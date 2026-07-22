import type { AiConfig, Instrument } from '../shared/types'
import { sendAiMessage } from './ai-provider'

export interface OpportunityCandidate extends Instrument {
  score?: number
  reasons?: unknown
  signal?: string
  latestPrice?: number
  changePercent?: number
  volume?: string
  technicalEvidence?: unknown
}

interface AiOpportunity {
  code?: unknown
  score?: unknown
  reasons?: unknown
}

const stripJsonFence = (content: string) => content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

const reasonList = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 120)).slice(0, 3)
  : []

export const buildOpportunityReviewPool = (
  screened: OpportunityCandidate[],
  previous: OpportunityCandidate[],
  liveItems: OpportunityCandidate[]
): OpportunityCandidate[] => {
  const screenedByCode = new Map(screened.map((item) => [item.code, item]))
  const liveByCode = new Map(liveItems.map((item) => [item.code, item]))
  const previousCodes = new Set(previous.map((item) => item.code))
  const reevaluation = previous.map((item) => {
    const screenedItem = screenedByCode.get(item.code)
    const live = liveByCode.get(item.code)
    const liveReason = live?.latestPrice
      ? `页面实时行情：最新价 ${live.latestPrice}，涨跌幅 ${Number(live.changePercent || 0).toFixed(2)}%，成交额 ${live.volume || '待确认'}`
      : '已有 AI 发现，本轮未进入成交额榜单，保留到 AI 复核后再决定是否移出'
    return { ...item, ...screenedItem, latestPrice: live?.latestPrice, changePercent: live?.changePercent, volume: live?.volume, reasons: [...reasonList(screenedItem?.reasons || item.reasons), liveReason].slice(0, 3) }
  })
  const fresh = screened.filter((item) => !previousCodes.has(item.code))
  return [...reevaluation, ...fresh].slice(0, 20)
}

export const parseWatchlistOpportunityAnalysis = (content: string, candidates: OpportunityCandidate[]): OpportunityCandidate[] => {
  let raw: { opportunities?: AiOpportunity[] }
  try { raw = JSON.parse(stripJsonFence(content)) as { opportunities?: AiOpportunity[] } }
  catch { throw new Error('AI 机会分析返回的不是有效 JSON，请重试') }
  if (!Array.isArray(raw.opportunities)) throw new Error('AI 机会分析缺少 opportunities')

  const candidateByCode = new Map(candidates.map((item) => [item.code, item]))
  const seen = new Set<string>()
  const analyzed = raw.opportunities.flatMap((item) => {
    const code = String(item.code || '')
    const candidate = candidateByCode.get(code)
    if (!candidate || seen.has(code)) return []
    seen.add(code)
    const aiScore = Number(item.score)
    const score = Number.isFinite(aiScore) ? Math.max(0, Math.min(100, Math.round(aiScore * 100) / 100)) : Number(candidate.score || 0)
    const reasons = reasonList(item.reasons)
    return [{ ...candidate, score, reasons: reasons.length ? reasons : candidate.reasons, signal: '观察' }]
  }).sort((left, right) => Number(right.score || 0) - Number(left.score || 0)).slice(0, 10)

  const expectedMinimum = Math.min(5, candidates.length)
  if (analyzed.length < expectedMinimum) throw new Error(`AI 只完成了 ${analyzed.length}/${expectedMinimum} 个候选分析，请重试`)
  return analyzed
}

export const analyzeWatchlistOpportunities = async (
  config: AiConfig,
  candidates: OpportunityCandidate[],
  previousAgentCodes: string[]
): Promise<OpportunityCandidate[]> => {
  if (candidates.length < 5) throw new Error(`深度分析候选只有 ${candidates.length} 个，少于最低 5 个，已保留原关注列表`)
  const previous = new Set(previousAgentCodes)
  const evidence = candidates.slice(0, 20).map((item) => ({
    code: item.code,
    name: item.name,
    type: item.type,
    exchange: item.exchange,
    screeningScore: item.score || 0,
    screeningReasons: item.reasons || [],
    latestPrice: item.latestPrice,
    changePercent: item.changePercent,
    amount: item.volume,
    technicalEvidence: item.technicalEvidence,
    previouslyDiscovered: previous.has(item.code)
  }))
  const prompt = [
    '你正在为“我的关注”页面复核一批候选。系统先扫描股票、ETF、可转债的市场行情，再为候选补充日线趋势、5分钟/15分钟闭合结构、量能和追涨风险。previouslyDiscovered=true 表示它曾由 AI 发现，本轮必须重新分析，不能照搬旧结论。这里是关注发现，不是买入信号。',
    '只允许分析输入里的证券代码，不得补造新标的、行情、持仓或成交。关注不等于买入；证据不足时降低评分，并在 reasons 里写清楚等待什么。按关注价值从高到低输出，候选不少于 5 个时必须输出 5–10 个，少于 5 个时全部输出。',
    '评分必须综合日线位置、短周期结构、量能、流动性、当日涨幅和追涨风险；不能只按 screeningScore 重排。technicalEvidence 缺失或状态为 market_unavailable 时应明显降分。股票、ETF、可转债至少覆盖两类；若无法覆盖，要在入选理由中说明另一类为什么没有合格候选。',
    '仅返回一个 JSON 对象，不要 Markdown。格式：{"opportunities":[{"code":"6位代码","score":0到100的数字,"reasons":["最多3条简短理由"]}]}。',
    `候选证据：${JSON.stringify(evidence)}`
  ].join('\n\n')
  const content = await sendAiMessage(config, [{ role: 'user', content: prompt }], { purpose: 'automation' })
  return parseWatchlistOpportunityAnalysis(content, candidates)
}
