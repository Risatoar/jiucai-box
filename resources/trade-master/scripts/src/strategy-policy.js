import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, tradeMasterHome } from './storage.js';

export const ACTIVE_DECISION_POLICY = Object.freeze({
    id: 'builtin-position-v1',
    range_low_min_volume_ratio: 1.2,
    range_low_max_position: 0.25,
    range_low_min_momentum_5d_pct: null,
    range_low_max_ma20_slope_5d_pct: null,
    range_low_max_atr_ratio_pct: null,
    range_low_max_intraday_drawdown_pct: null,
    range_low_requires_daily_repair: false,
    range_high_min_position: 0.8,
    range_high_min_volume_ratio: 1.2,
    range_decision_period: null,
    range_high_require_bearish_body: false,
    range_high_min_upper_shadow_ratio: 0,
    range_high_min_next_support_distance_pct: null,
    range_high_max_close_change_pct: null,
    range_high_max_atr_ratio_pct: null,
    range_high_max_momentum_5d_pct: null,
    t_reentry_min_discount_pct: 0,
    high_low_min_discount_pct: 0,
    t_reentry_max_calendar_days: null,
    t_reentry_discount_strategies: ['range_high_reversal'],
    t_reentry_buy_strategies: ['range_low_reversal', 'trend_pullback_entry'],
    t_reentry_min_volume_ratio: null,
    new_cycle_min_calendar_days: null,
    counterfactual_entry_cooldown_trading_days: 5,
    support_break_min_periods: 1,
    range_break_requires_daily_support_broken: false,
    reentry_min_periods: 1,
    reentry_requires_daily_repair: false,
    reentry_min_momentum_5d_pct: null,
    reentry_min_atr_ratio_pct: null,
    reclaim_reentry_min_periods: 1,
    reclaim_reentry_cross_periods: 1,
    reclaim_reentry_min_signals: 1,
    reclaim_reentry_min_span_minutes: 0,
    reclaim_reentry_pct: 1,
    reclaim_reentry_min_volume_ratio: 1.2,
    reclaim_reentry_min_momentum_5d_pct: null,
    reclaim_requires_known_support: false,
    reclaim_max_next_support_distance_pct: null,
    trend_top_min_periods: 1,
    trend_entry_min_periods: 1,
    trend_entry_period: null,
    trend_entry_strategies: null,
    trend_entry_min_momentum_5d_pct: null,
    trend_entry_max_momentum_5d_pct: null,
    trend_entry_max_distance_to_ma20_pct: null,
    trend_entry_min_ma20_slope_5d_pct: null,
    trend_entry_max_ma20_slope_5d_pct: null,
    trend_entry_max_atr_ratio_pct: null,
    trend_entry_max_intraday_drawdown_pct: null,
    trend_entry_max_next_support_distance_pct: null,
    trend_entry_min_volume_ratio: null,
    trend_entry_require_previous_high_reclaim: false,
    trend_entry_require_macd_improving: false,
    trend_entry_min_close_location: null,
    exit_signal_strategies: null,
    full_exit_requires_high_downside: false,
    full_exit_require_multi_period: false,
    full_exit_max_intraday_drawdown_pct: null,
    full_exit_min_atr_ratio_pct: null,
    full_exit_max_momentum_5d_pct: null,
    full_exit_min_ma20_slope_5d_pct: null,
    full_exit_allow_15m: true,
    full_exit_min_sell_periods: 2,
    defense_period: null,
    defense_strategies: null,
    defense_min_intraday_drawdown_pct: 0,
    defense_require_intraday_drawdown: false,
    defense_max_momentum_5d_pct: null,
    defense_min_momentum_5d_pct: null,
    defense_require_momentum_confirmation: false,
    defense_max_intraday_drawdown_pct: null,
    defense_max_next_support_distance_pct: null,
    rally_min_intraday_drawdown_pct: 0,
    rally_min_range_position: 0,
    rally_reject_daily_repair: false,
    rally_min_upper_shadow_ratio: 0,
});

