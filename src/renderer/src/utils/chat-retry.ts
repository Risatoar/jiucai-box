import type { AiMessageInput, ChatMessage } from '../../../shared/types'

export interface ChatRetryContext {
  messages: AiMessageInput[]
  latestQuestion: string
}

export const buildChatRetryContext = (messages: ChatMessage[], failedMessageId: string): ChatRetryContext | null => {
  const failedIndex = messages.findIndex((message) => message.id === failedMessageId && message.role === 'assistant' && message.status === 'error')
  if (failedIndex < 0) return null
  const history = messages.slice(0, failedIndex)
  const latestUser = [...history].reverse().find((message) => message.role === 'user')
  if (!latestUser) return null
  return {
    latestQuestion: latestUser.content,
    messages: history.map(({ role, content, attachments }) => ({ role, content, attachments }))
  }
}
