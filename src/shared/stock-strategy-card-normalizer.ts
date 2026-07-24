import type {
  StockStrategyCardData,
  StockStrategyActionPurpose,
  StockStrategyExecutionStatus,
  StockStrategyPoint,
  StockStrategyPositionState,
  StockStrategySignal,
  StockStrategyStance
} from './stock-strategy-types'
import {
  inferStockStrategyActionPurpose,
  STOCK_STRATEGY_ACTION_PURPOSES
} from './stock-strategy-action-purpose'

const stances: StockStrategyStance[] = ['持仓管理', '可关注', '等待确认', '暂不介入']
const confidences: StockStrategyCardData['confidence'][] = ['低', '中', '高']
const instrumentTypes: StockStrategyCardData['instrumentType'][] = ['stock', 'etf', 'cbond']
const signals: StockStrategySignal[] = ['immediate_buy', 'immediate_sell', 'strong_buy', 'strong_sell', 'prepare_buy', 'prepare_sell', 'watch', 'none']
const sources: NonNullable<StockStrategyCardData['source']>[] = ['holding', 'user', 'agent']
const executionStatuses: StockStrategyExecutionStatus[] = ['ready', 'review', 'blocked']
const positionStates: StockStrategyPositionState[] = [
  'entry_ready', 'entry_watch', 'full_exit_ready', 'reentry_ready', 'reentry_watch',
  'trend_top_reduce', 'trend_add_ready', 'trend_hold', 'range_break_reduce',
  'range_high_reduce', 'range_low_add', 'range_hold', 'defense_reduce',
  'defense_hold', 'watch', 'market_unavailable'
]
const triggerLevels: NonNullable<StockStrategyCardData['triggerLevel']>[] = ['watch', 'confirm', 'actionable']
const triggerKStates: NonNullable<StockStrategyCardData['triggerKState']>[] = ['forming', 'closed']
const BLOCKED_EXECUTION_TEXT = /等待|待确认|待核对|尚未|暂不|不得|不能|不执行|下一根|重新站稳/

const cleanText = (value: unknown, max = 160) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : undefined
}

const cleanList = (value: unknown, maxItems = 4) => Array.isArray(value)
  ? value.map((item) => cleanText(item, 120)).filter((item): item is string => Boolean(item)).slice(0, maxItems)
  : []

const cleanPoints = (value: unknown): StockStrategyPoint[] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const point = item as Record<string, unknown>
    const label = cleanText(point.label, 30)
    const condition = cleanText(point.condition, 140)
    if (!label || !condition) return []
    return [{ label, condition, price: cleanText(point.price, 30) }]
  }).slice(0, 4)
  : []

const immediateFallback = (signal: StockStrategySignal) =>
  signal === 'immediate_buy' ? 'strong_buy' : signal === 'immediate_sell' ? 'strong_sell' : signal