export const ROLLING_CANDIDATE_POLICY = Object.freeze({
    id: 'rolling-position-v23',
    range_low_min_volume_ratio: 2,
    range_low_max_position: 0.2,
    range_low_min_momentum_5d_pct: -6,
    range_low_max_ma20_slope_5d_pct: 3,
    range_low_max_atr_ratio_pct: 8,
    range_low_max_intraday_drawdown_pct: 3,
    range_low_requires_daily_repair: false,
    range_high_min_position: 0.9,
    range_high_min_volume_ratio: 1.2,
    range_decision_period: '5m',
    range_high_require_bearish_body: true,
    range_high_min_upper_shadow_ratio: 1.5,
    range_high_min_next_support_distance_pct: 10,
    range_high_max_close_change_pct: 0,
    range_high_max_atr_ratio_pct: null,
    range_high_max_momentum_5d_pct: null,
    t_reentry_min_discount_pct: 0.5,
    high_low_min_discount_pct: 0.5,
    t_reentry_max_calendar_days: 22,
    t_reentry_discount_strategies: ['range_high_reversal', 'support_break_retest', 'rally_exhaustion', 'trend_distribution_top'],
    new_cycle_min_calendar_days: 14,
    counterfactual_entry_cooldown_trading_days: 5,
    support_break_min_periods: 3,
    range_break_requires_daily_support_broken: true,
    reentry_min_periods: 2,
    reentry_requires_daily_repair: true,
    reclaim_reentry_min_periods: 1,
    reclaim_reentry_cross_periods: 2,
    reclaim_reentry_min_signals: 2,
    reclaim_reentry_min_span_minutes: 30,
    reclaim_reentry_pct: 1,
    reclaim_reentry_min_volume_ratio: 1.2,
    reclaim_reentry_min_momentum_5d_pct: -6,
    reclaim_requires_known_support: true,
    reclaim_max_next_support_distance_pct: 12,
    trend_top_min_periods: 2,
    trend_entry_min_periods: 2,
    trend_entry_strategies: ['trend_pullback_entry'],
    trend_entry_min_momentum_5d_pct: -6,
    trend_entry_max_momentum_5d_pct: 6,
    trend_entry_max_distance_to_ma20_pct: 12,
    trend_entry_min_ma20_slope_5d_pct: -0.5,
    trend_entry_max_ma20_slope_5d_pct: 3,
    trend_entry_max_atr_ratio_pct: 8,
    trend_entry_max_intraday_drawdown_pct: 3,
    trend_entry_max_next_support_distance_pct: null,
    exit_signal_strategies: ['support_break'],
    full_exit_requires_high_downside: true,
    full_exit_require_multi_period: true,
    full_exit_max_intraday_drawdown_pct: 4,
    full_exit_min_atr_ratio_pct: 3,
    full_exit_max_momentum_5d_pct: -5,
    full_exit_allow_15m: false,
    full_exit_min_sell_periods: 2,
    defense_period: '5m',
    defense_strategies: ['support_break_retest', 'rally_exhaustion'],
    defense_min_intraday_drawdown_pct: 1.5,
    defense_require_intraday_drawdown: true,
    defense_max_momentum_5d_pct: -2,
    defense_max_intraday_drawdown_pct: 3,
    defense_max_next_support_distance_pct: 10,
    rally_min_intraday_drawdown_pct: 1,
    rally_min_range_position: 0.6,
    rally_reject_daily_repair: true,
    rally_min_upper_shadow_ratio: 0,
});

