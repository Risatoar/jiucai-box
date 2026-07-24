export const SCENARIOS = [
    'escape_top',
    'avoid_sell_flying',
    't_trade',
    'bottom_fishing',
    'capital_protection',
    'trend_profit_capture',
    'range_high_low',
];
export const EVALUATION_HORIZONS = [1, 3, 7, 15];
export const SCENARIO_HORIZONS = {
    escape_top: 3,
    avoid_sell_flying: 1,
    t_trade: null,
    bottom_fishing: 3,
    capital_protection: 3,
    trend_profit_capture: 7,
    range_high_low: 3,
};
export const T_TRADE_MAX_CALENDAR_DAYS = 22;
const T_TRADE_MIN_SPREAD_PCT = { stock: 3, etf: 3, cbond: 1 };
const HIGH_LOW_MIN_SPREAD_PCT = { stock: 2, etf: 2, cbond: 0.5 };

const round = (value) => Math.round(value * 100) / 100;
const tTradeTarget = (type) => T_TRADE_MIN_SPREAD_PCT[type] ?? T_TRADE_MIN_SPREAD_PCT.stock;
const highLowTarget = (type) => HIGH_LOW_MIN_SPREAD_PCT[type] ?? HIGH_LOW_MIN_SPREAD_PCT.stock;
const priceDiscountPct = (sellPrice, buyPrice) => (sellPrice - buyPrice) / sellPrice * 100;
const directionCorrect = (outcome) => outcome.directional_return_pct > 0;

const wilsonLowerBound = (correct, total) => {
    if (!total)
        return null;
    const z = 1.96;
    const ratio = correct / total;
    const denominator = 1 + z * z / total;
    const centre = ratio + z * z / (2 * total);
    const margin = z * Math.sqrt((ratio * (1 - ratio) + z * z / (4 * total)) / total);
    return round((centre - margin) / denominator * 100);
};

export function primaryScenario(signal, trend) {
    if (signal.side === 'sell') {
        if (signal.strategy === 'rally_exhaustion' || signal.strategy === 'trend_distribution_top')
            return 'escape_top';
        if (signal.strategy === 'range_high_reversal')
            return 'range_high_low';
        return 'capital_protection';
    }
    if (signal.strategy === 'sold_level_reclaim')
        return 'avoid_sell_flying';
    if (signal.strategy === 'range_low_reversal')
        return 'range_high_low';
    if (trend === 'up' || signal.strategy === 'trend_pullback_entry' || signal.strategy === 'volume_breakout')
        return 'trend_profit_capture';
    return 'bottom_fishing';
}

export function completedOutcome(record, horizon) {
    return record.outcomes.find((item) => item.horizon === horizon && item.status === 'completed');
}

const objectiveHorizon = (record) => record.strategy === 'sold_level_reclaim'
    ? 7
    : SCENARIO_HORIZONS[record.scenario] ?? 3;

export function metric(records, horizon, correctFn = directionCorrect) {
    const outcomes = records.map((record) => ({ record, outcome: completedOutcome(record, horizon) })).filter((item) => item.outcome);
    const correct = outcomes.filter((item) => correctFn(item.outcome, item.record)).length;
    return {
        samples: outcomes.length,
        correct,
        accuracy_pct: outcomes.length ? round(correct / outcomes.length * 100) : null,
        confidence_lower_bound_pct: wilsonLowerBound(correct, outcomes.length),
        average_directional_return_pct: outcomes.length
            ? round(outcomes.reduce((sum, item) => sum + item.outcome.directional_return_pct, 0) / outcomes.length)
            : null,
    };
}

export function objectiveMetric(records) {
    const outcomes = records.map((record) => ({
        record,
        outcome: completedOutcome(record, objectiveHorizon(record)),
    })).filter((item) => item.outcome);
    const correct = outcomes.filter((item) => directionCorrect(item.outcome)).length;
    return {
        samples: outcomes.length,
        correct,
        accuracy_pct: outcomes.length ? round(correct / outcomes.length * 100) : null,
        confidence_lower_bound_pct: wilsonLowerBound(correct, outcomes.length),
        average_directional_return_pct: outcomes.length
            ? round(outcomes.reduce((sum, item) => sum + item.outcome.directional_return_pct, 0) / outcomes.length)
            : null,
    };
}

