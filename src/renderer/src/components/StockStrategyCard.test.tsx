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
  it('keeps an automation push collapsed by default', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[baseCard]} defaultExpanded={false} />)
    expect(html).toContain('<details class="stock-strategy-disclosure">')
    expect(html).toContain('本次策略推送')
    expect(html).toContain('1 个标的 · 强烈买入 1')
    expect(html).not.toContain('stock-strategy-details')
  })

  it('renders a strong signal as an immediately visible highlighted card', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[baseCard, { ...baseCard, code: '600000', name: '普通观察', signal: 'none', stance: '等待确认' }]} />)
    expect(html).toContain('stock-signal-highlight buy')
    expect(html).toContain('强烈买入')
    expect(html).toContain('回踩买点 · 4.10-4.12')
    expect(html.indexOf('强烈买入')).toBeLessThan(html.indexOf('普通观察'))
  })

  it('keeps observation-only cards compact without a false highlight', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[{ ...baseCard, signal: 'none' }]} />)
    expect(html).not.toContain('stock-signal-highlight')
    expect(html).toContain('stock-strategy-tag')
    expect(html).toContain('stock-card-signal watch')
    expect(html).toContain('关注')
  })

  it('distinguishes prepare-to-sell, watch and strong signals in the push summary', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[
      { ...baseCard, code: '300438', name: '鹏辉能源', signal: 'prepare_sell', sellPoints: [{ label: '准备减仓', condition: '下一根完整15分钟仍走弱' }] },
      { ...baseCard, code: '600011', name: '华能国际', signal: 'watch' },
      baseCard
    ]} defaultExpanded={false} />)

    expect(html).toContain('强烈买入 1 · 准备卖出 1 · 关注 1')
    expect(html).toContain('stock-signal-highlight sell prepare')
    expect(html).toContain('准备卖出')
  })

  it('shows the account scope for the same instrument in separate accounts', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[
      { ...baseCard, signal: 'none', accountScope: '我 → 我的主账户' },
      { ...baseCard, signal: 'none', accountScope: '老婆 → 老婆的账户' }
    ]} />)

    expect(html).toContain('我 → 我的主账户')
    expect(html).toContain('老婆 → 老婆的账户')
    expect(html.match(/stock-strategy-group account/g)).toHaveLength(2)
    expect(html.match(/stock-strategy-tag /g)).toHaveLength(2)
  })

  it('groups empty-account watchlist opportunities under the main account and labels their source', () => {
    const html = renderToStaticMarkup(<StockStrategyTags content={'## 我 → 我的主账户\n- 当前空仓，现金状态已确认\n- 我的收藏和AI发现已完成扫描'} cards={[
      { ...baseCard, code: '510300', signal: 'none', accountScope: '我 → 我的主账户', source: 'user' },
      { ...baseCard, code: '588000', name: '科创50ETF', signal: 'none', accountScope: '我 → 我的主账户', source: 'agent' }
    ]} />)

    expect(html.match(/stock-strategy-group account/g)).toHaveLength(1)
    expect(html).toContain('我的主账户')
    expect(html).toContain('我的收藏')
    expect(html).toContain('AI发现')
    expect(html).toContain('stock-account-overview')
    expect(html).toContain('当前空仓，现金状态已确认')
  })
})
