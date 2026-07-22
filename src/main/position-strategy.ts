import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AiConfig, HouseholdAccount, HouseholdMember, HouseholdPosition, TradeMasterSnapshot } from '../shared/types'
import { POSITION_STRATEGY_REFRESH_MS } from '../shared/position-strategy'
import type { PositionStrategyAnalysis, PositionStrategyFactor, PositionStrategyHorizon, PositionStrategyPlan, PositionStrategyRequest } from '../shared/position-strategy'
import { sendAiMessage } from './ai-provider'
import { buildTradeContext } from './trade-context'
import { runTradeMaster } from './trade-master'

interface StrategyTarget {
  member: HouseholdMember
  account: HouseholdAccount
  position: HouseholdPosition
}

interface CacheEntry {
  signature: string
  analysis: PositionStrategyAnalysis
}

interface QuoteFact {
  price: number
  changeRatio?: number | null
  exchangeTime?: string | null
  collectedAt?: string
  source?: string
}

const verdicts: PositionStrategyAnalysis['verdict'][] = ['优先降风险', '制定回本计划', '保护已有利润', '继续持有观察', '信息不足']
const factorStatuses: PositionStrategyFactor['status'][] = ['利好', '中性', '利空', '材料不足']
const confidences: PositionStrategyAnalysis['confidence'][] = ['低', '中', '高']

const text = (value: unknown, fallback: string, limit = 600) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : fallback
const texts = (value: unknown, limit = 6) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 240)).slice(0, limit)
  : []
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

const parsePlan = (value: unknown, applicable: boolean): PositionStrategyPlan => {
  const raw = record(value)
  return {
    applicable,
    summary: text(raw.summary, applicable ? '当前材料不足，暂不能形成可靠计划。' : '当前不适用。'),
    steps: applicable ? texts(raw.steps, 5) : []
  }
}

const parseHorizon = (value: unknown, horizon: string): PositionStrategyHorizon => {
  const raw = record(value)
  return {
    horizon,
    goal: text(raw.goal, '等待补充材料'),
    stance: text(raw.stance, '暂不调整'),
    actions: texts(raw.actions, 5),
    triggers: texts(raw.triggers, 4),
    invalidation: texts(raw.invalidation, 4)
  }
}

const parseFactor = (value: unknown): PositionStrategyFactor => {
  const raw = record(value)
  const status = factorStatuses.includes(raw.status as PositionStrategyFactor['status']) ? raw.status as PositionStrategyFactor['status'] : '材料不足'
  return { status, summary: text(raw.summary, '没有接入可核验材料，暂不据此行动。'), evidence: texts(raw.evidence, 4) }
}

export const positionStrategySignature = (snapshot: TradeMasterSnapshot, target: StrategyTarget) => JSON.stringify({
  member: [target.member.id, target.member.riskProfile, target.member.monitoringEnabled, target.member.updatedAt],
  account: [target.account.id, target.account.totalAsset, target.account.cash, target.account.monitoringEnabled, target.account.updatedAt],
  positions: target.account.positions.map((position) => [position.instrument.code, position.quantity, position.availableQuantity, position.averageCost, position.status]).sort(),
  discipline: snapshot.discipline,
  goals: snapshot.goals,
  profile: snapshot.userProfile,
  strategies: snapshot.strategies,
  evolution: snapshot.evolution
})

const cachePath = (home: string, target: StrategyTarget) => {
  const safe = [target.member.id, target.account.id, target.position.instrument.code].join('-').replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(home, 'cache/position-strategy', `${safe}.json`)
}

const readCache = async (path: string): Promise<CacheEntry | null> => {
  try { return JSON.parse(await readFile(path, 'utf8')) as CacheEntry }
  catch { return null }
}

const writeCache = async (path: string, entry: CacheEntry) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
  await rename(`${path}.tmp`, path)
}

const resolveTarget = (snapshot: TradeMasterSnapshot, request: PositionStrategyRequest): StrategyTarget => {
  const member = snapshot.household?.members.find((item) => item.id === request.memberId)
  const account = snapshot.household?.accounts.find((item) => item.id === request.accountId && item.memberId === request.memberId)
  const position = account?.positions.find((item) => item.instrument.code === request.code && item.quantity > 0 && item.status !== 'closed')
  if (!member || !account || !position) throw new Error('这笔家庭持仓已经变化，请刷新页面后重试')
  return { member, account, position }
}

const commandJson = async (command: string, args: string[]) => JSON.parse(await runTradeMaster(command, args)) as Record<string, unknown>