export function clusteredObjectiveMetric(records) {
    const groups = new Map();
    for (const record of records) {
        const outcome = completedOutcome(record, objectiveHorizon(record));
        if (!outcome)
            continue;
        const key = `${record.type}|${record.date}|${record.strategy}|${record.side}`;
        groups.set(key, [...(groups.get(key) ?? []), outcome.directional_return_pct]);
    }
    const clusterReturns = [...groups.values()].map((returns) => returns.reduce((sum, value) => sum + value, 0) / returns.length);
    const correct = clusterReturns.filter((value) => value > 0).length;
    return {
        samples: clusterReturns.length,
        raw_samples: [...groups.values()].reduce((sum, values) => sum + values.length, 0),
        correct,
        accuracy_pct: clusterReturns.length ? round(correct / clusterReturns.length * 100) : null,
        confidence_lower_bound_pct: wilsonLowerBound(correct, clusterReturns.length),
        average_directional_return_pct: clusterReturns.length
            ? round(clusterReturns.reduce((sum, value) => sum + value, 0) / clusterReturns.length)
            : null,
        clustering_contract: 'instrument_type+signal_date+strategy+side',
    };
}

export function sellTimingSummary(records) {
    const samples = records.filter((record) => record.side === 'sell')
        .map((record) => ({
            record,
            immediate: completedOutcome(record, 1),
            direction: completedOutcome(record, 3),
        }))
        .filter((item) => item.immediate && item.direction);
    const timely = samples.filter((item) => item.immediate.max_adverse_pct >= -2).length;
    const earlyButDirectionallyCorrect = samples.filter((item) => item.immediate.max_adverse_pct < -2
        && directionCorrect(item.direction)).length;
    const wrongDirection = samples.length - timely - earlyButDirectionallyCorrect;
    return {
        samples: samples.length,
        timely,
        early_but_directionally_correct: earlyButDirectionallyCorrect,
        wrong_direction: wrongDirection,
        directionally_correct: timely + earlyButDirectionallyCorrect,
        directional_accuracy_pct: samples.length ? round((timely + earlyButDirectionallyCorrect) / samples.length * 100) : null,
        timing_accuracy_pct: samples.length ? round(timely / samples.length * 100) : null,
    };
}

export function positionCycleSummary(records) {
    const tPairs = [];
    const highLowPairs = [];
    const riskRecoveryPairs = [];
    let tSellLegs = 0;
    let riskSellLegs = 0;
    let pairedTSellLegs = 0;
    let pairedRiskSellLegs = 0;
    let unmatchedReentryLegs = 0;
    const byCode = new Map();
    for (const record of [...records].sort((left, right) => `${left.date}${left.time}`.localeCompare(`${right.date}${right.time}`)))
        byCode.set(record.code, [...(byCode.get(record.code) ?? []), record]);
    for (const [code, items] of byCode) {
        const openSells = [];
        for (const item of items.filter((record) => !record.simulation_track)) {
            if (item.side === 'sell') {
                if (item.position_after > 0 && ['range_high_reduce', 'trend_top_reduce', 'defense_reduce'].includes(item.decision_state)) {
                    openSells.push(item);
                    if (item.trade_intent === 't_sell')
                        tSellLegs += 1;
                    else
                        riskSellLegs += 1;
                }
                continue;
            }
            if (item.side !== 'buy' || !['t_reentry', 'risk_reentry'].includes(item.trade_intent))
                continue;
            const matchedLot = item.matched_sell_lots?.at(0);
            let sell = null;
            if (matchedLot) {
                const index = openSells.findLastIndex((candidate) => candidate.date === matchedLot.date
                    && Math.abs(candidate.price - matchedLot.price) < 0.000001);
                if (index >= 0)
                    sell = openSells.splice(index, 1)[0];
            }
            else if (openSells.length) {
                sell = openSells.pop();
            }
            if (!sell) {
                unmatchedReentryLegs += 1;
                continue;
            }
            if (sell.trade_intent === 't_sell')
                pairedTSellLegs += 1;
            else
                pairedRiskSellLegs += 1;
            const elapsedDays = (Date.parse(`${item.date}T15:00:00+08:00`) - Date.parse(`${sell.date}T15:00:00+08:00`)) / 86400000;
            if (elapsedDays < 0 || elapsedDays > T_TRADE_MAX_CALENDAR_DAYS) {
                unmatchedReentryLegs += 1;
                continue;
            }
            const spread = (sell.price / item.price - 1) * 100;
            const discount = priceDiscountPct(sell.price, item.price);
            const requiredSpread = item.trade_intent === 'high_low_reentry'
                ? highLowTarget(item.type)
                : tTradeTarget(item.type);
            const pair = {
                code,
                type: item.type,
                trade_intent: item.trade_intent,
                sell_trade_intent: sell.trade_intent ?? 'risk_reduce',
                sell_date: sell.date,
                buy_date: item.date,
                elapsed_calendar_days: elapsedDays,
                sell_price: sell.price,
                buy_price: item.price,
                gross_spread_pct: round(spread),
                price_discount_pct: round(discount),
                required_spread_pct: requiredSpread,
                correct: discount >= requiredSpread,
            };
            if (item.trade_intent === 't_reentry' && sell.trade_intent === 't_sell')
                tPairs.push(pair);
            else if (item.trade_intent === 'high_low_reentry' && sell.trade_intent === 't_sell')
                highLowPairs.push(pair);
            else
                riskRecoveryPairs.push(pair);
        }
    }
    return {
        t_pairs: tPairs,
        high_low_pairs: highLowPairs,
        risk_recovery_pairs: riskRecoveryPairs,
        t_sell_legs: tSellLegs,
        risk_sell_legs: riskSellLegs,
        open_t_sell_legs: tSellLegs - pairedTSellLegs,
        open_risk_sell_legs: riskSellLegs - pairedRiskSellLegs,
        unmatched_reentry_legs: unmatchedReentryLegs,
    };
}

