import { describe, expect, it } from 'vitest'
import type { MarketInsightRequest } from '../shared/types'
import { marketInsightCacheKey, parseMarketInsight, unifiedModelDecisionPoints } from './market-insight'

const request: MarketInsightRequest = {
  item: { code: '159516', name: '半导体设备ETF国泰', type: 'etf', exchange: 'SZ', latestPrice: 0.661, changePercent: -5.71, volume: '61.15亿', score: 0, source: 'user', signal: '未评估', refreshedAt: '15:34:36' },
  bars: [{ time: '2026-07-20T15:00:00+08:00', open: 0.67, high: 0.672, low: 0.66, close: 0.661, volume: 100, amount: 66.1, closed: true }],
  gates: [{ id: 'discipline', label: '纪律', state: 'blocked', detail: '今日停手' }],
  position: null,
  strategies: [],
  discipline: 'STOPPED',
  period: 'timeline',
  phase: 'post_market'
}

describe('market insight parser', () => {
  it('keeps AI output structured and enforces blocked opening gates', () => {
    const insight = parseMarketInsight(JSON.stringify({
      stance: '可关注', openPosition: '支持', currentStrategy: '等待完整 K 线确认。', todayOutlook: '弱势震荡情景。',
      nextSessionStrategy: '开盘前重新核对账户和行情。', buyPoints: [{ label: '回踩确认', price: '0.655-0.660', condition: '完整 5 分钟 K 线收回均价' }], sellPoints: [{ label: '跌破离场', price: '0.650 下方', condition: '完整 5 分钟 K 线收盘跌破' }], triggers: ['完整 5 分钟 K 线收回均价'], invalidation: ['再次跌破日内低点'], evidence: ['收盘价低于均价'], confidence: '中'
    }), request)
    expect(insight.openPosition).toBe('不支持')
    expect(insight.buyPoints).toEqual([])
    expect(insight.sellPoints[0]).toMatchObject({ label: '跌破离场', price: '0.650 下方' })
    expect(insight.nextSessionStrategy).toContain('开盘前')
    expect(insight.dataAsOf).toBe(request.bars[0].time)
  })

  it('rejects prose responses instead of displaying invented fields', () => {
    expect(() => parseMarketInsight('暂时观望', request)).toThrow('有效 JSON')
  })

  it('invalidates cache when safety facts change', () => {
    const current = marketInsightCacheKey(request)
    expect(marketInsightCacheKey({ ...request, discipline: 'NORMAL' })).not.toBe(current)
    expect(marketInsightCacheKey({ ...request, gates: request.gates.map((gate) => ({ ...gate, state: 'pass' })) })).not.toBe(current)
  })

  it('only turns the unified closed actionable trigger into intraday points', () => {
    expect(unifiedModelDecisionPoints([{
      account_scope: '我 → 我的主账户',
      position_guidance: { state: 'range_low_add', trigger_signal_id: 'buy-1' },
      latest_signals: [
        { id: 'forming', side: 'buy', level: 'actionable', kState: 'forming', price: 10.1, reasons: ['形成中'] },
        { id: 'buy-1', side: 'buy', level: 'actionable', kState: 'closed', price: 9.8, reasons: ['区间下沿止跌'], invalidation: '跌破9.6' }
      ]
    }])).toEqual({
      buyPoints: [{ label: '统一模型买点', price: '9.8', condition: '区间下沿止跌', accountScope: '我 · 我的主账户' }],
      sellPoints: []
    })
  })
})
