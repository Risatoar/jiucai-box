import type { StockStrategyCardData, TradeRecordInput } from './stock-strategy-types'

export type * from './integration-types'
export type * from './stock-strategy-types'
export type * from './voc'
export type * from './review-types'

export type InstrumentType = 'stock' | 'etf' | 'cbond'
export type StockBoard = 'main_sh' | 'main_sz' | 'chinext' | 'star'
export type GateState = 'pass' | 'warn' | 'blocked'
export type AppView = 'chat' | 'portfolio' | 'watchlist' | 'review' | 'voc' | 'strategies' | 'automations' | 'settings'

export interface Instrument {
  code: string
  name: string
  type: InstrumentType
  exchange: 'SH' | 'SZ' | 'BJ'
}

export interface Position {
  instrument: Instrument
  quantity: number
  availableQuantity: number
  averageCost: number | null
  latestPrice: number
  changePercent: number
  pnl: number
  pnlPercent: number
  status: 'confirmed' | 'pending' | 'closed'
  memberId?: string
  memberName?: string
  accountId?: string
  accountName?: string
}

export type HouseholdRiskProfile = 'conservative' | 'balanced' | 'active'

export interface HouseholdMember {
  id: string
  name: string
  relationship: string
  riskProfile: HouseholdRiskProfile
  monitoringEnabled: boolean
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

export interface HouseholdPosition {
  instrument: Instrument
  quantity: number
  availableQuantity: number
  averageCost: number | null
  status: 'confirmed' | 'pending' | 'closed'
}

export interface HouseholdAccount {
  id: string
  memberId: string
  name: string
  broker?: string
  source: 'primary' | 'managed'
  totalAsset: number | null
  cash: number | null
  monitoringEnabled: boolean
  positions: HouseholdPosition[]
  updatedAt: string
}

export interface HouseholdSnapshot {
  members: HouseholdMember[]
  accounts: HouseholdAccount[]
  updatedAt: string
}

export interface HouseholdMemberInput {
  name: string
  relationship: string
  riskProfile: HouseholdRiskProfile
}

export interface HouseholdAccountInput {
  memberId: string
  name: string
  broker?: string
  totalAsset?: number
}

export interface WatchItem extends Instrument {
  latestPrice: number
  changePercent: number
  volume: string
  score: number
  source: 'user' | 'agent'
  signal: '未评估' | '观察' | '准备买入' | '风险预警' | '今日停手'
  refreshedAt: string
  strategyLane?: string
  strategyLabel?: string
  suitableFor?: string
  nextAction?: string
}

export type ChartPeriod = 'timeline' | '1m' | '5m' | '15m' | '30m' | '60m' | '120m' | 'five_day' | '1d' | '1w' | '1M'

export interface MarketBar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number | null
  closed?: boolean
}

export interface MarketSignal {
  id: string
  code: string
  strategy: string
  side: 'buy' | 'sell'
  level: 'watch' | 'confirm' | 'actionable'
  period: ChartPeriod
  kState: 'forming' | 'closed'
  time: string
  price: number
  confidence: number | null
  reasons: string[]
  invalidation?: string
}

export interface Gate {
  id: 'data' | 'account' | 'discipline' | 'cost' | 'strategy'
  label: string
  state: GateState
  detail: string
}

export type MarketSessionPhase = 'pre_market' | 'intraday' | 'post_market' | 'closed'

export interface MarketInsightRequest {
  item: WatchItem
  bars: MarketBar[]
  gates: Gate[]
  position: Position | null
  householdPositions?: Position[]
  strategies: StrategyDefinition[]
  discipline: string
  period: ChartPeriod
  phase: MarketSessionPhase
  force?: boolean
}

export interface MarketAiInsight {
  stance: '持仓管理' | '可关注' | '等待确认' | '暂不介入'
  openPosition: '支持' | '条件支持' | '不支持' | '无法判断'
  currentStrategy: string
  todayOutlook: string
  nextSessionStrategy: string | null
  buyPoints: MarketDecisionPoint[]
  sellPoints: MarketDecisionPoint[]
  triggers: string[]
  invalidation: string[]
  evidence: string[]
  confidence: '低' | '中' | '高'
  generatedAt: string
  dataAsOf: string
}

export interface MarketDecisionPoint {
  label: string
  price: string
  condition: string
  accountScope?: string
}

export interface NotificationAuditEvent {
  id: string
  title: string
  mode: string
  modeLabel: string
  severity: 'info' | 'warning' | 'critical' | 'opportunity'
  sentAt: string
  delivered: boolean
}

export interface AccountFactConfirmation<T> {
  value: T
  confirmedAt: string
  sourceMessageId: string
  source: 'user_confirmed_via_jiucai_box'
}

