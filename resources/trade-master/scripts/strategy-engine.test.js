import { describe, expect, it } from 'vitest';
import { generateStrategySignals } from './dist/strategy-engine.js';
import {
    ASSET_ADAPTIVE_CANDIDATE_POLICY,
    classifyRangeLowEntry,
    decisionPolicyForInstrument,
    rangeHighRejectionConfirmed,
    rangeLowRiskConfirmed,
    reentryRiskConfirmed,
    ROBUST_70_CANDIDATE_POLICY,
    ROLLING_CANDIDATE_POLICY,
} from './dist/strategy-policy.js';

const dailyBars = (regime) => Array.from({ length: 80 }, (_, index) => {
    const close = regime === 'up'
        ? 20 + index * 0.25
        : regime === 'down'
            ? 100 - index * 0.5
            : 20 + Math.sin(index / 3) * 0.25;
    return {
        time: `2026-04-${String((index % 28) + 1).padStart(2, '0')}`,
        open: close - 0.2,
        high: close + 1,
        low: close - 1,
        close,
        volume: 10000,
        period: '1d',
        closed: true,
    };
});

const dailyBarsWithRepair = () => {
    const bars = dailyBars('down');
    bars[bars.length - 1] = {
        ...bars.at(-1),
        open: 60.5,
        high: 63,
        low: 60.2,
        close: 62.5,
        volume: 20000,
    };
    return bars;
};

const minuteBars = (fiveMinuteBars) => fiveMinuteBars.flatMap((bar, bucket) => Array.from({ length: 5 }, (_, minute) => {
    const ratio = (minute + 1) / 5;
    const close = bar.open + (bar.close - bar.open) * ratio;
    const totalMinute = 9 * 60 + 30 + bucket * 5 + minute;
    const hour = Math.floor(totalMinute / 60);
    const minuteOfHour = totalMinute % 60;
    return {
        time: `2026-07-23 ${String(hour).padStart(2, '0')}:${String(minuteOfHour).padStart(2, '0')}`,
        open: minute === 0 ? bar.open : bar.open + (bar.close - bar.open) * minute / 5,
        high: Math.max(close, bar.high - (4 - minute) * 0.01),
        low: Math.min(close, bar.low + minute * 0.01),
        close,
        volume: bar.volume / 5,
        amount: close * bar.volume / 5,
        period: '1m',
        closed: true,
        source: 'fixture',
    };
}));

const baseBars = (start = 56) => Array.from({ length: 12 }, (_, index) => ({
    open: start + index * 0.03,
    high: start + 0.35 + index * 0.03,
    low: start - 0.35 + index * 0.02,
    close: start + 0.08 + index * 0.03,
    volume: 1000,
}));

const extendedBaseBars = (start = 56) => Array.from({ length: 38 }, (_, index) => ({
    open: start + index * 0.02,
    high: start + 0.3 + index * 0.02,
    low: start - 0.3 + index * 0.02,
    close: start + 0.08 + index * 0.02,
    volume: 1000,
}));

const multiPeriodBreakBars = () => [
    ...Array.from({ length: 36 }, () => ({
        open: 60,
        high: 60.5,
        low: 59.5,
        close: 60,
        volume: 1000,
    })),
    { open: 59.8, high: 59.9, low: 57.8, close: 58, volume: 2200 },
    { open: 58.2, high: 59.2, low: 57.7, close: 57.9, volume: 1800 },
    { open: 57.8, high: 59, low: 56.8, close: 57, volume: 1800 },
    { open: 57.3, high: 59, low: 56.85, close: 56.9, volume: 1700 },
    { open: 56.95, high: 58.5, low: 56.82, close: 56.9, volume: 1600 },
    { open: 56.95, high: 58, low: 56.81, close: 56.9, volume: 1600 },
];

