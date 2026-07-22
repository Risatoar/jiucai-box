import { aggregateBars } from './bar-utils.js';
import { macd, rollingRange, sma, volumeRatio, vwap } from './indicators.js';
import { runFusionStrategy } from './fusion-engine.js';
import { detectTdSequential } from './td-sequential.js';
function signal(bar, side, strategy, cluster, confidence, reasons, invalidation) {
    return {
        id: `${strategy}_${side}_${bar.period}_${bar.time}`,
        strategy,
        evidenceCluster: cluster,
        side,
        level: bar.closed ? (confidence >= 0.72 ? 'actionable' : confidence >= 0.6 ? 'confirm' : 'watch') : 'watch',
        period: bar.period,
        kState: bar.closed ? 'closed' : 'forming',
        time: bar.time,
        price: bar.close,
        confidence,
        reasons,
        invalidation,
    };
}
function detectStructureSignals(bars, dailyTrend) {
    const output = [];
    let brokenSupport = null;
    const closes = bars.map((bar) => bar.close);
    const macdLines = macd(closes);
    for (let index = 12; index < bars.length; index += 1) {
        const bar = bars[index];
        const previous = bars[index - 1];
        const range = rollingRange(bars, index, 12);
        if (range.low == null || range.high == null)
            continue;
        const ratio = volumeRatio(bars, index, 5) ?? 1;
        const currentVwap = vwap(bars, index);
        const reboundPct = (bar.close - range.low) / range.low * 100;
        const upperShadow = bar.high - Math.max(bar.open, bar.close);
        const body = Math.max(Math.abs(bar.close - bar.open), bar.close * 0.0005);
        if (bar.close < range.low * 0.999) {
            brokenSupport = range.low;
            output.push(signal(bar, 'sell', 'support_break', `support-${bar.period}`, 0.56, [`闭合价跌破滚动支撑${range.low.toFixed(3)}`, `量比${ratio.toFixed(2)}`], `后续闭合K收回${range.low.toFixed(3)}则破位失效`));
            continue;
        }
        if (brokenSupport != null) {
            if (bar.close >= brokenSupport) {
                brokenSupport = null;
            }
            else if (bar.high < brokenSupport * 1.003 && bar.close < previous.close) {
                output.push(signal(bar, 'sell', 'support_break_retest', `support-${bar.period}`, 0.78, [`此前跌破${brokenSupport.toFixed(3)}`, '反抽未收回且再次转弱'], `闭合K重新站回${brokenSupport.toFixed(3)}`));
                brokenSupport = null;
            }
        }
        if (reboundPct >= 0.8 && bar.close > previous.close && ratio >= 1 && (currentVwap == null || bar.close >= currentVwap)) {
            const confidence = dailyTrend === 'up' ? 0.74 : dailyTrend === 'down' ? 0.56 : 0.64;
            output.push(signal(bar, 'buy', 'stage_support_rebound', `support-rebound-${bar.period}`, confidence, [`距滚动低点反弹${reboundPct.toFixed(2)}%`, `量比${ratio.toFixed(2)}`, dailyTrend === 'down' ? '日线仍弱，只能作为持仓做T观察' : '日线未形成逆风'], `重新跌破${range.low.toFixed(3)}`));
        }
        if (bar.close > range.high * 1.001 && ratio >= 1.2) {
            output.push(signal(bar, 'buy', 'volume_breakout', `breakout-${bar.period}`, dailyTrend === 'down' ? 0.58 : 0.76, [`突破滚动压力${range.high.toFixed(3)}`, `量比${ratio.toFixed(2)}`], `闭合K跌回${range.high.toFixed(3)}下方`));
        }
        if (bar.high >= range.high * 0.998 && upperShadow >= body * 1.5 && bar.close < bar.open && ratio >= 1.15) {
            output.push(signal(bar, 'sell', 'rally_exhaustion', `exhaustion-${bar.period}`, 0.67, [`接近滚动压力${range.high.toFixed(3)}`, '放量冲高回落且上影明显'], `后续闭合K放量站上${range.high.toFixed(3)}`));
        }
        const histogram = macdLines.histogram[index] ?? 0;
        const previousHistogram = macdLines.histogram[index - 1] ?? 0;
        if (previousHistogram <= 0 && histogram > 0 && bar.close >= (currentVwap ?? bar.close)) {
            output.push(signal(bar, 'buy', 'macd_vwap_cross', `momentum-${bar.period}`, dailyTrend === 'down' ? 0.55 : 0.62, ['MACD柱由负转正', '价格位于VWAP上方'], 'MACD重新转负或跌回VWAP下方'));
        }
        if (previousHistogram >= 0 && histogram < 0 && bar.close <= previous.close) {
            output.push(signal(bar, 'sell', 'macd_weakening', `momentum-${bar.period}`, 0.61, ['MACD柱由正转负', '闭合价继续走弱'], 'MACD重新转正且价格收复局部压力'));
        }
    }
    return output;
}
function deduplicate(signals) {
    const best = new Map();
    for (const item of signals) {
        const key = `${item.time}:${item.period}:${item.side}:${item.evidenceCluster}`;
        const current = best.get(key);
        if (!current || item.confidence > current.confidence)
            best.set(key, item);
    }
    return [...best.values()].sort((left, right) => left.time.localeCompare(right.time) || right.confidence - left.confidence);
}
function dailyTrend(dailyBars) {
    const closes = dailyBars.map((bar) => bar.close);
    const latest = closes.at(-1);
    const ma20 = sma(closes, 20);
    const ma60 = sma(closes, 60);
    if (latest == null || ma20 == null)
        return 'unknown';
    if (latest > ma20 && (ma60 == null || ma20 >= ma60))
        return 'up';
    if (latest < ma20 && (ma60 == null || ma20 <= ma60))
        return 'down';
    return 'range';
}
export function generateStrategySignals(type, minuteBars, dailyBars) {
    const trend = dailyTrend(dailyBars);
    const periods = ['5m', '15m'];
    const byPeriod = Object.fromEntries(periods.map((period) => [period, aggregateBars(minuteBars, period)]));
    const signals = [];
    for (const period of periods) {
        const bars = byPeriod[period];
        signals.push(...detectStructureSignals(bars, trend));
        signals.push(...detectTdSequential(bars));
        if (type === 'cbond')
            signals.push(...runFusionStrategy(bars));
    }
    return {
        daily_trend: trend,
        bars: { '1m': minuteBars, ...byPeriod },
        signals: deduplicate(signals),
        evidence_clusters: [...new Set(signals.map((item) => item.evidenceCluster))],
    };
}
