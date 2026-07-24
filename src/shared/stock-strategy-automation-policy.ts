import type { StockStrategyCardData, StockStrategySignal } from './stock-strategy-types'
import { inferStockStrategyActionPurpose, UNIFIED_DECISION_POLICY_ID } from './stock-strategy-action-purpose'

const BUY_STATES = new Set(['entry_ready', 'entry_watch', 'reentry_ready', 'reentry_watch', 'range_low_add', 'trend_add_ready'])
const SELL_STATES = new Set(['full_exit_ready', 'range_break_reduce', 'range_high_reduce', 'trend_top_reduce', 'defense_reduce'])
const ACTION_SIGNALS = new Set<StockStrategySignal>([
  'immediate_buy',
  'immediate_sell',
  'strong_buy',
  'strong_sell',
  'prepare_buy',
  'prepare_sell'
])

const signalSide = (signal?: StockStrategySignal) => signal?.endsWith('_buy')
  ? 'buy'
  : signal?.endsWith('_sell')
    ? 'sell'
    : undefined

const downgradeToWatch = (card: StockStrategyCardData, blockers: string[]): StockStrategyCardData => ({
  ...card,
  signal: 'watch',
  actionPurpose: '仅观察',
  buyPoints: [],
  sellPoints: [],
  executionStatus: 'blocked',
  executionBlockers: [...new Set([...(card.executionBlockers || []), ...blockers])]
})

export const enforceUnifiedAutomationCard = (card: StockStrategyCardData): StockStrategyCardData => {
  const signal = card.signal || 'watch'
  const side = signalSide(signal)
  const hasDecisionPoints = card.buyPoints.length > 0 || card.sellPoints.length > 0
  if (!ACTION_SIGNALS.has(signal) && !hasDecisionPoints) return card

  const blockers: string[] = []
  if (card.decisionPolicyId !== UNIFIED_DECISION_POLICY_ID) blockers.push('买卖点未通过统一V25模型校验')
  if (!card.positionState) blockers.push('缺少统一模型仓位状态')
  if (!card.triggerStrategy) blockers.push('缺少统一模型触发策略')
  if (card.triggerKState !== 'closed') blockers.push('触发K线尚未闭合')
  const recommendation = signal.startsWith('strong_') || signal.startsWith('immediate_')
  if (recommendation && card.triggerLevel !== 'actionable') blockers.push('统一模型尚未形成可行动信号')
  if (signal.startsWith('prepare_') && !['confirm', 'actionable'].includes(card.triggerLevel || '')) blockers.push('统一模型尚未形成准备级信号')
  if (side === 'buy' && !BUY_STATES.has(card.positionState || '')) blockers.push('统一模型状态与买入方向不一致')
  if (side === 'sell' && !SELL_STATES.has(card.positionState || '')) blockers.push('统一模型状态与卖出方向不一致')
  if (blockers.length) return downgradeToWatch(card, blockers)

  const actionPurpose = inferStockStrategyActionPurpose(card)
  if (!actionPurpose || actionPurpose === '仅观察') return downgradeToWatch(card, ['统一模型未识别出本次买卖用途'])
  return { ...card, actionPurpose }
}
