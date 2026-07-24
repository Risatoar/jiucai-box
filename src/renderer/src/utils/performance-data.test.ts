import { describe, expect, it } from 'vitest'
import { upsertSessionSummary } from './chat-session-summary'
import { loadMarketQuoteUpdates, parseMarketQuoteBatch } from './market-quote-batch'

describe('performance data helpers', () => {
  it('updates a session summary without rebuilding the full conversation list', () => {
    const older = { id: 'old', title: '旧对话', createdAt: '2026-07-20', updatedAt: '2026-07-20', messageCount: 1 }
    const changed = { id: 'new', title: '新对话', createdAt: '2026-07-21', updatedAt: '2026-07-22', messageCount: 3 }
    expect(upsertSessionSummary([older, { ...changed, messageCount: 2 }], changed)).toEqual([changed, older])
  })

  it('indexes a batch of quotes by instrument code', () => {
    const updates = parseMarketQuoteBatch(JSON.stringify({ quotes: [
      { instrument: { code: '510300' }, price: 4.2, changeRatio: 0.01, amount: 120_000_000, exchangeTime: '2026-07-22T10:00:00+08:00' },
      { price: 3.1 }
    ] }), new Date('2026-07-22T10:01:00+08:00'))
    expect(updates.get('510300')).toMatchObject({ price: 4.2, change: 1, amount: '1.20亿' })
    expect(updates.size).toBe(1)
  })

  it('falls back to the old single-quote command when batch quotes are unavailable', async () => {
    const calls: string[][] = []
    const updates = await loadMarketQuoteUpdates(async (_command, args = []) => {
      calls.push(args)
      if (args[0] === 'quotes') return { ok: false, output: '', error: 'unknown subcommand' }
      const code = args[2]
      return { ok: true, output: JSON.stringify({ quotes: [{ instrument: { code }, price: 4.2, changeRatio: 0.01, amount: 20_000 }] }) }
    }, ['510300', '159915'])
    expect([...updates.keys()].sort()).toEqual(['159915', '510300'])
    expect(calls.filter((args) => args[0] === 'quote')).toHaveLength(2)
  })
})
