import { completedOutcome, metric, objectiveScenarioSummary } from './backtest-metrics.js';
import { evaluateSignal, executableDaySignal } from './backtest-evaluation.js';
import { applyDecisionTransition } from './position-transition.js';
import { generateStrategySignals } from './strategy-engine.js';

const COOLDOWN_TRADING_DAYS = 5;
const HIGH_LOW_MAX_CALENDAR_DAYS = 22;
const HIGH_LOW_MIN_SPREAD_PCT = { stock: 2, etf: 2, cbond: 0.5 };
const T_TRADE_MIN_SPREAD_PCT = { stock: 3, etf: 3, cbond: 1 };
const highLowTarget = (type) => HIGH_LOW_MIN_SPREAD_PCT[type] ?? HIGH_LOW_MIN_SPREAD_PCT.stock;
const tTradeTarget = (type) => T_TRADE_MIN_SPREAD_PCT[type] ?? T_TRADE_MIN_SPREAD_PCT.stock;
const priceDiscountPct = (sellPrice, buyPrice) => (sellPrice - buyPrice) / sellPrice * 100;
const round = (value) => Math.round(value * 100) / 100;

const ACTION_HORIZONS = {
    full_exit: 3,
    defense_reduce: 3,
    range_high: 3,
    range_low: 3,
    trend_take_profit: 7,
    trend_entry: 1,
    reentry: 3,
};
const MINIMUM_CASES_PER_TYPE = 10;

const hasScene = (item, scene) => item.case_scene === scene || item.case_roles?.includes(scene);

function actionScene(guidance, signal) {
    if (guidance.state === 'full_exit_ready')
        return 'full_exit';
    if (guidance.state === 'defense_reduce')
        return 'defense_reduce';
    if (guidance.state === 'range_high_reduce')
        return 'range_high';
    if (guidance.state === 'range_low_add' || signal.strategy === 'range_low_reversal')
        return 'range_low';
    if (guidance.state === 'trend_top_reduce')
        return 'trend_take_profit';
    if (guidance.state === 'trend_add_ready' || signal.strategy === 'trend_pullback_entry')
        return 'trend_entry';
    if (guidance.state === 'reentry_ready')
        return 'reentry';
    return null;
}

function buildCase(engine, signal, instrument, date, dailyBars, state, track, tradingIndex) {
    const transition = applyDecisionTransition(engine.position_guidance, signal, state);
    const scene = actionScene(engine.position_guidance, signal);
    if (!transition || !scene)
        return null;
    return {
        ...evaluateSignal(
            signal,
            instrument,
            engine.daily_trend,
            date,
            dailyBars,
            engine.position_guidance,
            transition,
            engine.downside_risk,
        ),
        case_scene: scene,
        simulation_track: track,
        trading_index: tradingIndex,
    };
}

function rejectedBottomCase(engine, instrument, date, dailyBars, tradingIndex) {
    if (engine.daily_trend !== 'down' || engine.downside_risk?.daily_repair_confirmed)
        return null;
    const signals = engine.signals.filter((item) => item.kState === 'closed'
        && item.level === 'actionable'
        && item.strategy === 'fast_reversal_reentry');
    if (new Set(signals.map((item) => item.period)).size < 2)
        return null;
    const signal = [...signals].sort((left, right) => left.time.localeCompare(right.time)).at(-1);
    return {
        ...evaluateSignal(
            signal,
            instrument,
            engine.daily_trend,
            date,
            dailyBars,
            { state: 'bottom_abstain', action: '日线修复未确认，拒绝抄底', trade_intent: 'abstain' },
            {
                position_before: 0,
                position_after: 0,
                sold_capacity_after: 0,
                action_fraction: 0,
                matched_sell_lots: [],
            },
            engine.downside_risk,
        ),
        case_scene: 'bottom_fishing_abstention',
        simulation_track: 'scenario_negative_control',
        trading_index: tradingIndex,
    };
}

