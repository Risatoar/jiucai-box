import { describe, expect, it } from 'vitest'
import type { HouseholdSnapshot, StockStrategyCardData } from '../../../shared/types'
import { handlingLabel, priceFromSignal, resolveSignalAccountId, signalLabel, signalTradeSide } from './signal-handling'

const household: HouseholdSnapshot = {
  members: [
    { id: 'self', name: '我', relationship: '本人', riskProfile: 'balanced', monitoringEnabled: true, isOwner: true, createdAt: '', updatedAt: '' },
    { id: 'wife', name: '老婆', relationship: '配偶', riskProfile: 'conservative', monitoringEnabled: true, isOwner: false, createdAt: '', updatedAt: '' }
  ],
  accounts: [
    { id: 'primary-account', memberId: 'self', name: '我的主账户', source: 'primary', totalAsset: null, cash: null, monitoringEnabled: true, positions: [], updatedAt: '' },
    { id: 'wife-account', memberId: 'wife', name: '老婆的账户', source: 'managed', totalAsset: null, cash: null, monitoringEnabled: true, positions: [], updatedAt: '' }
  ],
  updatedAt: ''
}
const card = { code: '600150', name: '中国船舶', signal: 'strong_sell', stance: '持仓管理', summary: '破位', buyPoints: [], sellPoints: [], risks: [], evidence: [], confidence: '高' } satisfies StockStrategyCardData

describe('signal handling helpers', () => {
  it('maps an account-scoped signal to the exact independent account', () => {
    expect(resolveSignalAccountId({ ...card, accountScope: '老婆 → 老婆的账户' }, household)).toBe('wife-account')
    expect(resolveSignalAccountId({ ...card, accountScope: '未知人 → 未知账户' }, household)).toBe('')
    expect(resolveSignalAccountId(card, household)).toBe('primary-account')
  })

  it('derives direction, prices and persisted outcome labels', () => {
    expect(signalTradeSide(card)).toBe('sell')
    expect(signalLabel(card)).toBe('关注·下跌')
    expect(signalTradeSide({ ...card, signal: 'immediate_buy' })).toBe('buy')
    expect(signalLabel({ ...card, signal: 'immediate_buy', executionValidUntil: new Date(Date.now() - 1_000).toISOString() })).toContain('当前点位已过期')
    expect(priceFromSignal('¥32.96 附近')).toBe('32.96')
    expect(handlingLabel('executed', 'sell')).toBe('已卖出登记')
  })
})
