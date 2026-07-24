import { spawn } from 'node:child_process'
import type { AiConfig, AiMessageInput, AiStreamEvent, ChatAttachment } from '../shared/types'
import { normalizeCodexCliModel, resolveAiTimeoutMs } from '../shared/ai-config'
import { readAttachment, resolveAttachmentPath } from './attachment-store'
import { parseCodexJsonLine, readSseJson } from './ai-stream'
import { stripThinkingTags } from '../shared/ai-content-cleaner'
import { resolveCodexBinary } from './codex-models'

export interface AiExecutionOptions {
  purpose?: 'chat' | 'automation' | 'memory'
  timeoutMs?: number
  onEvent?: (event: AiStreamEvent) => void
  signal?: AbortSignal
  workingDirectory?: string
}

export const summarizeProcessError = (stderr: string, code: number | null): string => {
  const lines = stderr
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const errorLine = [...lines].reverse().find((line) => line.startsWith('ERROR:'))
  if (errorLine) {
    const detail = errorLine.replace(/^ERROR:\s*/, '')
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string }; message?: string }
      return parsed.error?.message || parsed.message || detail.slice(0, 500)
    } catch { return detail.slice(0, 500) }
  }
  return lines.at(-1)?.slice(0, 500) || `进程退出码 ${code}`
}

const stopChild = (child: ReturnType<typeof spawn>) => {
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid!, 'SIGTERM')
  } catch { child.kill('SIGTERM') }
}

const runProcess = (binary: string, args: string[], input: string, options: AiExecutionOptions): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: options.workingDirectory, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let stdout = ''
    let stderr = ''
    let finished = false
    let timer: NodeJS.Timeout | undefined
    const finish = (callback: () => void) => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      callback()
    }
    const abort = () => { stopChild(child); finish(() => reject(new Error('AI_EXECUTION_CANCELLED'))) }
    child.stdout.on('data', (data) => { stdout += String(data) })
    child.stderr.on('data', (data) => { stderr += String(data) })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => finish(() => code === 0 ? resolve(stripThinkingTags(stdout.trim())) : reject(new Error(summarizeProcessError(stderr, code)))))
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    if (options.timeoutMs && options.timeoutMs > 0) timer = setTimeout(() => {
      stopChild(child)
      finish(() => reject(new Error(`AI 执行超过 ${Math.round(options.timeoutMs! / 1000)} 秒，已停止本次任务`)))
    }, options.timeoutMs)
    child.stdin.end(input)
  })

const runJsonProcess = (binary: string, args: string[], input: string, options: AiExecutionOptions): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: options.workingDirectory, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let lineBuffer = ''
    let stderr = ''
    let finalText = ''
    let finished = false
    let timer: NodeJS.Timeout | undefined
    const finish = (callback: () => void) => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      callback()
    }
    const abort = () => { stopChild(child); finish(() => reject(new Error('AI_EXECUTION_CANCELLED'))) }
    const consumeLine = (line: string) => {
      if (!line.trim()) return
      try {
        const parsed = parseCodexJsonLine(line)
        if (parsed.finalText) finalText = parsed.finalText
        if (parsed.streamEvent) options.onEvent?.(parsed.streamEvent)
      } catch (error) { finish(() => reject(error)) }
    }
    child.stdout.on('data', (data) => {
      lineBuffer += String(data)
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() || ''
      for (const line of lines) consumeLine(line)
    })
    child.stderr.on('data', (data) => { stderr += String(data) })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => {
      if (lineBuffer) consumeLine(lineBuffer)
      finish(() => code === 0 && finalText ? resolve(stripThinkingTags(finalText)) : reject(new Error(stderr || `Codex 没有返回最终内容，退出码 ${code}`)))
    })
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    if (options.timeoutMs && options.timeoutMs > 0) timer = setTimeout(() => {
      stopChild(child)
      finish(() => reject(new Error(`AI 执行超过 ${Math.round(options.timeoutMs! / 1000)} 秒，已停止本次任务`)))
    }, options.timeoutMs)
    child.stdin.end(input)
  })

const attachmentData = async (attachment: ChatAttachment) => `data:${attachment.mimeType};base64,${(await readAttachment(attachment)).toString('base64')}`

