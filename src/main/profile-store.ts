import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { UserProfile } from '../shared/types'
import { rateUserProfile } from '../shared/profile-rating'

export const saveUserProfile = async (profile: UserProfile): Promise<UserProfile> => {
  if (!Number.isFinite(profile.capital) || profile.capital <= 0) throw new Error('资金量必须大于 0')
  if (!profile.styles.length || !profile.instruments.length) throw new Error('至少选择一种交易周期和关注品种')
  const rating = rateUserProfile(profile)
  const enrichedProfile = { ...profile, riskRating: rating.rating, riskScore: rating.score, ratingReasons: rating.reasons }
  const root = process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
  const target = join(root, 'profile.json')
  const payload = { schema_version: 2, updated_at: new Date().toISOString(), ...enrichedProfile }
  const writeJson = async (path: string, value: unknown) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(`${path}.tmp`, path)
  }
  const readJson = async (path: string) => {
    try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
  }
  await writeJson(target, payload)
  const goalsPath = join(root, 'goals.json')
  const goals = await readJson(goalsPath)
  const targetDate = new Date(); targetDate.setMonth(targetDate.getMonth() + profile.targetMonths)
  await writeJson(goalsPath, {
    ...goals, schema_version: 1, status: 'active', goal_mode: 'user_configured', current_asset: profile.capital,
    current_asset_as_of: new Date().toISOString(), current_asset_status: 'user_declared_profile',
    target_asset: Number((profile.capital * (1 + profile.targetReturn / 100)).toFixed(2)), target_return: profile.targetReturn / 100,
    target_date: targetDate.toISOString().slice(0, 10), max_drawdown: profile.maxDrawdown / 100,
    constraints: { ...((goals.constraints as Record<string, unknown>) || {}), allowed_instrument_types: profile.instruments, auto_order: false },
    updated_at: new Date().toISOString(), updated_by: 'jiucai_box_profile'
  })
  const strategyPath = join(root, 'strategy-profile.json')
  const strategy = await readJson(strategyPath)
  await writeJson(strategyPath, {
    ...strategy, schema_version: 1, updated_at: new Date().toISOString(),
    preferences: { ...((strategy.preferences as Record<string, unknown>) || {}), trading_styles: profile.styles, experience: profile.experience, trading_habits: profile.tradingHabits, allowed_instrument_types: profile.instruments, risk_rating: rating.rating, risk_score: rating.score },
    behavioral_guardrails: [...new Set([...(Array.isArray(strategy.behavioral_guardrails) ? strategy.behavioral_guardrails as string[] : []), '收益目标不得放宽最大回撤、仓位或交易频率'])]
  })
  return enrichedProfile
}
