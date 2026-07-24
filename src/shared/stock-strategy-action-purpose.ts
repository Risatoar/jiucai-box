import type {
  StockStrategyActionPurpose,
  StockStrategyPositionState,
  StockStrategySignal
} from './stock-strategy-types'

export const UNIFIED_DECISION_POLICY_ID = 'rolling-position-v25-robust-70'

export const STOCK_STRATEGY_ACTION_PURPOSES: StockStrategyActionPurpose[] = [
  '逃顶 · 卖出准备做T',
  '区间高抛 · 卖出准备做T',
  '买入完成做T',
  '高抛低吸完成',
  '区间低吸',
  '清仓避险',
  '风险减仓',
  '风险释放后接回',
  '趋势回踩买入',
  '新开仓',
  '准备接回',
  '持有核心仓',
  '仅观察'
]

interface ActionPurposeEvidence {
  signal?: StockStrategySignal
  positionState?: StockStrategyPositionState
  tradeIntent?: string
  triggerStrategy?: string
}

export const inferStockStrategyActionPurpose = ({
  signal,
  positionState,
  tradeIntent,
  triggerStrategy
}: ActionPurposeEvidence): StockStrategyActionPurpose | undefined => {
  if (positionState === 'full_exit_ready') return '清仓避险'
  if (positionState === 'range_break_reduce' || positionState === 'defense_reduce') return '风险减仓'
  if (positionState === 'trend_top_reduce') return '逃顶 · 卖出准备做T'
  if (positionState === 'range_high_reduce') return '区间高抛 · 卖出准备做T'
  if (positionState === 'range_low_add') return '区间低吸'
  if (positionState === 'trend_add_ready') return '趋势回踩买入'
  if (positionState === 'reentry_watch' || positionState === 'entry_watch') return '准备接回'
  if (positionState === 'trend_hold') return '持有核心仓'
  if (positionState === 'reentry_ready' || positionState === 'entry_ready') {
    if (tradeIntent === 't_reentry') return '买入完成做T'
    if (tradeIntent === 'high_low_reentry') return '高抛低吸完成'
    if (positionState === 'reentry_ready' || tradeIntent === 'risk_reclaim' || tradeIntent === 'risk_reentry') return '风险释放后接回'
    return '新开仓'
  }
  if (triggerStrategy === 'range_low_reversal') return '区间低吸'
  if (triggerStrategy === 'trend_pullback_entry') return '趋势回踩买入'
  if (signal === 'watch' || signal === 'none') return '仅观察'
  return undefined
}
