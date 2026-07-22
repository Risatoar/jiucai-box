import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadPortfolio, readJson, tradeMasterHome, writeJson } from './storage.js';

const CLOSED = new Set(['closed', 'closed_case', 'removed', 'archived']);
const SUPPORTED_TYPES = new Set(['stock', 'etf', 'cbond']);

const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const round = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};

const average = (values) => {
    const usable = values.filter(Number.isFinite);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
};

const closedBars = (result) => (result?.bars ?? []).filter((bar) => bar.closed !== false);

const activeWatchItems = (watchlist, portfolio, household) => {
    const heldCodes = new Set((portfolio.positions ?? [])
        .filter((item) => item.status === 'confirmed' && finite(item.quantity) > 0)
        .map((item) => item.instrument?.code));
    for (const account of household?.accounts ?? []) {
        for (const position of account.positions ?? []) {
            if (position.status === 'confirmed' && finite(position.quantity) > 0)
                heldCodes.add(position.instrument?.code);
        }
    }
    const active = [];
    const seen = new Set();
    let heldExcluded = 0;
    let inactiveExcluded = 0;
    for (const item of watchlist.instruments ?? []) {
        if (CLOSED.has(String(item.status ?? ''))) {
            inactiveExcluded += 1;
            continue;
        }
        if (heldCodes.has(item.code)) {
            heldExcluded += 1;
            continue;
        }
        if (seen.has(item.code) || !/^\d{6}$/.test(String(item.code)) || !SUPPORTED_TYPES.has(item.type))
            continue;
        seen.add(item.code);
        active.push({
            ...item,
            source_scope: item.source === 'agent' ? 'ai_discovered' : 'user_favorite',
        });
    }
    return { active, heldExcluded, inactiveExcluded };
};

const dailyStructure = (bars) => {
    const closes = bars.map((bar) => finite(bar.close, NaN)).filter(Number.isFinite);
    const close = closes.at(-1) ?? null;
    const ma5 = average(closes.slice(-5));
    const ma20 = average(closes.slice(-20));
    return {
        sample_count: closes.length,
        close,
        ma5: ma5 == null ? null : round(ma5, 4),
        ma20: ma20 == null ? null : round(ma20, 4),
        above_ma20: close != null && ma20 != null ? close >= ma20 : null,
        aligned: closes.length >= 20 && close != null && ma5 != null && ma20 != null && close >= ma20 && ma5 >= ma20,
    };
};

const chasingRisk = (item, quote) => {
    const change = finite(quote?.changeRatio);
    const threshold = item.type === 'cbond' ? 0.07 : item.type === 'etf' ? 0.035 : 0.045;
    const nearHigh = finite(quote?.high) > 0 && (finite(quote.high) - finite(quote.price)) / finite(quote.high) < 0.005;
    return change > threshold || (nearHigh && change > (item.type === 'cbond' ? 0.05 : 0.03));
};

const monitorItem = async (market, item) => {
    try {
        const [evidence5, result15, resultDaily] = await Promise.all([
            market.evidence(item.code, '5m', 24),
            market.bars(item.code, '15m', 16),
            market.bars(item.code, '1d', 40),
        ]);
        const bars5 = closedBars(evidence5);
        const bars15 = closedBars(result15);
        const daily = dailyStructure(closedBars(resultDaily));
        const last5 = bars5.at(-1);
        const previous5 = bars5.at(-2);
        const last15 = bars15.at(-1);
        const previous15 = bars15.at(-2);
        const quote = evidence5.quotes?.[0] ?? null;
        const recentVolumes = bars5.slice(-6, -1).map((bar) => finite(bar.volume, NaN)).filter((value) => value > 0);
        const averageVolume = average(recentVolumes);
        const volumeRatio = last5 && averageVolume ? finite(last5.volume) / averageVolume : null;
        const fiveMinute = Boolean(last5 && previous5 && finite(last5.close) > finite(last5.open) && finite(last5.close) > finite(previous5.close));
        const fifteenMinute = Boolean(last15 && previous15 && finite(last15.close) >= finite(last15.open) && finite(last15.close) >= finite(previous15.close));
        const volume = volumeRatio != null && volumeRatio >= 1.05;
        const chasing = chasingRisk(item, quote);
        const verified = evidence5.market_state?.verified === true && bars5.length >= 2 && bars15.length >= 2;
        const ready = verified && daily.aligned && fiveMinute && fifteenMinute && volume && !chasing;
        const blockers = [
            !verified && '实时行情或闭合K线未通过验证',
            !daily.aligned && '日线趋势未站稳20日均线',
            !fiveMinute && '5分钟买点结构未确认',
            !fifteenMinute && '15分钟买点结构未确认',
            !volume && '独立量能证据不足',
            chasing && '涨幅或位置过高，存在追涨风险',
        ].filter(Boolean);
        return {
            instrument: { code: item.code, name: item.name, type: item.type, exchange: item.exchange },
            source: item.source === 'agent' ? 'agent' : 'user',
            source_scope: item.source_scope,
            status: ready ? 'buy_ready' : 'watching',
            signal_strength: ready ? 'strong' : 'none',
            price: quote?.price ?? null,
            change_percent: round(finite(quote?.changeRatio) * 100),
            checks: {
                quote_and_closed_bars_verified: verified,
                daily_trend_aligned: daily.aligned,
                five_minute_structure: fiveMinute,
                fifteen_minute_structure: fifteenMinute,
                independent_volume: volume,
                chasing_risk: chasing,
            },
            technical_evidence: { daily, latest_volume_vs_recent_average: volumeRatio == null ? null : round(volumeRatio) },
            trigger: ready ? '日线趋势、闭合5/15分钟结构和独立量能同时确认' : '继续等待全部买点条件同时确认',
            invalidation: daily.ma20 == null ? '行情证据不足时不做判断' : `跌破20日均线 ${daily.ma20} 或短周期闭合结构转弱`,
            blockers,
            conclusion: ready ? '出现高质量技术买点，仍须人工核对账户、纪律、费用和现金安全垫' : '继续观察，不构成买入信号',
            data_as_of: evidence5.market_state?.latest_exchange_time ?? null,
        };
    }
    catch (error) {
        return {
            instrument: { code: item.code, name: item.name, type: item.type, exchange: item.exchange },
            source: item.source === 'agent' ? 'agent' : 'user',
            source_scope: item.source_scope,
            status: 'market_unavailable',
            signal_strength: 'none',
            conclusion: '行情证据不可用，不做买入判断',
            blockers: [error instanceof Error ? error.message : String(error)],
            data_as_of: null,
        };
    }
};

