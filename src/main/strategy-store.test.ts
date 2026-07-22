import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectCandidatePromotion, setStrategyState } from './strategy-store'

const previousHome = process.env.TRADE_MASTER_HOME
afterEach(() => { if (previousHome == null) delete process.env.TRADE_MASTER_HOME; else process.env.TRADE_MASTER_HOME = previousHome })

describe('strategy-store', () => {
  it('pauses and restores a rule with a version snapshot', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-strategy-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(join(home, 'strategies'), { recursive: true })
    await writeFile(join(home, 'strategies/active.json'), JSON.stringify({ version: '1', rules: [{ id: 'r1', instrument_type: 'etf' }] }))
    await setStrategyState('r1', 'pause')
    expect(JSON.parse(await readFile(join(home, 'strategies/active.json'), 'utf8')).rules).toEqual([])
    await setStrategyState('r1', 'enable')
    expect(JSON.parse(await readFile(join(home, 'strategies/active.json'), 'utf8')).rules[0].id).toBe('r1')
  })

  it('fails closed with a useful result for a migrated candidate without evidence', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-strategy-candidate-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(join(home, 'strategies/candidates'), { recursive: true })
    await writeFile(join(home, 'strategies/candidates/legacy.json'), JSON.stringify({ id: 'legacy', target_rule: 'etf.fast_move', status: 'collecting_evidence' }))

    const readiness = await inspectCandidatePromotion('legacy')

    expect(readiness.ready).toBe(false)
    expect(readiness.evidence).toMatchObject({ history_samples: 0, out_of_sample_samples: 0, shadow_days: 0 })
    expect(readiness.message).toContain('正在使用的规则没有变化')
  })

  it('allows validation only after the candidate contract is complete', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-strategy-ready-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(join(home, 'strategies/candidates'), { recursive: true })
    await writeFile(join(home, 'strategies/candidates/ready.json'), JSON.stringify({
      id: 'ready', description: '完整候选', rule: { instrument_type: 'etf' },
      evidence: { history_samples: 30, out_of_sample_samples: 10, shadow_days: 5, drawdown_delta: 0, profit_factor: 1.1, conflicts: 0 }
    }))

    expect(await inspectCandidatePromotion('ready')).toMatchObject({ ready: true, evidence: { history_samples: 30, out_of_sample_samples: 10, shadow_days: 5 } })
  })
})
