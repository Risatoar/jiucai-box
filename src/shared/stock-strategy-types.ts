export interface TradeRecordInput {
  code: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  fee?: number
  occurredAt?: string
  note?: string
}

export type StockStrategyStance = '持仓管理' | '可关注' | '等待确认' | '暂不介入'
export type StockStrategySignal = 'immediate_buy' | 'immediate_sell' | 'strong_buy' | 'strong_sell' | 'prepare_buy' | 'prepare_sell' | 'watch' | 'none'
export type StockStrategySource = 'holding' | 'user' | 'agent'
export type StockStrategyExecutionStatus = 'ready' | 'review' | 'blocked'
export type StockSignalHandlingStatus = 'executed' | 'watching' | 'ignored'
export type StockStrategyActionPurpose =
  | '逃顶 · 卖出准备做T'
  | '区间高抛 · 卖出准备做T'
  | '买入完成做T'
  | '高抛低吸完成'
  | '区间低吸'
  | '清仓避险'
  | '风险减仓'
  | '风险释放后接回'
  | '趋势回踩买入'
  | '新开仓'
  | '准备接回'
  | '持有核心仓'
  | '仅观察'
export type StockStrategyPositionState =
  | 'entry_ready'
  | 'entry_watch'
  | 'full_exit_ready'
  | 'reentry_ready'
  | 'reentry_watch'
  | 'trend_top_reduce'
  | 'trend_add_ready'
  | 'trend_hold'
  | 'range_break_reduce'
  | 'range_high_reduce'
  | 'range_low_add'
  | 'range_hold'
  | 'defense_reduce'
  | 'defense_hold'
  | 'watch'
  | 'market_unavailable'

export interface StockSignalHandling {
  status: StockSignalHandlingStatus
  handledAt: string
  accountId?: string
  trade?: TradeRecordInput
}

export interface StockStrategyPoint {
  label: string
  price?: string
  condition: string
}

export interface StockStrategyCardData {
  code: string
  name: string
  exchange?: string
  instrumentType?: 'stock' | 'etf' | 'cbond'
  accountScope?: string
  source?: StockStrategySource
  currentPrice?: string
  changePercent?: string
  signal?: StockStrategySignal
  stance: StockStrategyStance
  summary: string
  strategy?: string
  decisionPolicyId?: string
  positionState?: StockStrategyPositionState
  tradeIntent?: string
  triggerStrategy?: string
  triggerLevel?: 'watch' | 'confirm' | 'actionable'
  triggerKState?: 'forming' | 'closed'
  actionPurpose?: StockStrategyActionPurpose
  buyPoints: StockStrategyPoint[]
  sellPoints: StockStrategyPoint[]
  support?: string
  resistance?: string
  stopLoss?: string
  invalidation?: string
  risks: string[]
  evidence: string[]
  nextCheck?: string
  confidence: '低' | '中' | '高'
  dataAsOf?: string
  executionStatus?: StockStrategyExecutionStatus
  executionBlockers?: string[]
  evaluationEligible?: boolean
  eligibilityReason?: string
  executionValidUntil?: string
  handling?: StockSignalHandling
}

export type SignalLedgerSide = 'buy' | 'sell'
export type SignalCaseKind = 'goodcase' | 'badcase' | 'neutral' | 'pending'
export type SignalOutcomeHorizon = 1 | 3 | 7 | 15

export interface SignalOutcome {
  horizon: SignalOutcomeHorizon
  status: 'pending' | 'completed'
  tradingDate?: string
  closePrice?: number
  underlyingReturnPercent?: number
  directionalReturnPercent?: number
  maxFavorablePercent?: number
  maxAdversePercent?: number
}

export interface SignalLedgerRecord {
  id: string
  fingerprint: string
  code: string
  name: string
  side: SignalLedgerSide
  signal: StockStrategySignal
  stance: StockStrategyStance
  accountScope?: string
  source?: StockStrategySource
  recordedAt: string
  signalDate: string
  referencePrice: number | null
  referencePriceSource: 'current_price' | 'point_price' | 'missing'
  summary: string
  strategy?: string
  decisionPolicyId?: string
  positionState?: StockStrategyPositionState
  tradeIntent?: string
  triggerStrategy?: string
  actionPurpose?: StockStrategyActionPurpose
  points: StockStrategyPoint[]
  invalidation?: string
  risks: string[]
  evidence: string[]
  confidence: '低' | '中' | '高'
  dataAsOf?: string
  executionStatus?: StockStrategyExecutionStatus
  executionBlockers?: string[]
  executionValidUntil?: string
  evaluationEligible?: boolean
  eligibilityReason?: string
  sourceSessionId: string
  sourceMessageId: string
  outcomes: SignalOutcome[]
  caseKind: SignalCaseKind
  caseReason: string
  evaluatedAt?: string
}

export interface SignalAccuracySummary {
  total: number
  eligible: number
  excluded: number
  evaluated: number
  pending: number
  goodcases: number
  badcases: number
  neutral: number
  directionalAccuracyPercent: number | null
  byHorizon: Array<{
    horizon: SignalOutcomeHorizon
    completed: number
    correct: number
    accuracyPercent: number | null
    averageDirectionalReturnPercent: number | null
  }>
}

export interface SignalHistorySnapshot {
  code: string
  generatedAt: string
  records: SignalLedgerRecord[]
  summary: SignalAccuracySummary
  refreshError?: string
}

export interface DailySignalReview {
  schemaVersion: 1
  tradingDate: string
  generatedAt: string
  summary: SignalAccuracySummary
  updatedSignalIds: string[]
  goodcases: SignalLedgerRecord[]
  badcases: SignalLedgerRecord[]
  reflection: string[]
  strategyCandidateFile?: string
}
