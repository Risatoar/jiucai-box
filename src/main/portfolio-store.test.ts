import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { recordConfirmedTrade } from './portfolio-store'

const previousHome = process.env.TRADE_MASTER_HOME
afterEach(() => { if (previousHome == null) delete process.env.TRADE_MASTER_HOME; else process.env.TRADE_MASTER_HOME = previousHome })

describe('recordConfirmedTrade', () => {
  it('writes confirmed buys and prevents overselling', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-portfolio-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(home, { recursive: true })
    await writeFile(join(home, 'portfolio.json'), JSON.stringify({ cash: 10000, total_asset: 10000, positions: [], historical_order_events: [] }))
    const instrument = { code: '510300', name: '沪深300ETF', type: 'etf' as const, exchange: 'SH' as const }
    await recordConfirmedTrade({ code: '510300', side: 'buy', quantity: 100, price: 3.5, fee: 1 }, instrument)
    const saved = JSON.parse(await readFile(join(home, 'portfolio.json'), 'utf8')) as { cash: number; positions: Array<{ quantity: number; average_cost: number }> }
    expect(saved.cash).toBe(9649)
    expect(saved.positions[0]).toMatchObject({ quantity: 100, average_cost: 3.51 })
    await expect(recordConfirmedTrade({ code: '510300', side: 'sell', quantity: 101, price: 3.6 }, instrument)).rejects.toThrow('卖出数量超过确认持仓')
  })
})
