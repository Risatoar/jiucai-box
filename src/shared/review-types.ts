import type { MarketBar, SignalLedgerRecord } from './types'

export type ReviewPeriod = 'daily' | 'weekly' | 'monthly'
export type ReviewStage = 'idle' | 'collecting' | 'analyzing' | 'ready' | 'error'
export type ReviewTrend = 'up' | 'down' | 'range' | 'breakout' | 'breakdown' | 'unknown'
export type ReviewConfidence = '低' | '中' | '高'
export type ReviewOutcomeStatus = 'verified' | 'partial' | 'failed' | 'watching' | 'pending'

export interface ReviewDateRange {
  start: string
  end: string
  tradingDate: string
}

export interface ReviewIndexAssessment {
  stance: string
  summary: string
  evidence: string[]
  nextSessionFocus: string
}

export interface ReviewBreadth {
  type: string
  total: number
  rising: number
  falling: number
  flat: number
  medianChangePercent: number | null
  totalAmount: number | null
}

export interface ReviewBenchmark {
  code: string
  name: string
  changePercent: number | null
  price?: number | null
  instrumentType?: string
  amount: number | null
}


export interface ReviewRepresentative {
  code: string
  name: string
  type?: string
  price?: number | null
  changePercent?: number | null
  amount?: number | null
  turnoverPercent?: number | null
  leadershipScore?: number | null
}

export interface ReviewHotTheme {
  name: string
  heatScore: number | null
  changePercent: number | null
  breadthPercent: number | null
  totalAmount: number | null
  amountEstimated?: boolean
  stockCount?: number
  sampleStockCount?: number
  representativeCodes: string[]
  representatives: ReviewRepresentative[]
}

export interface ReviewMarketOverview {
  dataScope?: 'all_a_share_stocks' | 'unavailable'
  stockCoverage?: {
    total: number
    classified: number
    percent: number
    source: string
    sampleSize?: number
  }
  regime: string | null
  breadth: ReviewBreadth[]
  benchmarks: ReviewBenchmark[]
  hotThemes: ReviewHotTheme[]
  generatedAt: string | null
}

export interface ReviewSectorAnalysis {
  id: string
  name: string
  trend: ReviewTrend
  stage: '启动' | '加速' | '分歧' | '退潮' | '穿越' | '未知'
  summary: string
  evidence: string[]
  leaders: string[]
  representatives: ReviewRepresentative[]
  observation: string
  winRate?: number | null
  suggestion: string
  relatedCodes: string[]
}

export interface ReviewHotStock {
  code: string
  name: string
  sector?: string
  role: '龙头' | '补涨' | '跟风' | '独立' | '未知'
  changePercent: number | null
  price?: number | null
  instrumentType?: string
  turnoverRate?: number | null
  volumeRatio?: number | null
  stage: ReviewSectorAnalysis['stage']
  summary: string
  evidence: string[]
  nextScript: string
  invalidation: string
  suggestion: string
  bars?: MarketBar[]
}

export interface ReviewCandidateReview {
  id: string
  code: string
  name: string
  recommendedAt: string
  recommendation: string
  reason: string
  referencePrice: number | null
  latestPrice: number | null
  changeSinceRecommend: number | null
  status: ReviewOutcomeStatus
  summary: string
  evidence: string[]
  userRating?: number | null
  userNote?: string
  bars?: MarketBar[]
}

export interface ReviewSignalReview {
  id: string
  code: string
  name: string
  side: 'buy' | 'sell'
  signal: SignalLedgerRecord['signal']
  strategy: string
  level: SignalLedgerRecord['confidence']
  signalAt: string
  signalDate: string
  referencePrice: number | null
  latestPrice: number | null
  outcomeStatus: ReviewOutcomeStatus
  directionalReturnPercent: number | null
  summary: string
  evidence: string[]
  userRating?: number | null
  userNote?: string
  bars?: MarketBar[]
}

export interface ReviewAggregate {
  candidateTotal: number
  candidateVerified: number
  candidateFailed: number
  candidateWatching: number
  candidateRatedCount: number
  candidateAvgRating: number | null
  signalTotal: number
  signalEvaluated: number
  signalAccuracyPercent: number | null
  averageDirectionalReturnPercent: number | null
  signalRatedCount: number
  signalAvgRating: number | null
  blindSpots: string[]
  suggestions: string[]
}

export interface ReviewReport {
  schemaVersion: 1
  id: string
  period: ReviewPeriod
  range: ReviewDateRange
  stage: ReviewStage
  generatedAt: string
  dataAsOf: string
  marketOverview?: ReviewMarketOverview
  rawData?: {
    indexBars?: MarketBar[]
    sectorSnapshots?: unknown[]
    candidates?: ReviewCandidateReview[]
    signals?: ReviewSignalReview[]
  }
  indexAssessment?: ReviewIndexAssessment
  sectors?: ReviewSectorAnalysis[]
  hotStocks?: ReviewHotStock[]
  candidateReviews?: ReviewCandidateReview[]
  signalReviews?: ReviewSignalReview[]
  aggregate?: ReviewAggregate
  candidateSummary?: string
  signalSummary?: string
  summary?: string
  error?: string
}

export interface ReviewRatingInput {
  targetType: 'candidate' | 'signal'
  targetId: string
  rating: number
  note?: string
}

export interface ReviewRequest {
  period: ReviewPeriod
  tradingDate?: string
  force?: boolean
}
