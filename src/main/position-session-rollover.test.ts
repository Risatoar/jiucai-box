import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rolloverAvailableQuantitiesBeforeOpen } from './position-session-rollover'

const previousHome = process.env.TRADE_MASTER_HOME

afterEach(() => {
  if (previousHome == null) delete process.env.TRADE_MASTER_HOME
  else process.env.TRADE_MASTER_HOME = previousHome
})

describe('rolloverAvailableQuantitiesBeforeOpen', () => {
  it('sets primary and managed available quantities to confirmed holdings once before open', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-position-rollover-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(join(home, 'household'), { recursive: true })
    await writeFile(join(home, 'portfolio.json'), JSON.stringify({
      positions: [
        { instrument: { code: '159516' }, quantity: 3400, available_quantity: 0, status: 'confirmed' },
        { instrument: { code: '510300' }, quantity: 0, available_quantity: 100, status: 'closed' }
      ]
    }))
    await writeFile(join(home, 'household/portfolio.json'), JSON.stringify({
      accounts: [
        { id: 'primary-account', source: 'primary', positions: [{ quantity: 999, availableQuantity: 0 }] },
        { id: 'managed', source: 'managed', positions: [{ quantity: 200, availableQuantity: 0 }] }
      ]
    }))

    const result = await rolloverAvailableQuantitiesBeforeOpen(new Date('2026-07-22T08:50:00+08:00'))
    expect(result).toEqual({ status: 'updated', tradingDate: '2026-07-22', primaryPositions: 2, managedPositions: 1 })
    const portfolio = JSON.parse(await readFile(join(home, 'portfolio.json'), 'utf8'))
    expect(portfolio.positions.map((item: { available_quantity: number }) => item.available_quantity)).toEqual([3400, 0])
    expect(portfolio).toMatchObject({ available_quantity_trading_date: '2026-07-22', available_quantity_rollover_status: 'derived_from_confirmed_positions' })
    const household = JSON.parse(await readFile(join(home, 'household/portfolio.json'), 'utf8'))
    expect(household.accounts[0].positions[0].availableQuantity).toBe(0)
    expect(household.accounts[1].positions[0]).toMatchObject({ quantity: 200, availableQuantity: 200, availableQuantityTradingDate: '2026-07-22' })

    portfolio.positions[0].quantity = 3600
    await writeFile(join(home, 'portfolio.json'), JSON.stringify(portfolio))
    await expect(rolloverAvailableQuantitiesBeforeOpen(new Date('2026-07-22T09:20:00+08:00')))
      .resolves.toMatchObject({ status: 'updated', primaryPositions: 1, managedPositions: 0 })
    const refreshed = JSON.parse(await readFile(join(home, 'portfolio.json'), 'utf8'))
    expect(refreshed.positions[0].available_quantity).toBe(3600)
    await expect(rolloverAvailableQuantitiesBeforeOpen(new Date('2026-07-22T09:25:00+08:00')))
      .resolves.toMatchObject({ status: 'already_current', primaryPositions: 0, managedPositions: 0 })
  })

  it('does not reset quantities after the market opens', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-position-rollover-'))
    process.env.TRADE_MASTER_HOME = home
    await writeFile(join(home, 'portfolio.json'), JSON.stringify({ positions: [{ quantity: 3400, available_quantity: 1200 }] }))
    await expect(rolloverAvailableQuantitiesBeforeOpen(new Date('2026-07-22T10:00:00+08:00')))
      .resolves.toMatchObject({ status: 'outside_preopen' })
    const portfolio = JSON.parse(await readFile(join(home, 'portfolio.json'), 'utf8'))
    expect(portfolio.positions[0].available_quantity).toBe(1200)
  })
})
