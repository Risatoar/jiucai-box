import type { TradeMasterSnapshot } from '../shared/types'

const positionFacts = (portfolio: unknown) => {
  const value = portfolio as { cash?: unknown; cash_status?: unknown; cash_confirmed_at?: unknown; frozen_cash?: unknown; frozen_cash_status?: unknown; frozen_cash_confirmed_at?: unknown; active_orders_status?: unknown; active_orders_confirmed_at?: unknown; total_asset?: unknown; total_asset_estimate_before_unconfirmed_fees?: unknown; positions?: Array<Record<string, unknown>>; pending_events?: unknown[]; conflicts?: unknown[] } | null
  if (!value) return null
  return {
    cash: value.cash,
    cash_status: value.cash_status,
    cash_confirmed_at: value.cash_confirmed_at,
    frozen_cash: value.frozen_cash,
    frozen_cash_status: value.frozen_cash_status,
    frozen_cash_confirmed_at: value.frozen_cash_confirmed_at,
    active_orders_status: value.active_orders_status,
    active_orders_confirmed_at: value.active_orders_confirmed_at,
    total_asset: value.total_asset ?? value.total_asset_estimate_before_unconfirmed_fees,
    positions: (value.positions || []).map((position) => ({
      instrument: position.instrument,
      quantity: position.quantity,
      available_quantity: position.available_quantity,
      average_cost: position.average_cost,
      status: position.status,
      restrictions: position.restrictions
    })),
    pending_events: value.pending_events || [],
    conflicts: value.conflicts || []
  }
}

export const buildTradeContext = (snapshot: TradeMasterSnapshot): string => JSON.stringify({
  as_of: snapshot.loadedAt,
  fact_home: snapshot.home,
  user_profile: snapshot.userProfile,
  portfolio: positionFacts(snapshot.portfolio),
  daily_account_state: snapshot.accountState ? {
    trading_date: snapshot.accountState.tradingDate,
    account_id: snapshot.accountState.accountId,
    available_cash: snapshot.accountState.availableCash,
    frozen_cash: snapshot.accountState.frozenCash,
    active_orders: snapshot.accountState.activeOrders,
    rule: '同一交易日内已确认字段直接复用；只询问缺失字段，不得把已确认字段重新标为待确认。'
  } : null,
  household_portfolios: snapshot.household ? {
    members: snapshot.household.members.map((member) => ({ id: member.id, name: member.name, relationship: member.relationship, risk_profile: member.riskProfile, monitoring_enabled: member.monitoringEnabled })),
    accounts: snapshot.household.accounts.map((account) => ({ id: account.id, member_id: account.memberId, name: account.name, broker: account.broker, source: account.source, total_asset: account.totalAsset, cash: account.cash, monitoring_enabled: account.monitoringEnabled, positions: account.positions }))
  } : null,
  watchlist: snapshot.watchlist,
  goals: snapshot.goals,
  discipline: snapshot.discipline,
  strategy_profile: snapshot.strategyProfile,
  active_strategies: snapshot.strategies,
  strategy_candidates: snapshot.strategyCandidates,
  evolution: snapshot.evolution,
  off_market_voc: snapshot.voc ? {
    sources: snapshot.voc.sources.map((source) => ({ id: source.id, platform: source.platform, name: source.displayName, inverse_weight: source.inverseWeight, status: source.status })),
    recent_reports: snapshot.voc.recentReports.slice(0, 8),
    rule: '场外 VOC 只作为反向情绪风险因子，不能单独触发买卖；必须与行情、资金、账户和交易纪律交叉验证。'
  } : null,
  data_errors: snapshot.errors
})