export const normalizeStockStrategyCard = (value: unknown): StockStrategyCardData | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const code = cleanText(raw.code, 12)
  const name = cleanText(raw.name, 36)
  const summary = cleanText(raw.summary, 220)
  if (!code || !/^\d{6}$/.test(code) || !name || !summary) return null

  const buyPoints = cleanPoints(raw.buyPoints)
  const sellPoints = cleanPoints(raw.sellPoints)
  const confidence = confidences.includes(raw.confidence as StockStrategyCardData['confidence'])
    ? raw.confidence as StockStrategyCardData['confidence']
    : '低'
  const requestedSignal = signals.includes(raw.signal as StockStrategySignal) ? raw.signal as StockStrategySignal : 'watch'
  const executionStatus = executionStatuses.includes(raw.executionStatus as StockStrategyExecutionStatus)
    ? raw.executionStatus as StockStrategyExecutionStatus
    : undefined
  const executionBlockers = cleanList(raw.executionBlockers)
  const accountScope = cleanText(raw.accountScope, 80)
  const currentPrice = cleanText(raw.currentPrice, 30)
  const dataAsOf = cleanText(raw.dataAsOf, 40)
  const executionValidUntil = cleanText(raw.executionValidUntil, 40)
  const decisionPolicyId = cleanText(raw.decisionPolicyId ?? raw.decision_policy_id, 80)
  const positionStateValue = raw.positionState ?? raw.position_state
  const positionState = positionStates.includes(positionStateValue as StockStrategyPositionState)
    ? positionStateValue as StockStrategyPositionState
    : undefined
  const tradeIntent = cleanText(raw.tradeIntent ?? raw.trade_intent, 60)
  const triggerStrategy = cleanText(raw.triggerStrategy ?? raw.trigger_strategy, 80)
  const triggerLevelValue = raw.triggerLevel ?? raw.trigger_level
  const triggerLevel = triggerLevels.includes(triggerLevelValue as NonNullable<StockStrategyCardData['triggerLevel']>)
    ? triggerLevelValue as NonNullable<StockStrategyCardData['triggerLevel']>
    : undefined
  const triggerKStateValue = raw.triggerKState ?? raw.trigger_k_state
  const triggerKState = triggerKStates.includes(triggerKStateValue as NonNullable<StockStrategyCardData['triggerKState']>)
    ? triggerKStateValue as NonNullable<StockStrategyCardData['triggerKState']>
    : undefined
  const suppliedActionPurpose = STOCK_STRATEGY_ACTION_PURPOSES.includes(raw.actionPurpose as StockStrategyActionPurpose)
    ? raw.actionPurpose as StockStrategyActionPurpose
    : undefined
  const actionPurpose = inferStockStrategyActionPurpose({
    signal: requestedSignal,
    positionState,
    tradeIntent,
    triggerStrategy
  }) || suppliedActionPurpose
  const matchingPoints = requestedSignal === 'immediate_buy' ? buyPoints : requestedSignal === 'immediate_sell' ? sellPoints : []
  const executionCopy = [summary, cleanText(raw.strategy, 260), ...matchingPoints.map((point) => point.condition)].filter(Boolean).join(' ')
  const evidenceTime = dataAsOf ? Date.parse(dataAsOf) : Number.NaN
  const expiryTime = executionValidUntil ? Date.parse(executionValidUntil) : Number.NaN
  const executionWindowValid = Number.isFinite(evidenceTime)
    && Number.isFinite(expiryTime)
    && expiryTime > Date.now()
    && expiryTime > evidenceTime
    && expiryTime - evidenceTime <= 5 * 60 * 1000
  const immediateReady = matchingPoints.some((point) => Boolean(point.price))
    && confidence === '高'
    && executionStatus === 'ready'
    && Array.isArray(raw.executionBlockers)
    && executionBlockers.length === 0
    && Boolean(accountScope && currentPrice && dataAsOf)
    && !BLOCKED_EXECUTION_TEXT.test(executionCopy)
    && executionWindowValid
  const signal = requestedSignal.startsWith('immediate_') && !immediateReady
    ? immediateFallback(requestedSignal)
    : requestedSignal
  const downgradedImmediate = requestedSignal.startsWith('immediate_') && !immediateReady
  const normalizedExecutionStatus = downgradedImmediate
    ? executionStatus === 'blocked' ? 'blocked' : 'review'
    : signal.startsWith('immediate_') ? 'ready' : executionStatus
  const normalizedExecutionBlockers = downgradedImmediate && executionBlockers.length === 0
    ? ['立即执行条件未完整通过，已降为推荐级信号']
    : executionBlockers

  return {
    code,
    name,
    exchange: cleanText(raw.exchange, 8),
    instrumentType: instrumentTypes.includes(raw.instrumentType as StockStrategyCardData['instrumentType']) ? raw.instrumentType as StockStrategyCardData['instrumentType'] : undefined,
    accountScope,
    source: sources.includes(raw.source as NonNullable<StockStrategyCardData['source']>) ? raw.source as NonNullable<StockStrategyCardData['source']> : undefined,
    currentPrice,
    changePercent: cleanText(raw.changePercent, 20),
    signal,
    stance: stances.includes(raw.stance as StockStrategyStance) ? raw.stance as StockStrategyStance : '等待确认',
    summary,
    strategy: cleanText(raw.strategy, 260),
    decisionPolicyId,
    positionState,
    tradeIntent,
    triggerStrategy,
    triggerLevel,
    triggerKState,
    actionPurpose,
    buyPoints,
    sellPoints,
    support: cleanText(raw.support, 180),
    resistance: cleanText(raw.resistance, 180),
    stopLoss: cleanText(raw.stopLoss, 180),
    invalidation: cleanText(raw.invalidation, 180),
    risks: cleanList(raw.risks),
    evidence: cleanList(raw.evidence),
    nextCheck: cleanText(raw.nextCheck, 120),
    confidence,
    dataAsOf,
    executionStatus: normalizedExecutionStatus,
    executionBlockers: normalizedExecutionBlockers,
    executionValidUntil
  }
}
