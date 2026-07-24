import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MarketCache } from './dist/cache.js';

const policy = { retention_days: 30, max_entries: 20, max_bytes: 1024 * 1024 };
const idFor = (key) => createHash('sha256').update(key).digest('hex');

const legacyCache = async (key, value) => {
    const root = await mkdtemp(join(tmpdir(), 'market-cache-legacy-'));
    const dataRoot = join(root, 'data');
    await mkdir(dataRoot, { recursive: true });
    const id = idFor(key);
    const file = `${id}.json`;
    const now = new Date();
    await writeFile(join(dataRoot, file), `${JSON.stringify(value)}\n`, 'utf8');
    await writeFile(join(root, 'index.json'), `${JSON.stringify({
        schema_version: 1,
        policy,
        updated_at: now.toISOString(),
        entries: {
            [id]: {
                key,
                file,
                created_at: now.toISOString(),
                updated_at: now.toISOString(),
                last_accessed_at: now.toISOString(),
                expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
                size: Buffer.byteLength(JSON.stringify(value)),
                source: 'legacy',
            },
        },
    }, null, 2)}\n`, 'utf8');
    return { root, id, file };
};

describe('MarketCache compatibility and index writes', () => {
    it('直接读取旧版索引和原始数据文件，无需迁移', async () => {
        const key = 'bars:tencent:510300:1d:40:{}';
        const stored = { bars: [{ time: '2026-07-22', close: 4.8 }] };
        const { root } = await legacyCache(key, stored);
        const cache = new MarketCache(policy, root);
        expect(cache.get(key, 60_000)).toEqual(stored);
    });

    it('继续写入旧版可识别的原始 JSON 数据格式', async () => {
        const key = 'bars:tencent:510300:5m:24:{}';
        const { root, file } = await legacyCache(key, { bars: [] });
        const cache = new MarketCache(policy, root);
        const next = { bars: [{ time: '2026-07-23 13:30', close: 4.9 }] };
        cache.set(key, next, 'tencent');
        expect(JSON.parse(await readFile(join(root, 'data', file), 'utf8'))).toEqual(next);
        expect(cache.flush()).toBe(true);
        const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
        expect(index.schema_version).toBe(1);
        expect(index.entries[idFor(key)].key).toBe(key);
    });

    it('索引缺项时按哈希文件恢复，兼容旧版并发写入留下的孤立缓存', async () => {
        const root = await mkdtemp(join(tmpdir(), 'market-cache-orphan-'));
        const dataRoot = join(root, 'data');
        const key = 'universe:sina:full-v2:stock';
        const id = idFor(key);
        await mkdir(dataRoot, { recursive: true });
        await writeFile(join(dataRoot, `${id}.json`), '{"items":[1,2,3]}\n', 'utf8');
        const cache = new MarketCache(policy, root);
        expect(cache.get(key, 60_000)).toEqual({ items: [1, 2, 3] });
        expect(cache.flush()).toBe(true);
        const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
        expect(index.entries[id]).toMatchObject({ key, source: 'recovered' });
    });
});
