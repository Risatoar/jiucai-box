import { fusionConfig } from './fusion-config.js';
import { volumeRatio, vwap } from './indicators.js';
function minuteFromOpen(value) {
    const matched = value.match(/[T ](\d{2}):(\d{2})/);
    if (!matched)
        return 0;
    const minute = Number(matched[1]) * 60 + Number(matched[2]);
    return minute >= 780 ? minute - 780 + 120 : minute - 570;
}
function averageRangePct(bars, end, sample = 80) {
    const slice = bars.slice(Math.max(0, end - sample + 1), end + 1);
    const values = slice.filter((bar) => bar.close > 0).map((bar) => (bar.high - bar.low) / bar.close * 100);
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0.2;
}
function level(confidence, bar) {
    if (!bar.closed)
        return 'watch';
    if (confidence >= 0.7)
        return 'actionable';
    if (confidence >= 0.6)
        return 'confirm';
    return 'watch';
}
function exitSignal(bar, type, price, confidence, position, reason) {
    return {
        id: `${type}_${bar.period}_${bar.time}`,
        strategy: 'legacy_fusion_nine_turn',
        evidenceCluster: `fusion-rebound-${bar.period}`,
        side: 'sell',
        level: level(confidence, bar),
        period: bar.period,
        kState: bar.closed ? 'closed' : 'forming',
        time: bar.time,
        price: Number(price.toFixed(3)),
        confidence,
        reasons: [reason, '仅对应策略虚拟入场，不自动映射用户真实持仓'],
        virtualEntryId: position.id,
        invalidation: '价格重新站回退出结构且反抽确认',
    };
}
export function runFusionStrategy(bars) {
    if (bars.length < 10)
        return [];
    const config = fusionConfig(bars[0].period);
    const signals = [];
    const dayOpen = bars[0].open;
    let position = null;
    for (let index = 6; index < bars.length; index += 1) {
        const bar = bars[index];
        if (position) {
            const current = position;
            current.peakPrice = Math.max(current.peakPrice, bar.high);
            const stop = current.entryPrice * (1 - config.stopLossPct / 100);
            const target = current.entryPrice * (1 + config.takeProfitPct / 100);
            const peakProfit = (current.peakPrice - current.entryPrice) / current.entryPrice * 100;
            let exit = null;
            if (peakProfit >= config.trailingActivatePct) {
                const trailing = current.peakPrice * (1 - config.trailingPullbackPct / 100);
                if (bar.low <= trailing && bar.close < current.peakPrice) {
                    exit = exitSignal(bar, 'fusion_sell_trailing', trailing, 0.85, current, `移动保护：峰值回撤${config.trailingPullbackPct}%`);
                }
            }
            if (!exit && bar.low <= stop)
                exit = exitSignal(bar, 'fusion_sell_stop', stop, 0.9, current, `虚拟仓止损${config.stopLossPct}%`);
            if (!exit && bar.high >= target)
                exit = exitSignal(bar, 'fusion_sell_target', target, 0.9, current, `虚拟仓止盈${config.takeProfitPct}%`);
            if (exit) {
                signals.push(exit);
                if (bar.closed)
                    position = null;
            }
            continue;
        }
        if (index < config.skipBars + 6)
            continue;
        const recentHigh = Math.max(...bars.slice(Math.max(0, index - config.oversoldLookback), index + 1).map((item) => item.high));
        const drop = (recentHigh - bar.close) / recentHigh * 100;
        const oversold = drop >= config.oversoldDropPct;
        if (!oversold && bar.close < dayOpen * 0.995)
            continue;
        const ratio = volumeRatio(bars, index, 5) ?? 1;
        if (ratio < (oversold ? Math.max(0.7, config.minVolumeRatio - 0.1) : config.minVolumeRatio))
            continue;
        const currentVwap = vwap(bars, index);
        const aboveVwap = currentVwap == null || bar.close >= currentVwap;
        if (!oversold && !aboveVwap)
            continue;
        if (bar.close <= bars[index - 1].close)
            continue;
        const averageRange = averageRangePct(bars, index);
        const scale = Math.min(config.volatilityMaxScale, Math.max(1, averageRange / config.volatilityBaselinePct));
        const reboundThreshold = (oversold ? config.oversoldReboundPct * Math.max(1, scale * 0.7) : config.entryReboundPct * scale);
        const recent = bars.slice(Math.max(0, index - config.entryLookback), index);
        if (recent.length < config.entryLookback)
            continue;
        const recentLow = Math.min(...recent.map((item) => item.low));
        const trigger = recentLow * (1 + reboundThreshold / 100);
        if (bar.high < trigger)
            continue;
        const price = Math.max(trigger, bar.open);
        let confidence = 0.55;
        if (ratio >= 1.8)
            confidence += 0.1;
        else if (ratio >= 1.3)
            confidence += 0.07;
        else
            confidence += 0.04;
        if (aboveVwap)
            confidence += 0.05;
        if (oversold)
            confidence += 0.08;
        const mins = minuteFromOpen(bar.time);
        if (mins >= 30 && mins < 90)
            confidence += 0.03;
        if (mins >= 120 && confidence < config.afternoonMinConfidence)
            continue;
        confidence = Math.min(0.95, Number(confidence.toFixed(3)));
        const id = `fusion_buy_${bar.period}_${bar.time}`;
        signals.push({
            id,
            strategy: 'legacy_fusion_nine_turn',
            evidenceCluster: `fusion-rebound-${bar.period}`,
            side: 'buy',
            level: level(confidence, bar),
            period: bar.period,
            kState: bar.closed ? 'closed' : 'forming',
            time: bar.time,
            price: Number(price.toFixed(3)),
            confidence,
            reasons: [oversold ? `滚动窗口超跌${drop.toFixed(2)}%后反弹` : `低点反弹达到${reboundThreshold.toFixed(2)}%`, `量比${ratio.toFixed(2)}`, aboveVwap ? '位于VWAP上方' : '超跌模式放宽VWAP'],
            invalidation: `跌破${(price * (1 - config.stopLossPct / 100)).toFixed(3)}或结构重新走弱`,
            metadata: { stop_loss: price * (1 - config.stopLossPct / 100), target: price * (1 + config.takeProfitPct / 100), average_range_pct: averageRange },
        });
        if (bar.closed)
            position = { id, entryIndex: index, entryPrice: price, peakPrice: price };
    }
    return signals;
}
