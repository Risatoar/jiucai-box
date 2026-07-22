import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { saveUserProfile } from './profile-store'

const previousHome = process.env.TRADE_MASTER_HOME
afterEach(() => { if (previousHome == null) delete process.env.TRADE_MASTER_HOME; else process.env.TRADE_MASTER_HOME = previousHome })

describe('saveUserProfile', () => {
  it('syncs onboarding into goals and strategy preferences', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-profile-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(home, { recursive: true })
    await writeFile(join(home, 'goals.json'), JSON.stringify({ constraints: { auto_order: false } }))
    await writeFile(join(home, 'strategy-profile.json'), JSON.stringify({ preferences: {}, behavioral_guardrails: [] }))
    await saveUserProfile({ capital: 10000, styles: ['短线'], experience: '1-3年', maxDrawdown: 8, targetReturn: 20, targetMonths: 12, instruments: ['etf'], tradingHabits: ['只看关键提醒'] })
    const goals = JSON.parse(await readFile(join(home, 'goals.json'), 'utf8'))
    const strategy = JSON.parse(await readFile(join(home, 'strategy-profile.json'), 'utf8'))
    expect(goals).toMatchObject({ current_asset: 10000, target_asset: 12000, max_drawdown: 0.08 })
    expect(strategy.preferences).toMatchObject({ trading_styles: ['短线'], allowed_instrument_types: ['etf'] })
  })
})
