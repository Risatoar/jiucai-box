import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CachedMarketService } from './dist/cached-market.js';

describe('offline cached market history', () => {
    it('merges cached snapshots and filters them without network access', async () => {
        const root = await mkdtemp(join(tmpdir(), 'cached-market-'));
        await mkdir(join(root, 'data'));
        await Promise.all([
            writeFile(join(root, 'data', 'first.json'), JSON.stringify([
                { time: '2026-07-01 09:30', close: 10, period: '5m', closed: true },
                { time: '2026-07-02 09:30', close: 11, period: '5m', closed: true },
            ])),
            writeFile(join(root, 'data', 'second.json'), JSON.stringify([
                { time: '2026-07-02 09:30', close: 11.2, period: '5m', closed: true },
                { time: '2026-07-03 09:30', close: 12, period: '5m', closed: true },
            ])),
        ]);
        await writeFile(join(root, 'index.json'), JSON.stringify({
            entries: {
                first: { key: 'bars:tencent:300438:5m:100:{}', file: 'first.json', source: 'tencent' },
                second: { key: 'bars:sina:300438:5m:100:{}', file: 'second.json', source: 'sina' },
            },
        }));
        const result = await new CachedMarketService(root).bars('300438', '5m', 100, {
            start: '2026-07-02',
            asOf: '2026-07-03T15:00:00+08:00',
        });
        expect(result.offline).toBe(true);
        expect(result.bars).toHaveLength(2);
        expect(result.bars[0].close).toBe(11.2);
        expect(result.trading_days).toBe(2);
    });

    it('canonicalizes minute timestamps and never doubles a bar across providers', async () => {
        const root = await mkdtemp(join(tmpdir(), 'cached-market-dedup-'));
        await mkdir(join(root, 'data'));
        await Promise.all([
            writeFile(join(root, 'data', 'tencent.json'), JSON.stringify([
                { time: '2026-07-23 09:35', close: 10, volume: 100, period: '5m', closed: true, source: 'tencent' },
                { time: '2026-07-23 09:40', close: 10.2, volume: 120, period: '5m', closed: true, source: 'tencent' },
            ])),
            writeFile(join(root, 'data', 'sina.json'), JSON.stringify([
                { time: '2026-07-23 09:35:00', close: 10.01, volume: 10000, amount: 100100, period: '5m', closed: true, source: 'sina' },
                { time: '2026-07-23 09:40:00', close: 10.21, volume: 12000, amount: 122520, period: '5m', closed: true, source: 'sina' },
            ])),
        ]);
        await writeFile(join(root, 'index.json'), JSON.stringify({
            entries: {
                tencent: { key: 'bars:tencent:300438:5m:100:{}', file: 'tencent.json', source: 'tencent' },
                sina: { key: 'bars:sina:300438:5m:100:{}', file: 'sina.json', source: 'sina' },
            },
        }));
        const result = await new CachedMarketService(root).bars('300438', '5m', 100);
        expect(result.bars).toHaveLength(2);
        expect(result.bars.every((item) => item.source === 'sina')).toBe(true);
        expect(result.bars.map((item) => item.volume)).toEqual([10000, 12000]);
        expect(result.deduplication).toMatchObject({
            source_unique_rows: 4,
            selected_rows: 2,
            cross_source_duplicates_removed: 2,
            non_primary_unique_rows_excluded: 0,
        });
    });

    it('uses the most complete source for a trading day before provider priority', async () => {
        const root = await mkdtemp(join(tmpdir(), 'cached-market-coverage-'));
        await mkdir(join(root, 'data'));
        await Promise.all([
            writeFile(join(root, 'data', 'sina.json'), JSON.stringify([
                { time: '2026-07-23 09:35:00', close: 10, period: '5m', closed: true, source: 'sina' },
            ])),
            writeFile(join(root, 'data', 'tencent.json'), JSON.stringify([
                { time: '2026-07-23 09:35', close: 10.01, period: '5m', closed: true, source: 'tencent' },
                { time: '2026-07-23 09:40', close: 10.2, period: '5m', closed: true, source: 'tencent' },
            ])),
        ]);
        await writeFile(join(root, 'index.json'), JSON.stringify({
            entries: {
                sina: { key: 'bars:sina:300438:5m:100:{}', file: 'sina.json', source: 'sina' },
                tencent: { key: 'bars:tencent:300438:5m:100:{}', file: 'tencent.json', source: 'tencent' },
            },
        }));
        const result = await new CachedMarketService(root).bars('300438', '5m', 100);
        expect(result.bars).toHaveLength(2);
        expect(result.bars.every((item) => item.source === 'tencent')).toBe(true);
        expect(result.source).toBe('offline-cache:tencent');
    });
});
