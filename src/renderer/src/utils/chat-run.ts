import type { AiStreamEvent, ChatRunSnapshot } from '../../../shared/types'

export interface ChatRunState {
  sessionId: string
  startedAt: number
  status: string
  content: string
}

export type ChatRunMap = Record<string, ChatRunState>

export function hydrateChatRuns(runs: ChatRunSnapshot[]): ChatRunMap {
  return Object.fromEntries(runs.map(({ sessionId, startedAt, status, content }) => [sessionId, { sessionId, startedAt, status, content }]))
}

export function setChatRun(current: ChatRunMap, snapshot: ChatRunSnapshot): ChatRunMap {
  return { ...current, [snapshot.sessionId]: { sessionId: snapshot.sessionId, startedAt: snapshot.startedAt, status: snapshot.status, content: snapshot.content } }
}

export function startChatRun(current: ChatRunMap, sessionId: string, startedAt = Date.now()): ChatRunMap {
  if (current[sessionId]) return current
  return {
    ...current,
    [sessionId]: { sessionId, startedAt, status: '正在读取这次回答需要的信息', content: '' }
  }
}

export function updateChatRun(current: ChatRunMap, sessionId: string, event: AiStreamEvent): ChatRunMap {
  const run = current[sessionId]
  if (!run) return current
  if (event.type === 'status' && event.message) {
    return { ...current, [sessionId]: { ...run, status: event.message } }
  }
  if (event.type === 'content' && event.content) {
    const content = event.mode === 'append' ? `${run.content}${event.content}` : event.content
    return { ...current, [sessionId]: { ...run, content, status: '正在生成回答' } }
  }
  return current
}

export function finishChatRun(current: ChatRunMap, sessionId: string): ChatRunMap {
  if (!current[sessionId]) return current
  const next = { ...current }
  delete next[sessionId]
  return next
}
