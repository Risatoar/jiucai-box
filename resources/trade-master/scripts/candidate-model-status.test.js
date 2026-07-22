import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { candidateModelStatus, evaluatePendingPredictions, recordCandidatePrediction } from './dist/candidate-model-status.js';

const previousHome = process.env.TRADE_MASTER_HOME;
afterEach(() => {
    if (previousHome == null)
        delete process.env.TRADE_MASTER_HOME;
    else
        process.env.TRADE_MASTER_HOME = previousHome;
});

describe('candidate model shadow evaluation', () => {
    it('deduplicates frequent snapshots and evaluates five-day after-cost outcomes', async () => {
        const home = await mkdtemp(join(tmpdir(), 'candidate-model-status-'));
        process.env.TRADE_MASTER_HOME = home;
        await mkdir(home, { recursive: true });
        const pool = {
            generated_at: '2026-07-01T02:00:00.000Z',
            market_regime: { state: 'mixed' },
            model: { validation_status: 'shadow_observation' },
            candidates: [{ rank: 1, type: 'etf', instrument: { code: '510300', name: '沪深300ETF' }, price: 10, ranking_score: 80, status: 'buy_ready', validation: { data_as_of: '2026-07-01T02:00:00.000Z' } }],
        };
        const first = recordCandidatePrediction(pool);
        const duplicate = recordCandidatePrediction({ ...pool, generated_at: '2026-07-01T02:15:00.000Z' });
        expect(duplicate).toBe(first);
        const market = {
            bars: async () => ({
                source: 'fixture',
                bars: [10.1, 10.2, 10.3, 10.4, 10.5, 10.6].map((close, index) => ({ time: `2026-07-0${index + 1}`, close, low: close - 0.2, closed: true })),
            }),
        };
        const result = await evaluatePendingPredictions(market, '2026-07-08T07:00:00.000Z');
        expect(result).toMatchObject({ checked: 1, completed: 1, metrics: { out_of_sample_samples: 1, shadow_samples: 1 } });
        expect(result.metrics.win_rate_after_costs).toBe(1);
        const stored = JSON.parse(await readFile(first, 'utf8'));
        expect(stored.candidates[0].outcome).toMatchObject({ status: 'completed', gross_returns: { '5d': 0.05 }, return_5d_after_costs: 0.048 });
        expect(candidateModelStatus()).toMatchObject({ validation_status: 'shadow_observation', high_confidence_label_allowed: false });
    });
});
