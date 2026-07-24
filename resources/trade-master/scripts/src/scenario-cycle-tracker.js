import { evaluateSignal, executableDaySignal } from './backtest-evaluation.js';
import { applyDecisionTransition } from './position-transition.js';
import { generateStrategySignals } from './strategy-engine.js';
import { rangeHighRejectionConfirmed, rangeLowRiskConfirmed } from './strategy-policy.js';

const MAX_CALENDAR_DAYS = 22;

const elapsedDays = (start, end) => (
    Date.parse(`${end}T15:00:00+08:00`) - Date.parse(`${start}T15:00:00+08:00`)
) / 86_400_000;

const sceneForGuidance = (guidance) => {
    if (guidance.state === 'range_low_add')
        return 'range_low';
    if (guidance.state === 'trend_add_ready')
        return 'trend_entry';
    if (guidance.state === 'reentry_ready')
        return 'reentry';
    return null;
};

export function createScenarioCycleTracker() {
    return { lots: [] };
}

const matchesPeriod = (item, period) => !period || item.period === period;
const tSpreadTarget = (policy) => Math.max(0, Number(policy.t_reentry_min_discount_pct) || 0);
const highLowSpreadTarget = (policy) => Math.max(0, Number(policy.high_low_min_discount_pct) || 0);
const priceDiscountPct = (sellPrice, buyPrice) => (sellPrice - buyPrice) / sellPrice * 100;
const spreadIntent = (spread, policy) => (
    spread >= tSpreadTarget(policy)
        ? 't_reentry'
        : spread >= highLowSpreadTarget(policy)
            ? 'high_low_reentry'
            : null
);

function strictIntradaySell(item, risk, policy) {
    if (item.strategy === 'trend_distribution_top')
        return true;
    return item.strategy === 'range_high_reversal'
        && matchesPeriod(item, policy.range_decision_period)
        && (item.metadata?.range_position ?? 0) >= policy.range_high_min_position
        && (item.metadata?.volume_ratio ?? 0) >= policy.range_high_min_volume_ratio
        && (!policy.range_high_require_bearish_body || item.metadata?.bearish_body)
        && rangeHighRejectionConfirmed(item, risk, policy)
        && (policy.range_high_max_close_change_pct == null
            || (item.metadata?.close_change_pct ?? Number.POSITIVE_INFINITY) <= policy.range_high_max_close_change_pct);
}

function strictIntradayBuy(item, risk, policy) {
    if (policy.t_reentry_buy_strategies
        && !policy.t_reentry_buy_strategies.includes(item.strategy))
        return false;
    if (policy.t_reentry_min_volume_ratio != null
        && (item.metadata?.volume_ratio ?? 0) < policy.t_reentry_min_volume_ratio)
        return false;
    if (item.strategy === 'range_low_reversal') {
        return matchesPeriod(item, policy.range_decision_period)
            && (item.metadata?.range_position ?? 1) <= policy.range_low_max_position
            && (item.metadata?.volume_ratio ?? 0) >= policy.range_low_min_volume_ratio
            && rangeLowRiskConfirmed(risk, policy);
    }
    if (item.strategy === 'stage_support_rebound')
        return matchesPeriod(item, policy.trend_entry_period);
    return item.strategy === 'trend_pullback_entry'
        && matchesPeriod(item, policy.trend_entry_period)
        && (policy.trend_entry_min_volume_ratio == null
            || (item.metadata?.volume_ratio ?? 0) >= policy.trend_entry_min_volume_ratio)
        && (!policy.trend_entry_require_previous_high_reclaim || item.metadata?.previous_high_reclaimed)
        && (!policy.trend_entry_require_macd_improving || item.metadata?.macd_improving)
        && (policy.trend_entry_min_close_location == null
            || (item.metadata?.close_location ?? 0) >= policy.trend_entry_min_close_location);
}

export function collectIntradayTCycleCases(input) {
    const engine = generateStrategySignals(input.instrument.type, input.bars, input.dailyContext, {
        hasPosition: true,
        positionQuantity: 100,
        soldQuantity: 0,
        decisionPolicy: input.policy,
    });
    const actionable = engine.signals.filter((item) => item.kState === 'closed' && item.level === 'actionable');
    const sells = actionable.filter((item) => item.side === 'sell' && strictIntradaySell(item, engine.downside_risk, input.policy))
        .sort((left, right) => left.time.localeCompare(right.time));
    const buys = actionable.filter((item) => item.side === 'buy' && strictIntradayBuy(item, engine.downside_risk, input.policy))
        .sort((left, right) => left.time.localeCompare(right.time));
    for (const sell of sells) {
        const buy = buys.find((item) => item.time > sell.time
            && priceDiscountPct(sell.price, item.price) >= highLowSpreadTarget(input.policy));
        if (!buy)
            continue;
        const discountPct = priceDiscountPct(sell.price, buy.price);
        const tradeIntent = spreadIntent(discountPct, input.policy);
        const buyScene = buy.strategy === 'range_low_reversal'
            ? 'range_low'
            : buy.strategy === 'trend_pullback_entry'
                ? 'trend_entry'
                : 'reentry';
        const sellScene = sell.strategy === 'range_high_reversal' ? 'range_high' : 'trend_take_profit';
        const lot = {
            price: sell.price,
            date: input.date,
            strategy: sell.strategy,
            quantity: 0.5,
            trade_intent: 't_sell',
            sell_scene: sellScene,
        };
        return [{
            ...evaluateSignal(
                buy,
                input.instrument,
                engine.daily_trend,
                input.date,
                input.dailyBars,
                { state: 'reentry_ready', action: '日内高抛后价差达标，进入接回评估', trade_intent: tradeIntent },
                {
                    position_before: 0.5,
                    position_after: 1,
                    sold_capacity_after: 0,
                    action_fraction: 0.5,
                    matched_sell_lots: [lot],
                },
                engine.downside_risk,
            ),
            case_scene: 'reentry',
            case_roles: ['reentry'],
            reference_buy_scene: buyScene,
            reference_sell_scene: sellScene,
            required_t_spread_pct: tSpreadTarget(input.policy),
            required_high_low_spread_pct: highLowSpreadTarget(input.policy),
            simulation_track: 'scenario_intraday_t_cycle',
            trading_index: input.tradingIndex,
        }];
    }
    return [];
}

