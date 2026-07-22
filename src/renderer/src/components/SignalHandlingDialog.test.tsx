import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { HouseholdSnapshot, StockStrategyCardData } from '../../../shared/types'
import { SignalHandlingDialog } from './SignalHandlingDialog'

const household: HouseholdSnapshot = {
  members: [{ id: 'wife', name: '老婆', relationship: '配偶', riskProfile: 'conservative', monitoringEnabled: true, isOwner: false, createdAt: '', updatedAt: '' }],
  accounts: [{ id: 'wife-account', memberId: 'wife', name: '老婆的账户', source: 'managed', totalAsset: null, cash: null, monitoringEnabled: true, positions: [], updatedAt: '' }],
  updatedAt: ''
}
const card: StockStrategyCardData = { code: '600150', name: '中国船舶', accountScope: '老婆 → 老婆的账户', signal: 'strong_sell', currentPrice: '32.96', stance: '持仓管理', summary: '破位确认', buyPoints: [], sellPoints: [], risks: [], evidence: [], confidence: '高' }

describe('SignalHandlingDialog', () => {
  it('prefills signal direction, price and matched household account', () => {
    const html = renderToStaticMarkup(<SignalHandlingDialog card={card} household={household} onClose={() => undefined} onSave={async () => ({ ok: true })} />)
    expect(html).toContain('已卖出')
    expect(html).toContain('老婆 · 老婆的账户')
    expect(html).toContain('value="wife-account"')
    expect(html).toContain('value="32.96"')
    expect(html).toContain('确认已成交并登记')
    expect(html).toContain('这里不会发起下单')
  })
})
