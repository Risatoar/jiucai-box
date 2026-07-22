import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addAgentWatchItems, addWatchItem, loadActiveAgentWatchItems, loadAgentWatchItemsForReview, loadRuntimeCandidates, removeWatchItem, syncAgentWatchItems } from './watchlist-store'

const previousHome = process.env.TRADE_MASTER_HOME

afterEach(() => {
  if (previousHome == null) delete process.env.TRADE_MASTER_HOME
  else process.env.TRADE_MASTER_HOME = previousHome
})

describe('addWatchItem', () => {
  it('reactivates a closed item without duplicating it', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-watchlist-'))
    await addWatchItem({ code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH' })
    await addWatchItem({ code: '510300', name: '沪深300ETF华泰柏瑞', type: 'etf', exchange: 'SH' })
    const saved = JSON.parse(await readFile(join(process.env.TRADE_MASTER_HOME, 'watchlist.json'), 'utf8')) as { instruments: Array<Record<string, unknown>> }
    expect(saved.instruments).toHaveLength(1)
    expect(saved.instruments[0]).toMatchObject({ code: '510300', status: 'active', source: 'user' })
  })
  it('keeps user removal when a later agent scan sees the same code', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-watchlist-'))
    await addWatchItem({ code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH' })
    await removeWatchItem('510300')
    await addAgentWatchItems([{ code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH', score: 90 }])
    const saved = JSON.parse(await readFile(join(process.env.TRADE_MASTER_HOME, 'watchlist.json'), 'utf8')) as { instruments: Array<Record<string, unknown>> }
    expect(saved.instruments[0]).toMatchObject({ code: '510300', status: 'removed', removed_by: 'user' })
  })
  it('replaces stale agent recommendations while preserving user items', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-watchlist-'))
    await addWatchItem({ code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH' })
    await addAgentWatchItems([{ code: '113001', name: '旧推荐', type: 'cbond', exchange: 'SH', score: 70 }])
    const result = await syncAgentWatchItems([{ code: '600000', name: '新推荐', type: 'stock', exchange: 'SH', score: 92 }])
    const saved = JSON.parse(await readFile(join(process.env.TRADE_MASTER_HOME, 'watchlist.json'), 'utf8')) as { instruments: Array<Record<string, unknown>> }
    expect(result).toMatchObject({ added: 1, removed: 1, active: 1 })
    expect(saved.instruments.find((item) => item.code === '510300')).toMatchObject({ source: 'user', status: 'active' })
    expect(saved.instruments.find((item) => item.code === '113001')).toMatchObject({ source: 'agent', status: 'removed', removed_by: 'agent_refresh' })
    expect(saved.instruments.find((item) => item.code === '600000')).toMatchObject({ source: 'agent', status: 'active' })
  })
  it('loads up to twenty screened candidates for the AI review stage', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-watchlist-'))
    await mkdir(join(process.env.TRADE_MASTER_HOME, 'runtime'), { recursive: true })
    const candidates = Array.from({ length: 22 }, (_, index) => ({ type: 'stock', score: 90 - index, reasons: ['验证通过'], instrument: { code: `60${String(index).padStart(4, '0')}`, name: `候选${index}`, exchange: 'SH' } }))
    await writeFile(join(process.env.TRADE_MASTER_HOME, 'runtime/candidate-pool.json'), JSON.stringify({ candidates }))
    const loaded = await loadRuntimeCandidates()
    expect(loaded).toHaveLength(20)
    expect(loaded[0]).toMatchObject({ code: '600000', signal: '模型关注候选' })
  })
  it('loads only active AI discoveries for the next reevaluation', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-watchlist-'))
    await addAgentWatchItems([{ code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH', score: 91 }])
    await addWatchItem({ code: '600000', name: '浦发银行', type: 'stock', exchange: 'SH' })
    const loaded = await loadActiveAgentWatchItems()
    expect(loaded).toEqual([expect.objectContaining({ code: '510300', score: 91 })])
  })
  it('recovers the latest automated-removal batch for review after an empty-scan incident', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-watchlist-'))
    const instruments = [
      { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH', score: 91, source: 'agent', status: 'removed', removed_by: 'agent_refresh', removed_at: '2026-07-21T12:56:32.406Z' },
      { code: '110101', name: '宝钛转债', type: 'cbond', exchange: 'SH', score: 90, source: 'agent', status: 'removed', removed_by: 'agent_refresh', removed_at: '2026-07-21T12:56:32.406Z' },
      { code: '300058', name: '蓝色光标', type: 'stock', exchange: 'SZ', source: 'agent', status: 'removed', removed_by: 'user', removed_at: '2026-07-21T00:55:59.476Z' }
    ]
    await writeFile(join(process.env.TRADE_MASTER_HOME, 'watchlist.json'), JSON.stringify({ instruments }))
    const loaded = await loadAgentWatchItemsForReview()
    expect(loaded.map((item) => item.code)).toEqual(['510300', '110101'])
  })
})