export function collectDailyScenarioCases(input) {
    const context = { decisionPolicy: input.policy };
    const full = generateStrategySignals(input.instrument.type, input.bars, input.dailyContext, {
        ...context,
        hasPosition: true,
        positionQuantity: 100,
        soldQuantity: 0,
    });
    const flat = generateStrategySignals(input.instrument.type, input.bars, input.dailyContext, {
        ...context,
        hasPosition: false,
        positionQuantity: 0,
        soldQuantity: 0,
    });
    const cases = [];
    const fullSignal = executableDaySignal(full);
    if (fullSignal?.side === 'sell') {
        const item = buildCase(
            full,
            fullSignal,
            input.instrument,
            input.date,
            input.dailyBars,
            { held: 1, sold: 0 },
            'scenario_full_position',
            input.tradingIndex,
        );
        if (item)
            cases.push(item);
    }
    const flatSignal = executableDaySignal(flat);
    if (flatSignal?.side === 'buy') {
        const item = buildCase(
            flat,
            flatSignal,
            input.instrument,
            input.date,
            input.dailyBars,
            { held: 0, sold: 1 },
            'scenario_flat_entry',
            input.tradingIndex,
        );
        if (item)
            cases.push(item);
    }
    const rejected = rejectedBottomCase(flat, input.instrument, input.date, input.dailyBars, input.tradingIndex);
    return { cases, rejected: rejected ? [rejected] : [] };
}

function independentCases(records) {
    const lastIndexes = new Map();
    return records.filter((item) => {
        const key = `${item.code}|${item.case_scene}`;
        const previous = lastIndexes.get(key);
        if (previous != null && item.trading_index - previous < COOLDOWN_TRADING_DAYS)
            return false;
        lastIndexes.set(key, item.trading_index);
        return true;
    });
}

function highLowCycleSummary(records) {
    const pairs = [];
    let sellLegs = 0;
    let buyLegs = 0;
    const byCode = new Map();
    for (const item of records.filter((record) => !record.outcomes.some((outcome) => outcome.status === 'invalid')))
        byCode.set(item.code, [...(byCode.get(item.code) ?? []), item]);
    for (const [code, items] of byCode) {
        const sells = items.filter((item) => item.case_scene === 'range_high');
        const buys = items.filter((item) => item.case_scene === 'range_low');
        sellLegs += sells.length;
        buyLegs += buys.length;
        const usedSells = new Set();
        for (const buy of buys) {
            const candidates = sells.map((sell, index) => ({ sell, index })).filter(({ sell, index }) => {
                if (usedSells.has(index) || sell.date >= buy.date)
                    return false;
                const days = (Date.parse(`${buy.date}T15:00:00+08:00`) - Date.parse(`${sell.date}T15:00:00+08:00`)) / 86400000;
                const discount = priceDiscountPct(sell.price, buy.price);
                return days <= HIGH_LOW_MAX_CALENDAR_DAYS && discount >= highLowTarget(buy.type);
            });
            const matched = candidates.sort((left, right) => right.sell.date.localeCompare(left.sell.date))[0];
            if (!matched)
                continue;
            usedSells.add(matched.index);
            const elapsed = (Date.parse(`${buy.date}T15:00:00+08:00`) - Date.parse(`${matched.sell.date}T15:00:00+08:00`)) / 86400000;
            pairs.push({
                code,
                type: buy.type ?? matched.sell.type ?? null,
                sell_date: matched.sell.date,
                buy_date: buy.date,
                elapsed_calendar_days: elapsed,
                sell_price: matched.sell.price,
                buy_price: buy.price,
                gross_spread_pct: round((matched.sell.price / buy.price - 1) * 100),
                price_discount_pct: round(priceDiscountPct(matched.sell.price, buy.price)),
                required_spread_pct: highLowTarget(buy.type),
            });
        }
    }
    return {
        pairs,
        sell_legs: sellLegs,
        buy_legs: buyLegs,
        open_sell_legs: sellLegs - pairs.length,
        unmatched_buy_legs: buyLegs - pairs.length,
    };
}

