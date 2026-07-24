import {
    classifyRangeLowEntry,
    rangeHighRejectionConfirmed,
    rangeLowRiskConfirmed,
    reentryRiskConfirmed,
} from './strategy-policy.js';

const matchesPeriod = (item, period) => !period || item.period === period;

export function selectRangeLowSignals(signals, context, risk, policy) {
    return signals.filter((item) => item.strategy === 'range_low_reversal'
        && matchesPeriod(item, policy.range_decision_period)
        && (item.metadata?.range_position ?? 1) <= policy.range_low_max_position
        && (item.metadata?.volume_ratio ?? 0) >= policy.range_low_min_volume_ratio
        && rangeLowRiskConfirmed(risk, policy))
        .filter((item) => {
            const intent = classifyRangeLowEntry(item, context, policy);
            const isReentry = Number(context.soldQuantity) > 0;
            return intent.eligible && (!isReentry
                || intent.trade_intent === 't_reentry'
                || intent.trade_intent === 'high_low_reentry'
                || reentryRiskConfirmed(risk, policy));
        });
}

export function selectRangeHighSignals(signals, risk, policy) {
    return signals.filter((item) => item.strategy === 'range_high_reversal'
        && matchesPeriod(item, policy.range_decision_period)
        && (item.metadata?.range_position ?? 0) >= policy.range_high_min_position
        && (item.metadata?.volume_ratio ?? 0) >= policy.range_high_min_volume_ratio
        && (!policy.range_high_require_bearish_body || item.metadata?.bearish_body === true)
        && rangeHighRejectionConfirmed(item, risk, policy)
        && (policy.range_high_max_close_change_pct == null
            || (item.metadata?.close_change_pct ?? Number.POSITIVE_INFINITY) <= policy.range_high_max_close_change_pct));
}

export function selectTrendEntrySignals(signals, policy) {
    const selected = policy.trend_entry_strategies
        ? signals.filter((item) => policy.trend_entry_strategies.includes(item.strategy))
        : signals;
    return selected.filter((item) => item.strategy !== 'trend_pullback_entry' || (
        matchesPeriod(item, policy.trend_entry_period)
        && (policy.trend_entry_min_volume_ratio == null
            || (item.metadata?.volume_ratio ?? 0) >= policy.trend_entry_min_volume_ratio)
        && (!policy.trend_entry_require_previous_high_reclaim || item.metadata?.previous_high_reclaimed)
        && (!policy.trend_entry_require_macd_improving || item.metadata?.macd_improving)
        && (policy.trend_entry_min_close_location == null
            || (item.metadata?.close_location ?? 0) >= policy.trend_entry_min_close_location)
    ));
}

export function selectDefenseSignals(signals, risk, policy) {
    return signals.filter((item) => {
        if (!matchesPeriod(item, policy.defense_period)
            || (policy.defense_strategies && !policy.defense_strategies.includes(item.strategy)))
            return false;
        if (policy.defense_require_momentum_confirmation
            && (risk.momentum_5d_pct == null
                || risk.momentum_5d_pct > policy.defense_max_momentum_5d_pct
                || (policy.defense_min_momentum_5d_pct != null
                    && risk.momentum_5d_pct < policy.defense_min_momentum_5d_pct)))
            return false;
        if (item.strategy === 'rally_exhaustion') {
            return risk.intraday_drawdown_pct >= policy.rally_min_intraday_drawdown_pct
                && (item.metadata?.range_position ?? 0) >= policy.rally_min_range_position
                && (item.metadata?.upper_shadow_ratio ?? 0) >= policy.rally_min_upper_shadow_ratio
                && (!policy.rally_reject_daily_repair || !risk.daily_repair_confirmed)
                && (policy.defense_max_intraday_drawdown_pct == null
                    || risk.intraday_drawdown_pct <= policy.defense_max_intraday_drawdown_pct);
        }
        const pressure = policy.defense_require_intraday_drawdown
            ? risk.intraday_drawdown_pct >= policy.defense_min_intraday_drawdown_pct
            : risk.intraday_drawdown_pct >= policy.defense_min_intraday_drawdown_pct
                || (policy.defense_max_momentum_5d_pct != null
                    && risk.momentum_5d_pct != null
                    && risk.momentum_5d_pct <= policy.defense_max_momentum_5d_pct);
        return pressure
            && (policy.defense_max_intraday_drawdown_pct == null
                || risk.intraday_drawdown_pct <= policy.defense_max_intraday_drawdown_pct)
            && (policy.defense_max_next_support_distance_pct == null
                || risk.next_support_distance_pct <= policy.defense_max_next_support_distance_pct);
    });
}
