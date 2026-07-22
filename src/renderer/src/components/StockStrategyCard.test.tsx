import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StockStrategyCardData } from '../../../shared/types'
import { StockStrategyTags } from './StockStrategyCard'

const baseCard: StockStrategyCardData = {
  code: '510300', name: '沪深300ETF', instrumentType: 'etf', signal: 'strong_buy',
  currentPrice: '4.12', changePercent: '+1.20%', stance: '可关注', summary: '闭合结构和量能已经确认',
  buyPoints: [{ label: '回踩买点', price: '4.10-4.12', condition: '回踩不破并保持量能' }], sellPoints: [],
  risks: [], evidence: ['5分钟与15分钟结构确认'], confidence: '高', dataAsOf: '10:15'
}

describe('StockStrategyTags signal hierarchy', () => {
  it('renders a strong signal as an immediately visible highlighted card', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[baseCard, { ...baseCard, code: '600000', name: '普通观察', signal: 'none', stance: '等待确认' }]} />)
    expect(html).toContain('stock-signal-highlight buy')
    expect(html).toContain('重点买入信号')
    expect(html).toContain('回踩买点 · 4.10-4.12')
    expect(html.indexOf('重点买入信号')).toBeLessThan(html.indexOf('普通观察'))
  })

  it('keeps observation-only cards compact without a false highlight', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[{ ...baseCard, signal: 'none' }]} />)
    expect(html).not.toContain('stock-signal-highlight')
    expect(html).toContain('stock-strategy-tag')
  })

  it('shows the account scope for the same instrument in separate accounts', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[
      { ...baseCard, signal: 'none', accountScope: '我 → 我的主账户' },
      { ...baseCard, signal: 'none', accountScope: '老婆 → 老婆的账户' }
    ]} />)

    expect(html).toContain('我 → 我的主账户')
    expect(html).toContain('老婆 → 老婆的账户')
    expect(html.match(/stock-strategy-tag /g)).toHaveLength(2)
  })
})