export const ASSET_ADAPTIVE_CANDIDATE_POLICY = Object.freeze({
    ...ROLLING_CANDIDATE_POLICY,
    id: 'rolling-position-v24-asset-adaptive',
    asset_overrides: {
        stock: {},
        etf: {
            trend_entry_strategies: [],
            range_low_requires_daily_repair: true,
            full_exit_min_atr_ratio_pct: 999,
            full_exit_max_momentum_5d_pct: null,
        },
        cbond: {
            range_low_requires_daily_repair: true,
            range_high_max_atr_ratio_pct: 10,
            range_high_max_momentum_5d_pct: 0,
            range_high_max_close_change_pct: -0.02,
            trend_entry_max_next_support_distance_pct: 30,
            full_exit_min_atr_ratio_pct: 999,
            full_exit_max_momentum_5d_pct: null,
            rally_min_upper_shadow_ratio: 2.5,
            defense_strategies: ['support_break_retest'],
        },
    },
});

export const COVERAGE_RESTORED_CANDIDATE_POLICY = Object.freeze({
    ...ASSET_ADAPTIVE_CANDIDATE_POLICY,
    id: 'rolling-position-v24-coverage-restored',
    asset_overrides: {
        stock: {
            trend_top_min_periods: 1,
            trend_entry_min_periods: 1,
        },
        etf: {
            trend_entry_strategies: [],
            trend_top_min_periods: 1,
            range_low_requires_daily_repair: false,
            range_low_min_volume_ratio: 2.5,
            range_low_min_momentum_5d_pct: -3,
            range_low_max_atr_ratio_pct: 5,
            range_low_max_intraday_drawdown_pct: 2,
            full_exit_min_atr_ratio_pct: 999,
            full_exit_max_momentum_5d_pct: null,
        },
        cbond: {
            trend_top_min_periods: 1,
            trend_entry_min_periods: 1,
            range_low_requires_daily_repair: false,
            range_low_min_volume_ratio: 2.5,
            range_low_min_momentum_5d_pct: -3,
            range_low_max_atr_ratio_pct: 8,
            range_low_max_intraday_drawdown_pct: 2,
            range_high_max_atr_ratio_pct: 10,
            range_high_max_momentum_5d_pct: 0,
            range_high_max_close_change_pct: -0.02,
            trend_entry_max_next_support_distance_pct: 30,
            full_exit_min_atr_ratio_pct: 999,
            full_exit_max_momentum_5d_pct: null,
            rally_min_upper_shadow_ratio: 2.5,
            defense_strategies: ['support_break_retest'],
        },
    },
});

export const ROBUST_70_CANDIDATE_POLICY = Object.freeze({
    ...COVERAGE_RESTORED_CANDIDATE_POLICY,
    id: 'rolling-position-v25-robust-70',
    range_low_max_position: 0.135,
    range_low_max_ma20_slope_5d_pct: -0.5,
    range_low_min_momentum_5d_pct: -1,
    reentry_min_momentum_5d_pct: 0.3,
    reentry_min_atr_ratio_pct: null,
    t_reentry_min_discount_pct: 3,
    high_low_min_discount_pct: 2,
    t_reentry_buy_strategies: ['range_low_reversal', 'trend_pullback_entry', 'stage_support_rebound'],
    t_reentry_min_volume_ratio: 1.1,
    defense_min_intraday_drawdown_pct: 2.6,
    defense_require_intraday_drawdown: true,
    defense_max_momentum_5d_pct: -5.2,
    defense_min_momentum_5d_pct: -8.7,
    defense_require_momentum_confirmation: true,
    defense_strategies: ['support_break_retest'],
    full_exit_min_ma20_slope_5d_pct: -4.9,
    trend_entry_min_volume_ratio: 1.1,
    trend_entry_period: '15m',
    trend_entry_require_previous_high_reclaim: true,
    trend_entry_require_macd_improving: true,
    trend_entry_min_close_location: 0.65,
    quality_guard: {
        minimum_cases_per_type: 10,
        target_accuracy_pct: 70,
        protected_max_degradation_pct: 5,
        protected: {
            range_high: 86.76,
            trend_take_profit: 73.33,
            bottom_fishing_abstention: 80,
        },
        optimize: [
            'full_exit',
            'defense_reduce',
            'range_low',
            'trend_entry',
            'reentry',
            't_trade',
            'high_low_pair',
        ],
    },
    asset_overrides: {
        stock: {
            trend_top_min_periods: 1,
            trend_entry_min_periods: 1,
            t_reentry_min_discount_pct: 3,
            high_low_min_discount_pct: 2,
        },
        etf: {
            trend_entry_strategies: ['trend_pullback_entry'],
            trend_entry_min_periods: 1,
            trend_top_min_periods: 1,
            range_low_requires_daily_repair: false,
            range_low_min_volume_ratio: 2.5,
            range_low_min_momentum_5d_pct: -1,
            range_low_max_atr_ratio_pct: 5,
            range_low_max_intraday_drawdown_pct: 2,
            full_exit_min_atr_ratio_pct: 999,
            full_exit_max_momentum_5d_pct: null,
            t_reentry_min_discount_pct: 3,
            high_low_min_discount_pct: 2,
        },
        cbond: {
            trend_entry_strategies: [],
            trend_top_min_periods: 1,
            range_low_requires_daily_repair: false,
            range_low_min_volume_ratio: 2.5,
            range_low_min_momentum_5d_pct: -1,
            range_low_max_atr_ratio_pct: 8,
            range_low_max_intraday_drawdown_pct: 2,
            range_high_max_atr_ratio_pct: 10,
            range_high_max_momentum_5d_pct: 0,
            range_high_max_close_change_pct: -0.02,
            full_exit_min_atr_ratio_pct: 999,
            full_exit_max_momentum_5d_pct: null,
            rally_min_upper_shadow_ratio: 2.5,
            defense_strategies: ['support_break_retest'],
            t_reentry_min_discount_pct: 1,
            high_low_min_discount_pct: 0.5,
        },
    },
});

