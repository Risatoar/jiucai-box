import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acknowledgeWatchlistSignals, monitorWatchlistBuyPoints } from './dist/watchlist-monitor.js';

const previousHome = process.env.TRADE_MASTER_HOME;
const shanghaiToday = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

afterEach(() => {
    if (previousHome == null)
        delete process.env.TRADE_MASTER_HOME;
    else
        process.env.TRADE_MASTER_HOME = previousHome;
});

const dailyBars = (repaired = true) => {
    const bars = Array.from({ length: 80 }, (_, index) => {
        const close = 100 - index * 0.5;
        return {
            time: `2026-04-${String((index % 28) + 1).padStart(2, '0')}`,
            open: close - 0.2,
            close,
            high: close + 1,
            low: close - 1,
            volume: 10000,
            period: '1d',
            closed: true,
        };
    });
    if (repaired)
        bars[bars.length - 1] = { ...bars.at(-1), open: 60.5, high: 67, low: 60.2, close: 65, volume: 20000 };
    return bars;
};

const fiveMinuteBars = (repaired = true) => [
    ...Array.from({ length: 38 }, (_, index) => ({
        open: 56 + index * 0.02,
        high: 56.3 + index * 0.02,
        low: 55.7 + index * 0.02,
        close: 56.08 + index * 0.02,
        volume: 1000,
    })),
    repaired
        ? { open: 56.8, high: 60.5, low: 56.7, close: 60.2, volume: 5000 }
        : { open: 56.8, high: 57, low: 56.5, close: 56.7, volume: 900 },
];

const minuteBars = (repaired = true) => fiveMinuteBars(repaired).flatMap((bar, bucket) => Array.from({ length: 5 }, (_, minute) => {
    const ratio = (minute + 1) / 5;
    const close = bar.open + (bar.close - bar.open) * ratio;
    const totalMinute = 9 * 60 + 30 + bucket * 5 + minute;
    return {
        time: `${shanghaiToday()} ${String(Math.floor(totalMinute / 60)).padStart(2, '0')}:${String(totalMinute % 60).padStart(2, '0')}`,
        open: minute === 0 ? bar.open : bar.open + (bar.close - bar.open) * minute / 5,
        high: Math.max(close, bar.high - (4 - minute) * 0.01),
        low: Math.min(close, bar.low + minute * 0.01),
        close,
        volume: bar.volume / 5,
        amount: close * bar.volume / 5,
        period: '1m',
        closed: true,
    };
}));

const market = (ready = true) => ({
    quotes: async (code) => ({
        quotes: [{ instrument: { code }, price: ready ? 60.2 : 56.7, changeRatio: ready ? 0.02 : -0.01, high: 60.5 }],
        errors: [],
    }),
    bars: async (_code, period) => ({
        source: 'fixture',
        bars: period === '1m' ? minuteBars(ready) : dailyBars(ready),
        errors: [],
    }),
    cacheStatus: () => ({}),
});

