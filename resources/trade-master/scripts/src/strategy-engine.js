import { aggregateBars } from './bar-utils.js';
import { macd, rollingRange, volumeRatio, vwap } from './indicators.js';
import { runFusionStrategy } from './fusion-engine.js';
import { classifyRangeLowEntry, normalizeDecisionPolicy, reentryRiskConfirmed } from './strategy-policy.js';
import { dailyRiskProfile, dailyTrend } from './strategy-risk.js';
import { selectDefenseSignals, selectRangeHighSignals, selectRangeLowSignals, selectTrendEntrySignals } from './strategy-signal-filters.js';
import { detectTdSequential } from './td-sequential.js';
function signal(bar, side, strategy, cluster, confidence, reasons, invalidation, metadata = {}) {
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
        metadata,
    };
}
function sellConfidence(strategy, dailyTrend) {
    const byStrategy = {
        support_break: { up: 0.54, range: 0.58, down: 0.62, unknown: 0.56 },
        support_break_retest: { up: 0.68, range: 0.72, down: 0.78, unknown: 0.7 },
        rally_exhaustion: { up: 0.58, range: 0.7, down: 0.72, unknown: 0.64 },
        trend_distribution_top: { up: 0.74, range: 0.7, down: 0.68, unknown: 0.68 },
        macd_weakening: { up: 0.55, range: 0.61, down: 0.66, unknown: 0.59 },
    };
    return byStrategy[strategy]?.[dailyTrend] ?? 0.56;
}
function intentMetadata(context, intent, extra = {}) {
    const preservesCore = Boolean(context.hasPosition) && ['trend_hold', 'trend_reduce', 'range_reduce', 'risk_reduce', 'reentry', 't_entry'].includes(intent);
    return {
        position_intent: intent,
        has_position: Boolean(context.hasPosition),
        account_scope: context.accountScope ?? null,
        preserve_core_position: preservesCore,
        ...extra,
    };
}
function detectStructureSignals(bars, dailyTrend, context) {
    const output = [], decisionPolicy = normalizeDecisionPolicy(context.decisionPolicy);
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
        const pullbackPct = (range.high - bar.low) / range.high * 100;
        const rangeSpan = range.high - range.low;
        const rangePosition = rangeSpan > 0 ? (bar.close - range.low) / rangeSpan : 0.5;
        const upperShadow = bar.high - Math.max(bar.open, bar.close);
        const body = Math.max(Math.abs(bar.close - bar.open), bar.close * 0.0005);
        const histogram = macdLines.histogram[index] ?? 0;
        const previousHistogram = macdLines.histogram[index - 1] ?? 0;
        if (bar.close < range.low * 0.999) {
            brokenSupport = range.low;
            output.push(signal(bar, 'sell', 'support_break', `support-${bar.period}`, sellConfidence('support_break', dailyTrend), [`闭合价跌破滚动支撑${range.low.toFixed(3)}`, `量比${ratio.toFixed(2)}`], `后续闭合K收回${range.low.toFixed(3)}则破位失效`, intentMetadata(context, 'risk_reduce', { market_regime: dailyTrend })));
            continue;
        }
        if (brokenSupport != null) {
            if (bar.close >= brokenSupport) {
                brokenSupport = null;
            }
            else if (bar.high < brokenSupport * 1.003 && bar.close < previous.close) {
                output.push(signal(bar, 'sell', 'support_break_retest', `support-${bar.period}`, sellConfidence('support_break_retest', dailyTrend), [`此前跌破${brokenSupport.toFixed(3)}`, '反抽未收回且再次转弱'], `闭合K重新站回${brokenSupport.toFixed(3)}`, intentMetadata(context, 'risk_reduce', { market_regime: dailyTrend, failed_retest: true })));
                brokenSupport = null;
            }
        }
        const aboveVwap = currentVwap == null || bar.close >= currentVwap;
        const breakout = bar.close > range.high * 1.001;
        const reclaimPrice = Number(context.lastSellPrice) * (1 + decisionPolicy.reclaim_reentry_pct / 100);
        const reclaimedSoldLevel = Number.isFinite(reclaimPrice)
            && reclaimPrice > 0
            && previous.close < reclaimPrice
            && bar.close >= reclaimPrice
            && ratio >= decisionPolicy.reclaim_reentry_min_volume_ratio
            && aboveVwap;
        if (reclaimedSoldLevel) {
            output.push(signal(bar, 'buy', 'sold_level_reclaim', `sold-reclaim-${bar.period}`, 0.76, [
                `重新收复此前卖出位${Number(context.lastSellPrice).toFixed(3)}`,
                `量比${ratio.toFixed(2)}，旧卖点失效`,
                '仅接回此前已卖出的仓位，不新增计划外风险暴露',
            ], `闭合K重新跌回${Number(context.lastSellPrice).toFixed(3)}下方`, intentMetadata(context, 'reentry', {
                market_regime: dailyTrend,
                reclaimed_sell_price: Number(context.lastSellPrice),
                volume_ratio: ratio,
                max_reentry_quantity: context.soldQuantity ?? null,
            })));
        }
        const fastReversal = dailyTrend === 'down'
            && reboundPct >= 3
            && breakout
            && ratio >= 1.8
            && aboveVwap
            && bar.close > previous.close;
        if (fastReversal) {
            output.push(signal(bar, 'buy', 'fast_reversal_reentry', `reentry-${bar.period}`, 0.74, [
                `距阶段低点反弹${reboundPct.toFixed(2)}%`,
                `放量突破${range.high.toFixed(3)}，量比${ratio.toFixed(2)}`,
                context.hasPosition ? '下跌风险释放后进入分批接回评估' : '下降趋势快速修复，只允许小仓确认',
            ], `闭合K重新跌回${range.high.toFixed(3)}下方或跌破${range.low.toFixed(3)}`, intentMetadata(context, context.hasPosition ? 'reentry' : 'reversal_entry', {
                market_regime: dailyTrend,
                recovery_from_downtrend: true,
                max_reentry_quantity: context.soldQuantity ?? null,
                rebound_pct: reboundPct,
                volume_ratio: ratio,
            })));
        }
        if (reboundPct >= 0.8 && bar.close > previous.close && ratio >= 1 && (currentVwap == null || bar.close >= currentVwap)) {
            const confidence = dailyTrend === 'up'
                ? 0.74
                : dailyTrend === 'down' && reboundPct >= 1.5 && ratio >= 1.2
                    ? 0.64
                    : dailyTrend === 'down'
                        ? 0.56
                        : 0.64;
            output.push(signal(bar, 'buy', 'stage_support_rebound', `support-rebound-${bar.period}`, confidence, [`距滚动低点反弹${reboundPct.toFixed(2)}%`, `量比${ratio.toFixed(2)}`, dailyTrend === 'down' ? '日线仍弱，作为持仓低吸或接回候选' : '日线未形成逆风'], `重新跌破${range.low.toFixed(3)}`, intentMetadata(context, context.hasPosition ? 't_entry' : 'open', {
                market_regime: dailyTrend,
                rebound_pct: reboundPct,
                volume_ratio: ratio,
            })));
        }
        if (breakout && ratio >= 1.2) {
            const confidence = dailyTrend === 'down' && reboundPct >= 1.5 && ratio >= 1.5 ? 0.64 : dailyTrend === 'down' ? 0.58 : 0.76;
            output.push(signal(bar, 'buy', 'volume_breakout', `breakout-${bar.period}`, confidence, [`突破滚动压力${range.high.toFixed(3)}`, `量比${ratio.toFixed(2)}`], `闭合K跌回${range.high.toFixed(3)}下方`, intentMetadata(context, context.hasPosition ? 't_entry' : 'open', { market_regime: dailyTrend })));
        }
        if (dailyTrend === 'range' && rangePosition <= 0.25 && bar.close > previous.close && ratio >= 0.85) {
            output.push(signal(bar, 'buy', 'range_low_reversal', `range-low-${bar.period}`, ratio >= 1.2 ? 0.72 : 0.66, [
                `位于震荡区间下沿${range.low.toFixed(3)}附近`,
                `闭合K止跌回升，量比${ratio.toFixed(2)}`,
            ], `闭合K跌破区间下沿${range.low.toFixed(3)}`, intentMetadata(context, context.hasPosition ? 't_entry' : 'range_entry', {
                market_regime: dailyTrend,
                range_position: rangePosition,
                volume_ratio: ratio,
            })));
        }
        if (dailyTrend === 'up' && pullbackPct >= 0.6 && pullbackPct <= 3.5 && bar.close > previous.close && aboveVwap && ratio >= 0.8) {
            const closeLocation = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 0.5;
            output.push(signal(bar, 'buy', 'trend_pullback_entry', `trend-pullback-${bar.period}`, ratio >= 1.1 ? 0.76 : 0.72, [
                `上涨趋势回踩${pullbackPct.toFixed(2)}%后重新转强`,
                `闭合价守在日内均价线上，量比${ratio.toFixed(2)}`,
            ], `闭合K跌破回踩低点${bar.low.toFixed(3)}`, intentMetadata(context, context.hasPosition ? 't_entry' : 'trend_entry', {
                market_regime: dailyTrend,
                trend_hold: true,
                pullback_pct: pullbackPct,
                volume_ratio: ratio,
                previous_high_reclaimed: bar.close > previous.high,
                macd_improving: histogram > previousHistogram,
                close_location: closeLocation,
            })));
        }
        const trendDistributionTop = dailyTrend === 'up'
            && bar.high >= range.high * 0.998
            && upperShadow >= body * 1.5
            && bar.close < bar.open
            && ratio >= 1.35
            && ((currentVwap != null && bar.close < currentVwap) || bar.close < previous.low);
        if (trendDistributionTop) {
            output.push(signal(bar, 'sell', 'trend_distribution_top', `distribution-${bar.period}`, sellConfidence('trend_distribution_top', dailyTrend), [
                `上涨趋势高位放量冲高回落，量比${ratio.toFixed(2)}`,
                currentVwap != null && bar.close < currentVwap ? '闭合价跌回VWAP下方' : '闭合价跌破前一根K线低点',
                '仅高抛机动仓，核心仓继续由趋势破坏条件管理',
            ], `闭合K重新放量站上${range.high.toFixed(3)}`, intentMetadata(context, 'trend_reduce', {
                market_regime: dailyTrend,
                partial_reduce_only: true,
                reentry_required: true,
                range_position: rangePosition,
                volume_ratio: ratio,
            })));
        }
        else if (bar.high >= range.high * 0.998 && upperShadow >= body * 1.5 && bar.close < bar.open && ratio >= 1.15) {
            output.push(signal(bar, 'sell', 'rally_exhaustion', `exhaustion-${bar.period}`, sellConfidence('rally_exhaustion', dailyTrend), [`接近滚动压力${range.high.toFixed(3)}`, '放量冲高回落且上影明显'], `后续闭合K放量站上${range.high.toFixed(3)}`, intentMetadata(context, dailyTrend === 'up' ? 'trend_hold' : 'range_reduce', {
                market_regime: dailyTrend,
                range_position: rangePosition,
                volume_ratio: ratio,
                upper_shadow_ratio: upperShadow / body,
                below_vwap: currentVwap != null && bar.close < currentVwap,
            })));
        }
        if (dailyTrend === 'range' && rangePosition >= 0.8 && bar.close < previous.close && ratio >= 0.9) {
            output.push(signal(bar, 'sell', 'range_high_reversal', `range-high-${bar.period}`, ratio >= 1.2 ? 0.72 : 0.66, [
                `位于震荡区间上沿${range.high.toFixed(3)}附近`,
                `闭合K冲高转弱，量比${ratio.toFixed(2)}`,
            ], `闭合K放量站上区间上沿${range.high.toFixed(3)}`, intentMetadata(context, 'range_reduce', {
                market_regime: dailyTrend,
                range_position: rangePosition,
                volume_ratio: ratio,
                bearish_body: bar.close < bar.open,
                upper_shadow_ratio: upperShadow / body,
                close_change_pct: (bar.close / previous.close - 1) * 100,
            })));
        }
        if (previousHistogram <= 0 && histogram > 0 && bar.close >= (currentVwap ?? bar.close)) {
            output.push(signal(bar, 'buy', 'macd_vwap_cross', `momentum-${bar.period}`, dailyTrend === 'down' ? 0.58 : dailyTrend === 'up' ? 0.66 : 0.62, ['MACD柱由负转正', '价格位于VWAP上方'], 'MACD重新转负或跌回VWAP下方', intentMetadata(context, context.hasPosition ? 't_entry' : 'open', { market_regime: dailyTrend })));
        }
        if (previousHistogram >= 0 && histogram < 0 && bar.close <= previous.close) {
            output.push(signal(bar, 'sell', 'macd_weakening', `momentum-${bar.period}`, sellConfidence('macd_weakening', dailyTrend), ['MACD柱由正转负', '闭合价继续走弱'], 'MACD重新转正且价格收复局部压力', intentMetadata(context, dailyTrend === 'up' ? 'trend_hold' : 'risk_reduce', { market_regime: dailyTrend })));
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
function positionGuidance(trend, signals, context, riskProfile, decisionPolicy) {
    const policy = normalizeDecisionPolicy(decisionPolicy);
    const closed = signals.filter((item) => item.kState === 'closed');
    const actionableBuy = closed.filter((item) => item.side === 'buy' && item.level === 'actionable');
    const actionableSell = closed.filter((item) => item.side === 'sell' && item.level === 'actionable' && item.metadata?.position_intent !== 'trend_hold');
    const confirmedSell = closed.filter((item) => item.side === 'sell' && item.level === 'confirm' && item.metadata?.position_intent !== 'trend_hold');
    const confirmedBuy = closed.filter((item) => item.side === 'buy' && item.level === 'confirm');
    const latest = (items) => [...items].sort((left, right) => left.time.localeCompare(right.time)).at(-1);
    const confirmedAcrossPeriods = (items, minimum) => new Set(items.map((item) => item.period)).size >= minimum;
    const signalSpanMinutes = (items) => {
        const times = items.map((item) => Date.parse(`${item.time.replace(' ', 'T')}+08:00`)).filter(Number.isFinite);
        return times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 60000 : 0;
    };
    const strictRangeLow = selectRangeLowSignals(actionableBuy, context, riskProfile, policy);
    const strictRangeHigh = selectRangeHighSignals(actionableSell, riskProfile, policy);
    const supportRetests = actionableSell.filter((item) => item.strategy === 'support_break_retest');
    const reentrySignals = actionableBuy.filter((item) => item.strategy === 'fast_reversal_reentry');
    const reclaimSignals = actionableBuy.filter((item) => item.strategy === 'sold_level_reclaim');
    const trendTopSignals = actionableSell.filter((item) => item.strategy === 'trend_distribution_top');
    const trendEntrySignals = selectTrendEntrySignals(actionableBuy, policy);
    const within = (value, minimum, maximum) => (minimum == null || (value != null && value >= minimum))
        && (maximum == null || (value != null && value <= maximum));
    const trendRiskEligible = within(riskProfile.momentum_5d_pct, policy.trend_entry_min_momentum_5d_pct, policy.trend_entry_max_momentum_5d_pct)
        && within(riskProfile.ma20_slope_5d_pct, policy.trend_entry_min_ma20_slope_5d_pct, policy.trend_entry_max_ma20_slope_5d_pct)
        && within(riskProfile.distance_to_ma20_pct, null, policy.trend_entry_max_distance_to_ma20_pct)
        && within(riskProfile.atr_ratio_pct, null, policy.trend_entry_max_atr_ratio_pct)
        && within(riskProfile.intraday_drawdown_pct, null, policy.trend_entry_max_intraday_drawdown_pct) && within(riskProfile.next_support_distance_pct, null, policy.trend_entry_max_next_support_distance_pct);
    const confirmedTrendEntrySignals = (trendRiskEligible ? trendEntrySignals : []).filter((item) => confirmedAcrossPeriods(
        trendEntrySignals.filter((candidate) => candidate.strategy === item.strategy),
        policy.trend_entry_min_periods,
    ));
    const latestRangeLow = latest(strictRangeLow);
    const latestRangeLowIntent = latestRangeLow ? classifyRangeLowEntry(latestRangeLow, context, policy) : null;
    const latestRangeHigh = latest(strictRangeHigh);
    const latestRangeBreak = confirmedAcrossPeriods(supportRetests, policy.support_break_min_periods)
        && (!policy.range_break_requires_daily_support_broken || riskProfile.recent_support_broken)
        ? latest(supportRetests)
        : null;
    const latestFastReentry = confirmedAcrossPeriods(reentrySignals, policy.reentry_min_periods)
        && (!policy.reentry_requires_daily_repair || riskProfile.daily_repair_confirmed)
        ? latest(reentrySignals)
        : null;
    const reclaimConfirmed = confirmedAcrossPeriods(reclaimSignals, policy.reclaim_reentry_cross_periods)
        || (
            reclaimSignals.length >= policy.reclaim_reentry_min_signals
            && signalSpanMinutes(reclaimSignals) >= policy.reclaim_reentry_min_span_minutes
            && confirmedAcrossPeriods(reclaimSignals, policy.reclaim_reentry_min_periods)
        );
    const reclaimRiskEligible = (!policy.reclaim_requires_known_support || !riskProfile.no_known_support_below)
        && (policy.reclaim_reentry_min_momentum_5d_pct == null
            || riskProfile.momentum_5d_pct == null
            || riskProfile.momentum_5d_pct >= policy.reclaim_reentry_min_momentum_5d_pct)
        && (policy.reclaim_max_next_support_distance_pct == null
            || riskProfile.next_support_distance_pct <= policy.reclaim_max_next_support_distance_pct);
    const latestReclaim = reclaimConfirmed && reclaimRiskEligible
        ? latest(reclaimSignals)
        : null;
    const latestReentry = reentryRiskConfirmed(riskProfile, policy)
        ? latest([latestFastReentry, latestReclaim].filter(Boolean))
        : null;
    const latestRawTrendTop = latest(trendTopSignals);
    const latestTrendTop = confirmedAcrossPeriods(trendTopSignals, policy.trend_top_min_periods) ? latest(trendTopSignals) : null;
    const latestTrendEntry = latest(confirmedTrendEntrySignals);
    const latestDefenseSell = latest(selectDefenseSignals(actionableSell, riskProfile, policy));
    const trendBuyLeads = Boolean(latestTrendEntry && (!latestRawTrendTop || latestTrendEntry.time > latestRawTrendTop.time));
    const trendSellLeads = Boolean(latestTrendTop && (!latestTrendEntry || latestTrendTop.time >= latestTrendEntry.time));
    const defenseSellLeads = Boolean(latestDefenseSell && (!latestReentry || latestDefenseSell.time >= latestReentry.time));
    const confirmedSupportBreaks = confirmedSell.filter((item) => item.strategy === 'support_break');
    const repeatedSupportBreaks = confirmedSupportBreaks.length >= 2;
    const exitSignals = policy.exit_signal_strategies
        ? actionableSell.filter((item) => policy.exit_signal_strategies.includes(item.strategy))
        : actionableSell;
    const actionableSellPeriods = new Set(exitSignals.map((item) => item.period));
    const exitEvidencePeriods = new Set([...exitSignals, ...confirmedSupportBreaks].map((item) => item.period));
    const latestExitSignal = latest(exitSignals) ?? (repeatedSupportBreaks ? confirmedSupportBreaks.at(-1) : null);
    const exitRiskLeads = Boolean(latestExitSignal && (!latestReentry || latestExitSignal.time >= latestReentry.time));
    const fullExitPressureConfirmed = (
        policy.full_exit_min_atr_ratio_pct == null
        && policy.full_exit_max_momentum_5d_pct == null
    ) || (
        policy.full_exit_min_atr_ratio_pct != null
        && riskProfile.atr_ratio_pct != null
        && riskProfile.atr_ratio_pct >= policy.full_exit_min_atr_ratio_pct
    ) || (
        policy.full_exit_max_momentum_5d_pct != null
        && riskProfile.momentum_5d_pct != null
        && riskProfile.momentum_5d_pct <= policy.full_exit_max_momentum_5d_pct
    );
    const fullExitReady = trend === 'down'
        && exitRiskLeads
        && fullExitPressureConfirmed
        && (!policy.full_exit_requires_high_downside || riskProfile.high_downside_space)
        && (!policy.full_exit_require_multi_period || exitEvidencePeriods.size >= policy.full_exit_min_sell_periods)
        && (policy.full_exit_min_ma20_slope_5d_pct == null
            || riskProfile.ma20_slope_5d_pct >= policy.full_exit_min_ma20_slope_5d_pct)
        && (policy.full_exit_max_intraday_drawdown_pct == null
            || riskProfile.intraday_drawdown_pct <= policy.full_exit_max_intraday_drawdown_pct)
        && (
            (exitSignals.length > 0 && (
                riskProfile.high_downside_space
                || (policy.full_exit_allow_15m && actionableSellPeriods.has('15m'))
                || actionableSellPeriods.size >= policy.full_exit_min_sell_periods
            ))
            || (riskProfile.high_downside_space && repeatedSupportBreaks)
        );
    if (!context.hasPosition) {
        const entrySignal = trend === 'down'
            ? latestReentry
            : trend === 'range'
                ? latestRangeLow
                : trend === 'up'
                    ? latestTrendEntry
                    : null;
        return {
            state: entrySignal ? 'entry_ready' : confirmedBuy.length ? 'entry_watch' : 'watch',
            action: entrySignal ? '出现低位或突破买点，进入人工买入复核' : '等待高质量买点',
            preserve_core: false,
            material_change: Boolean(entrySignal),
            trade_intent: entrySignal === latestRangeLow ? latestRangeLowIntent?.trade_intent ?? 'new_entry' : 'new_entry',
            trigger_signal_id: entrySignal?.id ?? null,
        };
    }
    if (fullExitReady) {
        return {
            state: 'full_exit_ready',
            action: '下跌趋势仍有较大亏损空间，进入果断清仓复核；清仓后必须立即转入重新买回观察',
            preserve_core: false,
            material_change: true,
            reentry_plan_required: true,
            trade_intent: 'risk_exit',
            exit_reason: '关键支撑失守且下一支撑距离较远',
            trigger_signal_id: latestExitSignal?.id ?? null,
        };
    }
    if (latestReentry && (!latestExitSignal || latestReentry.time > latestExitSignal.time)) {
        return {
            state: 'reentry_ready',
            action: '原卖出压力正在解除，进入已减仓部分的分批接回评估',
            preserve_core: true,
            material_change: true,
            reentry_plan_required: false,
            trade_intent: latestReentry.strategy === 'sold_level_reclaim' ? 'risk_reclaim' : 'risk_reentry',
            trigger_signal_id: latestReentry.id,
        };
    }
    if (trend === 'up' && trendSellLeads) {
        return {
            state: 'trend_top_reduce',
            action: '上涨趋势出现顶部派发证据，只高抛机动仓并保留核心仓；卖出部分进入回踩接回观察',
            preserve_core: true,
            material_change: true,
            reentry_plan_required: true,
            trade_intent: 't_sell',
            trigger_signal_id: latestTrendTop.id,
        };
    }
    if (trend === 'up' && !trendSellLeads) {
        return {
            state: trendBuyLeads ? 'trend_add_ready' : 'trend_hold',
            action: trendBuyLeads ? '上涨趋势回踩后重新转强，可评估低吸；核心仓继续持有' : '上涨趋势未破坏，普通转弱不卖核心仓',
            preserve_core: true,
            material_change: trendBuyLeads,
            reentry_plan_required: false,
            trade_intent: trendBuyLeads ? 'new_cycle_entry' : null,
            trigger_signal_id: trendBuyLeads ? latestTrendEntry?.id ?? null : null,
        };
    }
    if (trend === 'range') {
        const latestRangeDecision = [latestRangeLow, latestRangeHigh, latestRangeBreak]
            .filter(Boolean)
            .sort((left, right) => left.time.localeCompare(right.time))
            .at(-1);
        if (latestRangeDecision?.strategy === 'support_break_retest') {
            return {
                state: 'range_break_reduce',
                action: '震荡区间下沿确认失守，进入防守减仓复核并保留接回计划',
                preserve_core: true,
                material_change: true,
                reentry_plan_required: true,
                trade_intent: 'risk_reduce',
                trigger_signal_id: latestRangeDecision.id,
            };
        }
        if (latestRangeDecision?.strategy === 'range_high_reversal') {
            return {
                state: 'range_high_reduce',
                action: '震荡上沿进入高抛复核',
                preserve_core: true,
                material_change: true,
                reentry_plan_required: true,
                trade_intent: 't_sell',
                trigger_signal_id: latestRangeDecision.id,
            };
        }
        if (latestRangeDecision?.strategy === 'range_low_reversal') {
            return {
                state: 'range_low_add',
                action: '震荡下沿进入低吸复核',
                preserve_core: true,
                material_change: true,
                reentry_plan_required: false,
                trade_intent: latestRangeLowIntent?.trade_intent ?? 'new_entry',
                trade_intent_evidence: latestRangeLowIntent,
                trigger_signal_id: latestRangeDecision.id,
            };
        }
        return {
            state: 'range_hold',
            action: '等待震荡区间边界确认',
            preserve_core: true,
            material_change: false,
            reentry_plan_required: false,
            trigger_signal_id: null,
        };
    }
    if (defenseSellLeads) {
        return {
            state: 'defense_reduce',
            action: '下跌趋势确认破位或反抽失败，优先分批降低风险并保留后续接回权',
            preserve_core: true,
            material_change: true,
            reentry_plan_required: true,
            trade_intent: 'risk_reduce',
            trigger_signal_id: latestDefenseSell?.id ?? null,
        };
    }
    return {
        state: confirmedBuy.length ? 'reentry_watch' : 'defense_hold',
        action: confirmedBuy.length ? '下跌后出现修复，开始观察低吸或接回，不再沿用旧卖出结论' : '等待破位或止跌确认，不在低位机械卖出',
        preserve_core: true,
        material_change: confirmedBuy.length > 0,
        reentry_plan_required: false,
        trigger_signal_id: null,
    };
}
export function generateStrategySignals(type, minuteBars, dailyBars, context = {}) {
    const trend = dailyTrend(dailyBars);
    const periods = ['5m', '15m'];
    const byPeriod = Object.fromEntries(periods.map((period) => [period, aggregateBars(minuteBars, period)]));
    const signals = [];
    for (const period of periods) {
        const bars = byPeriod[period];
        signals.push(...detectStructureSignals(bars, trend, context));
        signals.push(...detectTdSequential(bars));
        if (type === 'cbond')
            signals.push(...runFusionStrategy(bars));
    }
    const normalizedSignals = deduplicate(signals);
    const riskProfile = dailyRiskProfile(dailyBars, minuteBars, trend);
    return {
        daily_trend: trend,
        market_regime: trend,
        bars: { '1m': minuteBars, ...byPeriod },
        signals: normalizedSignals,
        evidence_clusters: [...new Set(signals.map((item) => item.evidenceCluster))],
        downside_risk: riskProfile,
        decision_policy_id: normalizeDecisionPolicy(context.decisionPolicy).id,
        position_guidance: positionGuidance(trend, normalizedSignals, context, riskProfile, context.decisionPolicy),
    };
}
