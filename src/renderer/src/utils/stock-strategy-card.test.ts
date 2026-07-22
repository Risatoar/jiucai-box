import { describe, expect, it } from 'vitest'
import { parseStockStrategyCards, stripStockStrategyPayload } from './stock-strategy-card'

describe('stock strategy card payload', () => {
  it('从回答中提取并隐藏股票策略卡数据', () => {
    const result = parseStockStrategyCards(`先说结论：等待回踩确认。\n<stock_strategy_cards>[{"code":"510300","name":"沪深300ETF","instrumentType":"etf","signal":"strong_buy","stance":"等待确认","summary":"不追涨，回踩后再判断。","buyPoints":[{"label":"观察买点","price":"4.10-4.12","condition":"缩量企稳并收回均价线"}],"sellPoints":[],"risks":["跌破支撑后放弃"],"evidence":["日线仍在 MA20 上方"],"confidence":"中"}]</stock_strategy_cards>`)

    expect(result.content).toBe('先说结论：等待回踩确认。')
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]).toMatchObject({ code: '510300', signal: 'strong_buy', stance: '等待确认', confidence: '中' })
    expect(result.cards[0].buyPoints[0].price).toBe('4.10-4.12')
  })

  it('忽略格式错误或缺少证券代码的卡片', () => {
    const result = parseStockStrategyCards('回答\n<stock_strategy_cards>[{"name":"某股票","summary":"观察"}]</stock_strategy_cards>')
    expect(result.content).toBe('回答')
    expect(result.cards).toEqual([])
  })

  it('流式生成机器数据时不把半截标签展示给用户', () => {
    expect(stripStockStrategyPayload('正在回答\n<stock_strategy_cards>[{"code":"510')).toBe('正在回答')
    expect(stripStockStrategyPayload('正在回答\n<stock_strategy_')).toBe('正在回答')
  })

  it('复盘漏掉机器数据时，从原文保守补出策略卡', () => {
    const result = parseStockStrategyCards(`结论：今天只确认了 1 笔卖出，没有确认买入。

华峰转债（118071）10张，于开盘以188.76元全部卖出。目前持仓0张，已经结束。

半导体设备ETF（159516）是在7月17日清仓，并非今天卖出；当前同样是0份。

5. 下一步

今天不再因为华峰转债继续上涨而买回。

- 触发：没有买回触发条件，后续只能作为一笔全新的交易重新评估。
- 失效：看到上涨就追、只看1分钟快速拉升，或买后现金低于3060元，都直接放弃。
- 成本状态：华峰转债本次手续费需要确认。
- 下一检查点：今晚查看券商成交明细。`)

    expect(result.cards[0]).toMatchObject({
      code: '118071', name: '华峰转债', instrumentType: 'cbond', exchange: 'SH', stance: '暂不介入',
      invalidation: expect.stringContaining('看到上涨就追'), nextCheck: '今晚查看券商成交明细。'
    })
    expect(result.cards[0].buyPoints).toEqual([])
    expect(result.content).toContain('5. 下一步')
  })

  it('只有账户事实、没有后续策略时不生成卡片', () => {
    const result = parseStockStrategyCards('账户记录显示华峰转债（118071）目前持仓0张。')
    expect(result.cards).toEqual([])
  })

  it('使用真实持仓目录为旧盯盘消息补齐名称对应的代码', () => {
    const result = parseStockStrategyCards(
      '鹏辉能源：完整15分钟跌破56.2才考虑减仓。下一检查点：第一根完整15分钟走势。',
      [{ code: '300438', name: '鹏辉能源', type: 'stock', exchange: 'SZ' }],
      8
    )
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]).toMatchObject({ code: '300438', name: '鹏辉能源' })
  })

  it('同一证券在不同账户的机器卡片不会被去重合并', () => {
    const base = { code: '300438', name: '鹏辉能源', instrumentType: 'stock', stance: '持仓管理', summary: '独立账户策略', buyPoints: [], sellPoints: [], risks: [], evidence: [], confidence: '中' }
    const result = parseStockStrategyCards(`<stock_strategy_cards>${JSON.stringify([
      { ...base, accountScope: '我 → 我的主账户' },
      { ...base, accountScope: '老婆 → 老婆的账户' }
    ])}</stock_strategy_cards>`, [], 8)

    expect(result.cards).toHaveLength(2)
    expect(result.cards.map((card) => card.accountScope)).toEqual(['我 → 我的主账户', '老婆 → 老婆的账户'])
  })
})
