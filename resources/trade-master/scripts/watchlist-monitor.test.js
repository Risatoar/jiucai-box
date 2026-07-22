import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acknowledgeWatchlistSignals, monitorWatchlistBuyPoints } from './dist/watchlist-monitor.js';

const previousHome = process.env.TRADE_MASTER_HOME;

afterEach(() => {
    if (previousHome == null)
        delete process.env.TRADE_MASTER_HOME;
    else
        process.env.TRADE_MASTER_HOME = previousHome;
});

const dailyBars = () => Array.from({ length: 30 }, (_, index) => ({
    open: 9.9 + index * 0.03,
    close: 10 + index * 0.03,
    high: 10.1 + index * 0.03,
    low: 9.8 + index * 0.03,
    volume: 1000 + index,
    closed: true,
}));

const fiveMinuteBars = () => [
    { open: 10, close: 10.01, volume: 100, closed: true },
    { open: 10.01, close: 10.03, volume: 100, closed: true },
    { open: 10.03, close: 10.04, volume: 100, closed: true },
    { open: 10.04, close: 10.05, volume: 100, closed: true },
    { open: 10.05, close: 10.06, volume: 100, closed: true },
    { open: 10.06, close: 10.18, volume: 130, closed: true },
];

const market = (changeRatio = 0.02) => ({
    evidence: async (code) => ({
        quotes: [{ instrument: { code }, price: 10.18, changeRatio, high: 10.6 }],
        bars: fiveMinuteBars(),
        market_state: { verified: true, latest_exchange_time: '2026-07-22T10:15:00+08:00' },
    }),
    bars: async (_code, period) => ({
        source: 'fixture',
        bars: period === '15m'
            ? [{ open: 10, close: 10.05, closed: true }, { open: 10.05, close: 10.18, closed: true }]
            : dailyBars(),
    }),
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
        expect(first.summary).toMatchObject({ active_total: 2, analyzed: 2, user_favorites: 1, ai_discovered: 1, held_excluded: 1, inactive_excluded: 1, buy_ready: 2 });
        expect(first.items.map((item) => item.instrument.code).sort()).toEqual(['113001', '510300']);
        expect(first.items.every((item) => item.status === 'buy_ready' && item.signal_strength === 'strong')).toBe(true);
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

    it('does not call a chasing move a buy point and reports a previously confirmed point as invalidated', async () => {
        const home = await mkdtemp(join(tmpdir(), 'watchlist-monitor-risk-'));
        process.env.TRADE_MASTER_HOME = home;
        await writeFile(join(home, 'portfolio.json'), JSON.stringify({ positions: [] }));
        await writeFile(join(home, 'discipline.json'), JSON.stringify({ state: 'NORMAL' }));
        await writeFile(join(home, 'watchlist.json'), JSON.stringify({ instruments: [
            { code: '600000', name: '测试股票', type: 'stock', exchange: 'SH', source: 'user', status: 'active' },
        ] }));

        await monitorWatchlistBuyPoints(market());
        acknowledgeWatchlistSignals();
        const chasing = await monitorWatchlistBuyPoints(market(0.06));
        expect(chasing.items[0]).toMatchObject({ status: 'watching', checks: { chasing_risk: true } });
        expect(chasing.new_buy_signals).toEqual([]);
        expect(chasing.invalidated_buy_signals).toHaveLength(1);
        expect(chasing.material_change).toBe(true);
    });
});
