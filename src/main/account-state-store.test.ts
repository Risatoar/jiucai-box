import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDailyAccountState, parseAccountStateConfirmation, recordAccountStateConfirmation } from './account-state-store'

describe('account-state-store', () => {
  beforeEach(async () => { process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-account-state-')) })
  afterEach(() => { delete process.env.TRADE_MASTER_HOME })

  it('parses only explicit account confirmations', () => {
    expect(parseAccountStateConfirmation('目前我是完全空仓，7580 的资金可用')).toEqual({ availableCash: 7580 })
    expect(parseAccountStateConfirmation('没有冻结资金，都可用，没有活动委托')).toEqual({ frozenCash: 0, activeOrders: 'none' })
    expect(parseAccountStateConfirmation('没有冻结资金啊，都可用，没有撤单')).toEqual({ frozenCash: 0 })
  })

  it('persists current-day facts and synchronizes confirmed cash to the primary portfolio', async () => {
    const time = new Date('2026-07-21T01:00:00.000Z')
    await recordAccountStateConfirmation({ id: 'cash', role: 'user', content: '7580 的资金可用', timestamp: '09:00' }, time)
    await recordAccountStateConfirmation({ id: 'cash', role: 'user', content: '7580 的资金可用', timestamp: '09:00' }, time)
    await recordAccountStateConfirmation({ id: 'frozen', role: 'user', content: '没有冻结资金，没有活动委托', timestamp: '09:01' }, time)

    const state = await loadDailyAccountState(time)
    expect(state).toMatchObject({ tradingDate: '2026-07-21', availableCash: { value: 7580 }, frozenCash: { value: 0 }, activeOrders: { value: 'none' }, processedMessageIds: ['cash', 'frozen'] })
    const portfolio = JSON.parse(await readFile(join(process.env.TRADE_MASTER_HOME!, 'portfolio.json'), 'utf8')) as Record<string, unknown>
    expect(portfolio).toMatchObject({ cash: 7580, cash_status: 'user_confirmed', frozen_cash: 0, active_orders_status: 'none' })
    expect(await loadDailyAccountState(new Date('2026-07-22T01:00:00.000Z'))).toBeNull()
  })
})
