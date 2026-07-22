import type { AiStreamEvent } from '../shared/types'

interface CodexJsonItem {
  type?: string
  text?: string
  command?: string
  name?: string
  message?: string
}

interface CodexJsonEvent {
  type?: string
  item?: CodexJsonItem
  message?: string
}

export interface ParsedCodexEvent {
  streamEvent?: AiStreamEvent
  finalText?: string
  completed?: boolean
}

const toolLabel = (item: CodexJsonItem) => {
  if (item.type === 'command_execution') return '正在读取本地数据'
  if (item.type === 'mcp_tool_call') return `正在调用${item.name ? ` ${item.name}` : '工具'}`
  if (item.type === 'web_search') return '正在检索信息'
  return '正在执行分析工具'
}

export const parseCodexJsonLine = (line: string): ParsedCodexEvent => {
  let event: CodexJsonEvent
  try { event = JSON.parse(line) as CodexJsonEvent }
  catch { return {} }
  if (event.type === 'thread.started') return { streamEvent: { type: 'status', stage: 'connecting', message: '本机 Codex 已连接' } }
  if (event.type === 'turn.started') return { streamEvent: { type: 'status', stage: 'thinking', message: '正在理解问题并规划分析' } }
  if (event.type === 'item.started' && event.item?.type && event.item.type !== 'agent_message') {
    return { streamEvent: { type: 'status', stage: 'tool', message: toolLabel(event.item) } }
  }
  if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text?.trim()) {
    const text = event.item.text.trim()
    return { finalText: text, streamEvent: { type: 'content', stage: 'writing', content: text, mode: 'replace' } }
  }
  if (event.type === 'turn.completed') return { completed: true, streamEvent: { type: 'status', stage: 'writing', message: '分析完成，正在保存结果' } }
  if (event.type === 'turn.failed' || event.type === 'error') throw new Error(event.message || '本机 Codex 执行失败')
  return {}
}

export const readSseJson = async (response: Response, onEvent: (event: Record<string, unknown>) => void) => {
  if (!response.body) throw new Error('模型接口没有返回可读数据流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const consume = (final = false) => {
    buffer = buffer.replace(/\r\n/g, '\n')
    const frames = buffer.split('\n\n')
    if (!final) buffer = frames.pop() || ''
    else buffer = ''
    for (const frame of frames) {
      const payload = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
      if (!payload || payload === '[DONE]') continue
      let event: Record<string, unknown>
      try { event = JSON.parse(payload) as Record<string, unknown> }
      catch { continue /* ignore malformed provider heartbeat frames */ }
      onEvent(event)
    }
  }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    consume()
  }
  buffer += decoder.decode()
  if (buffer.trim()) {
    buffer += '\n\n'
    consume(true)
  }
}
