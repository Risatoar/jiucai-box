import { describe, expect, it } from 'vitest';
import { aggregateBars } from './dist/bar-utils.js';

const bar = (time, close) => ({
    time,
    open: close - 0.1,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume: 100,
    amount: close * 100,
    period: '5m',
    closed: true,
    source: 'fixture',
});

describe('bar aggregation from historical intraday periods', () => {
    it('keeps closed 5m bars instead of treating them as incomplete 1m buckets', () => {
        const input = [
            bar('2026-07-01 09:30', 10),
            bar('2026-07-01 09:35', 10.2),
            bar('2026-07-01 09:40', 10.4),
        ];
        expect(aggregateBars(input, '5m')).toEqual(input);
    });

    it('aggregates three closed 5m bars into one closed 15m bar', () => {
        const output = aggregateBars([
            bar('2026-07-01 09:30', 10),
            bar('2026-07-01 09:35', 10.2),
            bar('2026-07-01 09:40', 10.4),
        ], '15m');
        expect(output).toHaveLength(1);
        expect(output[0]).toMatchObject({
            period: '15m',
            closed: true,
            open: 9.9,
            close: 10.4,
            volume: 300,
        });
    });
});
