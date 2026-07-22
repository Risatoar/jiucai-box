import { describe, expect, it } from 'vitest'
import type { MarketBar } from '../../../shared/types'
import { aggregate120MinuteBars, calculateKdj, calculateMacd, calculateRsi, clampVisibleCount, formatBarTime, formatVolume, movingAverage, nearestBarIndex } from './kline-chart-utils'

const bars = [1, 2, 3, 4, 5].map((close, index): MarketBar => ({
  time: `2026-07-${String(index + 1).padStart(2, '0')}T10:00:00+08:00`,
  open: close,
  high: close,
  low: close,
  close,
  volume: close * 10_000,
  amount: null
}))

describe('kline chart utils', () => {
  it('calculates moving averages without future bars', () => {
    expect(movingAverage(bars, 3)).toEqual([null, null, 2, 3, 4])
  })

  it('keeps zoom range within the available bars', () => {
    expect(clampVisibleCount(2, 100)).toBe(24)
    expect(clampVisibleCount(200, 100)).toBe(100)
    expect(clampVisibleCount(72, 10)).toBe(10)
  })

  it('maps chart hover positions to the nearest visible bar', () => {
    expect(nearestBarIndex(-20, 4, 258, 10)).toBe(0)
    expect(nearestBarIndex(131, 4, 258, 10)).toBe(5)
    expect(nearestBarIndex(400, 4, 258, 10)).toBe(9)
  })

  it('formats axis values for Chinese market reading', () => {
    expect(formatBarTime(bars[0].time, true)).toBe('07-01')
    expect(formatVolume(12_300)).toBe('1.2万')
  })

  it('aggregates consecutive 60 minute bars into a 120 minute bar', () => {
    const sameDayBars = bars.slice(0, 4).map((bar, index) => ({ ...bar, time: `2026-07-01T${String(9 + index).padStart(2, '0')}:30:00+08:00` }))
    const result = aggregate120MinuteBars(sameDayBars)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ open: 1, close: 2, high: 2, low: 1, volume: 30_000 })
  })

  it('calculates MACD, KDJ and RSI series aligned with source bars', () => {
    expect(calculateMacd(bars)).toHaveLength(bars.length)
    expect(calculateKdj(bars)).toHaveLength(bars.length)
    expect(calculateRsi([...bars, ...bars, ...bars])).toHaveLength(15)
  })
})
