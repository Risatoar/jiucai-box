import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDecisionTransition, canSampleCounterfactualEntry, runRollingBacktest, selectBacktestUniverse } from './dist/rolling-backtest.js';
import { pushUniqueRecord } from './dist/backtest-diagnostics.js';

const previousHome = process.env.TRADE_MASTER_HOME;
let temporaryHome = '';

afterEach(async () => {
    if (temporaryHome)
        await rm(temporaryHome, { recursive: true, force: true });
    temporaryHome = '';
    if (previousHome == null)
        delete process.env.TRADE_MASTER_HOME;
    else
        process.env.TRADE_MASTER_HOME = previousHome;
});

function dailyBars() {
    const bars = [];
    for (let index = 0; index < 50; index += 1) {
        const date = new Date('2026-05-01T07:00:00.000Z');
        date.setUTCDate(date.getUTCDate() + index);
        const close = 10 + index * 0.05;
        bars.push({ time: date.toISOString().slice(0, 10), open: close - 0.02, high: close + 0.08, low: close - 0.08, close, volume: 1000, amount: null, period: '1d', closed: true });
    }
    return bars;
}

function fiveMinuteBars() {
    const bars = [];
    for (let dateIndex = 0; dateIndex < 16; dateIndex += 1) {
        const date = new Date('2026-06-01T00:00:00.000Z');
        date.setUTCDate(date.getUTCDate() + dateIndex);
        const tradingDate = date.toISOString().slice(0, 10);
        for (let index = 0; index < 48; index += 1) {
            const sessionMinute = index < 24 ? 570 + index * 5 : 780 + (index - 24) * 5;
            const hour = Math.floor(sessionMinute / 60);
            const minute = sessionMinute % 60;
            const breakout = index >= 38;
            const close = breakout ? 12.8 + (index - 38) * 0.03 : 12.4 + index * 0.001;
            bars.push({
                time: `${tradingDate} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
                open: close - 0.01,
                high: close + 0.02,
                low: close - 0.02,
                close,
                volume: breakout ? 5000 : 500,
                amount: null,
                period: '5m',
                closed: true,
            });
        }
    }
    return bars;
}

describe('rolling multi-scenario backtest', () => {
    it('反事实空仓买点至少间隔五个真实交易日，避免重复开仓样本', () => {
        expect(canSampleCounterfactualEntry(null, 1, 5)).toBe(true);
        expect(canSampleCounterfactualEntry(1, 4, 5)).toBe(false);
        expect(canSampleCounterfactualEntry(1, 6, 5)).toBe(true);
    });

    it('同一股票同一天同方向同策略只记一次，避免持仓与反事实轨道重复', () => {
        const records = [];
        const item = { code: '603993', date: '2026-07-14', side: 'buy', strategy: 'fast_reversal_reentry' };
        expect(pushUniqueRecord(records, item)).toBe(true);
        expect(pushUniqueRecord(records, { ...item, simulation_track: 'flat_down_entry' })).toBe(false);
        expect(records).toHaveLength(1);
    });

    it('tracks partial sells, full exits, and reentries without inventing extra inventory', () => {
        const partial = applyDecisionTransition(
            { state: 'range_high_reduce' },
            { side: 'sell', price: 100, strategy: 'range_high_reversal', time: '2026-07-01 10:00:00' },
            { held: 1, sold: 0 },
        );
        expect(partial).toMatchObject({
            next_state: {
                held: 0.5,
                sold: 0.5,
                last_sell_price: 100,
                last_sell_date: '2026-07-01',
                sold_lots: [{ price: 100, quantity: 0.5 }],
            },
            action_fraction: 0.5,
        });
        expect(applyDecisionTransition(
            { state: 'range_high_reduce' },
            { side: 'sell' },
            partial.next_state,
        )).toBeNull();
        const exit = applyDecisionTransition(
            { state: 'full_exit_ready' },
            { side: 'sell', price: 90, strategy: 'support_break', time: '2026-07-02 10:00:00' },
            partial.next_state,
        );
        expect(exit).toMatchObject({
            next_state: {
                held: 0,
                sold: 1,
                last_sell_price: 90,
                sold_lots: [
                    { price: 100, quantity: 0.5 },
                    { price: 90, quantity: 0.5 },
                ],
            },
            action_fraction: 0.5,
        });
        const reentry = applyDecisionTransition(
            { state: 'entry_ready' },
            { side: 'buy' },
            exit.next_state,
        );
        expect(reentry).toMatchObject({
            next_state: {
                held: 0.5,
                sold: 0.5,
                last_sell_price: 100,
                sold_lots: [{ price: 100, quantity: 0.5 }],
            },
            action_fraction: 0.5,
            matched_sell_lots: [{ price: 90, quantity: 0.5 }],
        });
        expect(applyDecisionTransition(
            { state: 'trend_add_ready' },
            { side: 'buy' },
            { held: 1, sold: 0 },
        )).toBeNull();
        expect(applyDecisionTransition(
            { state: 'entry_ready' },
            { side: 'buy' },
            { held: 0, sold: 1 },
        )).toMatchObject({ position_before: 0, position_after: 0.5, action_fraction: 0.5 });
    });

    it('selects a diversified standard universe and allows an explicit research cohort up to 240 instruments', async () => {
        temporaryHome = await mkdtemp(join(tmpdir(), 'rolling-universe-'));
        process.env.TRADE_MASTER_HOME = temporaryHome;
        await writeFile(join(temporaryHome, 'watchlist.json'), JSON.stringify({
            instruments: Array.from({ length: 30 }, (_, index) => ({
                code: index % 3 === 0 ? `600${String(index).padStart(3, '0')}` : index % 3 === 1 ? `510${String(index).padStart(3, '0')}` : `123${String(index).padStart(3, '0')}`,
                name: `样本${index}`,
                type: index % 3 === 0 ? 'stock' : index % 3 === 1 ? 'etf' : 'cbond',
                source: 'user',
            })),
        }));
        const selected = selectBacktestUniverse(25);
        expect(selected).toHaveLength(25);
        expect(new Set(selected.map((item) => item.type))).toEqual(new Set(['stock', 'etf', 'cbond']));
        const expandedCodes = Array.from({ length: 42 }, (_, index) => `600${String(index).padStart(3, '0')}`);
        expect(selectBacktestUniverse(42, expandedCodes)).toHaveLength(42);
        const researchCodes = Array.from({ length: 180 }, (_, index) => `6${String(index).padStart(5, '0')}`);
        expect(selectBacktestUniverse(180, researchCodes)).toHaveLength(180);
    });

    it('uses an explicit full universe without reading or mixing local instruments', async () => {
        temporaryHome = await mkdtemp(join(tmpdir(), 'rolling-explicit-universe-'));
        process.env.TRADE_MASTER_HOME = temporaryHome;
        await writeFile(join(temporaryHome, 'watchlist.json'), JSON.stringify({
            instruments: [{ code: '159516', name: '本地自选', type: 'etf', source: 'user' }],
        }));
        const codes = Array.from({ length: 25 }, (_, index) => `600${String(index).padStart(3, '0')}`);
        const selected = selectBacktestUniverse(25, codes);
        expect(selected.map((item) => item.code)).toEqual(codes);
        expect(selected.every((item) => item.source === 'explicit')).toBe(true);
        expect(selected.some((item) => item.code === '159516')).toBe(false);
    });

    it('uses closed historical bars, persists a report, and never promotes incomplete evidence', async () => {
        temporaryHome = await mkdtemp(join(tmpdir(), 'rolling-report-'));
        process.env.TRADE_MASTER_HOME = temporaryHome;
        await Promise.all([
            mkdir(join(temporaryHome, 'runtime'), { recursive: true }),
            mkdir(join(temporaryHome, 'strategies', 'candidates'), { recursive: true }),
        ]);
        await writeFile(join(temporaryHome, 'watchlist.json'), JSON.stringify({ instruments: [] }));
        await writeFile(join(temporaryHome, 'portfolio.json'), JSON.stringify({ positions: [] }));
        await writeFile(join(temporaryHome, 'runtime', 'candidate-pool.json'), JSON.stringify({ candidates: [] }));
        let intradayLimit = null;
        const market = {
            bars: async (_code, period, limit) => {
                if (period === '5m')
                    intradayLimit = limit;
                return {
                bars: period === '5m' ? fiveMinuteBars() : dailyBars(),
                source: 'fixture',
                errors: [],
                };
            },
        };
        const codes = Array.from({ length: 20 }, (_, index) => `600${String(index).padStart(3, '0')}`);
        const report = await runRollingBacktest(market, { asOf: '2026-06-30T15:00:00+08:00', days: 30, limit: 20, horizon: 3, codes });
        expect(report.no_lookahead).toBe(true);
        expect(report.universe.intraday_period).toBe('5m');
        expect(intradayLimit).toBe(5000);
        expect(report.universe.completed).toBe(20);
        expect(report.universe.coverage_issues).toEqual([]);
        expect(report.split).toMatchObject({
            cutoff_date: '2026-06-12',
            evaluation_trading_dates: 16,
        });
        expect(report.metrics.out_of_sample_scenarios).toBeDefined();
        expect(report.metrics.objective_out_of_sample_scenarios).toBeDefined();
        expect(report.metrics.clustered_objective).toMatchObject({ clustering_contract: 'instrument_type+signal_date+strategy+side' });
        expect(report.evaluation_contract.temporal_holdout_is_true_out_of_sample).toBe(false);
        expect(report.data_quality).toMatchObject({ invalid_outcomes: 0, invalid_records: 0 });
        expect(report.metrics.by_horizon).toHaveProperty('overall.15');
        expect(report.decision_policy.id).toBe('rolling-position-v23');
        expect(report.active_baseline.decision_policy.id).toBe('builtin-position-v1');
        expect(report.performance.candidate.basis).toContain('信号组合代理');
        expect(report.performance.objective_overall.candidate.samples).toBeGreaterThanOrEqual(report.performance.objective.candidate.samples);
        expect(report.signal_audit.executable_decisions).toBeLessThanOrEqual(report.signal_audit.raw_actionable_signals);
        expect(report.case_library).toMatchObject({
            evidence_role: 'scenario_research_only_not_promotion_or_portfolio_return',
            sampling_contract: {
                one_case_per_code_date_scene: true,
                independent_cooldown_trading_days: 5,
            },
        });
        expect(report.promotion.weak_scenarios.length).toBeGreaterThan(0);
        expect(report.promotion.ready).toBe(false);
        const persisted = JSON.parse(await readFile(report.saved.report, 'utf8'));
        expect(persisted.mode).toBe('rolling_multi_scenario_backtest');
        const candidate = JSON.parse(await readFile(report.saved.candidate, 'utf8'));
        expect(candidate.validation_status).toBe('collecting_evidence');
        expect(candidate.evidence.out_of_sample_samples).toBe(0);
        expect(candidate.rule.decision_policy.id).toBe('rolling-position-v23');
        expect(candidate.evidence.shadow_days).toBe(0);
        expect(report.promotion.evidence_source).toBe('frozen_policy_forward_shadow');
        const review = await readFile(report.saved.review, 'utf8');
        expect(review).toContain('## 抄底确认漏斗');
        expect(review).toContain('不为补齐场景样本强行抄底');
        const expanded = await runRollingBacktest(market, {
            asOf: '2026-06-30T15:00:00+08:00',
            days: 60,
            limit: 20,
            horizon: 3,
            minimumTradingDays: 5,
            evidenceTag: 'expanded-2x',
            researchOnly: true,
            codes,
        });
        expect(expanded).toMatchObject({
            research_only: true,
            evidence_tag: 'expanded-2x',
            window_days: 60,
            universe: { coverage_tier: 'expanded_partial_history' },
            promotion: { ready: false, evidence_source: 'expanded_research_not_for_promotion' },
        });
        expect(expanded.decision_policy.id).toBe('rolling-position-v23-expanded-2x');
        expect(expanded.saved.report).toContain('rolling-backtest-expanded-2x-2026-06-30.json');
        const expandedCandidate = JSON.parse(await readFile(expanded.saved.candidate, 'utf8'));
        expect(expandedCandidate.validation_status).toBe('research_only');
    });
});
