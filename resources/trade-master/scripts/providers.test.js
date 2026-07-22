import { describe, expect, it } from 'vitest';
import { createProviders, normalizeSinaBar, normalizeSinaUniverseRow } from './dist/providers.js';

describe('SinaUniverseProvider normalization', () => {
    it('normalizes stock, ETF and convertible-bond universe rows', () => {
        const row = { code: '510300', name: '沪深300ETF', trade: '4.787', changepercent: '2.95', settlement: '4.650', open: '4.677', high: '4.789', low: '4.617', volume: '27388321', amount: '12894642144', turnoverratio: '11.21' };
        const normalized = normalizeSinaUniverseRow(row, 'etf', '2026-07-21T08:00:00.000Z');
        expect(normalized).toMatchObject({
            instrument: { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH' },
            price: 4.787,
            amount: 12894642144,
            source: 'sina'
        });
        expect(normalized.changeRatio).toBeCloseTo(0.0295);
    });

    it('rejects rows without a valid six-digit code or price', () => {
        expect(normalizeSinaUniverseRow({ code: 'bad', name: '坏数据', trade: '4.2' }, 'stock')).toBeNull();
        expect(normalizeSinaUniverseRow({ code: '600000', name: '停牌数据', trade: '0' }, 'stock')).toBeNull();
    });

    it('enables the Sina and Tencent fallbacks for existing provider configs', () => {
        const providers = createProviders({ priority: ['eastmoney', 'tencent'], request_timeout_ms: 8000, eastmoney: { enabled: true }, tencent: { enabled: true }, tushare: { enabled: false } });
        expect(providers.map((item) => item.id)).toEqual(['sina', 'tencent', 'eastmoney']);
    });

    it('normalizes a closed Sina convertible-bond bar', () => {
        const bar = normalizeSinaBar({ day: '2026-07-21 14:55:00', open: '166.003', high: '166.020', low: '164.918', close: '165.900', volume: '83200', amount: '13753449.7356' }, '5m', new Date('2026-07-21T15:01:00+08:00'));
        expect(bar).toMatchObject({ time: '2026-07-21 14:55:00', close: 165.9, amount: 13753449.7356, closed: true, source: 'sina' });
    });
});
