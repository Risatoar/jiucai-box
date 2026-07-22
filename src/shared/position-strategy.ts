import type { Instrument } from './types'

export const POSITION_STRATEGY_REFRESH_MS = 5 * 60 * 1000

export interface PositionStrategyRequest {
  memberId: string
  accountId: string
  code: string
  force?: boolean
}

export interface PositionStrategyHorizon {
  horizon: string
  goal: string
  stance: string
  actions: string[]
  triggers: string[]
  invalidation: string[]
}

export interface PositionStrategyPlan {
  applicable: boolean
  summary: string
  steps: string[]
}

export interface PositionStrategyFactor {
  status: '利好' | '中性' | '利空' | '材料不足'
  summary: string
  evidence: string[]
}

export interface PositionStrategyAnalysis {
  instrument: Instrument
  memberName: string
  accountName: string
  verdict: '优先降风险' | '制定回本计划' | '保护已有利润' | '继续持有观察' | '信息不足'
  summary: string
  positionSnapshot: {
    quantity: number
    availableQuantity: number
    averageCost: number | null
    latestPrice: number
    marketValue: number
    pnl: number | null
    pnlPercent: number | null
    exposurePercent: number | null
  }
  breakEvenPlan: PositionStrategyPlan
  profitPlan: PositionStrategyPlan
  timeframes: {
    short: PositionStrategyHorizon
    medium: PositionStrategyHorizon
    long: PositionStrategyHorizon
  }
  positionManagement: {
    summary: string
    actions: string[]
    noAddConditions: string[]
  }
  perspectives: {
    macro: PositionStrategyFactor
    sector: PositionStrategyFactor
    company: PositionStrategyFactor
  }
  riskControls: string[]
  nextChecks: string[]
  missingFacts: string[]
  confidence: '低' | '中' | '高'
  generatedAt: string
  dataAsOf: string
  expiresAt: string
}
