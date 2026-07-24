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

  it('只在当前点位和执行闸门全部通过时保留立即买入', () => {
    const now = Date.now()
    const immediate = {
      code: '510300',
      name: '沪深300ETF',
      accountScope: '我 → 我的主账户',
      currentPrice: '4.12',
      signal: 'immediate_buy',
      stance: '可关注',
      summary: '当前点位满足买入条件',
      buyPoints: [{ label: '当前点位立即买入', price: '4.12', condition: '当前价格仍在计划区间内' }],
      sellPoints: [],
      risks: [],
      evidence: ['完整5分钟和15分钟证据已确认'],
      confidence: '高',
      dataAsOf: new Date(now - 30_000).toISOString(),
      executionValidUntil: new Date(now + 4 * 60_000).toISOString(),
      executionStatus: 'ready',
      executionBlockers: []
    }
    const blocked = { ...immediate, code: '159516', executionStatus: 'blocked', executionBlockers: ['今日委托待确认'] }
    const content = `<stock_strategy_cards>${JSON.stringify([immediate, blocked])}</stock_strategy_cards>`

    const cards = parseStockStrategyPayload(content, 8)
    expect(cards[0]).toMatchObject({ signal: 'immediate_buy', executionStatus: 'ready', executionBlockers: [] })
    expect(cards[1]).toMatchObject({ signal: 'strong_buy', executionStatus: 'blocked', executionBlockers: ['今日委托待确认'] })
  })

  it('保留关键位的完整长文本供悬浮提示展示', () => {
    const stopLoss = '按单笔最多亏20元反推；未确定买入价格前不生成虚假止损价，需先完成人工账户与成本复核'
    const content = `<stock_strategy_cards>${JSON.stringify([{
      code: '600095',
      name: '湘财股份',
      stance: '可关注',
      summary: '等待人工复核',
      buyPoints: [],
      sellPoints: [],
      stopLoss,
      risks: [],
      evidence: [],
      confidence: '中'
    }])}</stock_strategy_cards>`

    expect(parseStockStrategyPayload(content)[0]?.stopLoss).toBe(stopLoss)
  })

  it('为统一模型信号推导动作目的', () => {
    const content = `<stock_strategy_cards>${JSON.stringify([{
      code: '300438',
      name: '鹏辉能源',
      signal: 'strong_sell',
      stance: '持仓管理',
      summary: '上涨趋势出现顶部派发证据',
      decisionPolicyId: 'rolling-position-v25-robust-70',
      positionState: 'trend_top_reduce',
      tradeIntent: 't_sell',
      triggerStrategy: 'trend_distribution_top',
      triggerLevel: 'actionable',
      triggerKState: 'closed',
      buyPoints: [],
      sellPoints: [{ label: '高位减仓', price: '30.20', condition: '闭合顶部派发信号仍成立' }],
      risks: [],
      evidence: ['V25 closed/actionable'],
      confidence: '高'
    }])}</stock_strategy_cards>`

    expect(parseStockStrategyPayload(content, 3, true)[0]).toMatchObject({
      signal: 'strong_sell',
      actionPurpose: '逃顶 · 卖出准备做T'
    })
  })

  it('定时任务卡片不是统一模型闭合信号时清空买卖点并降为观察', () => {
    const content = `<stock_strategy_cards>${JSON.stringify([{
      code: '510300',
      name: '沪深300ETF',
      signal: 'strong_buy',
      stance: '可关注',
      summary: '语言模型自行生成的买点',
      decisionPolicyId: 'other-model',
      positionState: 'entry_ready',
      triggerStrategy: 'trend_pullback_entry',
      triggerLevel: 'actionable',
      triggerKState: 'forming',
      buyPoints: [{ label: '猜测买点', price: '4.12', condition: '形成中K线触价' }],
      sellPoints: [],
      risks: [],
      evidence: [],
      confidence: '高'
    }])}</stock_strategy_cards>`

    expect(parseStockStrategyPayload(content, 3, true)[0]).toMatchObject({
      signal: 'watch',
      actionPurpose: '仅观察',
      buyPoints: [],
      sellPoints: [],
      executionStatus: 'blocked'
    })
  })
})
