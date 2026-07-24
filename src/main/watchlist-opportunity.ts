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
  strategyLane?: string
  strategyLabel?: string
  suitableFor?: string
  nextAction?: string
}

interface AiOpportunity {
  code?: unknown
  score?: unknown
  reasons?: unknown
}

interface CandidateTechnicalEvidence {
  status?: string
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
  return [...reevaluation, ...fresh].slice(0, 45)
}

const STRATEGY_LANE_ORDER = ['steady', 'short_3d', 'medium_long', 'hot_leader', 'limit_up']
const nextActionFor = (candidate: OpportunityCandidate) => {
  const evidence = candidate.technicalEvidence as CandidateTechnicalEvidence | undefined
  if (evidence?.status === 'buy_ready') return '人工复核买点'
  const actions: Record<string, string> = {
    steady: '等待回踩企稳',
    short_3d: '3日内等待放量',
    medium_long: '等待趋势回踩',
    hot_leader: '等待分歧转强',
    limit_up: '只观察回封强度'
  }
  return actions[String(candidate.strategyLane)] || '重新扫描后生成'
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
    const buyReady = (candidate.technicalEvidence as CandidateTechnicalEvidence | undefined)?.status === 'buy_ready'
    return [{
      ...candidate,
      score,
      reasons: reasons.length ? reasons : candidate.reasons,
      signal: buyReady ? '准备买入' : '观察',
      nextAction: nextActionFor(candidate)
    }]
  })

  if (candidates.length < 10) throw new Error(`确定性模型只形成 ${candidates.length}/10 个合格候选，已保留原关注列表`)
  if (analyzed.length !== 10) throw new Error(`AI 只完成了 ${analyzed.length}/10 个候选分析，请重试`)
  for (const lane of STRATEGY_LANE_ORDER) {
    const count = analyzed.filter((item) => item.strategyLane === lane).length
    if (count !== 2) throw new Error(`AI 返回的 ${lane} 策略篮子为 ${count}/2，只能重排同篮子候选，不能改换策略归属`)
  }
  return analyzed.sort((left, right) => {
    const laneOrder = STRATEGY_LANE_ORDER.indexOf(String(left.strategyLane)) - STRATEGY_LANE_ORDER.indexOf(String(right.strategyLane))
    return laneOrder || Number(right.score || 0) - Number(left.score || 0)
  })
}

export const analyzeWatchlistOpportunities = async (
  config: AiConfig,
  candidates: OpportunityCandidate[],
  previousAgentCodes: string[]
): Promise<OpportunityCandidate[]> => {
  if (candidates.length < 10) throw new Error(`只有 ${candidates.length}/10 个候选通过画像、行情和风险门槛，已保留原关注列表`)
  const previous = new Set(previousAgentCodes)
  const evidence = candidates.slice(0, 10).map((item) => ({
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
    strategyLane: item.strategyLane,
    strategyLabel: item.strategyLabel,
    suitableFor: item.suitableFor,
    previouslyDiscovered: previous.has(item.code)
  }))
  const prompt = [
    '你正在为“我的关注”页面复核一批候选。系统先扫描股票、ETF、可转债的市场行情，再为候选补充日线趋势、5分钟/15分钟闭合结构、量能和追涨风险。previouslyDiscovered=true 表示它曾由 AI 发现，本轮必须重新分析，不能照搬旧结论。这里是关注发现，不是买入信号。',
    '只允许分析输入里的证券代码，不得补造新标的、行情、持仓或成交。必须输出恰好 10 个不重复标的，固定覆盖五个策略篮子且每类 2 个：steady=低波动稳健、short_3d=3日内短线、medium_long=中长线趋势、hot_leader=热门主线龙头、limit_up=强势打板观察。strategyLane 由确定性模型分配，AI 只能在同一篮子内解释和重排，禁止改变归属。',
    '评分必须综合日线位置、短周期结构、量能、流动性、当日涨幅、板块热度、领导力和追涨风险；不能只按 screeningScore 重排。strategy_type=trend 表示趋势机会，oversold_rebound 表示热门板块严重回撤后的止跌反弹机会。高波动本身不是机会：价格位于MA20下方、MA5低于MA20或MA20继续向下的标的，除非已通过主线超跌反弹硬门槛，否则不得推荐。反弹候选必须保留其板块热度、回撤深度和止跌证据；趋势候选优先龙头、领涨和强势标的。limit_up 只表示打板选手的高风险观察池，追涨或封板证据不足时必须写明风险，不能自动变为 buy_ready。technicalEvidence 中的画像、领导力、策略篮子和可负担性已由确定性模型计算，AI 只能解释和重排；technicalEvidence 缺失或状态不是 watching/buy_ready 时不得选择。',
    '仅返回一个 JSON 对象，不要 Markdown。格式：{"opportunities":[{"code":"6位代码","score":0到100的数字,"reasons":["最多3条简短理由"]}]}。',
    `候选证据：${JSON.stringify(evidence)}`
  ].join('\n\n')
  const content = await sendAiMessage(config, [{ role: 'user', content: prompt }], { purpose: 'automation' })
  return parseWatchlistOpportunityAnalysis(content, candidates)
}