export function registerScenarioSellCases(tracker, cases) {
    const eligible = cases.filter((item) => item.side === 'sell' && [
        'full_exit',
        'defense_reduce',
        'range_high',
        'trend_take_profit',
    ].includes(item.case_scene));
    for (const item of eligible) {
        const tradeIntent = ['range_high', 'trend_take_profit'].includes(item.case_scene)
            ? 't_sell'
            : 'risk_reduce';
        const bucket = tradeIntent === 't_sell' ? 't' : 'risk';
        tracker.lots.push({
            id: `${item.code}|${item.date}|${item.case_scene}`,
            bucket,
            price: item.price,
            strategy: item.strategy,
            date: item.date,
            quantity: 0.5,
            trade_intent: tradeIntent,
            sell_scene: item.case_scene,
        });
        const keep = tracker.lots.filter((lot) => lot.bucket === bucket)
            .sort((left, right) => right.date.localeCompare(left.date))
            .slice(0, 3);
        tracker.lots = [...tracker.lots.filter((lot) => lot.bucket !== bucket), ...keep];
    }
}

export function collectDailyCycleCases(input, tracker) {
    tracker.lots = tracker.lots.filter((lot) => {
        const elapsed = elapsedDays(lot.date, input.date);
        return elapsed > 0 && elapsed <= MAX_CALENDAR_DAYS;
    });
    const candidates = [...tracker.lots].sort((left, right) => {
        if (left.bucket !== right.bucket)
            return left.bucket === 't' ? -1 : 1;
        return right.date.localeCompare(left.date);
    });
    for (const lot of candidates) {
        const engine = generateStrategySignals(input.instrument.type, input.bars, input.dailyContext, {
            hasPosition: true,
            positionQuantity: 50,
            soldQuantity: 50,
            lastSellPrice: lot.price,
            lastSellStrategy: lot.strategy,
            lastSellDate: lot.date,
            decisionPolicy: input.policy,
        });
        let signal = executableDaySignal(engine);
        let scene = sceneForGuidance(engine.position_guidance);
        let guidance = engine.position_guidance;
        if ((signal?.side !== 'buy' || !scene) && lot.trade_intent === 't_sell') {
            signal = engine.signals
                .filter((item) => item.side === 'buy'
                    && item.kState === 'closed'
                    && item.level === 'actionable'
                    && strictIntradayBuy(item, engine.downside_risk, input.policy))
                .filter((item) => priceDiscountPct(lot.price, item.price)
                    >= highLowSpreadTarget(input.policy))
                .sort((left, right) => left.time.localeCompare(right.time))[0];
            scene = signal?.strategy === 'range_low_reversal'
                ? 'range_low'
                : signal?.strategy === 'trend_pullback_entry'
                    ? 'trend_entry'
                    : signal
                        ? 'reentry'
                        : null;
            if (signal) {
                guidance = {
                    state: 'reentry_ready',
                    action: '已有高抛仓位且闭合回补信号与价差同时达标',
                    trade_intent: 'high_low_reentry',
                };
            }
        }
        if (signal?.side !== 'buy' || !scene)
            continue;
        const discountPct = priceDiscountPct(lot.price, signal.price);
        if (lot.trade_intent === 't_sell'
            && discountPct < highLowSpreadTarget(input.policy))
            continue;
        const transition = applyDecisionTransition(guidance, signal, {
            held: 0.5,
            sold: 0.5,
            sold_lots: [lot],
        });
        if (!transition)
            continue;
        tracker.lots = tracker.lots.filter((item) => item.id !== lot.id);
        const tradeIntent = lot.trade_intent === 't_sell'
            ? spreadIntent(discountPct, input.policy)
            : 'risk_reentry';
        return [{
            ...evaluateSignal(
                signal,
                input.instrument,
                engine.daily_trend,
                input.date,
                input.dailyBars,
                { ...guidance, trade_intent: tradeIntent },
                transition,
                engine.downside_risk,
            ),
            case_scene: 'reentry',
            case_roles: ['reentry'],
            reference_buy_scene: scene,
            reference_sell_scene: lot.sell_scene,
            required_t_spread_pct: tSpreadTarget(input.policy),
            required_high_low_spread_pct: highLowSpreadTarget(input.policy),
            simulation_track: 'scenario_cycle_reentry',
            trading_index: input.tradingIndex,
        }];
    }
    return [];
}
