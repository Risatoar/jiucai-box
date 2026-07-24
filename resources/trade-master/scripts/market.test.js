import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MarketService } from './dist/market.js';

const previousHome = process.env.TRADE_MASTER_HOME;

afterEach(() => {
    if (previousHome == null)
        delete process.env.TRADE_MASTER_HOME;
    else
        process.env.TRADE_MASTER_HOME = previousHome;
});

describe('MarketService universe fallback', () => {
    it('uses the next full-market provider when the first one fails', async () => {
        process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'market-fallback-'));
        const item = { instrument: { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH' }, price: 4.8 };
        const market = new MarketService([
            { id: 'primary', listUniverse: async () => { throw new Error('socket closed'); } },
            { id: 'fallback', listUniverse: async () => [item] }
        ], { cache: { retention_days: 1, max_entries: 20, max_bytes: 1024 * 1024 } });
        await expect(market.universe('etf')).resolves.toMatchObject({ source: 'fallback', items: [item], errors: ['primary: socket closed'] });
    });

    it('uses Tencent first for a fast single-source quote', async () => {
        process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'market-quick-quote-'));
        const market = new MarketService([
            { id: 'slow', getQuote: async () => { throw new Error('should not run') } },
            { id: 'tencent', getQuote: async () => ({ price: 4.8, source: 'tencent' }) }
        ], { cache: { retention_days: 1, max_entries: 20, max_bytes: 1024 * 1024 } });
        await expect(market.quickQuote('510300')).resolves.toMatchObject({ source: 'tencent', quote: { price: 4.8 } });
    });

    it('loads many quotes with bounded concurrency', async () => {
        process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'market-many-quotes-'));
        let active = 0;
        let peak = 0;
        const market = new MarketService([{
            id: 'quotes',
            getQuote: async (code) => {
                active += 1;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active -= 1;
                return { instrument: { code }, price: Number(code) };
            }
        }], { cache: { retention_days: 1, max_entries: 20, max_bytes: 1024 * 1024 } });
        const result = await market.quotesMany(['1', '2', '3', '4'], 2);
        expect(result.quotes).toHaveLength(4);
        expect(peak).toBe(2);
    });

    it('reuses one live cache key when only the exact as-of timestamp changes', async () => {
        process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'market-live-cache-'));
        let calls = 0;
        const market = new MarketService([{
            id: 'bars',
            getBars: async () => {
                calls += 1;
                return [{ time: '2026-07-23', close: 4.8 }];
            }
        }], { cache: { retention_days: 1, max_entries: 20, max_bytes: 1024 * 1024 } });
        const now = new Date();
        await market.bars('510300', '1d', 40, { end: now.toISOString(), asOf: now.toISOString() });
        const later = new Date(now.getTime() + 30_000).toISOString();
        await market.bars('510300', '1d', 40, { end: later, asOf: later });
        expect(calls).toBe(1);
    });

    it('keeps exact historical as-of requests isolated for replay compatibility', async () => {
        process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'market-history-cache-'));
        let calls = 0;
        const market = new MarketService([{
            id: 'bars',
            getBars: async () => {
                calls += 1;
                return [{ time: '2025-01-01', close: calls }];
            }
        }], { cache: { retention_days: 1, max_entries: 20, max_bytes: 1024 * 1024 } });
        await market.bars('510300', '1d', 40, { asOf: '2025-01-01T10:00:00+08:00' });
        await market.bars('510300', '1d', 40, { asOf: '2025-01-02T10:00:00+08:00' });
        expect(calls).toBe(2);
    });

    it('continues to another provider when intraday history coverage is too short', async () => {
        process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'market-coverage-fallback-'));
        const bars = (days) => Array.from({ length: days }, (_, index) => ({
            time: `2026-07-${String(index + 1).padStart(2, '0')} 09:30`,
            close: 10 + index,
            period: '5m',
            closed: true,
        }));
        const market = new MarketService([
            { id: 'tencent', getBars: async () => bars(7) },
            { id: 'eastmoney', getBars: async () => bars(20) },
        ], { cache: { retention_days: 1, max_entries: 20, max_bytes: 1024 * 1024 } });
        await expect(market.bars('300438', '5m', 1800, {
            start: '2026-06-23',
            end: '2026-07-23',
            asOf: '2026-07-23T15:00:00+08:00',
            minimumTradingDays: 15,
        })).resolves.toMatchObject({
            source: 'eastmoney',
            trading_days: 20,
            errors: ['tencent: 仅7个交易日，低于15日门槛'],
        });
    });

    it('aggregates weekly and monthly sectors from period bars instead of the live daily snapshot', async () => {
        process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'market-sector-period-'));
        const market = new MarketService([{
            id: 'period-market',
            listSectorSnapshot: async () => ({
                scope: 'all_a_share_stocks',
                source: 'fixture',
                stock_total: 4,
                classified_stock_total: 4,
                coverage_percent: 100,
                sectors: [
                    {
                        name: '电力设备',
                        stock_count: 2,
                        period_candidates: [
                            { code: '600001', name: '电力一号' },
                            { code: '600002', name: '电力二号' },
                        ],
                    },
                    {
                        name: '银行',
                        stock_count: 2,
                        period_candidates: [
                            { code: '600003', name: '银行一号' },
                            { code: '600004', name: '银行二号' },
                        ],
                    },
                ],
            }),
            getBars: async (code) => {
                const strong = code === '600001' || code === '600002';
                return [
                    { time: '2026-07-20', open: 10, close: strong ? 10.5 : 9.9, amount: 100 },
                    { time: '2026-07-23', open: strong ? 10.5 : 9.9, close: strong ? 12 : 9, amount: 120 },
                ];
            },
        }], { cache: { retention_days: 1, max_entries: 100, max_bytes: 1024 * 1024 } });
        const result = await market.sectorPeriod('2026-07-20', '2026-07-23');
        expect(result.sectors[0]).toMatchObject({
            name: '电力设备',
            sample_stock_count: 2,
            change_percent: 20,
        });
        expect(result.sectors[1].name).toBe('银行');
        expect(result.period_breadth).toMatchObject({ total: 4, rising: 2, falling: 2 });
        expect(result.source).toBe('full_market_sw1_period_sample');
    });
});
