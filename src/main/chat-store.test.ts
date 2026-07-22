import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendNamedSessionMessage, createChatSession, listChatSessions, loadChatSession, onChatSessionChanged, saveChatSession, setChatSessionArchived } from './chat-store'

const previousHome = process.env.TRADE_MASTER_HOME

afterEach(() => {
  if (previousHome == null) delete process.env.TRADE_MASTER_HOME
  else process.env.TRADE_MASTER_HOME = previousHome
})

describe('chat-store', () => {
  it('persists messages and derives a real conversation title', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-chat-'))
    const created = await createChatSession()
    const saved = await saveChatSession({
      ...created,
      messages: [{ id: 'm1', role: 'user', content: '分析当前持仓的风险和执行策略', timestamp: '16:00' }],
      messageCount: 1
    })
    expect(saved.title).toBe('分析当前持仓的风险和执行策略')
    expect((await listChatSessions())[0]).toMatchObject({ id: created.id, messageCount: 1 })
    expect((await loadChatSession(created.id)).messages[0].content).toContain('当前持仓')
    expect(await readFile(join(process.env.TRADE_MASTER_HOME, 'conversations', `${created.id}.json`), 'utf8')).toContain('分析当前持仓')
  })

  it('keeps an automation task in a dedicated underscore-safe session', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-automation-chat-'))
    const saved = await appendNamedSessionMessage('automation-pre_market', '盘前交易策略 · 定时任务', {
      id: 'run-start', role: 'assistant', content: '定时任务已开始手动执行', timestamp: '17:50', status: 'normal'
    })

    expect(saved).toMatchObject({ id: 'automation-pre_market', title: '盘前交易策略 · 定时任务', messageCount: 1 })
    expect((await listChatSessions())[0].id).toBe('automation-pre_market')
  })

  it('publishes a session change after an automation result is persisted', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-automation-session-event-'))
    const changed: Array<{ id: string; messageCount: number }> = []
    const unsubscribe = onChatSessionChanged((session) => changed.push({ id: session.id, messageCount: session.messageCount }))

    await appendNamedSessionMessage('automation-intraday', '盘中盯盘 · 定时任务', {
      id: 'run-finished', role: 'assistant', content: '定时任务执行完成。', timestamp: '13:15', status: 'normal'
    })
    unsubscribe()

    expect(changed.at(-1)).toEqual({ id: 'automation-intraday', messageCount: 1 })
  })

  it('archives and restores a conversation without deleting messages or changing recency', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-archived-chat-'))
    const created = await createChatSession()
    const saved = await saveChatSession({
      ...created,
      messages: [{ id: 'm1', role: 'user', content: '保留这段会话', timestamp: '18:00' }]
    })

    const archived = await setChatSessionArchived(saved.id, true)
    expect(archived.archivedAt).toBeTruthy()
    expect(archived.updatedAt).toBe(saved.updatedAt)
    expect(await listChatSessions()).toEqual([])
    expect((await listChatSessions(true))[0]).toMatchObject({ id: saved.id, archivedAt: archived.archivedAt })
    expect((await loadChatSession(saved.id)).messages[0].content).toBe('保留这段会话')

    const restored = await setChatSessionArchived(saved.id, false)
    expect(restored.archivedAt).toBeUndefined()
    expect((await listChatSessions())[0].id).toBe(saved.id)
    expect(await listChatSessions(true)).toEqual([])
  })
})
