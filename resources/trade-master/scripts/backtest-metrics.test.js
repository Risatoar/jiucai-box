import { describe, expect, it } from 'vitest';
import { clusteredObjectiveMetric, objectiveMetric, objectiveScenarioSummary, scenarioSummary, sellTimingSummary } from './dist/backtest-metrics.js';

const record = (overrides) => ({
    code: '300438',
    date: '2026-07-01',
    time: '2026-07-01 10:00:00',
    side: 'sell',
    strategy: 'range_high_reversal',
    scenario: 'range_high_low',
    decision_state: 'range_high_reduce',
    trade_intent: 't_sell',
    position_after: 0.5,
    price: 100,
    outcomes: [],
    ...overrides,
});

describe('backtest scenario metrics', () => {
    it('separates an early sell from a wrong-direction sell', () => {
        const records = [
            record({ side: 'sell', outcomes: [
                { horizon: 1, status: 'completed', directional_return_pct: -2, max_adverse_pct: -3 },
                { horizon: 3, status: 'completed', directional_return_pct: 4 },
            ] }),
            record({ code: '600001', side: 'sell', outcomes: [
                { horizon: 1, status: 'completed', directional_return_pct: -2, max_adverse_pct: -3 },
                { horizon: 3, status: 'completed', directional_return_pct: -1 },
            ] }),
            record({ code: '600002', side: 'sell', outcomes: [
                { horizon: 1, status: 'completed', directional_return_pct: 2, max_adverse_pct: -1 },
                { horizon: 3, status: 'completed', directional_return_pct: 2 },
            ] }),
        ];
        expect(sellTimingSummary(records)).toMatchObject({
            samples: 3,
            timely: 1,
            early_but_directionally_correct: 1,
            wrong_direction: 1,
            directional_accuracy_pct: 66.67,
            timing_accuracy_pct: 33.33,
        });
    });
    it('做T只配对保留核心仓后的低价接回，避免高价防卖飞接回和重复配对', () => {
        const summary = scenarioSummary([
            record({}),
            record({ date: '2026-07-02', time: '2026-07-02 10:00:00', price: 99 }),
            record({
                date: '2026-07-03',
                time: '2026-07-03 10:00:00',
                side: 'buy',
                strategy: 'sold_level_reclaim',
                decision_state: 'reentry_ready',
                simulation_track: 'flat_down_entry',
                price: 102,
            }),
            record({
                date: '2026-07-10',
                time: '2026-07-10 10:00:00',
                side: 'buy',
                strategy: 'range_low_reversal',
                decision_state: 'entry_ready',
                simulation_track: 'flat_range_entry',
                price: 90,
            }),
            record({
                date: '2026-07-18',
                time: '2026-07-18 10:00:00',
                side: 'buy',
                strategy: 'range_low_reversal',
                decision_state: 'range_low_add',
                trade_intent: 'new_cycle_entry',
                simulation_track: 'flat_range_entry',
                price: 95,
            }),
            record({
                date: '2026-07-18',
                time: '2026-07-18 10:00:00',
                side: 'buy',
                strategy: 'range_low_reversal',
                decision_state: 'range_low_add',
                trade_intent: 't_reentry',
                price: 95,
            }),
        ], 3);
        expect(summary.t_pairs).toHaveLength(1);
        expect(summary.risk_recovery_pairs).toEqual([]);
        expect(summary.t_pairs[0]).toMatchObject({
            sell_price: 99,
            buy_price: 95,
            elapsed_calendar_days: 16,
            trade_intent: 't_reentry',
            correct: true,
        });
        expect(summary.scenarios.t_trade).toMatchObject({
            samples: 1,
            correct: 1,
            accuracy_pct: 100,
        });
    });

    it('非T接回会先消耗对应卖出批次，后续T接回不能重复使用同一卖点', () => {
        const summary = scenarioSummary([
            record({ date: '2026-07-01', time: '2026-07-01 10:00:00', price: 100 }),
            record({
                date: '2026-07-02',
                time: '2026-07-02 10:00:00',
                side: 'buy',
                trade_intent: 'risk_reentry',
                price: 95,
                matched_sell_lots: [{ date: '2026-07-01', price: 100, quantity: 0.5 }],
            }),
            record({
                date: '2026-07-03',
                time: '2026-07-03 10:00:00',
                side: 'buy',
                trade_intent: 't_reentry',
                price: 90,
                matched_sell_lots: [{ date: '2026-07-01', price: 100, quantity: 0.5 }],
            }),
        ], 3);
        expect(summary.t_pairs).toEqual([]);
        expect(summary.risk_recovery_pairs).toHaveLength(1);
    });

    it('按预先固定的场景周期评价，不为单个信号挑选最有利周期', () => {
        const escape = record({
            scenario: 'escape_top',
            strategy: 'rally_exhaustion',
            outcomes: [
                { horizon: 1, status: 'completed', directional_return_pct: -2, max_adverse_pct: -3 },
                { horizon: 3, status: 'completed', directional_return_pct: 4, max_adverse_pct: -3 },
            ],
        });
        const trend = record({
            side: 'buy',
            scenario: 'trend_profit_capture',
            strategy: 'trend_pullback_entry',
            outcomes: [
                { horizon: 3, status: 'completed', directional_return_pct: -1, max_adverse_pct: -2 },
                { horizon: 7, status: 'completed', directional_return_pct: 5, max_adverse_pct: -2 },
            ],
        });
        expect(objectiveMetric([escape, trend])).toMatchObject({ samples: 2, correct: 2, accuracy_pct: 100 });
        const scenarios = objectiveScenarioSummary([escape, trend]).scenarios;
        expect(scenarios.escape_top).toMatchObject({ evaluation_horizon: 3, samples: 1, correct: 1 });
        expect(scenarios.trend_profit_capture).toMatchObject({ evaluation_horizon: 7, samples: 1, correct: 1 });
        expect(scenarios.avoid_sell_flying).toMatchObject({
            evaluation_horizon: '1d_timing+3d_partial_direction+7d_reentry',
            samples: 1,
            correct: 1,
            breakdown: { core_preserved_directional_sells: 1, wrong_sells: 0 },
        });
    });

    it('方向正确按涨跌符号判断，不用0.5%阈值抹掉小幅正确走势', () => {
        expect(objectiveMetric([
            record({ side: 'buy', outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: 0.1 }] }),
            record({ code: '600001', side: 'sell', outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: -0.01 }] }),
        ])).toMatchObject({ samples: 2, correct: 1, accuracy_pct: 50 });
    });

    it('同类资产同日同策略的相关信号只形成一个聚类样本', () => {
        const correlated = [
            record({ type: 'etf', outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: -2 }] }),
            record({ code: '510300', type: 'etf', outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: -4 }] }),
            record({ code: '600001', type: 'stock', outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: 1 }] }),
        ];
        expect(clusteredObjectiveMetric(correlated)).toMatchObject({
            samples: 2,
            raw_samples: 3,
            correct: 1,
            accuracy_pct: 50,
        });
    });

    it('避免卖飞同时评价卖出后1日反弹和重新接回后7日表现', () => {
        const sell = record({
            outcomes: [{ horizon: 1, status: 'completed', directional_return_pct: 1, max_adverse_pct: -1 }],
        });
        const reclaim = record({
            side: 'buy',
            strategy: 'sold_level_reclaim',
            scenario: 'avoid_sell_flying',
            outcomes: [{ horizon: 7, status: 'completed', directional_return_pct: 3, max_adverse_pct: -2 }],
        });
        expect(objectiveScenarioSummary([sell, reclaim]).scenarios.avoid_sell_flying).toMatchObject({
            evaluation_horizon: '1d_timing+3d_partial_direction+7d_reentry',
            samples: 2,
            correct: 2,
            accuracy_pct: 100,
        });
    });

    it('只有清仓后明显反弹才直接记为卖飞，保留核心仓需等待3日方向', () => {
        const fullExit = record({
            decision_state: 'full_exit_ready',
            position_after: 0,
            outcomes: [
                { horizon: 1, status: 'completed', directional_return_pct: -3, max_adverse_pct: -3 },
                { horizon: 3, status: 'completed', directional_return_pct: 4, max_adverse_pct: -3 },
            ],
        });
        const pendingPartial = record({
            code: '600001',
            position_after: 0.5,
            outcomes: [{ horizon: 1, status: 'completed', directional_return_pct: -3, max_adverse_pct: -3 }],
        });
        expect(objectiveScenarioSummary([fullExit, pendingPartial]).scenarios.avoid_sell_flying).toMatchObject({
            samples: 1,
            correct: 0,
            breakdown: { wrong_sells: 1 },
        });
    });
});
