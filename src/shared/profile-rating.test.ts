import { describe, expect, it } from 'vitest'
import { rateUserProfile } from './profile-rating'

describe('rateUserProfile', () => {
  it('对高回撤、超短和行为偏差给出激进评级', () => {
    const result = rateUserProfile({ capital: 100000, styles: ['超短'], experience: '1-3年', maxDrawdown: 25, targetReturn: 50, targetMonths: 6, instruments: ['cbond'], tradingHabits: ['容易追涨', '容易扛亏'] })
    expect(result.rating).toBe('激进型')
    expect(result.score).toBeGreaterThanOrEqual(80)
  })

  it('对低回撤、中长线和低频偏好给出较低评级', () => {
    const result = rateUserProfile({ capital: 100000, styles: ['中长线'], experience: '3-5年', maxDrawdown: 5, targetReturn: 10, targetMonths: 12, instruments: ['etf'], tradingHabits: ['偏好低频'] })
    expect(['保守型', '稳健型']).toContain(result.rating)
    expect(result.score).toBeLessThan(45)
  })
})
