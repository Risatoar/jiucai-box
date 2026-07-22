import { describe, expect, it } from 'vitest'
import type { StrategyDefinition } from '../../../shared/types'
import { buildStrategyTransferJson, strategyExportFilename } from './strategy-transfer'

const strategy: StrategyDefinition = {
  id: 'etf.fast move', name: 'ETF 快速涨跌应对', family: '测试', instruments: ['etf'], status: 'active', version: '1.2.0',
  description: '完整策略说明', rules: ['完整 5m K 线确认'], evidence: { history: 30, outOfSample: 10, shadowDays: 5 },
  performance: { winRate: 60, profitFactor: 1.4, maxDrawdown: 5 }, updatedAt: '2026-07-22', source: 'user'
}

describe('strategy transfer', () => {
  it('exports a complete round-trip payload', () => {
    const payload = JSON.parse(buildStrategyTransferJson(strategy, '2026-07-22T00:00:00.000Z'))
    expect(payload).toMatchObject({ schemaVersion: 1, kind: 'jiucai-box-strategy', exportedAt: '2026-07-22T00:00:00.000Z' })
    expect(payload.strategy).toMatchObject({ id: strategy.id, name: strategy.name, rules: strategy.rules, rollback: true })
  })

  it('creates a filesystem-safe JSON filename', () => {
    expect(strategyExportFilename(strategy)).toBe('etf.fast-move-v1.2.0.json')
  })
})
