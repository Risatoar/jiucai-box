import { describe, expect, it } from 'vitest';
import { collectLastSellContexts, collectLastSellPrices, collectPlanTargets, mapWithConcurrency } from './dist/daily-plan.js';

describe('daily plan account targets', () => {
    it('把家庭持仓作为真实持仓分析，不再降级成无持仓自选', () => {
        const portfolio = { positions: [] };
        const household = {
            members: [{ id: 'spouse', name: '老婆', monitoringEnabled: true }],
            accounts: [{
                id: 'spouse-account',
                memberId: 'spouse',
                name: '老婆的账户',
                source: 'managed',
                monitoringEnabled: true,
                positions: [{
                    instrument: { code: '300438', name: '鹏辉能源', type: 'stock', exchange: 'SZ' },
                    quantity: 300,
                    availableQuantity: 300,
                    averageCost: 107.906,
                    status: 'confirmed',
                }],
            }],
        };
        const watchlist = { instruments: [
            {
                code: '300438',
                name: '鹏辉能源',
                type: 'stock',
                exchange: 'SZ',
                status: 'active',
                relation: 'confirmed_holding_monitor',
                monitoring_plan: { observed_quantity_reduction_since_previous_snapshot: 300 },
            },
            { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH', status: 'active' },
        ] };
        const targets = collectPlanTargets(portfolio, household, watchlist, 'NORMAL');
        expect(targets).toHaveLength(2);
        expect(targets.find((item) => item.instrument.code === '300438')).toMatchObject({
            accountScope: '老婆 → 老婆的账户',
            positionSource: 'household',
            position: {
                quantity: 300,
                available_quantity: 300,
                average_cost: 107.906,
            },
            instrument: {
                monitoring_plan: { observed_quantity_reduction_since_previous_snapshot: 300 },
            },
        });
        expect(targets.filter((item) => item.instrument.code === '300438')).toHaveLength(1);
    });

    it('停手状态仍分析持仓风险，但不扫描新的自选机会', () => {
        const portfolio = { positions: [{
            instrument: { code: '600000', name: '测试持仓', type: 'stock', exchange: 'SH' },
            quantity: 100,
            available_quantity: 100,
            average_cost: 10,
            status: 'confirmed',
        }] };
        const targets = collectPlanTargets(portfolio, null, { instruments: [
            { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH', status: 'active' },
        ] }, 'STOPPED');
        expect(targets.map((item) => item.instrument.code)).toEqual(['600000']);
        expect(targets[0].position).not.toBeNull();
    });

    it('盘中计划限制标的分析并发，避免多核和子进程瞬时打满', async () => {
        let active = 0;
        let peak = 0;
        const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return value * 2;
        });
        expect(results).toEqual([2, 4, 6, 8, 10, 12]);
        expect(peak).toBe(2);
    });

    it('按证券和账户隔离最后卖出价，后续买入会关闭接回状态', () => {
        const prices = collectLastSellPrices([
            { code: '300438', accountScope: '老婆 → 老婆的账户', side: 'sell', referencePrice: 60, recordedAt: '2026-07-16T07:00:00Z' },
            { code: '300438', accountScope: '我 → 我的主账户', side: 'sell', referencePrice: 62, recordedAt: '2026-07-16T07:01:00Z' },
            { code: '300438', accountScope: '我 → 我的主账户', side: 'buy', referencePrice: 61, recordedAt: '2026-07-17T07:00:00Z' },
            { code: '600519', accountScope: null, side: 'sell', referencePrice: 1200, recordedAt: '2026-07-17T07:01:00Z', evaluationEligible: false },
        ]);
        expect(prices.get('300438|老婆 → 老婆的账户')).toBe(60);
        expect(prices.has('300438|我 → 我的主账户')).toBe(false);
        expect(prices.has('600519|')).toBe(false);
        const contexts = collectLastSellContexts([
            { code: '002415', accountScope: '我 → 我的主账户', side: 'sell', referencePrice: 34.7, strategy: 'range_high_reversal', recordedAt: '2026-07-16T07:00:00Z' },
        ]);
        expect(contexts.get('002415|我 → 我的主账户')).toEqual({ price: 34.7, strategy: 'range_high_reversal' });
    });
});
