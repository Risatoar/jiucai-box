const increment = (target, key) => {
    target[key] = (target[key] ?? 0) + 1;
};

export function createBacktestDiagnostics() {
    return {
        raw_by_strategy: {},
        actionable_by_strategy: {},
        guidance_states: {},
        guidance_by_trend: {},
        range_high_filter_funnel: {},
        bottom_entry_filter_funnel: {
            downtrend_days: 0,
            actionable_reversal_days: 0,
            multi_period_confirmed_days: 0,
            daily_repair_confirmed_days: 0,
        },
    };
}

export function recordBacktestDiagnostics(diagnostics, engine, policy) {
    for (const signal of engine.signals.filter((item) => item.kState === 'closed')) {
        increment(diagnostics.raw_by_strategy, signal.strategy);
        if (signal.level === 'actionable')
            increment(diagnostics.actionable_by_strategy, signal.strategy);
        if (signal.strategy === 'range_high_reversal' && signal.level === 'actionable') {
            increment(diagnostics.range_high_filter_funnel, 'actionable');
            if (signal.period !== policy.range_decision_period)
                continue;
            increment(diagnostics.range_high_filter_funnel, 'period');
            if ((signal.metadata?.range_position ?? 0) < policy.range_high_min_position)
                continue;
            increment(diagnostics.range_high_filter_funnel, 'position');
            if ((signal.metadata?.volume_ratio ?? 0) < policy.range_high_min_volume_ratio)
                continue;
            increment(diagnostics.range_high_filter_funnel, 'volume');
            if (policy.range_high_require_bearish_body && signal.metadata?.bearish_body !== true)
                continue;
            increment(diagnostics.range_high_filter_funnel, 'bearish_body');
            if (!rangeHighRejectionConfirmed(signal, engine.downside_risk, policy))
                continue;
            increment(diagnostics.range_high_filter_funnel, 'rejection_or_space');
            if (policy.range_high_max_close_change_pct != null
                && (signal.metadata?.close_change_pct ?? Number.POSITIVE_INFINITY) > policy.range_high_max_close_change_pct)
                continue;
            increment(diagnostics.range_high_filter_funnel, 'final');
        }
    }
    const state = engine.position_guidance?.state ?? 'unknown';
    increment(diagnostics.guidance_states, state);
    increment(diagnostics.guidance_by_trend, `${engine.daily_trend}:${state}`);
    if (engine.daily_trend === 'down') {
        increment(diagnostics.bottom_entry_filter_funnel, 'downtrend_days');
        const reentries = engine.signals.filter((item) => item.kState === 'closed'
            && item.level === 'actionable'
            && item.strategy === 'fast_reversal_reentry');
        if (reentries.length) {
            increment(diagnostics.bottom_entry_filter_funnel, 'actionable_reversal_days');
            if (new Set(reentries.map((item) => item.period)).size >= policy.reentry_min_periods) {
                increment(diagnostics.bottom_entry_filter_funnel, 'multi_period_confirmed_days');
                if (!policy.reentry_requires_daily_repair || engine.downside_risk?.daily_repair_confirmed)
                    increment(diagnostics.bottom_entry_filter_funnel, 'daily_repair_confirmed_days');
            }
        }
    }
}

export function pushUniqueRecord(records, record) {
    const key = (item) => `${item.code}|${item.date}|${item.side}|${item.strategy}`;
    if (records.some((item) => key(item) === key(record)))
        return false;
    records.push(record);
    return true;
}
import { rangeHighRejectionConfirmed } from './strategy-policy.js';