export function scenarioSummary(records, horizon) {
    const result = Object.fromEntries(SCENARIOS.map((scenario) => [scenario, metric(records.filter((item) => item.scenario === scenario), horizon)]));
    result.avoid_sell_flying = metric(records.filter((item) => item.side === 'sell'), horizon, (outcome) => outcome.max_adverse_pct >= -2);
    const cycles = positionCycleSummary(records);
    const pairs = cycles.t_pairs;
    const correct = pairs.filter((item) => item.correct).length;
    result.t_trade = {
        samples: pairs.length,
        correct,
        accuracy_pct: pairs.length ? round(correct / pairs.length * 100) : null,
        confidence_lower_bound_pct: wilsonLowerBound(correct, pairs.length),
        average_directional_return_pct: pairs.length ? round(pairs.reduce((sum, item) => sum + item.gross_spread_pct, 0) / pairs.length) : null,
    };
    return { scenarios: result, t_pairs: pairs, high_low_pairs: cycles.high_low_pairs, risk_recovery_pairs: cycles.risk_recovery_pairs, cycle_ledger: cycles };
}

export function objectiveScenarioSummary(records) {
    const result = Object.fromEntries(SCENARIOS.map((scenario) => {
        const horizon = SCENARIO_HORIZONS[scenario];
        return [scenario, horizon == null
            ? { samples: 0, correct: 0, accuracy_pct: null, confidence_lower_bound_pct: null, average_directional_return_pct: null }
            : { evaluation_horizon: horizon, ...metric(records.filter((item) => item.scenario === scenario), horizon) }];
    }));
    const sellAvoidOutcomes = records.filter((item) => item.side === 'sell').map((record) => {
        const immediate = completedOutcome(record, 1);
        if (!immediate)
            return null;
        if (immediate.max_adverse_pct >= -2)
            return { record, outcome: immediate, correct: true, basis: 'timely_sell' };
        if (record.position_after > 0) {
            const direction = completedOutcome(record, 3);
            return direction
                ? { record, outcome: direction, correct: directionCorrect(direction), basis: 'core_preserved_3d_direction' }
                : null;
        }
        return { record, outcome: immediate, correct: false, basis: 'full_exit_rebound' };
    }).filter(Boolean);
    const reclaimAvoidOutcomes = records.filter((item) => item.strategy === 'sold_level_reclaim')
        .map((record) => {
            const outcome = completedOutcome(record, 7);
            return outcome ? { record, outcome, correct: directionCorrect(outcome), basis: 'reentry_7d_direction' } : null;
        })
        .filter(Boolean);
    const avoidOutcomes = [...sellAvoidOutcomes, ...reclaimAvoidOutcomes];
    const avoidCorrect = avoidOutcomes.filter((item) => item.correct).length;
    result.avoid_sell_flying = {
        evaluation_horizon: '1d_timing+3d_partial_direction+7d_reentry',
        samples: avoidOutcomes.length,
        correct: avoidCorrect,
        accuracy_pct: avoidOutcomes.length ? round(avoidCorrect / avoidOutcomes.length * 100) : null,
        confidence_lower_bound_pct: wilsonLowerBound(avoidCorrect, avoidOutcomes.length),
        average_directional_return_pct: avoidOutcomes.length
            ? round(avoidOutcomes.reduce((sum, item) => sum + item.outcome.directional_return_pct, 0) / avoidOutcomes.length)
            : null,
        breakdown: {
            timely_sells: sellAvoidOutcomes.filter((item) => item.basis === 'timely_sell' && item.correct).length,
            core_preserved_directional_sells: sellAvoidOutcomes.filter((item) => item.basis === 'core_preserved_3d_direction' && item.correct).length,
            wrong_sells: sellAvoidOutcomes.filter((item) => !item.correct).length,
            successful_reentries: reclaimAvoidOutcomes.filter((item) => item.correct).length,
            failed_reentries: reclaimAvoidOutcomes.filter((item) => !item.correct).length,
        },
    };
    const cycles = positionCycleSummary(records);
    const pairs = cycles.t_pairs;
    const correct = pairs.filter((item) => item.correct).length;
    result.t_trade = {
        evaluation_horizon: `paired_t_reentry_${T_TRADE_MAX_CALENDAR_DAYS}calendar_days`,
        samples: pairs.length,
        correct,
        accuracy_pct: pairs.length ? round(correct / pairs.length * 100) : null,
        confidence_lower_bound_pct: wilsonLowerBound(correct, pairs.length),
        average_directional_return_pct: pairs.length ? round(pairs.reduce((sum, item) => sum + item.gross_spread_pct, 0) / pairs.length) : null,
    };
    return { scenarios: result, t_pairs: pairs, high_low_pairs: cycles.high_low_pairs, risk_recovery_pairs: cycles.risk_recovery_pairs, cycle_ledger: cycles };
}

