import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import type { CodexModelOption } from '../shared/types'
import { normalizeCodexCliModel } from '../shared/ai-config'

interface JsonRpcMessage {
  id?: number
  result?: {
    data?: unknown[]
    nextCursor?: string | null
  }
  error?: {
    message?: string
  }
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export const normalizeCodexModels = (entries: unknown[]): CodexModelOption[] => {
  const seen = new Set<string>()
  const models: CodexModelOption[] = []
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    // Relay catalog ids may use `auto_model/<alias>`, while `codex --model`
    // accepts the bare alias. Keep picker values identical to execution args.
    const id = normalizeCodexCliModel(text(entry.id) || text(entry.model))
    if (!id || entry.hidden === true || seen.has(id)) continue
    seen.add(id)
    const efforts = Array.isArray(entry.supportedReasoningEfforts)
      ? entry.supportedReasoningEfforts.flatMap((effort) => {
        if (!effort || typeof effort !== 'object') return []
        const item = effort as Record<string, unknown>
        const reasoningEffort = text(item.reasoningEffort)
        return reasoningEffort ? [{ reasoningEffort, description: text(item.description) || undefined }] : []
      })
      : undefined
    models.push({
      id,
      displayName: text(entry.displayName) || id,
      description: text(entry.description) || undefined,
      isDefault: entry.isDefault === true,
      defaultReasoningEffort: text(entry.defaultReasoningEffort) || undefined,
      supportedReasoningEfforts: efforts,
      inputModalities: Array.isArray(entry.inputModalities) ? entry.inputModalities.map(text).filter(Boolean) : undefined
    })
  }
  return models
}

export const resolveCodexBinary = async (configuredPath?: string): Promise<string> => {
  const candidates = [
    configuredPath?.trim(),
    process.env.CODEX_BINARY,
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex'
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch { /* continue with the next known Codex location */ }
  }
  return 'codex'
}

const lastUsefulLine = (value: string) => value
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .at(-1)

export const listCodexModels = async (configuredPath?: string): Promise<{ models: CodexModelOption[]; codexPath: string }> => {
  const binary = await resolveCodexBinary(configuredPath)
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const collected: CodexModelOption[] = []
    let stdout = ''
    let stderr = ''
    let settled = false
    let activeListRequest = 0
    let nextRequestId = 2

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill('SIGTERM') } catch { /* process already stopped */ }
      if (error) reject(error)
      else resolve({ models: normalizeCodexModels(collected), codexPath: binary })
    }

    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`)
    const requestPage = (cursor?: string) => {
      activeListRequest = nextRequestId++
      send({
        method: 'model/list',
        id: activeListRequest,
        params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }
      })
    }

    const consumeLine = (line: string) => {
      if (!line.trim()) return
      let message: JsonRpcMessage
      try { message = JSON.parse(line) as JsonRpcMessage }
      catch { return }
      if (message.id === 1) {
        if (message.error) return finish(new Error(message.error.message || 'Codex 初始化失败'))
        send({ method: 'initialized', params: {} })
        requestPage()
        return
      }
      if (message.id !== activeListRequest) return
      if (message.error) return finish(new Error(message.error.message || 'Codex 模型列表读取失败'))
      collected.push(...normalizeCodexModels(message.result?.data || []))
      const nextCursor = message.result?.nextCursor
      if (nextCursor) requestPage(nextCursor)
      else finish()
    }

    child.stdout.on('data', (data) => {
      stdout += String(data)
      const lines = stdout.split('\n')
      stdout = lines.pop() || ''
      for (const line of lines) consumeLine(line)
    })
    child.stderr.on('data', (data) => { stderr += String(data) })
    child.stdin.on('error', (error) => finish(error))
    child.on('error', (error) => {
      const detail = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? '未找到本机 Codex。请确认已安装并登录 Codex，或填写 Codex 程序位置。'
        : error.message
      finish(new Error(detail))
    })
    child.on('close', (code) => {
      if (!settled) finish(new Error(lastUsefulLine(stderr) || `Codex 模型服务已退出（${code ?? '未知退出码'}）`))
    })

    const timer = setTimeout(() => finish(new Error('读取 Codex 模型超时，请确认 Codex 已安装并完成登录。')), 15_000)
    send({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'jiucai_box', title: '韭菜盒子', version: '0.1.4' } }
    })
  })
}