const isEventStream = (response: Response) => response.headers.get('content-type')?.includes('text/event-stream')

const streamChatCompletion = async (response: Response, onEvent?: (event: AiStreamEvent) => void) => {
  let content = ''
  onEvent?.({ type: 'status', stage: 'writing', message: '模型已响应，正在生成内容' })
  await readSseJson(response, (event) => {
    const choices = event.choices as Array<{ delta?: { content?: string } }> | undefined
    const delta = choices?.[0]?.delta?.content
    if (!delta) return
    content += delta
    onEvent?.({ type: 'content', stage: 'writing', content: delta, mode: 'append' })
  })
  return content.trim() || '模型没有返回内容'
}

const streamResponses = async (response: Response, onEvent?: (event: AiStreamEvent) => void) => {
  let content = ''
  await readSseJson(response, (event) => {
    if (event.type === 'response.created' || event.type === 'response.in_progress') {
      onEvent?.({ type: 'status', stage: 'thinking', message: '模型已响应，正在分析' })
    }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      content += event.delta
      onEvent?.({ type: 'content', stage: 'writing', content: event.delta, mode: 'append' })
    }
    if (event.type === 'error') throw new Error(typeof event.message === 'string' ? event.message : '模型流式响应失败')
  })
  return content.trim() || '模型没有返回内容'
}

const readChatResponse = async (response: Response, onEvent?: (event: AiStreamEvent) => void) => {
  if (isEventStream(response)) return streamChatCompletion(response, onEvent)
  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  return json.choices?.[0]?.message?.content?.trim() || '模型没有返回内容'
}

const readResponsesResponse = async (response: Response, onEvent?: (event: AiStreamEvent) => void) => {
  if (isEventStream(response)) return streamResponses(response, onEvent)
  const json = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
  return json.output_text?.trim() || json.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text?.trim() || '模型没有返回内容'
}

