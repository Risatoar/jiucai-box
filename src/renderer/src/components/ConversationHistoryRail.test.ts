import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../shared/types'
import { buildConversationTurns } from './ConversationHistoryRail'

describe('buildConversationTurns', () => {
  it('按用户提问划分轮次，并用最后一条回复作为摘要', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: '## 看看持仓', timestamp: '10:00' },
      { id: 'a1', role: 'assistant', content: '先核对仓位。', timestamp: '10:01' },
      { id: 'a2', role: 'assistant', content: '**结论**：今天先观察。', timestamp: '10:02' },
      { id: 'u2', role: 'user', content: '明天呢？', timestamp: '10:03' }
    ]
    const turns = buildConversationTurns(messages)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ targetMessageId: 'u1', title: '看看持仓', excerpt: '结论：今天先观察。' })
    expect(turns[1]).toMatchObject({ targetMessageId: 'u2', title: '明天呢？', excerpt: '明天呢？' })
  })

  it('保留轮次内不重复的附件，并兼容只有助手消息的会话', () => {
    const attachment = { id: 'file-1', name: '复盘.pdf', mimeType: 'application/pdf', size: 12, kind: 'file' as const, storageKey: 'files/review.pdf' }
    const turns = buildConversationTurns([
      { id: 'a1', role: 'assistant', content: '定时检查已完成。', timestamp: '18:00', attachments: [attachment] },
      { id: 'a2', role: 'assistant', content: '没有发现新的风险。', timestamp: '18:01', attachments: [attachment] }
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].attachments).toEqual([attachment])
    expect(turns[0].title).toBe('定时检查已完成。')
  })
})
