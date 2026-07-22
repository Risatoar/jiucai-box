import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { importStrategyCandidate, persistStrategyCandidate } from './strategy-candidate'

const previousTradeMasterHome = process.env.TRADE_MASTER_HOME

afterEach(() => {
  if (previousTradeMasterHome == null) delete process.env.TRADE_MASTER_HOME
  else process.env.TRADE_MASTER_HOME = previousTradeMasterHome
})

describe('createStrategyCandidate', () => {
  it('persists a validated non-promoted JSON candidate', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-candidate-'))
    const result = await persistStrategyCandidate('缩短可转债急跌确认周期', {
      title: '可转债急跌确认优化', problem: '现有确认可能偏慢', target_rule: 'cbond.fast_drop_confirmation', risk_level: 'L2',
      proposed_rules: ['完整 5m K 确认'], acceptance_checks: ['历史样本不少于30'], rollback_plan: '未上线前不生效'
    })
    const saved = JSON.parse(await readFile(result.file, 'utf8')) as Record<string, unknown>
    expect(saved.status).toBe('collecting_evidence')
    expect(saved.auto_promoted).toBe(false)
    expect(saved.source).toMatchObject({ kind: 'jiucai-box-conversation' })
  })

  it('imports an exported strategy as a non-promoted candidate', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-candidate-import-'))
    const result = await importStrategyCandidate(JSON.stringify({
      schemaVersion: 1,
      strategy: { id: 'etf.imported-rule', name: 'ETF 导入规则', description: '人工调整后重新验证', rules: ['完整 5m K 线确认', '跌破止损位不补仓'] }
    }))
    const saved = JSON.parse(await readFile(result.file, 'utf8')) as Record<string, unknown>
    expect(saved).toMatchObject({ target_rule: 'etf.imported-rule', status: 'collecting_evidence', auto_promoted: false })
    expect(saved.proposed_rules).toEqual(['完整 5m K 线确认', '跌破止损位不补仓'])
    expect(saved.source).toMatchObject({ kind: 'jiucai-box-json-import', imported_id: 'etf.imported-rule' })
  })

  it('rejects malformed or incomplete strategy JSON', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-candidate-invalid-'))
    await expect(importStrategyCandidate('{broken')).rejects.toThrow('JSON 格式不正确')
    await expect(importStrategyCandidate(JSON.stringify({ strategy: { id: 'missing-rules', name: '缺少规则' } }))).rejects.toThrow('rules 必须是非空字符串数组')
  })
})
