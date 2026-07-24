import { primaryScenario } from './backtest-metrics.js';

const round = (value) => Math.round(value * 100) / 100;
const day = (value) => String(value).slice(0, 10);
const MAX_VALID_PRICE_STEP_RATIO = 0.35;

function priceScaleDiscontinuity(signalPrice, bars) {
    const prices = [Number(signalPrice), ...bars.map((bar) => Number(bar.close))].filter((value) => value > 0);
    for (let index = 1; index < prices.length; index += 1) {
        const step = Math.abs(prices[index] / prices[index - 1] - 1);
        if (step > MAX_VALID_PRICE_STEP_RATIO)
            return round(step * 100);
    }
    return null;
}

export function evaluateSignal(signal, instrument, trend, date, dailyBars, guidance, transition, downsideRisk) {
    const future = dailyBars.filter((bar) => day(bar.time) > date && bar.closed !== false);
    const outcomes = [1, 3, 7, 15].map((horizon) => {
        const target = future[horizon - 1];
        if (!target)
            return { horizon, status: 'pending' };
        const window = future.slice(0, horizon);
        const discontinuity = priceScaleDiscontinuity(signal.price, window);
        if (discontinuity != null) {
            return {
                horizon,
                status: 'invalid',
                reason: 'price_scale_discontinuity',
                maximum_step_pct: discontinuity,
            };
        }
        const raw = (target.close / signal.price - 1) * 100;
        const directional = signal.side === 'buy' ? raw : -raw;
        const favorable = window.map((bar) => signal.side === 'buy'
            ? (bar.high / signal.price - 1) * 100
            : (signal.price / bar.low - 1) * 100);
        const adverse = window.map((bar) => signal.side === 'buy'
            ? (bar.low / signal.price - 1) * 100
            : (signal.price / bar.high - 1) * 100);
        return {
            horizon,
            status: 'completed',
            trading_date: day(target.time),
            close: target.close,
            directional_return_pct: round(directional),
            max_favorable_pct: round(Math.max(...favorable)),
            max_adverse_pct: round(Math.min(...adverse)),
        };
    });
    return {
        code: instrument.code,
        name: instrument.name,
        type: instrument.type,
        date,
        time: signal.time,
        period: signal.period,
        side: signal.side,
        strategy: signal.strategy,
        scenario: primaryScenario(signal, trend),
        trend,
        price: signal.price,
        model_confidence: signal.confidence,
        evidence_cluster: signal.evidenceCluster,
        reasons: signal.reasons,
        invalidation: signal.invalidation,
        signal_metadata: signal.metadata,
        decision_state: guidance.state,
        decision_action: guidance.action,
        trade_intent: guidance.trade_intent ?? signal.metadata?.position_intent ?? null,
        trade_intent_evidence: guidance.trade_intent_evidence ?? null,
        downside_risk: downsideRisk,
        position_before: transition.position_before,
        position_after: transition.position_after,
        sold_capacity_after: transition.sold_capacity_after,
        action_fraction: transition.action_fraction,
        matched_sell_lots: transition.matched_sell_lots ?? [],
        outcomes,
    };
}

export function executableDaySignal(engine) {
    const triggerId = engine.position_guidance?.trigger_signal_id;
    if (!triggerId || !engine.position_guidance?.material_change)
        return null;
    return engine.signals.find((item) => item.id === triggerId && item.kState === 'closed') ?? null;
}
