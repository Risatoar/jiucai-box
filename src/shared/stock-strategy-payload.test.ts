import { describe, expect, it } from 'vitest'
import { parseStockStrategyPayload, stripStockStrategyPayload } from './stock-strategy-payload'

describe('stock strategy payload', () => {
  it('从自动化结果中提取多标的卡片并隐藏机器数据', () => {
    const content = `盘中盯盘完成。\n<stock_strategy_cards>${JSON.stringify([
      { code: '159516', name: '半导体设备ETF', instrumentType: 'etf', accountScope: '我 → 我的主账户', source: 'user', signal: 'strong_buy', stance: '等待确认', summary: '不追高', buyPoints: [], sellPoints: [], risks: [], evidence: [], confidence: '中' },
      { code: '600089', name: '特变电工', instrumentType: 'stock', stance: '持仓管理', summary: '观察完整15分钟走势', buyPoints: [], sellPoints: [], risks: [], evidence: [], confidence: '低' }
    ])}</stock_strategy_cards>`
    expect(parseStockStrategyPayload(content, 8).map((card) => card.code)).toEqual(['159516', '600089'])
    expect(parseStockStrategyPayload(content, 8)[0].signal).toBe('strong_buy')
    expect(parseStockStrategyPayload(content, 8)[0]).toMatchObject({ accountScope: '我 → 我的主账户', source: 'user' })
    expect(stripStockStrategyPayload(content)).toBe('盘中盯盘完成。')
  })

  it('同一证券在不同账户保留独立策略卡', () => {
    const card = { code: '300438', name: '鹏辉能源', instrumentType: 'stock', stance: '持仓管理', summary: '账户独立策略', buyPoints: [], sellPoints: [], risks: [], evidence: [], confidence: '中' }
    const content = `<stock_strategy_cards>${JSON.stringify([
      { ...card, accountScope: '我 → 我的主账户' },
      { ...card, accountScope: '老婆 → 老婆的账户' },
      { ...card, accountScope: '老婆 → 老婆的账户' }
    ])}</stock_strategy_cards>`

    const cards = parseStockStrategyPayload(content, 8)
    expect(cards).toHaveLength(2)
    expect(cards.map((item) => item.accountScope)).toEqual(['我 → 我的主账户', '老婆 → 老婆的账户'])
  })

  it('保留准备卖出和关注信号等级', () => {
    const base = { name: '鹏辉能源', instrumentType: 'stock', stance: '持仓管理', summary: '等待下一根闭合K线', buyPoints: [], risks: [], evidence: [], confidence: '中' }
    const content = `<stock_strategy_cards>${JSON.stringify([
      { ...base, code: '300438', signal: 'prepare_sell', sellPoints: [{ label: '准备减仓', condition: '下一根完整15分钟仍不能收回压力位' }] },
      { ...base, code: '600011', name: '华能国际', signal: 'watch', sellPoints: [] }
    ])}</stock_strategy_cards>`

    expect(parseStockStrategyPayload(content, 8).map((card) => card.signal)).toEqual(['prepare_sell', 'watch'])
  })
})
