export function periodMinutes(period) {
    if (period.endsWith('m'))
        return Number(period.slice(0, -1));
    return period === '1d' ? 1440 : period === '1w' ? 10080 : 43200;
}
export function parseMarketTime(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return Date.parse(`${value}T15:00:00+08:00`);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
        const normalized = value.replace(' ', 'T');
        return Date.parse(`${/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized}+08:00`);
    }
    return Date.parse(value);
}
export function marketDate(value) {
    return value.slice(0, 10);
}
function minuteOfDay(value) {
    const matched = value.match(/[T ](\d{2}):(\d{2})/);
    return matched ? Number(matched[1]) * 60 + Number(matched[2]) : 0;
}
function sessionBucket(value, minutes) {
    const day = marketDate(value);
    const minute = minuteOfDay(value);
    const sessionStart = minute >= 780 ? 780 : 570;
    const bucketStart = sessionStart + Math.floor(Math.max(0, minute - sessionStart) / minutes) * minutes;
    return `${day}:${bucketStart}`;
}
export function aggregateBars(bars, period) {
    const minutes = periodMinutes(period);
    if (bars.length === 0)
        return [];
    const sourceMinutes = Math.max(1, Math.min(...bars.map((bar) => periodMinutes(bar.period ?? '1m'))));
    if (minutes <= sourceMinutes)
        return bars.map((bar) => ({ ...bar, period }));
    const expectedBars = Math.ceil(minutes / sourceMinutes);
    const output = [];
    let bucket = [];
    let key = '';
    const flush = () => {
        if (bucket.length === 0)
            return;
        output.push({
            time: bucket[0].time,
            open: bucket[0].open,
            high: Math.max(...bucket.map((bar) => bar.high)),
            low: Math.min(...bucket.map((bar) => bar.low)),
            close: bucket.at(-1).close,
            volume: bucket.reduce((sum, bar) => sum + bar.volume, 0),
            amount: bucket.every((bar) => bar.amount == null) ? null : bucket.reduce((sum, bar) => sum + (bar.amount ?? 0), 0),
            period,
            closed: bucket.length >= expectedBars && bucket.every((bar) => bar.closed),
            source: bucket[0].source,
        });
    };
    for (const bar of bars) {
        const nextKey = sessionBucket(bar.time, minutes);
        if (key && nextKey !== key) {
            flush();
            bucket = [];
        }
        key = nextKey;
        bucket.push(bar);
    }
    flush();
    return output;
}
export function groupBarsByDate(bars) {
    const grouped = new Map();
    for (const bar of bars)
        grouped.set(marketDate(bar.time), [...(grouped.get(marketDate(bar.time)) ?? []), bar]);
    return grouped;
}
export function cutoffBars(bars, asOf) {
    const cutoff = Date.parse(asOf);
    if (!Number.isFinite(cutoff))
        throw new Error(`无效 as-of：${asOf}`);
    return bars.filter((bar) => {
        const start = parseMarketTime(bar.time);
        const end = start + periodMinutes(bar.period) * 60_000;
        return bar.closed && end <= cutoff;
    });
}
