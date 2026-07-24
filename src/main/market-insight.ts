import type { AiConfig, MarketAiInsight, MarketDecisionPoint, MarketInsightRequest } from '../shared/types'
import { MARKET_INSIGHT_REFRESH_MS } from '../shared/market-insight'
import { sendAiMessage } from './ai-provider'

const cache = new Map<string, { createdAt: number; insight: MarketAiInsight }>()
const stances: MarketAiInsight['stance'][] = ['持仓管理', '可关注', '等待确认', '暂不介入']
const openAdvices: MarketAiInsight['openPosition'][] = ['支持', '条件支持', '不支持', '无法判断']
const confidences: MarketAiInsight['confidence'][] = ['低', '中', '高']

const stringValue = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AI 行情研判缺少 ${field}`)
  return value.trim()
}

const stringArray = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, 4)
  : []

const decisionPoints = (value: unknown): MarketDecisionPoint[] => Array.isArray(value)
  ? value.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const raw = item as Record<string, unknown>
      const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 24) : ''
      const price = typeof raw.price === 'string' || typeof raw.price === 'number' ? String(raw.price).trim().slice(0, 32) : ''
      const condition = typeof raw.condition === 'string' ? raw.condition.trim().slice(0, 180) : ''
      const accountScope = typeof raw.accountScope === 'string' ? raw.accountScope.trim().slice(0, 60) : ''
      return label && price && condition ? [{ label, price, condition, accountScope: accountScope || undefined }] : []
    }).slice(0, 3)
  : []

export const parseMarketInsight = (content: string, request: MarketInsightRequest): MarketAiInsight => {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let raw: Record<string, unknown>
  try { raw = JSON.parse(normalized) as Record<string, unknown> }
  catch { throw new Error('AI 行情研判返回的不是有效 JSON，请重试') }
  const stance = stances.includes(raw.stance as MarketAiInsight['stance']) ? raw.stance as MarketAiInsight['stance'] : '等待确认'
  let openPosition = openAdvices.includes(raw.openPosition as MarketAiInsight['openPosition']) ? raw.openPosition as MarketAiInsight['openPosition'] : '无法判断'
  if (request.gates.some((gate) => gate.state === 'blocked') || request.discipline.toLowerCase() === 'stopped') openPosition = '不支持'
  const nextSession = typeof raw.nextSessionStrategy === 'string' && raw.nextSessionStrategy.trim() ? raw.nextSessionStrategy.trim() : null
  const buyPoints = openPosition === '不支持' ? [] : decisionPoints(raw.buyPoints)
  return {
    stance,
    openPosition,
    currentStrategy: stringValue(raw.currentStrategy, 'currentStrategy'),
    todayOutlook: stringValue(raw.todayOutlook, 'todayOutlook'),
    nextSessionStrategy: ['post_market', 'closed'].includes(request.phase) ? nextSession : null,
    buyPoints,
    sellPoints: decisionPoints(raw.sellPoints),
    triggers: stringArray(raw.triggers),
    invalidation: stringArray(raw.invalidation),
    evidence: stringArray(raw.evidence),
    confidence: confidences.includes(raw.confidence as MarketAiInsight['confidence']) ? raw.confidence as MarketAiInsight['confidence'] : '低',
    generatedAt: new Date().toISOString(),
    dataAsOf: request.bars.at(-1)?.time || request.item.refreshedAt
  }
}

export const marketInsightCacheKey = (request: MarketInsightRequest) => [
  request.item.code,
  request.period,
  request.phase,
  request.position ? `${request.position.quantity}:${request.position.status}:${request.position.averageCost ?? 'unknown'}` : 'empty',
  (request.householdPositions || []).map((position) => `${position.memberId}:${position.accountId}:${position.quantity}:${position.averageCost ?? 'unknown'}`).sort().join(','),
  request.discipline,
  request.gates.map((gate) => `${gate.id}:${gate.state}`).join(','),
  request.strategies.filter((strategy) => strategy.status === 'active').map((strategy) => `${strategy.id}:${strategy.version}`).sort().join(',')
].join('|')

const requestPayload = (request: MarketInsightRequest) => ({
  标的: request.item,
  当前持仓: request.position,
  家庭成员在该标的的持仓: request.householdPositions || [],
  当前纪律: request.discipline,
  交易时段: request.phase,
  图表周期: request.period,
  下单前检查: request.gates,
  正在使用的规则: request.strategies.filter((strategy) => strategy.status === 'active').map((strategy) => ({
    名称: strategy.name,
    适用品种: strategy.instruments,
    说明: strategy.description,
    规则: strategy.rules
  })),
  最近行情: request.bars.slice(-80)
})

export type UnifiedModelAnalysis = {
  account_scope?: string | null
  latest_signals?: Array<{
    id?: string
    side?: 'buy' | 'sell'
    level?: string
    kState?: string
    price?: number
    reasons?: string[]
    invalidation?: string
  }>
  position_guidance?: { state?: string; trigger_signal_id?: string | null }
}

export const unifiedModelDecisionPoints = (analyses: UnifiedModelAnalysis[]) => {
  const result: { buyPoints: MarketDecisionPoint[]; sellPoints: MarketDecisionPoint[] } = { buyPoints: [], sellPoints: [] }
  for (const analysis of analyses) {
    const signal = analysis.latest_signals?.find((item) => item.id === analysis.position_guidance?.trigger_signal_id)
    if (!signal || !['buy', 'sell'].includes(signal.side || '') || signal.kState !== 'closed' || signal.level !== 'actionable' || !Number.isFinite(signal.price)) continue
    const point: MarketDecisionPoint = {
      label: signal.side === 'buy' ? '统一模型买点' : '统一模型卖点',
      price: String(signal.price),
      condition: signal.reasons?.join('；') || '统一模型闭合信号成立',
      accountScope: analysis.account_scope?.replace(' → ', ' · ') || undefined
    }
    result[signal.side === 'buy' ? 'buyPoints' : 'sellPoints'].push(point)
  }
  result.buyPoints = result.buyPoints.slice(0, 3)
  result.sellPoints = result.sellPoints.slice(0, 3)
  return result
}

export const generateMarketInsight = async (config: AiConfig, request: MarketInsightRequest, tradeContext: string, unifiedAnalyses: UnifiedModelAnalysis[] = []) => {
  const modelFingerprint = unifiedAnalyses.map((item) => `${item.account_scope}:${item.position_guidance?.trigger_signal_id || ''}`).join('|')
  const cacheKey = `${marketInsightCacheKey(request)}|${modelFingerprint}`
  const cached = cache.get(cacheKey)
  if (!request.force && cached && Date.now() - cached.createdAt < MARKET_INSIGHT_REFRESH_MS) return cached.insight
  const prompt = [
    '请基于下面的真实行情、确认持仓、纪律和统一买卖点模型证据，生成该标的的即时市场数据观察研判。盘中 buyPoints 和 sellPoints 最终由宿主按统一模型 trigger_signal 强制回填，你不得自行补造价格。若多个家庭成员持有同一标的，currentStrategy 必须按成员和账户分别说明，不得合并成本或数量。',
    '禁止补造行情、持仓或成交；信息不足就写清楚。走势只能写条件化情景，不能承诺涨跌。forming K 线只能预警，执行建议必须等待 closed K 确认。',
    '如果任一下单检查 blocked，或纪律为 STOPPED，openPosition 必须为“不支持”且 buyPoints 必须为空数组。如果当前没有确认持仓，不得把历史仓位当成现有持仓；没有可靠买卖点时返回空数组，不得为了填字段编价格。',
    '仅返回一个 JSON 对象，不要 Markdown。字段必须为：stance（持仓管理/可关注/等待确认/暂不介入）、openPosition（支持/条件支持/不支持/无法判断）、currentStrategy、todayOutlook、nextSessionStrategy（仅盘后给次日方案，否则 null）、buyPoints、sellPoints、triggers（最多4条）、invalidation（最多4条）、evidence（最多4条）、confidence（低/中/高）。buyPoints 和 sellPoints 各最多3项，每项格式为 {label, price, condition, accountScope}；price 可以是单价或区间字符串，accountScope 用“成员 · 账户”，公共参考可省略。',
    `当前页面证据：${JSON.stringify(requestPayload(request))}`,
    `统一买卖点模型证据：${JSON.stringify(unifiedAnalyses)}`,
    `用户确认交易记录：${tradeContext}`
  ].join('\n\n')
  const content = await sendAiMessage(config, [{ role: 'user', content: prompt }], { purpose: 'automation' })
  const insight = parseMarketInsight(content, request)
  if (request.phase === 'intraday') {
    const points = unifiedModelDecisionPoints(unifiedAnalyses)
    insight.buyPoints = insight.openPosition === '不支持' ? [] : points.buyPoints
    insight.sellPoints = points.sellPoints
  }
  cache.set(cacheKey, { createdAt: Date.now(), insight })
  return insight
}
