import type { AiStreamEvent, ChatRunSnapshot } from '../shared/types'

interface ActiveChatRun {
  snapshot: ChatRunSnapshot
  controller: AbortController
}

const activeRuns = new Map<string, ActiveChatRun>()

export const startChatRun = (requestId: string, sessionId: string): ActiveChatRun => {
  if (activeRuns.has(sessionId)) throw new Error('这个会话正在生成回复，请先等待或停止当前执行')
  const run: ActiveChatRun = {
    controller: new AbortController(),
    snapshot: { requestId, sessionId, startedAt: Date.now(), status: '正在连接 AI', content: '' }
  }
  activeRuns.set(sessionId, run)
  return run
}

export const updateChatRun = (sessionId: string, event: AiStreamEvent): ChatRunSnapshot | null => {
  const active = activeRuns.get(sessionId)
  if (!active) return null
  if (event.type === 'status' && event.message) active.snapshot = { ...active.snapshot, status: event.message }
  if (event.type === 'content' && event.content) {
    const content = event.mode === 'append' ? `${active.snapshot.content}${event.content}` : event.content
    active.snapshot = { ...active.snapshot, content, status: '正在生成回答' }
  }
  return { ...active.snapshot }
}

export const getChatRun = (sessionId: string): ChatRunSnapshot | null => {
  const active = activeRuns.get(sessionId)
  return active ? { ...active.snapshot } : null
}

export const listChatRuns = (): ChatRunSnapshot[] => [...activeRuns.values()].map((run) => ({ ...run.snapshot }))

export const cancelChatRun = (sessionId: string): boolean => {
  const active = activeRuns.get(sessionId)
  if (!active) return false
  active.snapshot = { ...active.snapshot, status: '正在停止' }
  active.controller.abort()
  return true
}

export const finishChatRun = (sessionId: string): ChatRunSnapshot | null => {
  const snapshot = getChatRun(sessionId)
  activeRuns.delete(sessionId)
  return snapshot
}
