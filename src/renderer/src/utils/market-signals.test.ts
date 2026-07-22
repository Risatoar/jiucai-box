import { describe, expect, it } from 'vitest'
import type { MarketBar } from '../../../shared/types'
import { latestMarketSignal, nearestSignalBarIndex, parseMarketSignals, signalsForChart } from './market-signals'

const bars: MarketBar[] = ['13:10', '13:15', '13:20'].map((time, index) => ({
  time: `2026-07-20T${time}:00+08:00`, open: .67, high: .68, low: .66, close: .67 - index * .001, volume: 100, amount: null, closed: true
}))

const payload = JSON.stringify({ instruments: [{
  instrument: { code: '159516' }, latest_signals: [
    { id: 'watch', strategy: 'support_break', side: 'sell', level: 'watch', period: '5m', kState: 'closed', time: '2026-07-20 13:15', price: .671, confidence: .56, reasons: ['跌破支撑'] },
    { id: 'action', strategy: 'support_break_retest', side: 'sell', level: 'actionable', period: '5m', kState: 'closed', time: '2026-07-20 13:15', price: .671, confidence: .78, reasons: ['反抽未收回'], invalidation: '收回0.674' },
    { id: 'buy', strategy: 'td_sequential_9', side: 'buy', level: 'confirm', period: '5m', kState: 'closed', time: '2026-07-20 13:20', price: .668, confidence: .68, reasons: ['买入序列达到9'] }
  ]
}] })

describe('market signal trace', () => {
  it('parses real strategy signals without inventing missing fields', () => {
    const signals = parseMarketSignals(payload)
    expect(signals).toHaveLength(3)
    expect(signals[1]).toMatchObject({ code: '159516', level: 'actionable', price: .671, invalidation: '收回0.674' })
  })

  it('maps signal time to the nearest real K line', () => {
    expect(nearestSignalBarIndex(bars, '2026-07-20 13:16')).toBe(1)
    expect(nearestSignalBarIndex([], '2026-07-20 13:16')).toBe(-1)
  })

  it('keeps one strongest marker per K line and finds the latest signal', () => {
    const signals = parseMarketSignals(payload)
    const points = signalsForChart(signals, bars, '5m')
    expect(points).toHaveLength(2)
    expect(points[0].signal.id).toBe('action')
    expect(latestMarketSignal(signals)?.id).toBe('buy')
    expect(signalsForChart(signals, bars, '1d')).toEqual([])
  })
})
