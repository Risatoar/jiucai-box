import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearChatDraft, loadChatDraft, saveChatDraft } from './chat-draft'

describe('chat drafts', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('按会话隔离保存并在发送后清理', () => {
    saveChatDraft('session-a', '待发送 A')
    saveChatDraft('session-b', '待发送 B')
    expect(loadChatDraft('session-a')).toBe('待发送 A')
    expect(loadChatDraft('session-b')).toBe('待发送 B')
    clearChatDraft('session-a')
    expect(loadChatDraft('session-a')).toBe('')
  })
})