function actionMetrics(records) {
    const result = Object.fromEntries(Object.entries(ACTION_HORIZONS).map(([scene, horizon]) => [
        scene,
        { evaluation_horizon: horizon, ...metric(records.filter((item) => hasScene(item, scene)), horizon) },
    ]));
    const reentries = records.filter((item) => hasScene(item, 'reentry'));
    const spreadReentries = reentries.filter((item) => ['t_reentry', 'high_low_reentry'].includes(item.trade_intent)
        && !item.outcomes.some((outcome) => outcome.status === 'invalid')
        && item.matched_sell_lots?.length);
    const riskReentries = reentries.filter((item) => !['t_reentry', 'high_low_reentry'].includes(item.trade_intent));
    const riskMetric = metric(riskReentries, ACTION_HORIZONS.reentry);
    const correctSpread = spreadReentries.filter((item) => {
        const threshold = item.trade_intent === 't_reentry'
            ? item.required_t_spread_pct ?? tTradeTarget(item.type)
            : item.required_high_low_spread_pct ?? highLowTarget(item.type);
        return priceDiscountPct(item.matched_sell_lots[0].price, item.price) >= threshold;
    }).length;
    const samples = spreadReentries.length + riskMetric.samples;
    const correct = correctSpread + riskMetric.correct;
    result.reentry = {
        evaluation_horizon: 'asset_spread_target_or_risk_3d',
        samples,
        correct,
        accuracy_pct: samples ? round(correct / samples * 100) : null,
        confidence_lower_bound_pct: null,
        t_spread_samples: spreadReentries.filter((item) => item.trade_intent === 't_reentry').length,
        high_low_spread_samples: spreadReentries.filter((item) => item.trade_intent === 'high_low_reentry').length,
        risk_directional_samples: riskMetric.samples,
    };
    return result;
}

function cycleMetrics(records) {
    const pairs = records.filter((item) => item.case_roles?.includes('reentry')
        && !item.outcomes.some((outcome) => outcome.status === 'invalid'))
        .flatMap((item) => (item.matched_sell_lots ?? []).slice(0, 1).map((lot) => {
            const spread = (lot.price / item.price - 1) * 100;
            const discount = priceDiscountPct(lot.price, item.price);
            const requiredT = item.required_t_spread_pct ?? tTradeTarget(item.type);
            const requiredHighLow = item.required_high_low_spread_pct ?? highLowTarget(item.type);
            return {
                code: item.code,
                type: item.type,
                sell_scene: lot.sell_scene ?? null,
                sell_date: lot.date,
                buy_date: item.date,
                sell_price: lot.price,
                buy_price: item.price,
                gross_spread_pct: round(spread),
                price_discount_pct: round(discount),
                trade_intent: item.trade_intent,
                required_t_spread_pct: requiredT,
                required_high_low_spread_pct: requiredHighLow,
                correct: lot.trade_intent !== 't_sell'
                    || discount >= (item.trade_intent === 't_reentry' ? requiredT : requiredHighLow),
            };
        }));
    const tPairs = pairs.filter((item) => item.trade_intent === 't_reentry' && item.correct);
    const highLowPairs = pairs.filter((item) => ['t_reentry', 'high_low_reentry'].includes(item.trade_intent)
        && item.price_discount_pct >= item.required_high_low_spread_pct);
    const riskPairs = pairs.filter((item) => item.trade_intent === 'risk_reentry');
    return {
        pairs,
        t_pairs: tPairs,
        high_low_pairs: highLowPairs,
        risk_recovery_pairs: riskPairs,
        t_accuracy_pct: tPairs.length ? round(tPairs.filter((item) => item.correct).length / tPairs.length * 100) : null,
    };
}

