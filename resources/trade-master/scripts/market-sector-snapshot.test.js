import { describe, expect, it } from 'vitest';
import { buildMarketSectorSnapshot } from './dist/market-sector-snapshot.js';

const stock = (code, name, industry, changeRatio, amount, turnoverRatio = 0.03) => ({
    instrument: { code, name, type: 'stock' },
    industry,
    price: 10,
    changeRatio,
    amount,
    turnoverRatio,
});

describe('full-market sector snapshot', () => {
    it('groups the full stock universe by industry and only exposes individual stocks as leaders', () => {
        const snapshot = buildMarketSectorSnapshot([
            { type: 'stock', items: [
                stock('600001', '芯片一号', '半导体', 0.08, 2_000_000_000, 0.1),
                stock('600002', '芯片二号', '半导体', 0.03, 1_000_000_000),
                stock('600003', '创新药一号', '医药制造', 0.01, 800_000_000),
            ] },
            { type: 'etf', items: [
                { instrument: { code: '512480', name: '半导体ETF', type: 'etf' }, changeRatio: 0.05, amount: 9_000_000_000 },
            ] },
        ], '2026-07-23T07:00:00.000Z');
        expect(snapshot).toMatchObject({
            scope: 'all_a_share_stocks',
            stock_total: 3,
            classified_stock_total: 3,
            coverage_percent: 100,
        });
        expect(snapshot.sectors[0].name).toBe('半导体');
        expect(snapshot.sectors[0].leaders.map((item) => item.code)).toEqual(['600001', '600002']);
        expect(snapshot.sectors[0].period_candidates.map((item) => item.code)).toEqual(['600001', '600002']);
        expect(snapshot.sectors[0].member_codes).toEqual(['600001', '600002']);
        expect(snapshot.sectors.flatMap((item) => item.leaders).every((item) => item.type === 'stock')).toBe(true);
        expect(snapshot.sectors.flatMap((item) => item.leaders).some((item) => item.code === '512480')).toBe(false);
    });

    it('keeps removed or watched stocks in the market ranking because the input is the full universe', () => {
        const snapshot = buildMarketSectorSnapshot([{ type: 'stock', items: [
            stock('600010', '全市场龙头', '证券', 0.1, 3_000_000_000),
            stock('600011', '全市场次强', '证券', 0.04, 1_000_000_000),
        ] }]);
        expect(snapshot.sectors[0].leaders[0].code).toBe('600010');
    });

    it('keeps all industries so period reports can rank the full market instead of today top 12 only', () => {
        const items = Array.from({ length: 15 }, (_, index) =>
            stock(String(600100 + index), `行业股票${index}`, `行业${index}`, index / 1000, 1_000_000_000 - index)
        );
        const snapshot = buildMarketSectorSnapshot([{ type: 'stock', items }]);
        expect(snapshot.sectors).toHaveLength(15);
    });
});