export function normalizeDecisionPolicy(value) {
    return { ...ACTIVE_DECISION_POLICY, ...(value ?? {}) };
}

export function decisionPolicyForInstrument(value, type) {
    const normalized = normalizeDecisionPolicy(value);
    const override = value?.asset_overrides?.[type] ?? {};
    return { ...normalized, ...override, id: normalized.id };
}

export function rangeHighRejectionConfirmed(signal, riskProfile, policy) {
    return ((signal.metadata?.upper_shadow_ratio ?? 0) >= policy.range_high_min_upper_shadow_ratio
        || (policy.range_high_min_next_support_distance_pct != null
            && riskProfile.next_support_distance_pct >= policy.range_high_min_next_support_distance_pct))
        && (policy.range_high_max_atr_ratio_pct == null
            || riskProfile.atr_ratio_pct <= policy.range_high_max_atr_ratio_pct)
        && (policy.range_high_max_momentum_5d_pct == null
            || riskProfile.momentum_5d_pct <= policy.range_high_max_momentum_5d_pct);
}

export function rangeLowRiskConfirmed(riskProfile, policy) {
    return (policy.range_low_min_momentum_5d_pct == null
        || riskProfile.momentum_5d_pct >= policy.range_low_min_momentum_5d_pct)
        && (policy.range_low_max_ma20_slope_5d_pct == null
            || riskProfile.ma20_slope_5d_pct <= policy.range_low_max_ma20_slope_5d_pct)
        && (policy.range_low_max_atr_ratio_pct == null
            || riskProfile.atr_ratio_pct <= policy.range_low_max_atr_ratio_pct)
        && (policy.range_low_max_intraday_drawdown_pct == null
            || riskProfile.intraday_drawdown_pct <= policy.range_low_max_intraday_drawdown_pct)
        && (!policy.range_low_requires_daily_repair || riskProfile.daily_repair_confirmed);
}

export function reentryRiskConfirmed(riskProfile, policy) {
    return (policy.reentry_min_momentum_5d_pct == null
        || riskProfile.momentum_5d_pct >= policy.reentry_min_momentum_5d_pct)
        && (policy.reentry_min_atr_ratio_pct == null
            || riskProfile.atr_ratio_pct >= policy.reentry_min_atr_ratio_pct);
}