export function multiHorizonSummary(records) {
    return Object.fromEntries(EVALUATION_HORIZONS.map((horizon) => [horizon, {
        overall: metric(records, horizon),
        scenarios: scenarioSummary(records, horizon).scenarios,
    }]));
}

export function strategyCalibration(records, horizon) {
    const grouped = new Map();
    for (const record of records)
        grouped.set(record.strategy, [...(grouped.get(record.strategy) ?? []), record]);
    return [...grouped.entries()].map(([strategy, items]) => ({ strategy, ...metric(items, horizon) }))
        .sort((left, right) => (right.samples ?? 0) - (left.samples ?? 0));
}

export function splitOutOfSample(records, evaluationDates = []) {
    const dates = [...new Set(evaluationDates.length ? evaluationDates : records.map((item) => item.date))].sort();
    const cutoff = dates[Math.max(0, Math.floor(dates.length * 0.8) - 1)] ?? '';
    return {
        cutoff_date: cutoff,
        evaluation_trading_dates: dates.length,
        history: records.filter((item) => item.date <= cutoff),
        out_of_sample: records.filter((item) => item.date > cutoff),
    };
}

function summarizePerformance(samples, basis) {
    const sorted = [...samples].sort((left, right) => `${left.record.date}${left.record.time}`.localeCompare(`${right.record.date}${right.record.time}`));
    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let winningSamples = 0;
    let losingSamples = 0;
    for (const item of sorted) {
        const weightedReturn = item.outcome.directional_return_pct * (item.record.action_fraction ?? 1) / 100;
        equity *= Math.max(0, 1 + weightedReturn);
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
        if (weightedReturn > 0) {
            grossProfit += weightedReturn;
            winningSamples += 1;
        }
        else {
            grossLoss += Math.abs(weightedReturn);
            losingSamples += 1;
        }
    }
    return {
        basis,
        samples: sorted.length,
        total_return_pct: round((equity - 1) * 100),
        max_drawdown_ratio: Number(maxDrawdown.toFixed(6)),
        profit_factor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(4)) : null,
        winning_samples: winningSamples,
        losing_samples: losingSamples,
    };
}

export function performanceSummary(records, horizon) {
    const samples = records
        .map((record) => ({ record, outcome: completedOutcome(record, horizon) }))
        .filter((item) => item.outcome);
    return summarizePerformance(samples, `按${horizon}日方向收益和动作仓位比例构造的信号组合代理，不等同真实账户收益`);
}

export function objectivePerformanceSummary(records) {
    const samples = records.map((record) => ({
        record,
        outcome: completedOutcome(record, objectiveHorizon(record)),
    })).filter((item) => item.outcome);
    return summarizePerformance(samples, '按固定场景评价周期和动作仓位比例构造的信号组合代理，不等同真实账户收益');
}
