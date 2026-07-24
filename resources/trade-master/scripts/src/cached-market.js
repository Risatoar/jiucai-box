import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseMarketTime } from './bar-utils.js';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const SOURCE_PRIORITY = { eastmoney: 30, sina: 20, tencent: 10 };

function validTimestamp(value) {
    const parsed = parseMarketTime(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

function boundaryTimestamp(value, endOfDay = false) {
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text))
        return Date.parse(`${text}T${endOfDay ? '23:59:59' : '00:00:00'}+08:00`);
    return validTimestamp(text);
}

function sourceName(bar, entry) {
    const fromKey = String(entry.key ?? '').split(':')[1];
    return String(bar.source ?? entry.source ?? fromKey ?? 'unknown').toLowerCase();
}

function day(value) {
    return String(value).slice(0, 10);
}

function preferSnapshot(current, candidate) {
    if (!current)
        return candidate;
    const currentAmount = Number.isFinite(Number(current.bar.amount)) ? 1 : 0;
    const candidateAmount = Number.isFinite(Number(candidate.bar.amount)) ? 1 : 0;
    if (candidateAmount !== currentAmount)
        return candidateAmount > currentAmount ? candidate : current;
    return candidate.updatedAt >= current.updatedAt ? candidate : current;
}

function selectDailySources(candidates) {
    const grouped = new Map();
    for (const candidate of candidates) {
        const date = day(candidate.bar.time);
        const bySource = grouped.get(date) ?? new Map();
        const rows = bySource.get(candidate.source) ?? new Map();
        rows.set(candidate.timestamp, preferSnapshot(rows.get(candidate.timestamp), candidate));
        bySource.set(candidate.source, rows);
        grouped.set(date, bySource);
    }
    const selected = [];
    const usedSources = new Set();
    let sourceUniqueRows = 0;
    let canonicalUniqueRows = 0;
    for (const bySource of grouped.values()) {
        const timestamps = new Set();
        for (const rows of bySource.values())
            for (const timestamp of rows.keys())
                timestamps.add(timestamp);
        canonicalUniqueRows += timestamps.size;
        for (const rows of bySource.values())
            sourceUniqueRows += rows.size;
        const [source, rows] = [...bySource.entries()].sort(([leftSource, left], [rightSource, right]) => (
            right.size - left.size
            || (SOURCE_PRIORITY[rightSource] ?? 0) - (SOURCE_PRIORITY[leftSource] ?? 0)
            || leftSource.localeCompare(rightSource)
        ))[0];
        usedSources.add(source);
        selected.push(...[...rows.values()].map((item) => item.bar));
    }
    return { selected, usedSources, sourceUniqueRows, canonicalUniqueRows };
}

export class CachedMarketService {
    root;
    index;

    constructor(cacheRoot) {
        this.root = resolve(cacheRoot);
        const indexPath = join(this.root, 'index.json');
        if (!existsSync(indexPath))
            throw new Error(`离线行情缓存不存在：${indexPath}`);
        this.index = readJson(indexPath);
    }

    async bars(code, period, limit, options = {}) {
        const prefix = `bars:`;
        const marker = `:${String(code)}:${period}:`;
        const candidates = [];
        let rawRows = 0;
        for (const entry of Object.values(this.index.entries ?? {})) {
            const key = String(entry.key ?? '');
            if (!key.startsWith(prefix) || !key.includes(marker))
                continue;
            const dataPath = join(this.root, 'data', String(entry.file ?? ''));
            if (!existsSync(dataPath))
                continue;
            const rows = readJson(dataPath);
            for (const bar of Array.isArray(rows) ? rows : []) {
                if (String(bar.period ?? period) !== period)
                    continue;
                const timestamp = validTimestamp(bar.time);
                if (timestamp == null || bar.closed === false)
                    continue;
                rawRows += 1;
                const source = sourceName(bar, entry);
                candidates.push({
                    bar: { ...bar, period, source },
                    source,
                    timestamp,
                    updatedAt: Date.parse(entry.updated_at ?? entry.created_at ?? 0) || 0,
                });
            }
        }
        const start = options.start ? boundaryTimestamp(options.start) : null;
        const end = options.asOf ? boundaryTimestamp(options.asOf, true) : options.end ? boundaryTimestamp(options.end, true) : null;
        const filtered = candidates.filter((item) => (
            (start == null || item.timestamp >= start)
            && (end == null || item.timestamp <= end)
        ));
        const merged = selectDailySources(filtered);
        const bars = merged.selected
            .sort((left, right) => validTimestamp(left.time) - validTimestamp(right.time))
            .slice(-limit);
        if (!bars.length)
            throw new Error(`离线缓存没有 ${code} ${period} 数据`);
        return {
            bars,
            source: `offline-cache:${[...merged.usedSources].sort().join('+') || 'unknown'}`,
            errors: [],
            trading_days: new Set(bars.map((bar) => String(bar.time).slice(0, 10))).size,
            offline: true,
            deduplication: {
                raw_rows: rawRows,
                filtered_rows: filtered.length,
                source_unique_rows: merged.sourceUniqueRows,
                selected_rows: bars.length,
                within_source_duplicates_removed: Math.max(0, filtered.length - merged.sourceUniqueRows),
                cross_source_duplicates_removed: Math.max(0, merged.sourceUniqueRows - merged.canonicalUniqueRows),
                non_primary_unique_rows_excluded: Math.max(0, merged.canonicalUniqueRows - merged.selected.length),
            },
        };
    }
}