const mapLimit = async (items, limit, worker) => {
    const result = new Array(items.length);
    let cursor = 0;
    const run = async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            result[index] = await worker(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return result;
};

const safeRead = (relative, fallback) => {
    const path = join(tradeMasterHome(), relative);
    return existsSync(path) ? readJson(path) : fallback;
};

export async function monitorWatchlistBuyPoints(market, limit = Number.MAX_SAFE_INTEGER) {
    const portfolio = loadPortfolio();
    const watchlist = safeRead('watchlist.json', { instruments: [] });
    const household = safeRead('household/portfolio.json', null);
    const discipline = safeRead('discipline.json', { state: 'UNKNOWN' });
    const previous = safeRead('runtime/watchlist-monitor-latest.json', null);
    const selected = activeWatchItems(watchlist, portfolio, household);
    const requested = selected.active.slice(0, limit);
    const items = await mapLimit(requested, 4, (item) => monitorItem(market, item));
    const previousItems = previous?.schema_version === 2 ? previous.items ?? [] : [];
    const previousByCode = new Map(previousItems.map((item) => [item.instrument?.code, item.status]));
    const newlyReady = items.filter((item) => item.status === 'buy_ready' && previousByCode.get(item.instrument.code) !== 'buy_ready');
    const newlyInvalidated = items.filter((item) => item.status !== 'buy_ready' && previousByCode.get(item.instrument.code) === 'buy_ready');
    const pendingBuyCodes = new Set([...(previous?.pending_buy_signals ?? []).map((item) => item.instrument?.code), ...newlyReady.map((item) => item.instrument.code)]);
    const pendingInvalidatedCodes = new Set([...(previous?.pending_invalidated_buy_signals ?? []).map((item) => item.instrument?.code), ...newlyInvalidated.map((item) => item.instrument.code)]);
    const pendingBuySignals = items.filter((item) => item.status === 'buy_ready' && pendingBuyCodes.has(item.instrument.code));
    const pendingInvalidatedBuySignals = items.filter((item) => item.status !== 'buy_ready' && pendingInvalidatedCodes.has(item.instrument.code));
    const result = {
        schema_version: 2,
        mode: 'watchlist_buy_point_monitor',
        generated_at: new Date().toISOString(),
        scope: '只监控非持仓自选的买点；持仓买卖策略由持仓通道处理',
        entry_gate: ['STOPPED', 'COOLDOWN'].includes(discipline.state) ? 'blocked_by_discipline' : 'manual_confirmation_required',
        summary: {
            active_total: selected.active.length,
            analyzed: items.length,
            truncated: Math.max(0, selected.active.length - items.length),
            user_favorites: items.filter((item) => item.source_scope === 'user_favorite').length,
            ai_discovered: items.filter((item) => item.source_scope === 'ai_discovered').length,
            held_excluded: selected.heldExcluded,
            inactive_excluded: selected.inactiveExcluded,
            buy_ready: items.filter((item) => item.status === 'buy_ready').length,
        },
        items,
        newly_observed_buy_signals: newlyReady,
        newly_observed_invalidations: newlyInvalidated,
        pending_buy_signals: pendingBuySignals,
        pending_invalidated_buy_signals: pendingInvalidatedBuySignals,
        new_buy_signals: pendingBuySignals,
        invalidated_buy_signals: pendingInvalidatedBuySignals,
        material_change: pendingBuySignals.length > 0 || pendingInvalidatedBuySignals.length > 0,
        notification_rule: '首次出现高质量买点或已提醒买点失效后保持待提醒；只有对话结果成功落地并确认后才静默',
        disclaimer: '技术买点不是下单指令，任何交易都必须由用户人工确认。',
    };
    writeJson(join(tradeMasterHome(), 'runtime/watchlist-monitor-latest.json'), result);
    return result;
}

export function acknowledgeWatchlistSignals() {
    const path = join(tradeMasterHome(), 'runtime/watchlist-monitor-latest.json');
    const current = safeRead('runtime/watchlist-monitor-latest.json', null);
    if (!current)
        return { acknowledged: false, reason: '尚无自选监控状态' };
    const acknowledged = {
        buy_signals: (current.pending_buy_signals ?? []).map((item) => item.instrument?.code).filter(Boolean),
        invalidations: (current.pending_invalidated_buy_signals ?? []).map((item) => item.instrument?.code).filter(Boolean),
    };
    writeJson(path, {
        ...current,
        pending_buy_signals: [],
        pending_invalidated_buy_signals: [],
        new_buy_signals: [],
        invalidated_buy_signals: [],
        material_change: false,
        last_acknowledged_at: new Date().toISOString(),
    });
    return { acknowledged: true, ...acknowledged };
}
