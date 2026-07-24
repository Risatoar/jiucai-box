import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzePlanTarget, collectLastSellContexts, shanghaiDate } from './daily-plan.js';
import { loadIntradayDecisionPolicy } from './strategy-policy.js';
import { loadPortfolio, readJson, tradeMasterHome, writeJson } from './storage.js';

const CLOSED = new Set(['closed', 'closed_case', 'removed', 'archived']);
const SUPPORTED_TYPES = new Set(['stock', 'etf', 'cbond']);

const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

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

const isReentryCandidate = (item) => item.relation === 'confirmed_holding_monitor'
    || String(item.source ?? '').includes('holding')
    || Number(item.monitoring_plan?.observed_quantity_reduction_since_previous_snapshot) > 0;

const monitorItem = async (market, item, asOf, decisionPolicy, lastSellContext) => {
    try {
        const analysis = await analyzePlanTarget(
            market,
            { instrument: item, position: null, accountScope: null, positionSource: 'watchlist' },
            shanghaiDate(new Date(asOf)),
            asOf,
            decisionPolicy,
            lastSellContext,
        );
        const guidance = analysis.position_guidance;
        const trigger = analysis.latest_signals.find((signal) => signal.id === guidance?.trigger_signal_id);
        const verified = analysis.market_state?.intraday_bars > 0 && analysis.errors.length === 0;
        const reentryCandidate = isReentryCandidate(item);
        const ready = verified
            && guidance?.state === 'entry_ready'
            && guidance.material_change === true
            && trigger?.side === 'buy'
            && trigger.kState === 'closed'
            && trigger.level === 'actionable';
        const blockers = [
            !verified && '实时行情或闭合K线未通过验证',
            !ready && guidance?.action,
        ].filter(Boolean);
        return {
            instrument: { code: item.code, name: item.name, type: item.type, exchange: item.exchange },
            source: item.source === 'agent' ? 'agent' : 'user',
            source_scope: item.source_scope,
            status: ready ? 'buy_ready' : 'watching',
            signal_strength: ready ? 'strong' : 'none',
            opportunity_type: ready && reentryCandidate ? 'reentry_after_risk_reduction' : ready ? 'new_entry' : reentryCandidate ? 'reentry_watch' : 'watch',
            price: analysis.quote?.price ?? null,
            change_percent: finite(analysis.quote?.changeRatio) * 100,
            checks: {
                quote_and_closed_bars_verified: verified,
                unified_model_entry_ready: ready,
                trigger_closed: trigger?.kState === 'closed',
                trigger_actionable: trigger?.level === 'actionable',
                reentry_candidate: reentryCandidate,
            },
            model_evidence: {
                decision_policy_id: analysis.market_state?.decision_policy_id,
                daily_trend: analysis.market_state?.daily_trend,
                position_guidance: guidance,
                trigger_signal: trigger ?? null,
                downside_risk: analysis.downside_risk,
            },
            trigger: trigger?.reasons?.join('；') ?? guidance?.action ?? '继续等待统一模型确认买点',
            invalidation: trigger?.invalidation ?? '行情证据不足时不做判断',
            blockers,
            conclusion: ready && reentryCandidate
                ? '原卖出逻辑已明显减弱，出现重新买回候选；仍须人工核对账户、费用和风险预算'
                : ready
                    ? '统一买卖点模型确认买点，仍须人工核对账户、纪律、费用和现金安全垫'
                    : '继续观察，不构成买入信号',
            data_as_of: analysis.market_state?.latest_bar ?? null,
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
    const asOf = new Date().toISOString();
    const decisionPolicy = loadIntradayDecisionPolicy();
    const ledger = safeRead('signals/ledger.json', { records: [] });
    const lastSellContexts = collectLastSellContexts(ledger.records ?? []);
    const items = await mapLimit(requested, 4, (item) => monitorItem(
        market,
        item,
        asOf,
        decisionPolicy,
        lastSellContexts.get(`${item.code}|`) ?? null,
    ));
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
        scope: '持仓与非持仓自选均使用同一套活动买卖点模型；本通道只负责非持仓买点去重提醒',
        decision_policy_id: decisionPolicy.id,
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
