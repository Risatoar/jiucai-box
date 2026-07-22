import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildMemoryContext, createMemory, deleteMemory, loadMemories, saveMemorySettings, selectRelevantMemories, updateMemory } from './memory-store'

const previousHome = process.env.TRADE_MASTER_HOME

afterEach(() => {
  if (previousHome == null) delete process.env.TRADE_MASTER_HOME
  else process.env.TRADE_MASTER_HOME = previousHome
})

describe('memory-store', () => {
  it('persists, deduplicates, updates and deletes memories', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-memory-'))
    const created = await createMemory({ content: ' 用户偏好先看结论 ', category: 'preference' }, 'session-1')
    const duplicate = await createMemory({ content: '用户偏好先看结论', category: 'preference' }, 'session-2')
    expect(duplicate.id).toBe(created.id)
    expect((await loadMemories()).items).toHaveLength(1)

    const updated = await updateMemory(created.id, { pinned: true, content: '用户偏好先看结论，再看证据' })
    expect(updated).toMatchObject({ pinned: true, content: '用户偏好先看结论，再看证据' })
    expect(await deleteMemory(created.id)).toBe(true)
    expect((await loadMemories()).items).toEqual([])
  })

  it('retrieves relevant items and honors global and per-chat switches', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-memory-context-'))
    await createMemory({ content: '用户做股票分析时偏好先看风险结论', category: 'preference' })
    await createMemory({ content: '用户复盘时会记录交易成本', category: 'habit' })
    expect((await selectRelevantMemories('帮我分析股票风险')).map((item) => item.category)).toContain('preference')
    expect(await buildMemoryContext('复盘交易成本')).toContain('用户复盘时会记录交易成本')
    expect(await selectRelevantMemories('股票', { useMemories: false, generateMemories: true })).toEqual([])
    await saveMemorySettings({ useMemories: false, generateMemories: true })
    expect(await selectRelevantMemories('股票')).toEqual([])
  })
})
