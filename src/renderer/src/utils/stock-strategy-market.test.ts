import { describe, expect, it } from 'vitest'
import { parseStockBars, parseStockLiveQuote } from './stock-strategy-market'

describe('stock strategy market parsing', () => {
  it('解析真实报价并把比例转换成百分比', () => {
    const quote = parseStockLiveQuote(JSON.stringify({ quotes: [{ price: 0.724, open: 0.68, high: 0.73, low: 0.67, previousClose: 0.661, changeRatio: 0.0953, volume: 100, amount: 200, exchangeTime: '2026-07-21T10:55:00+08:00', source: 'eastmoney' }] }))
    expect(quote).toMatchObject({ price: 0.724, changePercent: 9.53, source: 'eastmoney' })
  })

  it('过滤无效 K 线并按时间排序', () => {
    const bars = parseStockBars(JSON.stringify({ bars: [
      { time: '2026-07-21T10:00:00+08:00', open: 2, high: 3, low: 1, close: 2.5, volume: 10, amount: 20 },
      { time: '2026-07-21T09:55:00+08:00', open: 1, high: 2, low: .5, close: 1.5, volume: 8, amount: 16 },
      { time: 'bad', open: 1, high: null, low: 1, close: 1, volume: 1 }
    ] }))
    expect(bars.map((bar) => bar.open)).toEqual([1, 2])
  })
})
