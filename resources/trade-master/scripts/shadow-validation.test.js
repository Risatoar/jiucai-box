import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { updateShadowValidation } from './dist/shadow-validation.js';

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

const record = (date, directionalReturn, code = '600000') => ({
    code,
    date,
    time: `${date} 14:55:00`,
    side: 'buy',
    strategy: 'range_low_reversal',
    scenario: 'range_high_low',
    action_fraction: 0.5,
    outcomes: [{ horizon: 3, status: 'completed', directional_return_pct: directionalReturn }],
});

const caseRecord = (date, scene, side, price, code = '600000') => ({
    ...record(date, side === 'sell' ? 2 : 1, code),
    time: `${date} 14:50:00`,
    side,
    price,
    case_scene: scene,
    simulation_track: side === 'sell' ? 'scenario_full_position' : 'scenario_flat_entry',
    trading_index: date.endsWith('24') ? 1 : 2,
});

describe('frozen policy forward shadow validation', () => {
    it('counts each future trading date once and resets when the policy changes', async () => {
        temporaryHome = await mkdtemp(join(tmpdir(), 'shadow-validation-'));
        process.env.TRADE_MASTER_HOME = temporaryHome;
        const first = updateShadowValidation({
            policy: { id: 'candidate-v1', threshold: 1 },
            asOf: '2026-07-23T15:35:00+08:00',
            records: [],
            baselineRecords: [],
            horizon: 3,
            eligible: true,
        });
        expect(first).toMatchObject({ seed_date: '2026-07-23', shadow_days: 0 });
        const second = updateShadowValidation({
            policy: { id: 'candidate-v1', threshold: 1 },
            asOf: '2026-07-24T15:35:00+08:00',
            records: [record('2026-07-24', 2)],
            baselineRecords: [record('2026-07-24', -1)],
            caseRecords: [caseRecord('2026-07-24', 'range_high', 'sell', 11)],
            horizon: 3,
            eligible: true,
        });
        expect(second.shadow_days).toBe(1);
        expect(second.forward_metrics).toMatchObject({ samples: 1, correct: 1, accuracy_pct: 100 });
        expect(second.forward_case_library.independent.high_low_cycle_ledger).toMatchObject({
            sell_legs: 1,
            buy_legs: 0,
            open_sell_legs: 1,
        });
        const third = updateShadowValidation({
            policy: { id: 'candidate-v1', threshold: 1 },
            asOf: '2026-07-27T15:35:00+08:00',
            records: [record('2026-07-27', 3, '600001')],
            baselineRecords: [record('2026-07-27', -2, '600001')],
            caseRecords: [caseRecord('2026-07-27', 'range_low', 'buy', 10)],
            horizon: 3,
            eligible: true,
        });
        expect(third.shadow_days).toBe(2);
        expect(third.forward_records).toHaveLength(2);
        expect(third.forward_metrics).toMatchObject({ samples: 2, correct: 2, accuracy_pct: 100 });
        expect(third.forward_case_records).toHaveLength(2);
        expect(third.forward_case_library.independent.high_low_pairs).toHaveLength(1);
        expect(third.forward_case_library.independent.high_low_cycle_ledger).toMatchObject({
            sell_legs: 1,
            buy_legs: 1,
            open_sell_legs: 0,
            unmatched_buy_legs: 0,
        });
        const repeated = updateShadowValidation({
            policy: { id: 'candidate-v1', threshold: 1 },
            asOf: '2026-07-27T16:00:00+08:00',
            records: [record('2026-07-27', 4, '600001')],
            baselineRecords: [record('2026-07-27', -2, '600001')],
            horizon: 3,
            eligible: true,
        });
        expect(repeated.shadow_days).toBe(2);
        expect(repeated.forward_records).toHaveLength(2);
        expect(repeated.forward_records.find((item) => item.code === '600001').outcomes[0].directional_return_pct).toBe(4);
        const providerRegression = updateShadowValidation({
            policy: { id: 'candidate-v1', threshold: 1 },
            asOf: '2026-07-27T16:05:00+08:00',
            records: [{ ...record('2026-07-27', 0, '600001'), outcomes: [{ horizon: 3, status: 'pending' }] }],
            baselineRecords: [],
            horizon: 3,
            eligible: true,
        });
        expect(providerRegression.forward_records.find((item) => item.code === '600001').outcomes[0]).toMatchObject({
            status: 'completed',
            directional_return_pct: 4,
        });
        const reset = updateShadowValidation({
            policy: { id: 'candidate-v2', threshold: 2 },
            asOf: '2026-07-25T15:35:00+08:00',
            records: [],
            baselineRecords: [],
            horizon: 3,
            eligible: true,
        });
        expect(reset).toMatchObject({ seed_date: '2026-07-25', shadow_days: 0 });
    });
});
