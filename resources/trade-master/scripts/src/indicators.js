export function sma(values, period) {
    if (values.length < period || period <= 0)
        return null;
    return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}
export function smaSeries(values, period) {
    let sum = 0;
    return values.map((value, index) => {
        sum += value;
        if (index >= period)
            sum -= values[index - period];
        return index >= period - 1 ? sum / period : null;
    });
}
export function emaSeries(values, period) {
    if (values.length === 0)
        return [];
    const alpha = 2 / (period + 1);
    const output = [values[0]];
    for (let index = 1; index < values.length; index += 1) {
        output.push(values[index] * alpha + output[index - 1] * (1 - alpha));
    }
    return output;
}
export function rsi(values, period = 14) {
    if (values.length <= period)
        return null;
    let gains = 0;
    let losses = 0;
    for (let index = values.length - period; index < values.length; index += 1) {
        const change = values[index] - values[index - 1];
        if (change >= 0)
            gains += change;
        else
            losses -= change;
    }
    if (losses === 0)
        return gains === 0 ? 50 : 100;
    return 100 - 100 / (1 + gains / losses);
}
export function atr(bars, period = 14) {
    if (bars.length <= period)
        return null;
    const ranges = [];
    for (let index = bars.length - period; index < bars.length; index += 1) {
        const bar = bars[index];
        const previousClose = bars[index - 1].close;
        ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)));
    }
    return ranges.reduce((sum, value) => sum + value, 0) / period;
}
export function macd(values, fast = 12, slow = 26, signal = 9) {
    const fastLine = emaSeries(values, fast);
    const slowLine = emaSeries(values, slow);
    const dif = values.map((_, index) => fastLine[index] - slowLine[index]);
    const dea = emaSeries(dif, signal);
    const histogram = dif.map((value, index) => (value - dea[index]) * 2);
    return { dif, dea, histogram };
}
export function kdj(bars, period = 9) {
    const k = [];
    const d = [];
    const j = [];
    let previousK = 50;
    let previousD = 50;
    for (let index = 0; index < bars.length; index += 1) {
        const window = bars.slice(Math.max(0, index - period + 1), index + 1);
        const high = Math.max(...window.map((bar) => bar.high));
        const low = Math.min(...window.map((bar) => bar.low));
        const rsv = high === low ? 50 : ((bars[index].close - low) / (high - low)) * 100;
        previousK = previousK * 2 / 3 + rsv / 3;
        previousD = previousD * 2 / 3 + previousK / 3;
        k.push(previousK);
        d.push(previousD);
        j.push(3 * previousK - 2 * previousD);
    }
    return { k, d, j };
}
export function vwap(bars, endIndex = bars.length - 1) {
    let amount = 0;
    let volume = 0;
    for (let index = 0; index <= endIndex && index < bars.length; index += 1) {
        const bar = bars[index];
        const typical = (bar.high + bar.low + bar.close) / 3;
        amount += typical * bar.volume;
        volume += bar.volume;
    }
    return volume > 0 ? amount / volume : null;
}
export function volumeRatio(bars, index = bars.length - 1, window = 5) {
    if (index <= 0 || !bars[index])
        return null;
    const baseline = bars.slice(Math.max(0, index - window), index);
    if (baseline.length === 0)
        return null;
    const average = baseline.reduce((sum, bar) => sum + bar.volume, 0) / baseline.length;
    return average > 0 ? bars[index].volume / average : null;
}
export function rollingRange(bars, index, window, excludeLatest = true) {
    const end = excludeLatest ? index : index + 1;
    const sample = bars.slice(Math.max(0, end - window), end);
    if (sample.length === 0)
        return { high: null, low: null };
    return {
        high: Math.max(...sample.map((bar) => bar.high)),
        low: Math.min(...sample.map((bar) => bar.low)),
    };
}
export function summarizeIndicators(bars) {
    const closes = bars.map((bar) => bar.close);
    const latest = closes.at(-1) ?? null;
    const ma5 = sma(closes, 5);
    const ma20 = sma(closes, 20);
    const ma60 = sma(closes, 60);
    const rsi14 = rsi(closes);
    const atr14 = atr(bars);
    const macdLines = macd(closes);
    const kdjLines = kdj(bars);
    const trend = latest != null && ma20 != null && ma60 != null
        ? latest > ma20 && ma20 > ma60
            ? 'up'
            : latest < ma20 && ma20 < ma60
                ? 'down'
                : 'range'
        : 'unknown';
    return {
        latest,
        ma5,
        ma20,
        ma60,
        rsi14,
        atr14,
        trend,
        macd: {
            dif: macdLines.dif.at(-1) ?? null,
            dea: macdLines.dea.at(-1) ?? null,
            histogram: macdLines.histogram.at(-1) ?? null,
        },
        kdj: {
            k: kdjLines.k.at(-1) ?? null,
            d: kdjLines.d.at(-1) ?? null,
            j: kdjLines.j.at(-1) ?? null,
        },
        vwap: vwap(bars),
        volume_ratio: volumeRatio(bars),
    };
}