describe('watchlist buy-point monitor', () => {
    it('monitors active user and AI watch items while excluding holdings and removed items', async () => {
        const home = await mkdtemp(join(tmpdir(), 'watchlist-monitor-'));
        process.env.TRADE_MASTER_HOME = home;
        await writeFile(join(home, 'portfolio.json'), JSON.stringify({ positions: [] }));
        await writeFile(join(home, 'discipline.json'), JSON.stringify({ state: 'NORMAL' }));
        await mkdir(join(home, 'household'), { recursive: true });
        await writeFile(join(home, 'household/portfolio.json'), JSON.stringify({ accounts: [{ positions: [{ instrument: { code: '600001' }, quantity: 100, status: 'confirmed' }] }] }));
        await writeFile(join(home, 'watchlist.json'), JSON.stringify({ instruments: [
            { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH', source: 'user', status: 'active' },
            { code: '113001', name: '测试转债', type: 'cbond', exchange: 'SH', source: 'agent', status: 'active' },
            { code: '600001', name: '已持仓', type: 'stock', exchange: 'SH', source: 'user', status: 'active' },
            { code: '600002', name: '已删除', type: 'stock', exchange: 'SH', source: 'user', status: 'removed' },
        ] }));

        const first = await monitorWatchlistBuyPoints(market());
        expect(first.decision_policy_id).toBe('rolling-position-v25-robust-70');
        expect(first.summary).toMatchObject({ active_total: 2, analyzed: 2, user_favorites: 1, ai_discovered: 1, held_excluded: 1, inactive_excluded: 1, buy_ready: 2 });
        expect(first.items.map((item) => item.instrument.code).sort()).toEqual(['113001', '510300']);
        expect(first.items.every((item) => item.status === 'buy_ready' && item.signal_strength === 'strong')).toBe(true);
        expect(first.items.every((item) => item.model_evidence.decision_policy_id === 'rolling-position-v25-robust-70')).toBe(true);
        expect(first.new_buy_signals).toHaveLength(2);
        expect(first.material_change).toBe(true);
        expect(JSON.parse(await readFile(join(home, 'runtime/watchlist-monitor-latest.json'), 'utf8')).items).toHaveLength(2);

        const repeated = await monitorWatchlistBuyPoints(market());
        expect(repeated.new_buy_signals).toHaveLength(2);
        expect(repeated.invalidated_buy_signals).toEqual([]);
        expect(repeated.material_change).toBe(true);
        expect(acknowledgeWatchlistSignals()).toMatchObject({ acknowledged: true, buy_signals: ['510300', '113001'] });
        const acknowledged = await monitorWatchlistBuyPoints(market());
        expect(acknowledged.new_buy_signals).toEqual([]);
        expect(acknowledged.material_change).toBe(false);
    });

    it('reports a previously confirmed model point as invalidated when the unified model no longer confirms it', async () => {
        const home = await mkdtemp(join(tmpdir(), 'watchlist-monitor-risk-'));
        process.env.TRADE_MASTER_HOME = home;
        await writeFile(join(home, 'portfolio.json'), JSON.stringify({ positions: [] }));
        await writeFile(join(home, 'discipline.json'), JSON.stringify({ state: 'NORMAL' }));
        await writeFile(join(home, 'watchlist.json'), JSON.stringify({ instruments: [
            { code: '600000', name: '测试股票', type: 'stock', exchange: 'SH', source: 'user', status: 'active' },
        ] }));

        await monitorWatchlistBuyPoints(market());
        acknowledgeWatchlistSignals();
        const invalidated = await monitorWatchlistBuyPoints(market(false));
        expect(invalidated.items[0]).toMatchObject({
            status: 'watching',
            checks: { unified_model_entry_ready: false },
        });
        expect(invalidated.new_buy_signals).toEqual([]);
        expect(invalidated.invalidated_buy_signals).toHaveLength(1);
        expect(invalidated.material_change).toBe(true);
    });

    it('清仓后的旧持仓可在下降趋势强修复时重新进入买回候选', async () => {
        const home = await mkdtemp(join(tmpdir(), 'watchlist-reentry-'));
        process.env.TRADE_MASTER_HOME = home;
        await writeFile(join(home, 'portfolio.json'), JSON.stringify({ positions: [] }));
        await writeFile(join(home, 'discipline.json'), JSON.stringify({ state: 'NORMAL' }));
        await writeFile(join(home, 'watchlist.json'), JSON.stringify({ instruments: [{
            code: '300438',
            name: '鹏辉能源',
            type: 'stock',
            exchange: 'SZ',
            source: 'user_confirmed_spouse_holding',
            status: 'active',
            relation: 'confirmed_holding_monitor',
            monitoring_plan: { support: [10], observed_quantity_reduction_since_previous_snapshot: 300 },
        }] }));
        const result = await monitorWatchlistBuyPoints(market());
        expect(result.items[0]).toMatchObject({
            status: 'buy_ready',
            opportunity_type: 'reentry_after_risk_reduction',
            checks: {
                reentry_candidate: true,
                unified_model_entry_ready: true,
            },
        });
        expect(result.new_buy_signals).toHaveLength(1);
    });
});
