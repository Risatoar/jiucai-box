import { describe, expect, it } from 'vitest'
import { finishChatRun, hydrateChatRuns, setChatRun, startChatRun, updateChatRun } from './chat-run'

describe('chat run state', () => {
  it('按会话保留并增量更新流式内容', () => {
    let runs = startChatRun({}, 'session-a', 1000)
    runs = startChatRun(runs, 'session-b', 2000)
    runs = updateChatRun(runs, 'session-a', { type: 'content', content: '第一段', mode: 'append' })
    runs = updateChatRun(runs, 'session-a', { type: 'content', content: '第二段', mode: 'append' })

    expect(runs['session-a']).toMatchObject({ startedAt: 1000, status: '正在生成回答', content: '第一段第二段' })
    expect(runs['session-b']).toMatchObject({ startedAt: 2000, content: '' })
  })

  it('支持替换输出并只结束目标会话', () => {
    let runs = startChatRun(startChatRun({}, 'session-a'), 'session-b')
    runs = updateChatRun(runs, 'session-a', { type: 'content', content: '完整回答', mode: 'replace' })
    runs = finishChatRun(runs, 'session-a')

    expect(runs['session-a']).toBeUndefined()
    expect(runs['session-b']).toBeDefined()
  })

  it('支持刷新页面后从主进程恢复运行态', () => {
    const restored = hydrateChatRuns([{ requestId: 'request-1', sessionId: 'session-a', startedAt: 1000, status: '正在分析', content: '已输出' }])
    const updated = setChatRun(restored, { requestId: 'request-1', sessionId: 'session-a', startedAt: 1000, status: '正在生成回答', content: '已输出更多' })
    expect(updated['session-a']).toEqual({ sessionId: 'session-a', startedAt: 1000, status: '正在生成回答', content: '已输出更多' })
  })
})