function coverageMetrics(actions, highLow, cycles, abstentions) {
    const counts = {
        ...Object.fromEntries(Object.entries(actions).map(([key, value]) => [key, value.samples])),
        t_trade: cycles.t_pairs.length,
        high_low_pair: highLow.length,
        bottom_fishing_abstention: abstentions.samples,
    };
    const gaps = Object.entries(counts)
        .filter(([, samples]) => samples < MINIMUM_CASES_PER_TYPE)
        .map(([type, samples]) => ({ type, samples, missing: MINIMUM_CASES_PER_TYPE - samples }));
    return {
        minimum_per_type: MINIMUM_CASES_PER_TYPE,
        counts,
        covered_types: Object.keys(counts).length - gaps.length,
        total_types: Object.keys(counts).length,
        gaps,
        ready: gaps.length === 0,
    };
}

function abstentionMetrics(records) {
    const mature = records.map((record) => ({ record, outcome: completedOutcome(record, 3) })).filter((item) => item.outcome);
    const correct = mature.filter((item) => item.outcome.directional_return_pct <= 0).length;
    return {
        samples: mature.length,
        correct_abstentions: correct,
        accuracy_pct: mature.length ? round(correct / mature.length * 100) : null,
        cases: records,
    };
}

export function buildScenarioCaseLibrary(rawCases, rawRejected) {
    const unique = [...new Map(rawCases.map((item) => [`${item.code}|${item.date}|${item.case_scene}`, item])).values()]
        .sort((left, right) => `${left.code}|${left.date}`.localeCompare(`${right.code}|${right.date}`));
    const rejected = [...new Map(rawRejected.map((item) => [`${item.code}|${item.date}`, item])).values()]
        .sort((left, right) => `${left.code}|${left.date}`.localeCompare(`${right.code}|${right.date}`));
    const independent = independentCases(unique);
    const rawHighLowCycles = highLowCycleSummary(unique);
    const independentHighLowCycles = highLowCycleSummary(independent);
    const rawActions = actionMetrics(unique);
    const independentActions = actionMetrics(independent);
    const rawCycles = cycleMetrics(unique);
    const independentCycles = cycleMetrics(independent);
    const mergeHighLowPairs = (...groups) => [...new Map(groups.flat().map((item) => [
        `${item.code}|${item.sell_date}|${item.buy_date}`,
        item,
    ])).values()];
    const rawHighLowPairs = mergeHighLowPairs(rawCycles.high_low_pairs, rawHighLowCycles.pairs);
    const independentHighLowPairs = mergeHighLowPairs(
        independentCycles.high_low_pairs,
        independentHighLowCycles.pairs,
    );
    const abstentions = abstentionMetrics(rejected);
    return {
        schema_version: 1,
        evidence_role: 'scenario_research_only_not_promotion_or_portfolio_return',
        sampling_contract: {
            one_case_per_code_date_scene: true,
            independent_cooldown_trading_days: COOLDOWN_TRADING_DAYS,
            high_low_pair_one_to_one: true,
            high_low_max_calendar_days: HIGH_LOW_MAX_CALENDAR_DAYS,
            high_low_min_price_discount_pct_by_asset: HIGH_LOW_MIN_SPREAD_PCT,
            t_trade_min_price_discount_pct_by_asset: T_TRADE_MIN_SPREAD_PCT,
        },
        raw: {
            samples: unique.length,
            action_metrics: rawActions,
            avoid_sell_flying: objectiveScenarioSummary(unique).scenarios.avoid_sell_flying,
            high_low_pairs: rawHighLowPairs,
            high_low_cycle_ledger: rawHighLowCycles,
            position_cycle_ledger: rawCycles,
        },
        independent: {
            samples: independent.length,
            action_metrics: independentActions,
            avoid_sell_flying: objectiveScenarioSummary(independent).scenarios.avoid_sell_flying,
            high_low_pairs: independentHighLowPairs,
            high_low_cycle_ledger: independentHighLowCycles,
            position_cycle_ledger: independentCycles,
        },
        bottom_fishing_abstentions: abstentions,
        coverage: coverageMetrics(independentActions, independentHighLowPairs, independentCycles, abstentions),
        records: unique,
        independent_records: independent,
    };
}