const loadMarketEvidence = async (code: string) => {
  const [quoteResult, shortResult, mediumResult, longResult, infoResult] = await Promise.allSettled([
    commandJson('market', ['quote', '--code', code]),
    commandJson('market', ['bars', '--code', code, '--period', '5m', '--limit', '160']),
    commandJson('market', ['bars', '--code', code, '--period', '1d', '--limit', '240']),
    commandJson('market', ['bars', '--code', code, '--period', '1w', '--limit', '160']),
    commandJson('market', ['info', '--code', code])
  ])
  if (quoteResult.status === 'rejected') throw new Error(`实时行情读取失败：${quoteResult.reason instanceof Error ? quoteResult.reason.message : String(quoteResult.reason)}`)
  const quotes = Array.isArray(quoteResult.value.quotes) ? quoteResult.value.quotes as QuoteFact[] : []
  const quote = quotes.find((item) => Number.isFinite(item.price))
  if (!quote) throw new Error('实时行情没有返回有效价格，未生成策略以避免使用假数据')
  const bars = (result: PromiseSettledResult<Record<string, unknown>>) => result.status === 'fulfilled' && Array.isArray(result.value.bars) ? result.value.bars.slice(-80) : []
  const failure = (label: string, result: PromiseSettledResult<Record<string, unknown>>) => result.status === 'rejected' ? `${label}：${result.reason instanceof Error ? result.reason.message : String(result.reason)}` : null
  return {
    quote,
    quoteSources: quotes.map((item) => item.source).filter(Boolean),
    shortBars: bars(shortResult),
    mediumBars: bars(mediumResult),
    longBars: bars(longResult),
    company: infoResult.status === 'fulfilled' ? infoResult.value : null,
    missingSources: [failure('5分钟行情', shortResult), failure('日线行情', mediumResult), failure('周线行情', longResult), failure('公司基础资料', infoResult), '外围消息：尚未接入可核验资讯源', '行业板块：尚未接入可核验板块源'].filter((item): item is string => Boolean(item))
  }
}

export const parsePositionStrategy = (content: string, target: StrategyTarget, latestPrice: number, dataAsOf: string): PositionStrategyAnalysis => {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let raw: Record<string, unknown>
  try { raw = JSON.parse(normalized) as Record<string, unknown> }
  catch { throw new Error('AI 持仓策略返回的不是有效 JSON，请重试') }
  const cost = target.position.averageCost
  const marketValue = latestPrice * target.position.quantity
  const pnl = cost == null ? null : (latestPrice - cost) * target.position.quantity
  const pnlPercent = cost && cost > 0 ? (latestPrice / cost - 1) * 100 : null
  const exposurePercent = target.account.totalAsset && target.account.totalAsset > 0 ? marketValue / target.account.totalAsset * 100 : null
  const generatedAt = new Date().toISOString()
  const timeframes = record(raw.timeframes)
  const management = record(raw.positionManagement)
  const perspectives = record(raw.perspectives)
  return {
    instrument: target.position.instrument,
    memberName: target.member.name,
    accountName: target.account.name,
    verdict: verdicts.includes(raw.verdict as PositionStrategyAnalysis['verdict']) ? raw.verdict as PositionStrategyAnalysis['verdict'] : '信息不足',
    summary: text(raw.summary, '当前材料不足，暂不能形成可靠的持仓计划。'),
    positionSnapshot: { quantity: target.position.quantity, availableQuantity: target.position.availableQuantity, averageCost: cost, latestPrice, marketValue, pnl, pnlPercent, exposurePercent },
    breakEvenPlan: parsePlan(raw.breakEvenPlan, pnlPercent != null && pnlPercent < 0),
    profitPlan: parsePlan(raw.profitPlan, pnlPercent != null && pnlPercent >= 0),
    timeframes: {
      short: parseHorizon(timeframes.short, '短线 · 1—5 个交易日'),
      medium: parseHorizon(timeframes.medium, '中线 · 1—3 个月'),
      long: parseHorizon(timeframes.long, '长线 · 3—12 个月')
    },
    positionManagement: {
      summary: text(management.summary, '账户总资产或现金信息不足，不能精确计算仓位。'),
      actions: texts(management.actions, 6),
      noAddConditions: texts(management.noAddConditions, 5)
    },
    perspectives: { macro: parseFactor(perspectives.macro), sector: parseFactor(perspectives.sector), company: parseFactor(perspectives.company) },
    riskControls: texts(raw.riskControls, 6),
    nextChecks: texts(raw.nextChecks, 6),
    missingFacts: texts(raw.missingFacts, 8),
    confidence: confidences.includes(raw.confidence as PositionStrategyAnalysis['confidence']) ? raw.confidence as PositionStrategyAnalysis['confidence'] : '低',
    generatedAt,
    dataAsOf,
    expiresAt: new Date(Date.parse(generatedAt) + POSITION_STRATEGY_REFRESH_MS).toISOString()
  }
}