export interface DailyAccountState {
  schemaVersion: 1
  tradingDate: string
  accountId: string
  availableCash?: AccountFactConfirmation<number>
  frozenCash?: AccountFactConfirmation<number>
  activeOrders?: AccountFactConfirmation<'none' | 'present'>
  processedMessageIds: string[]
  updatedAt: string
}

export interface TradeMasterSnapshot {
  home: string
  userProfile: unknown
  portfolio: unknown
  household?: HouseholdSnapshot | null
  accountState?: DailyAccountState | null
  watchlist: unknown
  goals: unknown
  discipline: unknown
  strategyProfile: unknown
  evolution: unknown
  notifications: unknown
  automation: unknown
  strategies: unknown
  strategyCandidates: unknown
  strategyVersions?: unknown
  pausedStrategies?: unknown
  automationRuns?: unknown
  notificationAudit?: unknown
  voc?: import('./voc').VocSnapshot | null
  loadedAt: string
  errors: string[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  action?: {
    title: string
    level: 'observe' | 'warning' | 'ready' | 'stop'
    trigger: string
    invalidation: string
    nextCheck: string
  }
  status?: 'normal' | 'error' | 'notice'
  tradeProposal?: TradeRecordInput & { state: 'pending' | 'recorded' | 'rejected' }
  stockStrategyCards?: StockStrategyCardData[]
  attachments?: ChatAttachment[]
}

export interface ChatAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: 'image' | 'file'
  storageKey: string
}

export interface AttachmentInput {
  name: string
  mimeType: string
  bytes: Uint8Array
}

export interface AiMessageInput {
  role: string
  content: string
  attachments?: ChatAttachment[]
}

export interface AiStreamEvent {
  type: 'status' | 'content'
  stage?: 'connecting' | 'thinking' | 'tool' | 'writing'
  message?: string
  content?: string
  mode?: 'append' | 'replace'
}

export interface ChatRunSnapshot {
  requestId: string
  sessionId: string
  startedAt: number
  status: string
  content: string
}

export interface ChatRunChangedEvent {
  sessionId: string
  run: ChatRunSnapshot | null
}

export interface ChatSessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  archivedAt?: string
}

export interface ChatSession extends ChatSessionSummary {
  messages: ChatMessage[]
  memories?: ChatMemorySettings
}

export interface ChatMemorySettings {
  useMemories: boolean
  generateMemories: boolean
}

export type MemoryCategory = 'preference' | 'goal' | 'risk' | 'habit' | 'lesson'

export interface MemoryItem {
  id: string
  content: string
  category: MemoryCategory
  pinned: boolean
  sourceSessionId?: string
  createdAt: string
  updatedAt: string
}

export interface MemorySettings {
  useMemories: boolean
  generateMemories: boolean
}

export interface MemorySnapshot {
  settings: MemorySettings
  items: MemoryItem[]
}

export interface MemoryInput {
  content: string
  category: MemoryCategory
  pinned?: boolean
}

export interface StrategyDefinition {
  id: string
  name: string
  family: string
  instruments: InstrumentType[]
  status: 'active' | 'shadow' | 'candidate' | 'paused'
  version: string
  description: string
  rules: string[]
  evidence: { history: number; outOfSample: number; shadowDays: number }
  performance: { winRate: number; profitFactor: number; maxDrawdown: number }
  updatedAt: string
  source: 'builtin' | 'ai-evolved' | 'user'
}

export interface StrategyMutationResult {
  ok: boolean
  changed?: boolean
  promoted?: boolean
  message?: string
  error?: string
}

export interface UserProfile {
  capital: number
  styles: string[]
  experience: string
  maxDrawdown: number
  targetReturn: number
  targetMonths: number
  instruments: InstrumentType[]
  stockBoards?: StockBoard[]
  tradingHabits: string[]
  riskRating?: RiskRating
  riskScore?: number
  ratingReasons?: string[]
}

export type RiskRating = '保守型' | '稳健型' | '平衡型' | '进取型' | '激进型'

export interface ProfileRating {
  rating: RiskRating
  score: number
  reasons: string[]
}

export interface SetupProgress {
  stage: 'checking' | 'core' | 'facts' | 'doctor' | 'complete' | 'error'
  percent: number
  title: string
  detail: string
}

export interface SetupResult {
  ok: boolean
  progress: SetupProgress
  error?: string
}

export interface AppUpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'disabled' | 'error'
  currentVersion: string
  availableVersion?: string
  message: string
}

export interface AiConfig {
  provider: 'openai-compatible' | 'codex-local'
  baseUrl: string
  model: string
  codexModel?: string
  timeoutSeconds?: number
  apiKey?: string
  codexPath?: string
}

export interface CodexModelOption {
  id: string
  displayName: string
  description?: string
  isDefault?: boolean
  defaultReasoningEffort?: string
  supportedReasoningEfforts?: Array<{
    reasoningEffort: string
    description?: string
  }>
  inputModalities?: string[]
}