function calendarDaysBetween(start, end) {
    const startDate = String(start ?? '').slice(0, 10);
    const endDate = String(end ?? '').slice(0, 10);
    if (!startDate || !endDate)
        return null;
    const elapsed = (Date.parse(`${endDate}T15:00:00+08:00`) - Date.parse(`${startDate}T15:00:00+08:00`)) / 86400000;
    return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

export function classifyRangeLowEntry(signal, context = {}, value) {
    const policy = normalizeDecisionPolicy(value);
    const sellPrice = Number(context.lastSellPrice);
    const soldQuantity = Number(context.soldQuantity);
    const sellStrategy = String(context.lastSellStrategy ?? '');
    const elapsedCalendarDays = calendarDaysBetween(context.lastSellDate, signal?.time);
    if (!(soldQuantity > 0) || !(sellPrice > 0) || !sellStrategy) {
        return {
            eligible: true,
            trade_intent: 'new_entry',
            elapsed_calendar_days: elapsedCalendarDays,
            reference_sell_price: null,
            reference_sell_date: null,
            discount_pct: null,
        };
    }
    const discountPct = (sellPrice - Number(signal.price)) / sellPrice * 100;
    const discountRuleApplies = policy.t_reentry_discount_strategies?.includes(sellStrategy);
    if (!discountRuleApplies) {
        return {
            eligible: true,
            trade_intent: 'risk_reentry',
            elapsed_calendar_days: elapsedCalendarDays,
            reference_sell_price: sellPrice,
            reference_sell_date: context.lastSellDate ?? null,
            discount_pct: discountPct,
        };
    }
    const withinTradeWindow = elapsedCalendarDays == null
        || policy.t_reentry_max_calendar_days == null
        || elapsedCalendarDays <= policy.t_reentry_max_calendar_days;
    if (withinTradeWindow && discountPct >= policy.t_reentry_min_discount_pct) {
        return {
            eligible: true,
            trade_intent: 't_reentry',
            elapsed_calendar_days: elapsedCalendarDays,
            reference_sell_price: sellPrice,
            reference_sell_date: context.lastSellDate ?? null,
            discount_pct: discountPct,
        };
    }
    if (withinTradeWindow && discountPct >= policy.high_low_min_discount_pct) {
        return {
            eligible: true,
            trade_intent: 'high_low_reentry',
            elapsed_calendar_days: elapsedCalendarDays,
            reference_sell_price: sellPrice,
            reference_sell_date: context.lastSellDate ?? null,
            discount_pct: discountPct,
        };
    }
    if (elapsedCalendarDays != null
        && policy.new_cycle_min_calendar_days != null
        && elapsedCalendarDays >= policy.new_cycle_min_calendar_days) {
        return {
            eligible: true,
            trade_intent: 'new_cycle_entry',
            elapsed_calendar_days: elapsedCalendarDays,
            reference_sell_price: sellPrice,
            reference_sell_date: context.lastSellDate ?? null,
            discount_pct: discountPct,
        };
    }
    return {
        eligible: false,
        trade_intent: 'reentry_wait',
        elapsed_calendar_days: elapsedCalendarDays,
        reference_sell_price: sellPrice,
        reference_sell_date: context.lastSellDate ?? null,
        discount_pct: discountPct,
    };
}

export function loadActiveDecisionPolicy() {
    const path = join(tradeMasterHome(), 'strategies', 'active.json');
    if (!existsSync(path))
        return ACTIVE_DECISION_POLICY;
    const active = readJson(path);
    const policyRule = [...(active.rules ?? [])].reverse().find((item) => item.decision_policy);
    return policyRule?.decision_policy
        ? normalizeDecisionPolicy(policyRule.decision_policy)
        : ACTIVE_DECISION_POLICY;
}

export function loadIntradayDecisionPolicy() {
    return ROBUST_70_CANDIDATE_POLICY;
}