const callOpenAiCompatible = async (config: AiConfig, messages: AiMessageInput[], options: AiExecutionOptions): Promise<string> => {
  if (!config.apiKey) throw new Error('尚未配置 API Key')
  const attachments = messages.flatMap((message) => message.attachments || [])
  if (!attachments.length) {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: options.signal,
      body: JSON.stringify({ model: config.model, messages: messages.map(({ role, content }) => ({ role, content })), temperature: 0.2, stream: Boolean(options.onEvent) })
    })
    if (!response.ok) throw new Error(`模型接口返回 ${response.status}`)
    return readChatResponse(response, options.onEvent)
  }
  if (attachments.reduce((sum, item) => sum + item.size, 0) > 45 * 1024 * 1024) throw new Error('当前会话附件总量超过 45 MB，请拆分发送')
  const instructions = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const input = await Promise.all(messages.filter((message) => message.role !== 'system').map(async (message) => {
    if (message.role !== 'user' || !message.attachments?.length) return { role: message.role, content: message.content }
    const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: message.content }]
    for (const attachment of message.attachments) {
      const data = await attachmentData(attachment)
      content.push(attachment.kind === 'image'
        ? { type: 'input_image', image_url: data, detail: 'auto' }
        : { type: 'input_file', filename: attachment.name, file_data: data })
    }
    return { role: message.role, content }
  }))
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${config.apiKey}` },
    signal: options.signal,
    body: JSON.stringify({ model: config.model, instructions, input, stream: Boolean(options.onEvent) })
  })
  if (!response.ok && attachments.every((attachment) => attachment.kind === 'image') && [404, 405].includes(response.status)) {
    const chatMessages = await Promise.all(messages.map(async (message) => {
      if (message.role !== 'user' || !message.attachments?.length) return { role: message.role, content: message.content }
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: message.content }]
      for (const attachment of message.attachments) content.push({ type: 'image_url', image_url: { url: await attachmentData(attachment) } })
      return { role: message.role, content }
    }))
    const fallback = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      signal: options.signal,
      body: JSON.stringify({ model: config.model, messages: chatMessages, temperature: 0.2, stream: Boolean(options.onEvent) })
    })
    if (!fallback.ok) throw new Error(`模型图片接口返回 ${fallback.status}`)
    return readChatResponse(fallback, options.onEvent)
  }
  if (!response.ok) throw new Error(`模型文件接口返回 ${response.status}：${(await response.text()).slice(0, 300)}`)
  return readResponsesResponse(response, options.onEvent)
}

export const buildCodexExecArgs = (config: AiConfig, imageArgs: string[], purpose: AiExecutionOptions['purpose'] = 'chat', streaming = false, workingDirectory?: string) => {
  const selectedModel = normalizeCodexCliModel(config.codexModel || config.model)
  const modelArgs = selectedModel ? ['--model', selectedModel] : []
  return purpose === 'automation' || purpose === 'memory'
    ? ['exec', ...modelArgs, '--ephemeral', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never', ...(streaming ? ['--json'] : []), ...imageArgs, '-']
    : ['exec', ...modelArgs, '-c', 'approval_policy="never"', '--sandbox', 'workspace-write', '--skip-git-repo-check', ...(workingDirectory ? ['--cd', workingDirectory] : []), ...(streaming ? ['--json'] : []), ...imageArgs, '-']
}

const callCodex = async (config: AiConfig, messages: AiMessageInput[], options: AiExecutionOptions = {}): Promise<string> => {
  const attachments = messages.flatMap((message) => message.attachments || [])
  const images = [...new Set(attachments.filter((attachment) => attachment.kind === 'image').map((attachment) => resolveAttachmentPath(attachment.storageKey)))]
  const prompt = [
    '你是韭菜盒子的交易辅助 Agent。只做分析和提醒，不操作券商，不承诺盈利。',
    '结论优先；持仓事实不明时必须标记待确认；买卖建议必须说明触发、失效、成本状态和下一检查点。',
    '用户主要是没有投资基础的宝妈。使用日常中文，先说结论和下一步；少用行业缩写、英文和抽象名词。必须使用专业词时，紧接着用一句白话解释。不要说“事实仓、决策闸门、风险暴露、策略进化、审计契约、影子运行”。',
    ...(options.purpose === 'automation' ? ['这是一次后台自动化分析。宿主已完成工具调用；不要调用任何外部工具、MCP 或 skill，只基于下方事实和工具证据给出最终结果。'] : []),
    ...(options.purpose === 'memory' ? ['这是一次本地记忆提取。不要调用任何外部工具、MCP 或 skill；只输出要求的 JSON。'] : []),
    ...messages.map((message) => {
      const files = (message.attachments || []).filter((attachment) => attachment.kind === 'file').map((attachment) => `- ${attachment.name}: ${resolveAttachmentPath(attachment.storageKey)}`).join('\n')
      return `${message.role === 'system' ? '事实上下文' : message.role === 'user' ? '用户' : '助手'}：${message.content}${files ? `\n本地附件（请读取并分析）：\n${files}` : ''}`
    })
  ].join('\n\n')
  const binary = await resolveCodexBinary(config.codexPath)
  const imageArgs = images.flatMap((path) => ['--image', path])
  const streaming = Boolean(options.onEvent)
  try {
    const args = buildCodexExecArgs(config, imageArgs, options.purpose, streaming, options.workingDirectory)
    return streaming ? await runJsonProcess(binary, args, prompt, options) : await runProcess(binary, args, prompt, options)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('未找到本机 Codex。请在设置中填写 Codex 可执行文件路径，或改用 OpenAI 兼容 API。')
    }
    throw error
  }
}

export const sendAiMessage = async (config: AiConfig, messages: AiMessageInput[], options: AiExecutionOptions = {}): Promise<string> => {
  const timeoutMs = options.timeoutMs ?? resolveAiTimeoutMs(config.timeoutSeconds)
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  const resolvedOptions = { ...options, timeoutMs, signal: controller.signal }
  try {
    if (config.provider === 'openai-compatible') return stripThinkingTags(await callOpenAiCompatible(config, messages, resolvedOptions))
    if (config.provider === 'codex-local') return stripThinkingTags(await callCodex(config, messages, resolvedOptions))
    throw new Error('不支持的 AI Provider')
  } catch (error) {
    if (timedOut) throw new Error(`AI 执行超过 ${Math.round(timeoutMs / 1000)} 秒，已停止本次任务`)
    throw error
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
