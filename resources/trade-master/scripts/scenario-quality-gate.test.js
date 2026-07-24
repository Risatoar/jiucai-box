import { describe, expect, it } from 'vitest';
import { evaluateScenarioQualityGuard } from './dist/scenario-quality-gate.js';

const metric = (samples, correct) => ({
    samples,
    correct,
    accuracy_pct: samples ? correct / samples * 100 : null,
});

const library = (overrides = {}) => ({
    independent: {
        action_metrics: {
            full_exit: metric(10, 7),
            range_high: metric(20, 17),
            trend_take_profit: metric(10, 7),
            ...overrides,
        },
        position_cycle_ledger: {
            t_pairs: Array.from({ length: 10 }, (_, index) => ({ correct: index < 7 })),
        },
    },
    bottom_fishing_abstentions: {
        samples: 10,
        correct_abstentions: 8,
        accuracy_pct: 80,
    },
});

const guard = {
    minimum_cases_per_type: 10,
    target_accuracy_pct: 70,
    protected_max_degradation_pct: 5,
    optimize: ['full_exit', 't_trade'],
    protected: {
        range_high: 86.76,
        trend_take_profit: 73.33,
        bottom_fishing_abstention: 80,
    },
};

describe('scenario quality guard', () => {
    it('requires weak scenarios to reach 70% while preserving strong scenarios', () => {
        const result = evaluateScenarioQualityGuard(library(), guard);
        expect(result.ready).toBe(true);
        expect(result.checks.find((item) => item.name === 'range_high')).toMatchObject({
            role: 'protect',
            minimum_accuracy_pct: 81.76,
            pass: true,
        });
    });

    it('vetoes a candidate when a protected scenario degrades too much', () => {
        const result = evaluateScenarioQualityGuard(library({ range_high: metric(20, 15) }), guard);
        expect(result.ready).toBe(false);
        expect(result.failures).toEqual([
            expect.objectContaining({ name: 'range_high', role: 'protect', accuracy_pct: 75 }),
        ]);
    });
});
