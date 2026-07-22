const draftKey = (sessionId: string) => `jiucai.chat.draft.${sessionId}`

export const loadChatDraft = (sessionId: string | null): string => {
  if (!sessionId) return ''
  try { return localStorage.getItem(draftKey(sessionId)) || '' }
  catch { return '' }
}

export const saveChatDraft = (sessionId: string | null, content: string): void => {
  if (!sessionId) return
  try {
    if (content) localStorage.setItem(draftKey(sessionId), content)
    else localStorage.removeItem(draftKey(sessionId))
  } catch { /* local draft storage is best effort */ }
}

export const clearChatDraft = (sessionId: string): void => saveChatDraft(sessionId, '')
