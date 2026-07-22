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
});
