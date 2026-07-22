import type { ProfileRating, RiskRating, UserProfile } from './types'

const containsAny = (values: string[], targets: string[]) => targets.some((target) => values.includes(target))

export const rateUserProfile = (profile: UserProfile): ProfileRating => {
  let score = 30
  const reasons: string[] = []

  score += Math.min(30, Math.max(0, profile.maxDrawdown - 3) * 1.35)
  if (containsAny(profile.styles, ['超短'])) score += 14
  else if (containsAny(profile.styles, ['短线'])) score += 9
  else if (containsAny(profile.styles, ['波段'])) score += 4
  else score -= 5
  if (containsAny(profile.instruments, ['cbond'])) score += 5
  if (profile.tradingHabits.includes('容易追涨')) score += 8
  if (profile.tradingHabits.includes('容易扛亏')) score += 6
  if (profile.tradingHabits.includes('偏好低频')) score -= 7
  if (profile.targetMonths > 0) {
    const annualizedTarget = profile.targetReturn * (12 / profile.targetMonths)
    if (annualizedTarget >= 60) score += 12
    else if (annualizedTarget >= 30) score += 7
    else if (annualizedTarget <= 12) score -= 5
  }
  score = Math.round(Math.min(100, Math.max(0, score)))

  let rating: RiskRating = '保守型'
  if (score >= 80) rating = '激进型'
  else if (score >= 65) rating = '进取型'
  else if (score >= 45) rating = '平衡型'
  else if (score >= 25) rating = '稳健型'

  if (profile.maxDrawdown >= 15) reasons.push(`你能接受最多亏损 ${profile.maxDrawdown}%，风险偏高`)
  else reasons.push(`你希望亏损不超过 ${profile.maxDrawdown}%`)
  if (containsAny(profile.styles, ['超短', '短线'])) reasons.push('买卖比较频繁，需要更严格地按计划操作')
  if (profile.tradingHabits.includes('容易追涨') || profile.tradingHabits.includes('容易扛亏')) reasons.push('系统会重点提醒你避免追涨或一直扛亏')
  if (profile.tradingHabits.includes('偏好低频')) reasons.push('买卖次数较少，通常更容易控制风险')

  return { rating, score, reasons: reasons.slice(0, 3) }
}
