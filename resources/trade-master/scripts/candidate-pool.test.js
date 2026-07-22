import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { monitorCandidatePool, refreshCandidatePool } from './dist/candidate-pool.js';

const previousHome = process.env.TRADE_MASTER_HOME;
afterEach(() => {
    if (previousHome == null)
        delete process.env.TRADE_MASTER_HOME;
    else
        process.env.TRADE_MASTER_HOME = previousHome;
});

const universeItem = (type, code, name, changeRatio = 0.02) => ({
    instrument: { type, code, name, exchange: 'SH' },
    price: type === 'cbond' ? 118 : 10,
    changeRatio,
    volume: 1_000_000,
    amount: 200_000_000,
    amplitudeRatio: 0.035,
    turnoverRatio: 0.04,
    high: type === 'cbond' ? 120 : 10.3,
    low: type === 'cbond' ? 115 : 9.7,
    source: 'fixture',
});

const dailyBars = (step = 0.06) => Array.from({ length: 40 }, (_, index) => {
    const close = 10 + index * step;
    return { open: close - 0.03, close, high: close + 0.08, low: close - 0.08, volume: 1000 + index * 10, closed: true };
});

const barsByPeriod = async (_code, period) => ({
    source: 'fixture',
    bars: period === '1d' ? dailyBars() : [{ open: 10, close: 10.2, volume: 120, closed: true }],
});

