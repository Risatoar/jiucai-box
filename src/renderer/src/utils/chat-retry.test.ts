import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../shared/types'
import { buildChatRetryContext } from './chat-retry'

describe('buildChatRetryContext', () => {
  it('重试失败回答时复用原问题和附件，不带入失败回答或后续消息', () => {
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: '分析这张持仓截图', timestamp: '10:00', attachments: [{ id: 'a1', name: 'position.png', mimeType: 'image/png', size: 12, kind: 'image', storageKey: 'a1' }] },
      { id: 'failed', role: 'assistant', content: '发送失败：超时', timestamp: '10:01', status: 'error' },
      { id: 'user-2', role: 'user', content: '另一个问题', timestamp: '10:02' }
    ]

    expect(buildChatRetryContext(messages, 'failed')).toEqual({
      latestQuestion: '分析这张持仓截图',
      messages: [{ role: 'user', content: '分析这张持仓截图', attachments: messages[0].attachments }]
    })
  })

  it('没有可重放的用户请求时返回空', () => {
    expect(buildChatRetryContext([{ id: 'failed', role: 'assistant', content: '失败', timestamp: '10:01', status: 'error' }], 'failed')).toBeNull()
  })
})
