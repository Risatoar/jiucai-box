import { describe, expect, it } from 'vitest'
import type { HouseholdAccount, HouseholdMember, HouseholdPosition, TradeMasterSnapshot } from '../shared/types'
import { parsePositionStrategy, positionStrategySignature } from './position-strategy'

const member: HouseholdMember = { id: 'wife', name: '老婆', relationship: '配偶', riskProfile: 'balanced', monitoringEnabled: true, isOwner: false, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' }
const position: HouseholdPosition = { instrument: { code: '600111', name: '北方稀土', type: 'stock', exchange: 'SH' }, quantity: 700, availableQuantity: 700, averageCost: 61.26, status: 'confirmed' }
const account: HouseholdAccount = { id: 'wife-account', memberId: member.id, name: '老婆的账户', source: 'managed', totalAsset: 160_000, cash: 20_000, monitoringEnabled: true, positions: [position], updatedAt: '2026-07-21T03:00:00.000Z' }
const target = { member, account, position }
const snapshot = { home: '/tmp/trade-master', household: { members: [member], accounts: [account], updatedAt: account.updatedAt }, discipline: { state: 'CAUTION' }, goals: {}, userProfile: {}, strategies: {}, evolution: {} } as TradeMasterSnapshot

const response = JSON.stringify({
  verdict: '制定回本计划',
  summary: '先控制风险，不用新增资金追赶亏损。',
  breakEvenPlan: { summary: '分阶段降低回本难度。', steps: ['反弹确认后分批处理'] },
  profitPlan: { summary: '当前不适用。', steps: ['不应展示'] },
  timeframes: {
    short: { goal: '控制波动', stance: '观察', actions: ['等待闭合K线'], triggers: ['重新站稳关键位'], invalidation: ['跌破防守位'] },
    medium: { goal: '降低成本压力', stance: '分批评估', actions: [], triggers: [], invalidation: [] },
    long: { goal: '验证长期逻辑', stance: '材料不足', actions: [], triggers: [], invalidation: [] }
  },
  positionManagement: { summary: '仓位偏高。', actions: ['不新增风险'], noAddConditions: ['账户现金未确认'] },
  perspectives: {
    macro: { status: '材料不足', summary: '未接入资讯源。', evidence: [] },
    sector: { status: '材料不足', summary: '未接入板块源。', evidence: [] },
    company: { status: '中性', summary: '只看到估值快照。', evidence: ['动态市盈率已读取'] }
  },
  riskControls: ['不承诺回本'],
  nextChecks: ['下一根完整日线'],
  missingFacts: ['交易费用'],
  confidence: '中'
})

describe('position strategy', () => {
  it('keeps position metrics deterministic and activates only the relevant plan', () => {
    const analysis = parsePositionStrategy(response, target, 39.13, '2026-07-21T07:00:00.000Z')
    expect(analysis.positionSnapshot.pnl).toBeCloseTo(-15491)
    expect(analysis.positionSnapshot.exposurePercent).toBeCloseTo(17.119)
    expect(analysis.breakEvenPlan.applicable).toBe(true)
    expect(analysis.profitPlan).toMatchObject({ applicable: false, steps: [] })
    expect(analysis.perspectives.macro.status).toBe('材料不足')
  })

  it('invalidates the cache signature when the account holding changes', () => {
    const current = positionStrategySignature(snapshot, target)
    const nextAccount = { ...account, positions: [{ ...position, quantity: 600 }], updatedAt: '2026-07-21T04:00:00.000Z' }
    expect(positionStrategySignature({ ...snapshot, household: { members: [member], accounts: [nextAccount], updatedAt: nextAccount.updatedAt } }, { member, account: nextAccount, position: nextAccount.positions[0] })).not.toBe(current)
  })
})