describe('candidate pool runtime', () => {
    it('writes a cross-market pool and monitors closed 5/15 minute evidence', async () => {
        const home = await mkdtemp(join(tmpdir(), 'candidate-pool-'));
        process.env.TRADE_MASTER_HOME = home;
        await mkdir(home, { recursive: true });
        await writeFile(join(home, 'portfolio.json'), JSON.stringify({ as_of: '2026-07-21', positions: [] }));
        await writeFile(join(home, 'watchlist.json'), JSON.stringify({ instruments: [{ code: '510300' }] }));
        await writeFile(join(home, 'discipline.json'), JSON.stringify({ state: 'NORMAL' }));
        await writeFile(join(home, 'goals.json'), JSON.stringify({ status: 'active', current_asset: 10000, target_asset: 15000, target_date: '2027-07-21', max_drawdown: 0.05, constraints: { max_gross_exposure_ratio: 1, max_positions: 3 } }));
        const market = {
            universe: async (type) => ({ source: 'fixture', items: type === 'stock'
                ? [universeItem(type, '600000', '浦发银行')]
                : type === 'etf'
                    ? [universeItem(type, '510300', '沪深300ETF')]
                    : [universeItem(type, '113001', '测试转债')] }),
            evidence: async (code) => ({
                quotes: [{ instrument: { code }, price: 10.2, changeRatio: 0.02, high: 10.5 }],
                bars: [
                    { open: 10, close: 10.05, volume: 100, closed: true },
                    { open: 10.05, close: 10.2, volume: 130, closed: true },
                ],
                market_state: { verified: true, latest_exchange_time: '2026-07-21T10:15:00+08:00' },
            }),
            bars: barsByPeriod,
        };
        const pool = await refreshCandidatePool(market, '2026-07-21T10:15:00+08:00');
        expect(pool.candidates.map((item) => item.type).sort()).toEqual(['cbond', 'etf', 'stock']);
        expect(pool.goal_profile).toMatchObject({ active: true, target_return_percent: 50, max_drawdown_percent: 5 });
        expect(pool.candidates.every((item) => item.component_scores.goal_alignment_eligible)).toBe(true);
        expect(pool.watchlist_sync).toMatchObject({ active: 3 });
        expect(JSON.parse(await readFile(join(home, 'runtime/candidate-pool.json'), 'utf8')).candidates).toHaveLength(3);
        expect(JSON.parse(await readFile(join(home, 'watchlist.json'), 'utf8')).instruments.filter((item) => item.source === 'agent' && item.status === 'active')).toHaveLength(3);
        const monitored = await monitorCandidatePool(market, 12);
        expect(monitored.candidates.every((item) => item.status === 'buy_ready')).toBe(true);
        expect(monitored.candidates.every((item) => item.technical_evidence?.daily)).toBe(true);
        expect(monitored.entry_gate).toBe('manual_confirmation_required');
    });

    it('preserves the last pool when all universe sources fail', async () => {
        const home = await mkdtemp(join(tmpdir(), 'candidate-pool-fallback-'));
        process.env.TRADE_MASTER_HOME = home;
        await mkdir(join(home, 'runtime'), { recursive: true });
        await writeFile(join(home, 'runtime/candidate-pool.json'), JSON.stringify({ candidates: [{ rank: 1, instrument: { code: '510300' } }] }));
        const failed = await refreshCandidatePool({ universe: async () => { throw new Error('network unavailable'); } });
        expect(failed).toMatchObject({ refresh_status: 'failed', stale_pool_preserved: true, candidates: [{ instrument: { code: '510300' } }] });
    });

    it('returns five model-ranked watch candidates without claiming unverified confidence', async () => {
        const home = await mkdtemp(join(tmpdir(), 'candidate-pool-limit-'));
        process.env.TRADE_MASTER_HOME = home;
        await writeFile(join(home, 'portfolio.json'), JSON.stringify({ positions: [] }));
        const market = {
            universe: async (type) => ({ source: 'fixture', items: Array.from({ length: 6 }, (_, index) => universeItem(type, `${type === 'stock' ? '600' : type === 'etf' ? '510' : '113'}${String(index).padStart(3, '0')}`, `${type === 'stock' ? '股票' : type === 'etf' ? '基金' : '转债'}候选${index}`, type === 'etf' && index === 0 ? 0.1 : 0.02)) }),
            evidence: async (code) => ({ quotes: [{ instrument: { code }, price: 10.2, changeRatio: 0.02, high: 10.5 }], bars: [{ open: 10, close: 10.05, volume: 100, closed: true }, { open: 10.05, close: 10.2, volume: 130, closed: true }], market_state: { verified: true, latest_exchange_time: '2026-07-21T10:15:00+08:00' } }),
            bars: barsByPeriod,
        };
        const pool = await refreshCandidatePool(market);
        expect(pool.candidates).toHaveLength(5);
        expect(pool.candidates.every((item) => ['watching', 'buy_ready'].includes(item.status))).toBe(true);
        expect(pool.candidates.every((item) => item.confidence === 'unvalidated')).toBe(true);
        expect(pool.buy_ready_candidates).toEqual(pool.candidates.filter((item) => item.status === 'buy_ready'));
        expect(pool.model).toMatchObject({ model_version: 'candidate-model-v2.1.0', validation_status: 'shadow_observation', high_confidence_label_allowed: false });
        expect(pool.selection_policy.mode).toBe('candidate_model_v2');
        expect(pool.prediction_record).toContain('runtime/candidate-model/predictions/');
    });

    it('does not let short-term attention signals re-promote a model-rejected low-opportunity bond', async () => {
        const home = await mkdtemp(join(tmpdir(), 'candidate-pool-monitor-gate-'));
        process.env.TRADE_MASTER_HOME = home;
        await mkdir(join(home, 'runtime'), { recursive: true });
        await writeFile(join(home, 'discipline.json'), JSON.stringify({ state: 'NORMAL' }));
        await writeFile(join(home, 'runtime/candidate-pool.json'), JSON.stringify({
            generated_at: '2026-07-22T03:15:27.327Z',
            market_regime: { state: 'defensive' },
            candidates: [{
                type: 'cbond', instrument: { code: '123154', name: '火星转债', exchange: 'SZ' }, price: 127,
                screening_score: 77.85, amplitude_percent: 0.95, session_low: 126.01,
            }],
        }));
        const lowOpportunityBars = Array.from({ length: 40 }, (_, index) => {
            const close = 121 + index * 0.1;
            return { open: close - 0.03, close, high: close + 0.1, low: close - 0.1, volume: 1000 + index * 10, closed: true };
        });
        const market = {
            evidence: async () => ({
                quotes: [{ price: 127, changeRatio: 0.017, high: 127.2 }],
                bars: [{ open: 126.5, close: 126.7, volume: 100, closed: true }, { open: 126.7, close: 127, volume: 130, closed: true }],
                market_state: { verified: true, latest_exchange_time: '2026-07-22T03:15:15.000Z' },
            }),
            bars: async (_code, period) => ({ source: 'fixture', bars: period === '1d' ? lowOpportunityBars : [{ open: 126.6, close: 127, volume: 120, closed: true }] }),
        };
        const monitored = await monitorCandidatePool(market, 5);
        expect(monitored.candidates).toHaveLength(0);
        expect(monitored.rejected[0]).toMatchObject({ code: '123154', status: 'model_rejected', conclusion: expect.stringContaining('成本效率') });
    });

    it('builds a fast AI-review shortlist and migrates a legacy grouped pool', async () => {
        const home = await mkdtemp(join(tmpdir(), 'candidate-pool-screening-'));
        process.env.TRADE_MASTER_HOME = home;
        await mkdir(join(home, 'runtime'), { recursive: true });
        await writeFile(join(home, 'portfolio.json'), JSON.stringify({ positions: [] }));
        await writeFile(join(home, 'watchlist.json'), JSON.stringify({ instruments: [{ code: '510000', name: '已有ETF', type: 'etf', exchange: 'SH', source: 'agent', status: 'active' }] }));
        await writeFile(join(home, 'runtime/candidate-pool.json'), JSON.stringify({ candidates: { etf: { main: [{ code: '510000', rank: 1 }], reserve: [] } } }));
        const market = {
            universe: async (type) => ({ source: 'fixture', items: Array.from({ length: 6 }, (_, index) => universeItem(type, `${type === 'stock' ? '600' : type === 'etf' ? '510' : '113'}${String(index).padStart(3, '0')}`, `${type === 'stock' ? '股票' : type === 'etf' ? '基金' : '转债'}候选${index}`)) }),
            evidence: async () => { throw new Error('screening mode must not load K lines'); },
        };
        const pool = await refreshCandidatePool(market, undefined, { screeningOnly: true, maxCandidates: 20, syncWatchlist: false });
        expect(pool.candidates).toHaveLength(18);
        expect(pool.candidates).toContainEqual(expect.objectContaining({ instrument: expect.objectContaining({ code: '510000' }), status: 'screened_for_ai' }));
        expect(pool.reevaluation).toEqual({ requested: 1, reviewed: 1 });
        expect(pool.selection_policy.mode).toBe('asset_specific_ai_review_shortlist');
        expect(pool.watchlist_sync).toBeNull();
    });

    it('fails safely instead of returning success or syncing when fewer than five candidates survive screening', async () => {
        const home = await mkdtemp(join(tmpdir(), 'candidate-pool-insufficient-'));
        process.env.TRADE_MASTER_HOME = home;
        await mkdir(join(home, 'runtime'), { recursive: true });
        await writeFile(join(home, 'portfolio.json'), JSON.stringify({ positions: [] }));
        await writeFile(join(home, 'watchlist.json'), JSON.stringify({ instruments: [{ code: '510300', source: 'agent', status: 'active' }] }));
        await writeFile(join(home, 'runtime/candidate-pool.json'), JSON.stringify({ candidates: [{ rank: 1, instrument: { code: '510300' } }] }));
        const market = { universe: async (type) => ({ source: 'fixture', items: type === 'etf' ? [universeItem(type, '510300', '沪深300ETF')] : [] }) };
        const pool = await refreshCandidatePool(market, undefined, { screeningOnly: true, maxCandidates: 20, syncWatchlist: false });
        expect(pool).toMatchObject({ refresh_status: 'failed', stale_pool_preserved: true, candidates: [{ instrument: { code: '510300' } }] });
        const watchlist = JSON.parse(await readFile(join(home, 'watchlist.json'), 'utf8'));
        expect(watchlist.instruments[0]).toMatchObject({ code: '510300', status: 'active' });
    });
});
