import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StockStrategyCardData } from '../../../shared/types'
import { StockStrategyDetails, StockStrategyTags } from './StockStrategyCard'

const baseCard: StockStrategyCardData = {
  code: '510300', name: '沪深300ETF', instrumentType: 'etf', signal: 'strong_buy',
  currentPrice: '4.12', changePercent: '+1.20%', stance: '可关注', summary: '闭合结构和量能已经确认',
  actionPurpose: '趋势回踩买入',
  buyPoints: [{ label: '回踩买点', price: '4.10-4.12', condition: '回踩不破并保持量能' }], sellPoints: [],
  risks: [], evidence: ['5分钟与15分钟结构确认'], confidence: '高', dataAsOf: '10:15'
}

describe('StockStrategyTags signal hierarchy', () => {
  it('keeps the push visible while leaving the stock details collapsed by default', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[baseCard]} />)
    expect(html).toContain('<details class="stock-strategy-disclosure" open="">')
    expect(html).toContain('本次数据观察推送')
    expect(html).toContain('1 个标的 · 关注·上涨 1')
    expect(html).toContain('stock-signal-highlight')
    expect(html).not.toContain('stock-strategy-details')
  })

  it('renders a strong signal as an immediately visible highlighted card', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[baseCard, { ...baseCard, code: '600000', name: '普通观察', signal: 'none', stance: '等待确认' }]} onHandleSignal={() => undefined} />)
    expect(html).toContain('stock-signal-highlight buy')
    expect(html).toContain('关注·上涨')
    expect(html).toContain('data-signal-description="上涨数据特征已经形成，建议结合自身情况独立复核')
    expect(html).toContain('回踩买点 · 4.10-4.12')
    expect(html).toContain('要做什么 · 趋势回踩买入')
    expect(html).toContain('登记处理')
    expect(html.indexOf('关注·上涨')).toBeLessThan(html.indexOf('普通观察'))
  })

  it('places an executable immediate signal above strong signals and marks readiness', () => {
    const now = Date.now()
    const immediate = {
      ...baseCard,
      code: '159915',
      name: '创业板ETF',
      signal: 'immediate_buy',
      dataAsOf: new Date(now - 30_000).toISOString(),
      executionValidUntil: new Date(now + 4 * 60_000).toISOString(),
      executionStatus: 'ready',
      executionBlockers: []
    } satisfies StockStrategyCardData
    const html = renderToStaticMarkup(<StockStrategyTags cards={[baseCard, immediate]} />)

    expect(html).toContain('异动·上涨 1 · 关注·上涨 1')
    expect(html).toContain('stock-signal-highlight buy immediate')
    expect(html).toContain('数据条件已通过')
    expect(html.indexOf('异动·上涨')).toBeLessThan(html.indexOf('关注·上涨'))
  })

  it('demotes an expired immediate point to a strong signal in the interface', () => {
    const expired = {
      ...baseCard,
      signal: 'immediate_buy',
      executionStatus: 'ready',
      executionValidUntil: new Date(Date.now() - 1_000).toISOString()
    } satisfies StockStrategyCardData
    const html = renderToStaticMarkup(<StockStrategyTags cards={[expired]} />)

    expect(html).toContain('关注·上涨 1')
    expect(html).not.toContain('异动·上涨 1')
    expect(html).toContain('当前点位已过期')
  })

  it('shows a completed handling result without another execution button', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[{ ...baseCard, handling: { status: 'executed', handledAt: '2026-07-22T10:00:00.000Z', accountId: 'primary-account', trade: { code: '510300', side: 'buy', quantity: 300, price: 4.12 } } }]} onHandleSignal={() => undefined} />)
    expect(html).toContain('已买入登记')
    expect(html).not.toContain('>登记处理<')
  })

  it('keeps observation-only cards compact without a false highlight', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[{ ...baseCard, signal: 'none' }]} />)
    expect(html).not.toContain('stock-signal-highlight')
    expect(html).toContain('stock-strategy-tag')
    expect(html).toContain('stock-card-signal watch')
    expect(html).toContain('关注')
    expect(html).toContain('data-signal-description="当前证据不足')
  })

  it('distinguishes prepare-to-sell, watch and strong signals in the push summary', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[
      { ...baseCard, code: '300438', name: '鹏辉能源', signal: 'prepare_sell', sellPoints: [{ label: '准备减仓', condition: '下一根完整15分钟仍走弱' }] },
      { ...baseCard, code: '600011', name: '华能国际', signal: 'watch' },
      baseCard
    ]} />)

    expect(html).toContain('关注·上涨 1 · 观察·下跌 1 · 关注 1')
    expect(html).toContain('stock-signal-highlight sell prepare')
    expect(html).toContain('观察·下跌')
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

  it('shows spouse holding facts when the account content starts directly with instrument headings', () => {
    const content = `## 老婆 → 老婆的账户
### 300438 鹏辉能源
- **持仓事实**: 300股，成本107.906元，可用300股
- **策略**: 防守持有

### 002074 国轩高科
- **持仓事实**: 200股，成本27.535元，可用200股
- **策略**: 震荡持有`
    const html = renderToStaticMarkup(<StockStrategyTags content={content} cards={[
      { ...baseCard, code: '300438', name: '鹏辉能源', signal: 'watch', accountScope: '老婆 → 老婆的账户', source: 'holding' },
      { ...baseCard, code: '002074', name: '国轩高科', signal: 'watch', accountScope: '老婆 → 老婆的账户', source: 'holding' }
    ]} />)

    expect(html).toContain('持仓概览')
    expect(html).toContain('<strong>鹏辉能源 300438</strong>')
    expect(html).toContain('<strong>持仓事实</strong>: 300股，成本107.906元，可用300股')
    expect(html).toContain('<strong>国轩高科 002074</strong>')
    expect(html).not.toContain('**持仓事实**')
  })

  it('lets a single long reference value use the full row and exposes its complete tooltip', () => {
    const stopLoss = '按单笔最多亏20元反推；未确定买入价格前不生成虚假止损价'
    const html = renderToStaticMarkup(<StockStrategyDetails card={{
      ...baseCard,
      support: undefined,
      resistance: undefined,
      stopLoss
    }} onClose={() => undefined} />)

    expect(html).toContain('stock-levels count-1')
    expect(html).toContain(`title="${stopLoss}"`)
    expect(html).toContain(`>${stopLoss}</strong>`)
  })

  it('keeps full hover text for compact signal summaries and conditions', () => {
    const html = renderToStaticMarkup(<StockStrategyTags cards={[baseCard]} />)
    expect(html).toContain(`title="${baseCard.summary}"`)
    expect(html).toContain('title="回踩买点 · 4.10-4.12：回踩不破并保持量能"')
  })
})
