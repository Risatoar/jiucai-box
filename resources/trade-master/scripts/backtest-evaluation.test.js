import { describe, expect, it } from 'vitest';
import { evaluateSignal } from './dist/backtest-evaluation.js';

const signal = {
    time: '2026-07-01 10:00:00',
    period: '5m',
    side: 'buy',
    strategy: 'trend_pullback_entry',
    price: 2,
    confidence: 0.76,
    evidenceCluster: 'trend-5m',
    reasons: [],
    metadata: {},
};

const transition = {
    position_before: 0,
    position_after: 0.5,
    sold_capacity_after: 0.5,
    action_fraction: 0.5,
    matched_sell_lots: [],
};

describe('backtest outcome data quality', () => {
    it('复权或份额变化造成价格尺度跳变时不计入方向准确率', () => {
        const record = evaluateSignal(
            signal,
            { code: '159320', name: '电网ETF', type: 'etf' },
            'up',
            '2026-07-01',
            [
                { time: '2026-07-02', close: 1.98, high: 2.01, low: 1.95, closed: true },
                { time: '2026-07-03', close: 0.6, high: 0.61, low: 0.59, closed: true },
                { time: '2026-07-06', close: 0.62, high: 0.63, low: 0.6, closed: true },
            ],
            { state: 'trend_add_ready', action: 'test' },
            transition,
            {},
        );
        expect(record.outcomes[0]).toMatchObject({ horizon: 1, status: 'completed' });
        expect(record.outcomes[1]).toMatchObject({
            status: 'invalid',
            reason: 'price_scale_discontinuity',
        });
    });
});
