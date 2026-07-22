import { describe, expect, it } from 'vitest'
import type { ChatSession } from '../../../shared/types'
import { conversationPreviewAttachments, conversationPreviewExcerpt } from './ConversationPreview'

const session: ChatSession = {
  id: 'preview', title: '持仓检查', createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-20T10:03:00.000Z', messageCount: 2,
  messages: [
    { id: 'm1', role: 'user', content: '看看持仓', timestamp: '18:00', attachments: [{ id: 'a1', name: '持仓.png', mimeType: 'image/png', size: 12, kind: 'image', storageKey: 'preview/a1.png' }] },
    { id: 'm2', role: 'assistant', content: '## 结论\n目前仓位不高，先观察。', timestamp: '18:01', attachments: [{ id: 'a2', name: '复盘.pdf', mimeType: 'application/pdf', size: 12, kind: 'file', storageKey: 'preview/a2.pdf' }] }
  ]
}

describe('ConversationPreview', () => {
  it('优先展示最近一条消息并清理 Markdown 标记', () => {
    expect(conversationPreviewExcerpt(session)).toBe('结论 目前仓位不高，先观察。')
  })

  it('按最近优先汇总会话附件', () => {
    expect(conversationPreviewAttachments(session).map((item) => item.name)).toEqual(['复盘.pdf', '持仓.png'])
  })
})
