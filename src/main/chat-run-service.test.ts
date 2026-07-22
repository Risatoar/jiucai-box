import { describe, expect, it } from 'vitest'
import { cancelChatRun, finishChatRun, listChatRuns, startChatRun, updateChatRun } from './chat-run-service'

describe('chat run service', () => {
  it('在主进程保留流式输出并允许停止', () => {
    const active = startChatRun('request-1', 'session-service-test')
    updateChatRun('session-service-test', { type: 'content', content: '第一段', mode: 'append' })
    updateChatRun('session-service-test', { type: 'content', content: '第二段', mode: 'append' })

    expect(listChatRuns().find((run) => run.sessionId === 'session-service-test')?.content).toBe('第一段第二段')
    expect(cancelChatRun('session-service-test')).toBe(true)
    expect(active.controller.signal.aborted).toBe(true)
    finishChatRun('session-service-test')
  })
})
