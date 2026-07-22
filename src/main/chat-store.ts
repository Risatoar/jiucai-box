import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatMessage, ChatSession, ChatSessionSummary } from '../shared/types'
import { recordAccountStateConfirmation } from './account-state-store'

const sessionsDirectory = () => join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'conversations')

const normalizeTitle = (session: ChatSession): string => {
  if (session.title && session.title !== '新对话') return session.title
  const firstQuestion = session.messages.find((message) => message.role === 'user')?.content.trim()
  if (!firstQuestion) return '新对话'
  return firstQuestion.replace(/\s+/g, ' ').slice(0, 24)
}

const normalizeSession = (session: ChatSession): ChatSession => ({
  ...session,
  title: normalizeTitle(session),
  messageCount: session.messages.length
})

const sessionPath = (id: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('会话 ID 非法')
  return join(sessionsDirectory(), `${id}.json`)
}

export const createChatSession = async (): Promise<ChatSession> => {
  const existingEmpty = (await listChatSessions()).find((session) => session.messageCount === 0)
  if (existingEmpty) return loadChatSession(existingEmpty.id)
  const now = new Date().toISOString()
  const session: ChatSession = { id: randomUUID(), title: '新对话', createdAt: now, updatedAt: now, messageCount: 0, messages: [] }
  return saveChatSession(session)
}

export const getOrCreateNamedSession = async (id: string, title: string): Promise<ChatSession> => {
  try { return await loadChatSession(id) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const now = new Date().toISOString()
    return saveChatSession({ id, title, createdAt: now, updatedAt: now, messageCount: 0, messages: [] })
  }
}

export const appendNamedSessionMessage = async (id: string, title: string, message: ChatMessage): Promise<ChatSession> => {
  const session = await getOrCreateNamedSession(id, title)
  return saveChatSession({ ...session, archivedAt: undefined, messages: [...session.messages, message] })
}

export const appendChatSessionMessage = async (id: string, message: ChatMessage): Promise<ChatSession> => {
  const session = await loadChatSession(id)
  if (session.messages.some((item) => item.id === message.id)) return session
  return saveChatSession({ ...session, messages: [...session.messages, message] })
}

const writeChatSession = async (input: ChatSession, touchUpdatedAt: boolean): Promise<ChatSession> => {
  const session = normalizeSession({ ...input, updatedAt: touchUpdatedAt ? new Date().toISOString() : input.updatedAt })
  const directory = sessionsDirectory()
  await mkdir(directory, { recursive: true })
  const target = sessionPath(session.id)
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
  return session
}

export const saveChatSession = async (input: ChatSession): Promise<ChatSession> => {
  let existingIds = new Set<string>()
  try { existingIds = new Set((await loadChatSession(input.id)).messages.map((message) => message.id)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const saved = await writeChatSession(input, true)
  const newUserMessages = saved.messages.filter((message) => message.role === 'user' && !existingIds.has(message.id))
  for (const message of newUserMessages) await recordAccountStateConfirmation(message).catch(() => false)
  return saved
}

export const setChatSessionArchived = async (id: string, archived: boolean): Promise<ChatSession> => {
  const session = await loadChatSession(id)
  return writeChatSession({ ...session, archivedAt: archived ? new Date().toISOString() : undefined }, false)
}

export const loadChatSession = async (id: string): Promise<ChatSession> => {
  const raw = await readFile(sessionPath(id), 'utf8')
  return normalizeSession(JSON.parse(raw) as ChatSession)
}

export const listChatSessions = async (archived = false): Promise<ChatSessionSummary[]> => {
  try {
    const files = (await readdir(sessionsDirectory())).filter((file) => file.endsWith('.json'))
    const sessions = await Promise.all(files.map(async (file) => {
      try { return await loadChatSession(file.slice(0, -5)) }
      catch { return null }
    }))
    let keptEmpty = false
    return sessions
      .filter((session): session is ChatSession => session !== null)
      .filter((session) => archived ? Boolean(session.archivedAt) : !session.archivedAt)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .filter((session) => {
        if (archived) return true
        if (session.messageCount > 0) return true
        if (keptEmpty) return false
        keptEmpty = true
        return true
      })
      .map(({ messages: _messages, ...summary }) => summary)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
