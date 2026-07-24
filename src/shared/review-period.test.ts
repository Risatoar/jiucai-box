import { describe, expect, it } from 'vitest'
import {
  formatReviewSelection,
  getReviewDateRange,
  normalizeReviewSelection
} from './review-period'

describe('review period', () => {
  it('日报保留所选日期', () => {
    expect(getReviewDateRange('daily', '2026-07-23', '2026-07-23')).toEqual({
      start: '2026-07-23',
      end: '2026-07-23',
      tradingDate: '2026-07-23'
    })
  })

  it('周报归一到周一并在当前周截断到今天', () => {
    expect(normalizeReviewSelection('weekly', '2026-07-23')).toBe('2026-07-20')
    expect(getReviewDateRange('weekly', '2026-07-23', '2026-07-23')).toEqual({
      start: '2026-07-20',
      end: '2026-07-23',
      tradingDate: '2026-07-20'
    })
  })

  it('历史周使用完整自然周', () => {
    expect(getReviewDateRange('weekly', '2026-07-15', '2026-07-23')).toEqual({
      start: '2026-07-13',
      end: '2026-07-19',
      tradingDate: '2026-07-13'
    })
  })

  it('月报归一到月初并按自然月取值', () => {
    expect(getReviewDateRange('monthly', '2026-07-23', '2026-07-23')).toEqual({
      start: '2026-07-01',
      end: '2026-07-23',
      tradingDate: '2026-07-01'
    })
    expect(getReviewDateRange('monthly', '2026-06-18', '2026-07-23')).toEqual({
      start: '2026-06-01',
      end: '2026-06-30',
      tradingDate: '2026-06-01'
    })
  })

  it('按周期显示用户可理解的日期', () => {
    expect(formatReviewSelection('daily', '2026-07-23')).toBe('2026年7月23日')
    expect(formatReviewSelection('weekly', '2026-07-23')).toBe('2026年7月20日—7月26日')
    expect(formatReviewSelection('monthly', '2026-07-23')).toBe('2026年7月')
  })
})