const strategyPrompt = (snapshot: TradeMasterSnapshot, target: StrategyTarget, evidence: Awaited<ReturnType<typeof loadMarketEvidence>>) => {
  const cost = target.position.averageCost
  const pnlPercent = cost && cost > 0 ? (evidence.quote.price / cost - 1) * 100 : null
  const payload = {
    member: { name: target.member.name, relationship: target.member.relationship, riskProfile: target.member.riskProfile },
    account: { name: target.account.name, totalAsset: target.account.totalAsset, cash: target.account.cash, monitoringEnabled: target.account.monitoringEnabled },
    position: target.position,
    computed: { latestPrice: evidence.quote.price, pnlPercent, exposurePercent: target.account.totalAsset ? evidence.quote.price * target.position.quantity / target.account.totalAsset * 100 : null },
    quote: evidence.quote,
    quoteSources: evidence.quoteSources,
    shortBars5m: evidence.shortBars,
    mediumBars1d: evidence.mediumBars,
    longBars1w: evidence.longBars,
    companyFacts: evidence.company,
    unavailableEvidence: evidence.missingSources,
    discipline: snapshot.discipline,
    goals: snapshot.goals,
    userProfile: snapshot.userProfile,
    activeStrategies: snapshot.strategies
  }
  return [
    '你正在为一个家庭账户中的单只真实持仓制定策略。只分析指定成员和账户，不得与其他成员合并成本、数量或风险预算。',
    '先给可执行结论，再分别给短线（1—5个交易日）、中线（1—3个月）、长线（3—12个月）策略。亏损仓重点制定不靠盲目补仓的回本计划；盈利仓重点制定利润保护和分批退出计划。所有动作必须有触发条件和失效条件。',
    '仓位建议必须考虑该持仓占账户资产比例、可用数量、现金、交易费用和用户风险偏好。账户总资产、现金或费用缺失时必须写入 missingFacts，不得假设。禁止把摊平成本作为默认方案，禁止承诺回本或收益。',
    '外围消息、行业板块、公司三个角度只能使用输入中明确提供的可核验材料。没有接入的来源必须标记为“材料不足”，不得依靠记忆编造当日新闻、公告、行业政策或公司事件。forming K 线只能预警，不能作为执行确认。',
    '仅返回 JSON，不要 Markdown。字段：verdict（优先降风险/制定回本计划/保护已有利润/继续持有观察/信息不足）、summary、breakEvenPlan、profitPlan、timeframes、positionManagement、perspectives、riskControls、nextChecks、missingFacts、confidence（低/中/高）。',
    'breakEvenPlan 和 profitPlan 格式为 {summary,steps}。timeframes 下必须有 short/medium/long，每项格式 {goal,stance,actions,triggers,invalidation}。positionManagement 格式 {summary,actions,noAddConditions}。perspectives 下必须有 macro/sector/company，每项格式 {status,summary,evidence}，status 只能是利好/中性/利空/材料不足。各数组最多 6 条。',
    `本次真实证据：${JSON.stringify(payload)}`,
    `用户确认交易记录（仅用于交叉核对）：${buildTradeContext(snapshot)}`
  ].join('\n\n')
}

export const generatePositionStrategy = async (config: AiConfig, snapshot: TradeMasterSnapshot, request: PositionStrategyRequest) => {
  const target = resolveTarget(snapshot, request)
  const signature = positionStrategySignature(snapshot, target)
  const path = cachePath(snapshot.home, target)
  const cached = await readCache(path)
  const cacheMatches = cached?.signature === signature
  if (!request.force && cacheMatches && Date.parse(cached.analysis.expiresAt) > Date.now()) return { analysis: cached.analysis, cached: true, stale: false }
  try {
    const evidence = await loadMarketEvidence(request.code)
    const content = await sendAiMessage(config, [{ role: 'user', content: strategyPrompt(snapshot, target, evidence) }], { purpose: 'automation', timeoutMs: 90_000, workingDirectory: snapshot.home })
    const dataAsOf = evidence.quote.exchangeTime || evidence.quote.collectedAt || new Date().toISOString()
    const analysis = parsePositionStrategy(content, target, evidence.quote.price, dataAsOf)
    analysis.missingFacts = [...new Set([...analysis.missingFacts, ...evidence.missingSources])].slice(0, 10)
    await writeCache(path, { signature, analysis })
    return { analysis, cached: false, stale: false }
  } catch (error) {
    if (cacheMatches && cached) return { analysis: cached.analysis, cached: true, stale: true, warning: error instanceof Error ? error.message : String(error) }
    throw error
  }
}
