import { describe, expect, it } from 'vitest';
import { buildScenarioCaseLibrary } from './dist/scenario-case-library.js';

const record = (overrides) => ({
    code: '600000',
    date: '2026-07-01',
    time: '2026-07-01 10:00:00',
    side: 'sell',
    price: 100,
    case_scene: 'range_high',
    trading_index: 1,
    outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: 2, max_adverse_pct: -1 }],
    ...overrides,
});

describe('independent scenario case library', () => {
    it('deduplicates correlated cases and pairs each T sell and buy once', () => {
        const report = buildScenarioCaseLibrary([
            record({}),
            record({ date: '2026-07-03', trading_index: 3, price: 99 }),
            record({
                date: '2026-07-08',
                time: '2026-07-08 10:00:00',
                side: 'buy',
                price: 90,
                case_scene: 'range_low',
                trading_index: 6,
                outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: 3 }],
            }),
            record({
                code: '600001',
                case_scene: 'full_exit',
                price: 50,
                outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: 4 }],
            }),
        ], [
            record({
                code: '600002',
                side: 'buy',
                case_scene: 'bottom_fishing_abstention',
                outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: -5 }],
            }),
        ]);
        expect(report.raw.samples).toBe(4);
        expect(report.independent.samples).toBe(3);
        expect(report.independent.high_low_pairs).toHaveLength(1);
        expect(report.independent.high_low_cycle_ledger).toMatchObject({
            sell_legs: 1,
            buy_legs: 1,
            open_sell_legs: 0,
            unmatched_buy_legs: 0,
        });
        expect(report.independent.high_low_pairs[0]).toMatchObject({
            sell_date: '2026-07-01',
            buy_date: '2026-07-08',
            gross_spread_pct: 11.11,
        });
        expect(report.independent.action_metrics.full_exit).toMatchObject({
            samples: 1,
            correct: 1,
        });
        expect(report.bottom_fishing_abstentions).toMatchObject({
            samples: 1,
            correct_abstentions: 1,
            accuracy_pct: 100,
        });
        expect(report.coverage).toMatchObject({
            minimum_per_type: 10,
            ready: false,
        });
    });

    it('counts one matched low buy as both range-low and reentry evidence', () => {
        const report = buildScenarioCaseLibrary([
            record({}),
            record({
                date: '2026-07-08',
                time: '2026-07-08 10:00:00',
                side: 'buy',
                price: 90,
                case_scene: 'range_low',
                case_roles: ['range_low', 'reentry'],
                trade_intent: 't_reentry',
                matched_sell_lots: [{
                    price: 100,
                    date: '2026-07-01',
                    strategy: 'range_high_reversal',
                    quantity: 0.5,
                    trade_intent: 't_sell',
                    sell_scene: 'range_high',
                }],
                trading_index: 6,
                outcomes: [
                    { horizon: 3, status: 'completed', directional_return_pct: 3 },
                    { horizon: 7, status: 'completed', directional_return_pct: 5 },
                ],
            }),
        ], []);
        expect(report.independent.action_metrics.range_low.samples).toBe(1);
        expect(report.independent.action_metrics.reentry.samples).toBe(1);
        expect(report.independent.position_cycle_ledger.t_pairs).toHaveLength(1);
        expect(report.independent.position_cycle_ledger.t_accuracy_pct).toBe(100);
    });

    it('never uses a price-scale discontinuity to satisfy cycle coverage', () => {
        const report = buildScenarioCaseLibrary([
            record({
                side: 'buy',
                case_scene: 'reentry',
                case_roles: ['reentry'],
                trade_intent: 't_reentry',
                matched_sell_lots: [{
                    price: 100,
                    date: '2026-06-25',
                    quantity: 0.5,
                    trade_intent: 't_sell',
                    sell_scene: 'trend_take_profit',
                }],
                outcomes: [
                    { horizon: 3, status: 'invalid', reason: 'price_scale_discontinuity' },
                ],
            }),
        ], []);
        expect(report.independent.position_cycle_ledger.t_pairs).toHaveLength(0);
        expect(report.coverage.counts.t_trade).toBe(0);
    });

    it('does not count a 2% stock high-low pair as a 3% T trade', () => {
        const report = buildScenarioCaseLibrary([
            record({
                type: 'stock',
                side: 'buy',
                price: 98,
                case_scene: 'reentry',
                case_roles: ['reentry'],
                trade_intent: 'high_low_reentry',
                required_t_spread_pct: 3,
                required_high_low_spread_pct: 2,
                matched_sell_lots: [{
                    price: 100,
                    date: '2026-06-25',
                    quantity: 0.5,
                    trade_intent: 't_sell',
                    sell_scene: 'range_high',
                }],
            }),
        ], []);
        expect(report.independent.position_cycle_ledger.t_pairs).toHaveLength(0);
        expect(report.independent.high_low_pairs).toHaveLength(1);
        expect(report.coverage.counts.t_trade).toBe(0);
        expect(report.coverage.counts.high_low_pair).toBe(1);
    });
});