describe('position-aware market regime strategy', () => {
    it('区间买卖点必须通过下跌风险和上沿拒绝强度闸门', () => {
        expect(rangeLowRiskConfirmed({
            momentum_5d_pct: -7,
            ma20_slope_5d_pct: 1,
            atr_ratio_pct: 4,
            intraday_drawdown_pct: 2,
        }, ROLLING_CANDIDATE_POLICY)).toBe(false);
        expect(rangeLowRiskConfirmed({
            momentum_5d_pct: -2,
            ma20_slope_5d_pct: 1,
            atr_ratio_pct: 4,
            intraday_drawdown_pct: 2,
        }, ROLLING_CANDIDATE_POLICY)).toBe(true);
        expect(rangeHighRejectionConfirmed(
            { metadata: { upper_shadow_ratio: 1.2 } },
            { next_support_distance_pct: 11 },
            ROLLING_CANDIDATE_POLICY,
        )).toBe(true);
        expect(rangeHighRejectionConfirmed(
            { metadata: { upper_shadow_ratio: 1.2 } },
            { next_support_distance_pct: 5 },
            ROLLING_CANDIDATE_POLICY,
        )).toBe(false);
        const etfPolicy = decisionPolicyForInstrument(ASSET_ADAPTIVE_CANDIDATE_POLICY, 'etf');
        expect(etfPolicy.trend_entry_strategies).toEqual([]);
        expect(rangeLowRiskConfirmed({
            momentum_5d_pct: -2,
            ma20_slope_5d_pct: 1,
            atr_ratio_pct: 4,
            intraday_drawdown_pct: 2,
            daily_repair_confirmed: false,
        }, etfPolicy)).toBe(false);
        const cbondPolicy = decisionPolicyForInstrument(ASSET_ADAPTIVE_CANDIDATE_POLICY, 'cbond');
        expect(rangeHighRejectionConfirmed(
            { metadata: { upper_shadow_ratio: 4 } },
            { next_support_distance_pct: 20, atr_ratio_pct: 12, momentum_5d_pct: -2 },
            cbondPolicy,
        )).toBe(false);
    });

    it('区分做T接回、新周期买点和过早高价追回', () => {
        const context = {
            soldQuantity: 50,
            lastSellPrice: 100,
            lastSellStrategy: 'support_break_retest',
            lastSellDate: '2026-07-01',
        };
        expect(classifyRangeLowEntry({ price: 98, time: '2026-07-10 10:00:00' }, context, ROLLING_CANDIDATE_POLICY)).toMatchObject({
            eligible: true,
            trade_intent: 't_reentry',
            elapsed_calendar_days: 9,
        });
        expect(classifyRangeLowEntry({ price: 102, time: '2026-07-10 10:00:00' }, context, ROLLING_CANDIDATE_POLICY)).toMatchObject({
            eligible: false,
            trade_intent: 'reentry_wait',
        });
        expect(classifyRangeLowEntry({ price: 102, time: '2026-07-15 10:00:00' }, context, ROLLING_CANDIDATE_POLICY)).toMatchObject({
            eligible: true,
            trade_intent: 'new_cycle_entry',
            elapsed_calendar_days: 14,
        });
    });

    it('70%候选要求回补同时通过动量和波动率确认', () => {
        expect(reentryRiskConfirmed({
            momentum_5d_pct: 0.5,
            atr_ratio_pct: 4.2,
        }, ROBUST_70_CANDIDATE_POLICY)).toBe(true);
        expect(reentryRiskConfirmed({
            momentum_5d_pct: -3,
            atr_ratio_pct: 4.2,
        }, ROBUST_70_CANDIDATE_POLICY)).toBe(false);
        expect(reentryRiskConfirmed({
            momentum_5d_pct: 0.5,
            atr_ratio_pct: 3,
        }, ROBUST_70_CANDIDATE_POLICY)).toBe(true);
    });

    it('V25按资产类型区分做T和高抛低吸的最低价差', () => {
        const context = {
            soldQuantity: 50,
            lastSellPrice: 100,
            lastSellStrategy: 'range_high_reversal',
            lastSellDate: '2026-07-01',
        };
        const stockPolicy = decisionPolicyForInstrument(ROBUST_70_CANDIDATE_POLICY, 'stock');
        const cbondPolicy = decisionPolicyForInstrument(ROBUST_70_CANDIDATE_POLICY, 'cbond');
        expect(classifyRangeLowEntry({ price: 98, time: '2026-07-02 10:00:00' }, context, stockPolicy))
            .toMatchObject({ eligible: true, trade_intent: 'high_low_reentry' });
        expect(classifyRangeLowEntry({ price: 97, time: '2026-07-02 10:00:00' }, context, stockPolicy))
            .toMatchObject({ eligible: true, trade_intent: 't_reentry' });
        expect(classifyRangeLowEntry({ price: 99.5, time: '2026-07-02 10:00:00' }, context, cbondPolicy))
            .toMatchObject({ eligible: true, trade_intent: 'high_low_reentry' });
        expect(classifyRangeLowEntry({ price: 99, time: '2026-07-02 10:00:00' }, context, cbondPolicy))
            .toMatchObject({ eligible: true, trade_intent: 't_reentry' });
    });

    it('下跌后放量反转只有5分钟和15分钟同时确认才升级为接回信号', () => {
        const bars = [
            ...extendedBaseBars(56),
            { open: 56.8, high: 60.5, low: 56.7, close: 60.2, volume: 5000 },
        ];
        const result = generateStrategySignals('stock', minuteBars(bars), dailyBarsWithRepair(), {
            hasPosition: true,
            accountScope: '老婆 → 老婆的账户',
            positionQuantity: 300,
            soldQuantity: 300,
            decisionPolicy: ROLLING_CANDIDATE_POLICY,
        });
        const reentry = result.signals.find((signal) => signal.strategy === 'fast_reversal_reentry' && signal.period === '5m');
        expect(result.daily_trend).toBe('down');
        expect(reentry).toMatchObject({
            side: 'buy',
            level: 'actionable',
            metadata: { position_intent: 'reentry', max_reentry_quantity: 300 },
        });
        expect(result.position_guidance).toMatchObject({
            state: 'reentry_ready',
            preserve_core: true,
            material_change: true,
            trigger_signal_id: reentry.id,
        });
    });

    it('空仓时日线修复和跨周期反转同时成立会形成抄底候选', () => {
        const bars = [
            ...extendedBaseBars(56),
            { open: 56.8, high: 60.5, low: 56.7, close: 60.2, volume: 5000 },
        ];
        const result = generateStrategySignals('stock', minuteBars(bars), dailyBarsWithRepair(), {
            hasPosition: false,
            positionQuantity: 0,
            soldQuantity: 0,
            decisionPolicy: ROLLING_CANDIDATE_POLICY,
        });
        expect(result.daily_trend).toBe('down');
        expect(result.downside_risk.daily_repair_confirmed).toBe(true);
        expect(result.position_guidance).toMatchObject({
            state: 'entry_ready',
            material_change: true,
            trigger_signal_id: expect.stringContaining('fast_reversal_reentry'),
        });
    });

    it('下跌空间较大且反抽失败时允许清仓，并强制保留重新买回计划', () => {
        const bars = multiPeriodBreakBars();
        const result = generateStrategySignals('stock', minuteBars(bars), dailyBars('down'), {
            hasPosition: true,
            accountScope: '老婆 → 老婆的账户',
            positionQuantity: 300,
            decisionPolicy: { ...ROLLING_CANDIDATE_POLICY, full_exit_max_intraday_drawdown_pct: null },
        });
        expect(new Set(result.signals.filter((signal) => signal.strategy === 'support_break_retest' && signal.level === 'actionable').map((signal) => signal.period))).toEqual(new Set(['5m', '15m']));
        expect(result.position_guidance).toMatchObject({
            state: 'full_exit_ready',
            preserve_core: false,
            material_change: true,
            reentry_plan_required: true,
        });
    });

    it('支撑破位但波动和下行动量不足时不会直接清掉核心仓', () => {
        const result = generateStrategySignals('stock', minuteBars(multiPeriodBreakBars()), dailyBars('down'), {
            hasPosition: true,
            positionQuantity: 300,
            decisionPolicy: {
                ...ROLLING_CANDIDATE_POLICY,
                full_exit_max_intraday_drawdown_pct: null,
                full_exit_min_atr_ratio_pct: 99,
                full_exit_max_momentum_5d_pct: -99,
            },
        });
        expect(result.position_guidance.state).not.toBe('full_exit_ready');
        expect(result.position_guidance.preserve_core).toBe(true);
    });

    it('同一天买卖信号冲突时，单周期反转不会覆盖已确认的风险结构', () => {
        const lateBreak = generateStrategySignals('stock', minuteBars([
            ...baseBars(56),
            { open: 56.4, high: 60.5, low: 56.3, close: 60.2, volume: 2800 },
            { open: 59.5, high: 59.8, low: 55.2, close: 55.4, volume: 2400 },
            { open: 55.5, high: 56, low: 54.2, close: 54.5, volume: 2100 },
        ]), dailyBars('down'), { hasPosition: true, soldQuantity: 300, decisionPolicy: ROLLING_CANDIDATE_POLICY });
        expect(lateBreak.position_guidance.state).not.toBe('full_exit_ready');

        const lateRecovery = generateStrategySignals('stock', minuteBars([
            ...baseBars(60),
            { open: 60, high: 60.1, low: 56.8, close: 57, volume: 2200 },
            { open: 57.5, high: 59.8, low: 55.8, close: 56, volume: 2000 },
            { open: 56.2, high: 62, low: 56.1, close: 61.5, volume: 3200 },
        ]), dailyBars('down'), { hasPosition: true, soldQuantity: 300, decisionPolicy: ROLLING_CANDIDATE_POLICY });
        expect(lateRecovery.position_guidance.state).toBe('reentry_watch');
    });

    it('上涨趋势中的普通破位和动能转弱不会轻易卖掉核心仓', () => {
        const bars = [
            ...baseBars(30),
            { open: 30.2, high: 30.3, low: 29.3, close: 29.4, volume: 1500 },
            { open: 29.6, high: 29.7, low: 29.1, close: 29.2, volume: 1300 },
        ];
        const result = generateStrategySignals('stock', minuteBars(bars), dailyBars('up'), {
            hasPosition: true,
            positionQuantity: 500,
            decisionPolicy: ROLLING_CANDIDATE_POLICY,
        });
        const exits = result.signals.filter((signal) => signal.side === 'sell' && signal.kState === 'closed');
        expect(exits.every((signal) => signal.level !== 'actionable')).toBe(true);
        expect(result.position_guidance).toMatchObject({
            state: 'trend_hold',
            preserve_core: true,
        });
    });

    it('上涨趋势顶部出现放量派发证据时只高抛机动仓并保留接回计划', () => {
        const bars = [
            ...extendedBaseBars(30),
            { open: 30.8, high: 38, low: 30.2, close: 30.5, volume: 5000 },
        ];
        const result = generateStrategySignals('stock', minuteBars(bars), dailyBars('up'), {
            hasPosition: true,
            positionQuantity: 500,
            decisionPolicy: ROLLING_CANDIDATE_POLICY,
        });
        expect(result.signals).toContainEqual(expect.objectContaining({
            strategy: 'trend_distribution_top',
            side: 'sell',
            level: 'actionable',
            metadata: expect.objectContaining({
                position_intent: 'trend_reduce',
                preserve_core_position: true,
                partial_reduce_only: true,
            }),
        }));
        expect(result.position_guidance).toMatchObject({
            state: 'trend_top_reduce',
            preserve_core: true,
            reentry_plan_required: true,
            trigger_signal_id: expect.stringContaining('trend_distribution_top'),
        });
    });

    it('震荡区间上沿转弱时给出高抛复核，而不是机械清仓', () => {
        const bars = Array.from({ length: 12 }, (_, index) => ({
            open: index % 2 ? 20.1 : 20.3,
            high: 20.7,
            low: 19.7,
            close: index === 11 ? 20.69 : index % 2 ? 20.35 : 20.2,
            volume: 1000,
        }));
        bars.push({ open: 20.68, high: 20.85, low: 20.3, close: 20.62, volume: 1500 });
        const result = generateStrategySignals('stock', minuteBars(bars), dailyBars('range'), {
            hasPosition: true,
            positionQuantity: 600,
            decisionPolicy: ROLLING_CANDIDATE_POLICY,
        });
        expect(result.signals.some((signal) => signal.strategy === 'range_high_reversal' && signal.level === 'actionable')).toBe(true);
        expect(result.position_guidance).toMatchObject({
            state: 'range_high_reduce',
            preserve_core: true,
        });
    });

    it('卖出后跨周期重新收复卖出位时优先提示接回已卖仓位', () => {
        const result = generateStrategySignals('stock', minuteBars([
            ...extendedBaseBars(56),
            { open: 56.8, high: 60.5, low: 56.7, close: 60.2, volume: 5000 },
        ]), dailyBars('down'), {
            hasPosition: true,
            soldQuantity: 50,
            lastSellPrice: 58.5,
            decisionPolicy: {
                ...ROLLING_CANDIDATE_POLICY,
                reclaim_requires_known_support: false,
                reclaim_max_next_support_distance_pct: null,
            },
        });
        const reclaims = result.signals.filter((signal) => signal.strategy === 'sold_level_reclaim');
        expect(new Set(reclaims.map((signal) => signal.period))).toEqual(new Set(['5m', '15m']));
        expect(result.position_guidance).toMatchObject({
            state: 'reentry_ready',
            preserve_core: true,
            trigger_signal_id: expect.stringContaining('sold_level_reclaim'),
        });
    });

    it('极端下行动量中不会仅凭收复卖出位就抢反弹接回', () => {
        const extremeDown = dailyBars('down');
        extremeDown[extremeDown.length - 6] = { ...extremeDown.at(-6), close: 65 };
        extremeDown[extremeDown.length - 1] = { ...extremeDown.at(-1), close: 55 };
        const result = generateStrategySignals('stock', minuteBars([
            ...extendedBaseBars(56),
            { open: 56.8, high: 60.5, low: 56.7, close: 60.2, volume: 5000 },
        ]), extremeDown, {
            hasPosition: true,
            soldQuantity: 50,
            lastSellPrice: 58.5,
            decisionPolicy: {
                ...ROLLING_CANDIDATE_POLICY,
                reclaim_requires_known_support: false,
                reclaim_max_next_support_distance_pct: null,
            },
        });
        expect(result.signals.some((signal) => signal.strategy === 'sold_level_reclaim')).toBe(true);
        expect(result.position_guidance.state).not.toBe('reentry_ready');
    });
});
