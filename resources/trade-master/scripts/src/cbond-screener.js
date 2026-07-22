import { aggregateBars, groupBarsByDate } from './bar-utils.js';
import { atr, macd, sma, volumeRatio } from './indicators.js';
import { runFusionStrategy } from './fusion-engine.js';
async function mapLimit(items, concurrency, task) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await task(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
function dailyScore(snapshot, bars, options) {
    if (bars.length < 20)
        return null;
    const latest = bars.at(-1);
    if (latest.close < options.priceMin || latest.close > options.priceMax)
        return null;
    if ((latest.amount ?? 0) < options.amountMin)
        return null;
    const closes = bars.map((bar) => bar.close);
    const ma5 = sma(closes, 5);
    const ma10 = sma(closes, 10);
    const ma20 = sma(closes, 20);
    const atr14 = atr(bars, 14) ?? 0;
    const atrRatio = atr14 / latest.close;
    const volume = volumeRatio(bars, bars.length - 1, 10) ?? 1;
    const macdLines = macd(closes);
    const histogram = macdLines.histogram.at(-1) ?? 0;
    const previousHistogram = macdLines.histogram.at(-2) ?? histogram;
    let score = 25;
    const reasons = [];
    const risks = [];
    if (latest.close >= ma5 && ma5 >= ma10) {
        score += 14;
        reasons.push('收盘位于MA5上方且短均线偏强');
    }
    if (ma10 >= ma20) {
        score += 10;
        reasons.push('MA10不弱于MA20');
    }
    if (histogram > 0 && histogram >= previousHistogram) {
        score += 12;
        reasons.push('MACD动能为正且未收缩');
    }
    if (volume >= 1.2) {
        score += Math.min(12, volume * 5);
        reasons.push(`日线量比${volume.toFixed(2)}`);
    }
    if (atrRatio >= 0.01 && atrRatio <= 0.05) {
        score += 12;
        reasons.push(`ATR波动率${(atrRatio * 100).toFixed(2)}%，具备日内空间`);
    }
    else if (atrRatio > 0.08) {
        score -= 15;
        risks.push('波动率过高，超出小账户稳定试错范围');
    }
    else {
        score -= 6;
        risks.push('波动空间偏小');
    }
    const twentyHigh = Math.max(...bars.slice(-20).map((bar) => bar.high));
    if (latest.close >= twentyHigh * 0.98) {
        score -= 8;
        risks.push('接近20日高位，追涨风险较高');
    }
    const amountScore = Math.min(15, Math.log10(Math.max(latest.amount ?? 1, 1_000_000)) * 2);
    score += amountScore;
    reasons.push(`最近交易日成交额${((latest.amount ?? 0) / 100_000_000).toFixed(2)}亿元`);
    return {
        snapshot,
        bars,
        score: Math.max(0, Math.min(100, Number(score.toFixed(2)))),
        reasons,
        risks,
        latestDate: latest.time.slice(0, 10),
    };
}
function fusionFitness(signals) {
    const entries = new Map(signals.filter((item) => item.side === 'buy').map((item) => [item.id, item]));
    const returns = [];
    for (const item of signals.filter((candidate) => candidate.side === 'sell' && candidate.virtualEntryId)) {
        const entry = entries.get(item.virtualEntryId);
        if (entry)
            returns.push((item.price - entry.price) / entry.price);
    }
    const wins = returns.filter((value) => value > 0).length;
    const winRate = returns.length > 0 ? wins / returns.length : 0;
    const average = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
    const score = returns.length < 2 ? 0 : Math.max(0, Math.min(100, winRate * 55 + Math.max(-0.02, average) * 1000 + Math.min(20, returns.length * 2)));
    return {
        score: Number(score.toFixed(2)),
        trades: returns.length,
        win_rate: Number(winRate.toFixed(3)),
        reasons: returns.length < 2 ? ['可回放虚拟交易不足2笔，融合评分降级'] : [`近端回放${returns.length}笔，胜率${(winRate * 100).toFixed(1)}%`, `平均收益${(average * 100).toFixed(2)}%`],
    };
}
function startDate(asOf, days) {
    const date = new Date(asOf);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString();
}
export async function screenConvertibleBonds(market, asOf, options = {}) {
    const limit = Math.max(1, Math.min(20, options.limit ?? 5));
    const concurrency = Math.max(1, Math.min(12, options.concurrency ?? 8));
    const rules = {
        priceMin: options.priceMin ?? 100,
        priceMax: options.priceMax ?? 180,
        amountMin: options.amountMin ?? 10_000_000,
    };
    const universe = await market.universe('cbond');
    const identityPool = universe.items.slice(0, options.universeLimit ?? universe.items.length);
    let dailyFailures = 0;
    const dailyResults = await mapLimit(identityPool, concurrency, async (snapshot) => {
        try {
            const result = await market.bars(snapshot.instrument.code, '1d', 40, { end: asOf, asOf });
            return dailyScore(snapshot, result.bars, rules);
        }
        catch {
            dailyFailures += 1;
            return null;
        }
    });
    const dailyCandidates = dailyResults.filter((item) => item != null)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(30, limit * 6));
    let intradayFailures = 0;
    const enriched = await mapLimit(dailyCandidates, Math.min(concurrency, 6), async (candidate) => {
        try {
            const result = await market.bars(candidate.snapshot.instrument.code, '1m', 5000, {
                start: startDate(asOf, 20),
                end: asOf,
                asOf,
            });
            const allSignals = [];
            for (const dayBars of groupBarsByDate(result.bars).values()) {
                allSignals.push(...runFusionStrategy(aggregateBars(dayBars, '5m')));
                allSignals.push(...runFusionStrategy(aggregateBars(dayBars, '15m')));
            }
            const fusion = fusionFitness(allSignals);
            return {
                ...candidate,
                fusion,
                combinedScore: Number((candidate.score * 0.55 + fusion.score * 0.45).toFixed(2)),
                intradayBars: result.bars.length,
            };
        }
        catch {
            intradayFailures += 1;
            return {
                ...candidate,
                fusion: { score: 0, trades: 0, win_rate: 0, reasons: ['分时历史不可用，只保留日线候选评分'] },
                combinedScore: Number((candidate.score * 0.55).toFixed(2)),
                intradayBars: 0,
            };
        }
    });
    const candidates = enriched.sort((left, right) => right.combinedScore - left.combinedScore)
        .slice(0, limit)
        .map((item, index) => ({
        rank: index + 1,
        code: item.snapshot.instrument.code,
        name: item.snapshot.instrument.name,
        score: item.combinedScore,
        daily_score: item.score,
        fusion_score: item.fusion.score,
        fusion_trades: item.fusion.trades,
        fusion_win_rate: item.fusion.win_rate,
        historical_price: item.bars.at(-1).close,
        historical_date: item.latestDate,
        reasons: [...item.reasons, ...item.fusion.reasons],
        risks: item.risks,
        action: '关注，等待当日5m closed与正股/流动性证据；不是盘前直接买入名单',
    }));
    return {
        schema_version: 1,
        mode: 'cbond_point_in_time_screen',
        generated_at: new Date().toISOString(),
        as_of: asOf,
        no_lookahead: true,
        universe: {
            source: universe.source,
            identity_snapshot: 'current_universe_reconstructed',
            survivorship_bias: universe.reconstructed,
            total_identities: universe.items.length,
            evaluated_identities: identityPool.length,
            daily_failures: dailyFailures,
            intraday_failures: intradayFailures,
        },
        rules: { ...rules, daily_weight: 0.55, fusion_weight: 0.45, periods: ['5m', '15m'] },
        candidates,
        disclaimer: '候选用于关注和后续确认，不保证收益；历史标的池为重建口径时不得声称是当日完整原始排名。',
    };
}
