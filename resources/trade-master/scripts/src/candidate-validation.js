import {
    assessFundamentalContext,
    assessThemeContinuity,
    resolveValidatedMarketContext,
} from './candidate-market-context.js';

const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const round = (value, digits = 4) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};

const closedBars = (result) => (result?.bars ?? []).filter((bar) => bar.closed !== false);

const average = (values) => {
    const usable = values.filter(Number.isFinite);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
};

const returnPercent = (bars, periods) => {
    const selected = bars.slice(-(periods + 1));
    const first = finite(selected.at(0)?.close, NaN);
    const last = finite(selected.at(-1)?.close, NaN);
    return Number.isFinite(first) && first > 0 && Number.isFinite(last) ? round((last / first - 1) * 100, 2) : null;
};

const standardDeviation = (values) => {
    const usable = values.filter(Number.isFinite);
    if (usable.length < 2)
        return null;
    const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
    return Math.sqrt(usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (usable.length - 1));
};

const dailyReturns = (closes) => closes.slice(1)
    .map((close, index) => closes[index] > 0 ? close / closes[index] - 1 : NaN)
    .filter(Number.isFinite);

const downsideDeviation = (values) => {
    if (!values.length)
        return null;
    return Math.sqrt(values.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / values.length);
};

const rsi = (closes, periods = 14) => {
    const selected = closes.slice(-(periods + 1));
    if (selected.length < periods + 1)
        return null;
    let gains = 0;
    let losses = 0;
    for (let index = 1; index < selected.length; index += 1) {
        const change = selected[index] - selected[index - 1];
        gains += Math.max(0, change);
        losses += Math.max(0, -change);
    }
    if (losses === 0)
        return gains > 0 ? 100 : 50;
    const relativeStrength = gains / losses;
    return 100 - 100 / (1 + relativeStrength);
};

export function dailyStructure(bars) {
    const closes = bars.map((bar) => finite(bar.close, NaN)).filter(Number.isFinite);
    const last = closes.at(-1) ?? null;
    const ma5 = average(closes.slice(-5));
    const ma20 = average(closes.slice(-20));
    const previousMa20 = average(closes.slice(-25, -5));
    const recentBars = bars.slice(-20);
    const recentHigh = Math.max(...recentBars.map((bar) => finite(bar.high, NaN)).filter(Number.isFinite));
    const recentLow = Math.min(...recentBars.map((bar) => finite(bar.low, NaN)).filter(Number.isFinite));
    const returns = dailyReturns(closes.slice(-21));
    return {
        sample_count: closes.length,
        close: last,
        ma5: ma5 == null ? null : round(ma5, 4),
        ma20: ma20 == null ? null : round(ma20, 4),
        ma20_slope_5d_percent: ma20 != null && previousMa20 != null && previousMa20 > 0 ? round((ma20 / previousMa20 - 1) * 100, 2) : null,
        above_ma20: last != null && ma20 != null ? last >= ma20 : null,
        return_1d_percent: returnPercent(bars, 1),
        return_5d_percent: returnPercent(bars, 5),
        return_10d_percent: returnPercent(bars, 10),
        return_20d_percent: returnPercent(bars, 20),
        drawdown_from_20d_high_percent: last != null && Number.isFinite(recentHigh) && recentHigh > 0 ? round((last / recentHigh - 1) * 100, 2) : null,
        rebound_from_20d_low_percent: last != null && Number.isFinite(recentLow) && recentLow > 0 ? round((last / recentLow - 1) * 100, 2) : null,
        rsi14: rsi(closes) == null ? null : round(rsi(closes), 2),
        realized_volatility_20d_percent: standardDeviation(returns) == null ? null : round(standardDeviation(returns) * 100, 2),
        downside_volatility_20d_percent: downsideDeviation(returns) == null ? null : round(downsideDeviation(returns) * 100, 2),
    };
}

const safeInstrumentInfo = async (market, candidate) => {
    if (typeof market.info !== 'function')
        return null;
    try {
        return await market.info(candidate.instrument.code);
    }
    catch {
        return null;
    }
};

const loadThemeContinuity = async (market, candidate, marketContext, candidateDailyBars) => {
    const representative = marketContext.theme_evidence?.representative_codes?.[0];
    if (!representative)
        return assessThemeContinuity([], marketContext);
    if (representative === candidate.instrument.code)
        return assessThemeContinuity(candidateDailyBars, marketContext);
    try {
        const result = await market.bars(representative, '1d', 30);
        return assessThemeContinuity(closedBars(result), marketContext);
    }
    catch {
        return assessThemeContinuity([], marketContext);
    }
};

