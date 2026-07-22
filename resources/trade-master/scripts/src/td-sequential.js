function signalFor(bars, index, direction, count) {
    const bar = bars[index];
    const perfected = direction === 'buy'
        ? bar.low <= Math.min(bars[index - 2].low, bars[index - 3].low)
        : bar.high >= Math.max(bars[index - 2].high, bars[index - 3].high);
    const level = bar.closed ? (perfected ? 'confirm' : 'watch') : 'watch';
    return {
        id: `td_${direction}_${bar.period}_${bar.time}`,
        strategy: 'td_sequential_9',
        evidenceCluster: `td-sequential-${bar.period}`,
        side: direction,
        level,
        period: bar.period,
        kState: bar.closed ? 'closed' : 'forming',
        time: bar.time,
        price: bar.close,
        confidence: perfected ? 0.68 : 0.55,
        reasons: [
            `${direction === 'buy' ? '买入' : '卖出'}序列达到${count}`,
            perfected ? '第8/9根满足完善条件' : '尚未满足完善条件，只作观察',
        ],
        invalidation: direction === 'buy' ? '后续继续创新低且无止跌结构' : '后续继续创新高且无滞涨结构',
        metadata: { count, perfected, comparison_lag: 4 },
    };
}
export function detectTdSequential(bars) {
    const signals = [];
    let buyCount = 0;
    let sellCount = 0;
    for (let index = 4; index < bars.length; index += 1) {
        const current = bars[index];
        const comparison = bars[index - 4];
        buyCount = current.close < comparison.close ? buyCount + 1 : 0;
        sellCount = current.close > comparison.close ? sellCount + 1 : 0;
        if (buyCount === 9) {
            signals.push(signalFor(bars, index, 'buy', buyCount));
            buyCount = 0;
        }
        if (sellCount === 9) {
            signals.push(signalFor(bars, index, 'sell', sellCount));
            sellCount = 0;
        }
    }
    return signals;
}
