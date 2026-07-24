import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateAndPromote, validateLatestCandidate } from './dist/refinement.js';
import { loadActiveDecisionPolicy } from './dist/strategy-policy.js';

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

async function setup() {
    temporaryHome = await mkdtemp(join(tmpdir(), 'refinement-confidence-'));
    process.env.TRADE_MASTER_HOME = temporaryHome;
    await Promise.all([
        mkdir(join(temporaryHome, 'strategies', 'candidates'), { recursive: true }),
        mkdir(join(temporaryHome, 'strategies', 'versions'), { recursive: true }),
    ]);
    await writeFile(join(temporaryHome, 'config.json'), JSON.stringify({
        refinement: {
            minimum_history_samples: 30,
            minimum_out_of_sample_samples: 10,
            minimum_out_of_sample_accuracy: 80,
            minimum_confidence_lower_bound: 80,
            minimum_scenario_coverage: 7,
            minimum_shadow_days: 5,
            maximum_drawdown_delta: 0.005,
            minimum_profit_factor: 1.05,
            maximum_live_win_rate_drop: 0.1,
        },
    }));
    await writeFile(join(temporaryHome, 'strategies', 'active.json'), JSON.stringify({ version: 'v1', rules: [] }));
}

describe('strategy refinement confidence gates', () => {
    it('does not promote a strategy below 80% out-of-sample accuracy', async () => {
        await setup();
        const result = validateAndPromote({
            id: 'below-target',
            description: '测试候选',
            rule: {},
            evidence: {
                history_samples: 100,
                out_of_sample_samples: 30,
                out_of_sample_accuracy: 79.9,
                confidence_lower_bound: 90,
                scenario_coverage: 7,
                weak_scenario_count: 0,
                shadow_days: 10,
                drawdown_delta: 0,
                profit_factor: 1.5,
                conflicts: 0,
            },
        });
        expect(result.promoted).toBe(false);
        expect(result.checks.find((item) => item.name === 'out_of_sample_accuracy')).toMatchObject({ passed: false, actual: 79.9 });
    });

    it('treats missing drawdown and profit factor as failed evidence', async () => {
        await setup();
        const result = validateAndPromote({
            id: 'missing-risk-evidence',
            description: '测试候选',
            rule: {},
            evidence: {
                history_samples: 100,
                out_of_sample_samples: 30,
                out_of_sample_accuracy: 90,
                confidence_lower_bound: 85,
                scenario_coverage: 7,
                weak_scenario_count: 0,
                shadow_days: 10,
                drawdown_delta: null,
                profit_factor: null,
                conflicts: 0,
            },
        });
        expect(result.promoted).toBe(false);
        expect(result.checks.find((item) => item.name === 'drawdown_delta')?.passed).toBe(false);
        expect(result.checks.find((item) => item.name === 'profit_factor')?.passed).toBe(false);
    });

    it('does not promote when the 95% confidence lower bound is below 80%', async () => {
        await setup();
        const result = validateAndPromote({
            id: 'weak-confidence-bound',
            description: '测试候选',
            rule: {},
            evidence: {
                history_samples: 100,
                out_of_sample_samples: 30,
                out_of_sample_accuracy: 90,
                confidence_lower_bound: 79.9,
                scenario_coverage: 7,
                weak_scenario_count: 0,
                shadow_days: 10,
                drawdown_delta: 0,
                profit_factor: 1.5,
                conflicts: 0,
            },
        });
        expect(result.promoted).toBe(false);
        expect(result.checks.find((item) => item.name === 'confidence_lower_bound')).toMatchObject({ passed: false, actual: 79.9 });
    });

    it('does not promote while any out-of-sample scenario remains weak', async () => {
        await setup();
        const result = validateAndPromote({
            id: 'weak-scenario',
            description: '测试候选',
            rule: {},
            evidence: {
                history_samples: 100,
                out_of_sample_samples: 50,
                out_of_sample_accuracy: 90,
                confidence_lower_bound: 82,
                scenario_coverage: 7,
                weak_scenario_count: 1,
                shadow_days: 10,
                drawdown_delta: 0,
                profit_factor: 1.5,
                conflicts: 0,
            },
        });
        expect(result.promoted).toBe(false);
        expect(result.checks.find((item) => item.name === 'weak_scenario_count')).toMatchObject({ passed: false, actual: 1 });
    });

    it('makes a promoted decision policy visible to the live strategy loader', async () => {
        await setup();
        const decisionPolicy = { id: 'validated-v2', support_break_min_periods: 2 };
        const result = validateAndPromote({
            id: 'validated-policy',
            description: '通过全部证据门槛的测试候选',
            rule: { decision_policy: decisionPolicy },
            evidence: {
                history_samples: 100,
                out_of_sample_samples: 100,
                out_of_sample_accuracy: 90,
                confidence_lower_bound: 82,
                scenario_coverage: 7,
                weak_scenario_count: 0,
                shadow_days: 10,
                drawdown_delta: 0,
                profit_factor: 1.5,
                conflicts: 0,
            },
        });
        expect(result.promoted).toBe(true);
        expect(loadActiveDecisionPolicy()).toMatchObject(decisionPolicy);
    });

    it('validates the latest rolling candidate without bypassing evidence gates', async () => {
        await setup();
        await writeFile(join(temporaryHome, 'strategies', 'candidates', 'rolling-backtest-2026-07-23.json'), JSON.stringify({
            id: 'rolling-backtest-2026-07-23',
            description: '未来影子样本不足',
            rule: {},
            evidence: {
                history_samples: 32,
                out_of_sample_samples: 2,
                out_of_sample_accuracy: 100,
                confidence_lower_bound: 34.24,
                scenario_coverage: 0,
                weak_scenario_count: 7,
                shadow_days: 0,
                drawdown_delta: null,
                profit_factor: null,
                conflicts: 0,
            },
        }));
        const result = validateLatestCandidate();
        expect(result).toMatchObject({
            status: 'candidate',
            promoted: false,
            source_candidate: join(temporaryHome, 'strategies', 'candidates', 'rolling-backtest-2026-07-23.json'),
        });
    });

    it('accepts a no-loss profit factor only when explicit losing sample evidence is present', async () => {
        await setup();
        const result = validateAndPromote({
            id: 'no-loss-policy',
            description: '无亏损影子样本',
            rule: {},
            evidence: {
                history_samples: 100,
                out_of_sample_samples: 20,
                out_of_sample_accuracy: 100,
                confidence_lower_bound: 83.88,
                scenario_coverage: 7,
                weak_scenario_count: 0,
                shadow_days: 10,
                drawdown_delta: 0,
                profit_factor: null,
                losing_samples: 0,
                conflicts: 0,
            },
        });
        expect(result.checks.find((item) => item.name === 'profit_factor')).toMatchObject({ passed: true, actual: 'no_losses' });
        expect(result.promoted).toBe(true);
    });
});