export async function monitorCandidate(market, candidate, userProfile) {
    try {
        const [evidence5, result15, resultDaily, instrumentInfo] = await Promise.all([
            market.evidence(candidate.instrument.code, '5m', 24),
            market.bars(candidate.instrument.code, '15m', 16),
            market.bars(candidate.instrument.code, '1d', 40),
            safeInstrumentInfo(market, candidate),
        ]);
        const bars5 = closedBars({ bars: evidence5.bars });
        const bars15 = closedBars(result15);
        const dailyBars = closedBars(resultDaily);
        const last5 = bars5.at(-1);
        const previous5 = bars5.at(-2);
        const last15 = bars15.at(-1);
        const quote = evidence5.quotes[0] ?? null;
        const recentVolumes = bars5.slice(-6, -1).map((bar) => finite(bar.volume)).filter((value) => value > 0);
        const averageVolume = recentVolumes.length ? recentVolumes.reduce((sum, value) => sum + value, 0) / recentVolumes.length : 0;
        const fiveMinuteConfirmed = Boolean(last5 && previous5 && last5.close > last5.open && last5.close > previous5.close);
        const fifteenMinuteConfirmed = Boolean(last15 && last15.close >= last15.open);
        const volumeConfirmed = Boolean(last5 && averageVolume > 0 && finite(last5.volume) >= averageVolume * 1.05);
        const change = finite(quote?.changeRatio);
        const chasingLimit = finite(userProfile?.chasing_change_limits?.[candidate.type], candidate.type === 'cbond' ? 0.08 : 0.05);
        const chasing = change > chasingLimit || (quote?.high && (quote.high - quote.price) / quote.high < 0.005 && change > chasingLimit * 0.6);
        const verified = evidence5.market_state.verified && last5?.closed !== false && last15?.closed !== false;
        const status = !verified ? 'market_unavailable' : chasing ? 'waiting' : fiveMinuteConfirmed && fifteenMinuteConfirmed && volumeConfirmed ? 'attention' : 'waiting';
        const resolvedMarketContext = resolveValidatedMarketContext(candidate, instrumentInfo);
        const marketContext = {
            ...resolvedMarketContext,
            continuity: await loadThemeContinuity(market, candidate, resolvedMarketContext, dailyBars),
        };
        const fundamental = assessFundamentalContext(candidate.type, instrumentInfo);
        return {
            code: candidate.instrument.code,
            name: candidate.instrument.name,
            type: candidate.type,
            rank: candidate.rank,
            status,
            price: quote?.price ?? candidate.price,
            change_percent: round(change * 100, 2),
            checks: { quote_and_closed_bars_verified: verified, five_minute_structure: fiveMinuteConfirmed, fifteen_minute_structure: fifteenMinuteConfirmed, independent_volume: volumeConfirmed, chasing_risk: chasing },
            technical_evidence: {
                daily: dailyStructure(dailyBars),
                intraday: {
                    five_minute_structure: fiveMinuteConfirmed,
                    fifteen_minute_structure: fifteenMinuteConfirmed,
                    latest_volume_vs_recent_average: last5 && averageVolume > 0 ? round(finite(last5.volume) / averageVolume, 2) : null,
                },
                market_context: marketContext,
                fundamental,
                sources: [evidence5.provider_errors?.length ? 'partial' : 'verified', result15.source, resultDaily.source, instrumentInfo?.source].filter(Boolean),
            },
            blockers: [!verified && '实时行情或闭合K线未通过验证', chasing && '追涨风险偏高', !fiveMinuteConfirmed && '5分钟结构未确认', !fifteenMinuteConfirmed && '15分钟结构未确认', !volumeConfirmed && '量能证据不足', ...fundamental.risks].filter(Boolean),
            conclusion: status === 'attention' ? '可重点关注，仍须人工核对账户、纪律、费用、事件风险和现金安全垫' : status === 'waiting' ? '继续等待，不构成买入信号' : '行情证据不可用，不做交易判断',
            data_as_of: evidence5.market_state.latest_exchange_time,
        };
    }
    catch (error) {
        return { code: candidate.instrument.code, name: candidate.instrument.name, type: candidate.type, rank: candidate.rank, status: 'market_unavailable', conclusion: '行情证据不可用，不做交易判断', error: error instanceof Error ? error.message : String(error) };
    }
}
