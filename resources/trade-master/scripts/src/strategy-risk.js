import { atr, sma } from './indicators.js';

export function dailyTrend(dailyBars) {
    const closes = dailyBars.map((bar) => bar.close);
    const latest = closes.at(-1);
    const ma20 = sma(closes, 20);
    const ma60 = sma(closes, 60);
    if (latest == null || ma20 == null)
        return 'unknown';
    if (latest > ma20 * 1.005 && (ma60 == null || ma20 > ma60 * 1.003))
        return 'up';
    if (latest < ma20 * 0.995 && (ma60 == null || ma20 < ma60 * 0.997))
        return 'down';
    return 'range';
}

export function dailyRiskProfile(dailyBars, minuteBars, trend) {
    const closedDaily = dailyBars.filter((bar) => bar.closed !== false);
    const latest = closedDaily.at(-1);
    const previous = closedDaily.slice(-21, -1);
    const recentSupport = previous.length ? Math.min(...previous.map((bar) => bar.low)) : null;
    const deeperSample = closedDaily.slice(-60, -20);
    const deeperSupport = deeperSample.length ? Math.min(...deeperSample.map((bar) => bar.low)) : recentSupport;
    const dailyAtr = atr(closedDaily, 14);
    const closes = closedDaily.map((bar) => bar.close);
    const ma20 = sma(closes, 20);
    const priorMa20 = sma(closes.slice(0, -5), 20);
    const closeFiveDaysAgo = closedDaily.at(-6)?.close;
    const momentum5dPct = latest && closeFiveDaysAgo ? (latest.close / closeFiveDaysAgo - 1) * 100 : null;
    const distanceToMa20Pct = latest && ma20 ? (latest.close / ma20 - 1) * 100 : null;
    const ma20Slope5dPct = ma20 && priorMa20 ? (ma20 / priorMa20 - 1) * 100 : null;
    const atrRatioPct = latest && dailyAtr ? dailyAtr / latest.close * 100 : null;
    const priorDaily = closedDaily.at(-2);
    const priorVolumes = closedDaily.slice(-6, -1).map((bar) => bar.volume).filter(Number.isFinite);
    const priorAverageVolume = priorVolumes.length ? priorVolumes.reduce((sum, value) => sum + value, 0) / priorVolumes.length : null;
    const dailyRepairConfirmed = Boolean(latest && priorDaily
        && latest.close > latest.open
        && latest.close > priorDaily.high
        && (priorAverageVolume == null || latest.volume >= priorAverageVolume * 1.1));
    const dayHigh = minuteBars.length ? Math.max(...minuteBars.map((bar) => bar.high)) : null;
    const intradayClose = minuteBars.at(-1)?.close ?? latest?.close ?? null;
    const intradayDrawdownPct = dayHigh && intradayClose ? (dayHigh - intradayClose) / dayHigh * 100 : 0;
    const recentSupportBroken = intradayClose && recentSupport ? intradayClose < recentSupport * 0.995 : false;
    const knownSupportBelow = Boolean(intradayClose && deeperSupport && deeperSupport < intradayClose);
    const nextSupportDistancePct = knownSupportBelow
        ? (intradayClose - deeperSupport) / intradayClose * 100
        : 0;
    const highDownsideSpace = trend === 'down' && (
        (recentSupportBroken && (!knownSupportBelow || nextSupportDistancePct >= 4))
        || (dailyAtr && intradayClose && intradayDrawdownPct >= 5 && dailyAtr / intradayClose >= 0.025)
    );
    return {
        recent_support: recentSupport,
        deeper_support: deeperSupport,
        daily_atr: dailyAtr,
        momentum_5d_pct: momentum5dPct == null ? null : Number(momentum5dPct.toFixed(2)),
        distance_to_ma20_pct: distanceToMa20Pct == null ? null : Number(distanceToMa20Pct.toFixed(2)),
        ma20_slope_5d_pct: ma20Slope5dPct == null ? null : Number(ma20Slope5dPct.toFixed(2)),
        atr_ratio_pct: atrRatioPct == null ? null : Number(atrRatioPct.toFixed(2)),
        intraday_drawdown_pct: Number(intradayDrawdownPct.toFixed(2)),
        next_support_distance_pct: Number(nextSupportDistancePct.toFixed(2)),
        no_known_support_below: !knownSupportBelow,
        recent_support_broken: Boolean(recentSupportBroken),
        high_downside_space: Boolean(highDownsideSpace),
        daily_repair_confirmed: dailyRepairConfirmed,
    };
}
