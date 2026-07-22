import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildCandidateGoalProfile } from './candidate-goal-profile.js';
import { buildMarketRegime, buildScreeningShortlist, CANDIDATE_MODEL_VERSION, rankModelCandidates } from './candidate-model.js';
import { candidateModelStatus, evaluatePendingPredictions, recordCandidatePrediction } from './candidate-model-status.js';
import { readJson, tradeMasterHome, writeJson } from './storage.js';

const TYPES = ['stock', 'etf', 'cbond'];

function safeRead(relative, fallback) {
    const path = join(tradeMasterHome(), relative);
    return existsSync(path) ? readJson(path) : fallback;
}

function finite(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length)
        return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeUniverse(type, items) {
    const changes = items.map((item) => finite(item.changeRatio, NaN)).filter(Number.isFinite);
    return {
        type,
        total: items.length,
        rising: changes.filter((value) => value > 0.001).length,
        falling: changes.filter((value) => value < -0.001).length,
        flat: changes.filter((value) => Math.abs(value) <= 0.001).length,
        median_change_percent: median(changes) == null ? null : round(median(changes) * 100, 2),
        total_amount: round(items.reduce((sum, item) => sum + finite(item.amount), 0), 0),
    };
}

function poolDiff(previous, candidates) {
    const previousItems = Array.isArray(previous?.candidates)
        ? previous.candidates
        : Object.values(previous?.candidates ?? {}).flatMap((group) => [...(group?.main ?? []), ...(group?.reserve ?? [])]).map((item) => ({ ...item, instrument: item.instrument ?? { code: item.code } }));
    const oldRanks = new Map(previousItems.map((item) => [item.instrument?.code, item.rank]));
    const newRanks = new Map(candidates.map((item) => [item.instrument.code, item.rank]));
    const added = [...newRanks.keys()].filter((code) => !oldRanks.has(code));
    const removed = [...oldRanks.keys()].filter((code) => !newRanks.has(code));
    const reordered = [...newRanks.entries()].filter(([code, rank]) => oldRanks.has(code) && Math.abs(oldRanks.get(code) - rank) >= 3)
        .map(([code, rank]) => ({ code, from: oldRanks.get(code), to: rank }));
    return { added, removed, reordered, material_change: added.length > 0 || removed.length > 0 || reordered.length > 0 };
}

function syncAiRecommendations(watchlist, candidates) {
    let added = 0;
    let updated = 0;
    let removed = 0;
    const now = new Date().toISOString();
    const incoming = new Set(candidates.map((candidate) => candidate.instrument.code));
    const instruments = (watchlist.instruments ?? []).map((item) => {
        if (item.source !== 'agent' || item.status !== 'active' || incoming.has(item.code))
            return item;
        removed += 1;
        return { ...item, status: 'removed', removed_at: now, removed_by: 'agent_refresh' };
    });
    for (const candidate of candidates) {
        const instrument = candidate.instrument;
        const index = instruments.findIndex((item) => item.code === instrument.code);
        const recommendation = { ...instrument, score: candidate.score, reasons: candidate.reasons, signal: candidate.status === 'buy_ready' ? '模型买入条件已满足，等待人工复核' : '模型关注候选', model_version: CANDIDATE_MODEL_VERSION, status: 'active', source: 'agent', recommended_at: now };
        if (index < 0) {
            instruments.push(recommendation);
            added += 1;
            continue;
        }
        if (instruments[index].status === 'removed' && instruments[index].removed_by === 'user')
            continue;
        if (instruments[index].source === 'user' && instruments[index].status === 'active')
            continue;
        instruments[index] = { ...instruments[index], ...recommendation };
        updated += 1;
    }
    writeJson(join(tradeMasterHome(), 'watchlist.json'), { ...watchlist, schema_version: 1, updated_at: now, instruments });
    return { added, updated, removed, active: candidates.length };
}

export async function refreshCandidatePool(market, asOf = new Date().toISOString(), options = {}) {
    const portfolio = safeRead('portfolio.json', { positions: [] });
    const watchlist = safeRead('watchlist.json', { instruments: [] });
    const discipline = safeRead('discipline.json', { state: 'UNKNOWN' });
    const goals = safeRead('goals.json', { status: 'needs_confirmation' });
    const profile = safeRead('profile.json', {});
    const goalProfile = buildCandidateGoalProfile(goals, profile, asOf);
    const previous = safeRead('runtime/candidate-pool.json', null);
    const heldCodes = new Set((portfolio.positions ?? []).filter((item) => item.quantity > 0 && item.status !== 'closed').map((item) => item.instrument?.code));
    const activeAgentItems = (watchlist.instruments ?? []).filter((item) => item.source === 'agent' && item.status === 'active');
    const automatedRemovals = (watchlist.instruments ?? []).filter((item) => item.source === 'agent' && item.status === 'removed' && item.removed_by === 'agent_refresh' && item.removed_at);
    const latestRemoval = automatedRemovals.map((item) => item.removed_at).sort().at(-1);
    const previousAgentItems = activeAgentItems.length ? activeAgentItems : automatedRemovals.filter((item) => item.removed_at === latestRemoval);
    const previousAgentCodes = new Set(previousAgentItems.map((item) => item.code));
    const watchedCodes = new Set([...(watchlist.instruments ?? []).filter((item) => item.status === 'active').map((item) => item.code), ...previousAgentCodes]);
    const maxCandidates = Math.max(1, Math.min(options.screeningOnly ? 20 : 5, finite(options.maxCandidates, options.screeningOnly ? 20 : 5)));
    const settled = [];
    for (const type of TYPES) {
        try {
            settled.push({ status: 'fulfilled', value: { type, ...(await market.universe(type)) } });
        }
        catch (reason) {
            settled.push({ status: 'rejected', reason });
        }
    }
    const successful = settled.filter((item) => item.status === 'fulfilled').map((item) => ({ ...item.value, items: [...item.value.items] }));
    if (!successful.length) {
        const sourceErrors = settled.map((item, index) => item.status === 'rejected' ? `${TYPES[index]}: ${item.reason?.message ?? String(item.reason)}` : '').filter(Boolean);
        const failed = {
            ...(previous ?? { schema_version: 1, mode: 'candidate_refresh', candidates: [], market_breadth: [], benchmarks: [] }),
            generated_at: new Date().toISOString(),
            as_of: asOf,
            refresh_status: 'failed',
            stale_pool_preserved: Boolean(previous),
            source_errors: sourceErrors,
            diff: { added: [], removed: [], reordered: [], material_change: false },
            disclaimer: '全市场数据源暂不可用；已保留上一版候选池且禁止据此生成新的交易判断。',
        };
        writeJson(join(tradeMasterHome(), 'runtime', 'candidate-pool.json'), failed);
        return failed;
    }
    const existingByCode = new Map(previousAgentItems.map((item) => [item.code, item]));
    const availableCodes = new Set(successful.flatMap(({ items }) => items.map((item) => item.instrument.code)));
    const missingPrevious = [...previousAgentCodes].filter((code) => !availableCodes.has(code));
    const refreshedPrevious = await mapLimit(missingPrevious, 3, async (code) => {
        try {
            const result = market.quickQuote ? await market.quickQuote(code) : await market.quotes(code);
            const quote = result.quote ?? result.quotes?.[0];
            if (!quote)
                return null;
            const stored = existingByCode.get(code) ?? {};
            return {
                ...quote,
                instrument: { ...quote.instrument, name: stored.name ?? quote.instrument.name ?? code, type: stored.type ?? quote.instrument.type, exchange: stored.exchange ?? quote.instrument.exchange },
                amplitudeRatio: quote.previousClose && quote.high != null && quote.low != null ? Math.max(0, (quote.high - quote.low) / quote.previousClose) : 0,
                turnoverRatio: 0,
            };
        }
        catch {
            return null;
        }
    });
    for (const item of refreshedPrevious.filter((item) => item != null)) {
        const group = successful.find(({ type }) => type === item.instrument.type);
        if (group)
            group.items.push(item);
    }
    const marketRegime = buildMarketRegime(successful);
    const preliminary = buildScreeningShortlist(successful, heldCodes, watchedCodes, previousAgentCodes, options.screeningOnly ? 20 : 36);
    const reevaluationCount = preliminary.filter((item) => previousAgentCodes.has(item.instrument.code)).length;
    let candidates;
    let buyReadyCandidates = [];
    let analyzed = 0;
    if (options.screeningOnly) {
        candidates = preliminary.slice(0, maxCandidates).map((candidate, index) => ({
            ...candidate,
            rank: index + 1,
            score: candidate.screening_score,
            status: 'screened_for_ai',
            reasons: ['已通过分资产全市场初筛，等待日线风险与5/15分钟入场验证'],
            validation: { status: 'pending', conclusion: '这里只是模型初筛，不是买入信号' },
        }));
    }
    else {
        const validations = await mapLimit(preliminary, 5, (candidate) => monitorCandidate(market, candidate));
        const modelResult = rankModelCandidates(preliminary, validations, marketRegime, maxCandidates, goalProfile);
        candidates = modelResult.watchCandidates;
        buyReadyCandidates = modelResult.buyReadyCandidates;
        analyzed = modelResult.analyzed;
    }
    const benchmarks = successful.flatMap(({ items }) => items).filter((item) => ['510300', '510050', '159915', '588000', '512100', '513100', '513500'].includes(item.instrument.code))
        .map((item) => ({ code: item.instrument.code, name: item.instrument.name, price: item.price, change_percent: round(finite(item.changeRatio) * 100, 2), amount: item.amount }));
    if (options.screeningOnly && candidates.length < 5) {
        const failed = {
            ...(previous ?? { schema_version: 1, mode: 'candidate_refresh', candidates: [] }),
            generated_at: new Date().toISOString(),
            as_of: asOf,
            refresh_status: 'failed',
            stale_pool_preserved: Boolean(previous),
            source_errors: [`三类市场共返回 ${successful.reduce((sum, item) => sum + item.items.length, 0)} 条行情，但只有 ${candidates.length} 条通过候选初筛，未达到 AI 深度分析最低 5 条`],
            attempted_market_breadth: successful.map(({ type, items }) => summarizeUniverse(type, items)),
            disclaimer: '候选不足时禁止调用 AI 或清空原关注列表。',
        };
        writeJson(join(tradeMasterHome(), 'runtime', 'candidate-pool.json'), failed);
        return failed;
    }
    const diff = poolDiff(previous, candidates);
    const watchlistSync = options.syncWatchlist === false ? null : syncAiRecommendations(watchlist, candidates);
    const pool = {
        schema_version: 1,
        mode: 'candidate_refresh',
        generated_at: new Date().toISOString(),
        as_of: asOf,
        refresh_status: 'success',
        source: successful.map((item) => item.source),
        entry_gate: ['STOPPED', 'COOLDOWN'].includes(discipline.state) ? 'blocked_by_discipline' : 'manual_confirmation_required',
        input_state: { portfolio_as_of: portfolio.as_of ?? null, discipline: discipline.state, goals_status: goals.status ?? null, goal_profile_active: goalProfile.active },
        market_breadth: successful.map(({ type, items }) => summarizeUniverse(type, items)),
        benchmarks,
        candidates,
        watchlist_sync: watchlistSync,
        diff,
        source_errors: settled.flatMap((item, index) => item.status === 'rejected' ? [`${TYPES[index]}: ${item.reason?.message ?? String(item.reason)}`] : []),
        buy_ready_candidates: buyReadyCandidates,
        model: { ...candidateModelStatus(), model_version: CANDIDATE_MODEL_VERSION },
        market_regime: marketRegime,
        goal_profile: goalProfile,
        analyzed_candidates: analyzed,
        reevaluation: { requested: previousAgentCodes.size, reviewed: reevaluationCount },
        selection_policy: {
            maximum_candidates: maxCandidates,
            forced_minimum: false,
            mode: options.screeningOnly ? 'asset_specific_ai_review_shortlist' : 'candidate_model_v2',
            requirement: options.screeningOnly
                ? '股票、ETF、可转债分别做横截面初筛，之后补充日线风险与5/15分钟证据'
                : '分资产模型、设置中的盈利目标与期限、资金暴露和交易成本、最大回撤、日线趋势、完整5/15分钟闭合结构、独立量能和非追涨条件',
        },
        disclaimer: options.screeningOnly
            ? '这是交给深度分析的模型初筛，不是买入信号。'
            : '只输出0至5个通过绝对门槛的模型关注候选；真正买入就绪同样允许为0个。模型仍在影子验证期，不保证胜率或盈利，不连接、不操作券商账户。',
    };
    writeJson(join(tradeMasterHome(), 'runtime', 'candidate-pool.json'), pool);
    if (!options.screeningOnly) {
        pool.prediction_record = recordCandidatePrediction(pool);
        pool.model_evaluation = await evaluatePendingPredictions(market, pool.generated_at);
        pool.model = { ...candidateModelStatus(), model_version: CANDIDATE_MODEL_VERSION };
        writeJson(join(tradeMasterHome(), 'runtime', 'candidate-pool.json'), pool);
    }
    return pool;
}

async function mapLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await mapper(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

function closedBars(result) {
    return (result?.bars ?? []).filter((bar) => bar.closed !== false);
}
function average(values) {
    const usable = values.filter(Number.isFinite);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}
function returnPercent(bars, periods) {
    const selected = bars.slice(-(periods + 1));
    const first = finite(selected.at(0)?.close, NaN);
    const last = finite(selected.at(-1)?.close, NaN);
    return Number.isFinite(first) && first > 0 && Number.isFinite(last) ? round((last / first - 1) * 100, 2) : null;
}
function standardDeviation(values) {
    const usable = values.filter(Number.isFinite);
    if (usable.length < 2)
        return null;
    const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
    return Math.sqrt(usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (usable.length - 1));
}
function dailyReturns(closes) {
    return closes.slice(1).map((close, index) => closes[index] > 0 ? close / closes[index] - 1 : NaN).filter(Number.isFinite);
}
function downsideDeviation(values) {
    if (!values.length)
        return null;
    return Math.sqrt(values.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / values.length);
}
function dailyStructure(bars) {
    const closes = bars.map((bar) => finite(bar.close, NaN)).filter(Number.isFinite);
    const last = closes.at(-1) ?? null;
    const ma5 = average(closes.slice(-5));
    const ma20 = average(closes.slice(-20));
    const recentHigh = Math.max(...bars.slice(-20).map((bar) => finite(bar.high, NaN)).filter(Number.isFinite));
    const returns = dailyReturns(closes.slice(-21));
    return {
        sample_count: closes.length,
        close: last,
        ma5: ma5 == null ? null : round(ma5, 4),
        ma20: ma20 == null ? null : round(ma20, 4),
        above_ma20: last != null && ma20 != null ? last >= ma20 : null,
        return_5d_percent: returnPercent(bars, 5),
        return_20d_percent: returnPercent(bars, 20),
        drawdown_from_20d_high_percent: last != null && Number.isFinite(recentHigh) && recentHigh > 0 ? round((last / recentHigh - 1) * 100, 2) : null,
        realized_volatility_20d_percent: standardDeviation(returns) == null ? null : round(standardDeviation(returns) * 100, 2),
        downside_volatility_20d_percent: downsideDeviation(returns) == null ? null : round(downsideDeviation(returns) * 100, 2),
    };
}

async function monitorCandidate(market, candidate) {
    try {
        const [evidence5, result15, resultDaily] = await Promise.all([
            market.evidence(candidate.instrument.code, '5m', 24),
            market.bars(candidate.instrument.code, '15m', 16),
            market.bars(candidate.instrument.code, '1d', 40),
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
        const chasing = change > (candidate.type === 'cbond' ? 0.08 : 0.05) || (quote?.high && (quote.high - quote.price) / quote.high < 0.005 && change > 0.03);
        const verified = evidence5.market_state.verified && last5?.closed !== false && last15?.closed !== false;
        const status = !verified ? 'market_unavailable' : chasing ? 'waiting' : fiveMinuteConfirmed && fifteenMinuteConfirmed && volumeConfirmed ? 'attention' : 'waiting';
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
                sources: [evidence5.provider_errors?.length ? 'partial' : 'verified', result15.source, resultDaily.source].filter(Boolean),
            },
            blockers: [!verified && '实时行情或闭合K线未通过验证', chasing && '追涨风险偏高', !fiveMinuteConfirmed && '5分钟结构未确认', !fifteenMinuteConfirmed && '15分钟结构未确认', !volumeConfirmed && '量能证据不足'].filter(Boolean),
            conclusion: status === 'attention' ? '可重点关注，仍须人工核对账户、纪律、费用和现金安全垫' : status === 'waiting' ? '继续等待，不构成买入信号' : '行情证据不可用，不做交易判断',
            data_as_of: evidence5.market_state.latest_exchange_time,
        };
    }
    catch (error) {
        return { code: candidate.instrument.code, name: candidate.instrument.name, type: candidate.type, rank: candidate.rank, status: 'market_unavailable', conclusion: '行情证据不可用，不做交易判断', error: error instanceof Error ? error.message : String(error) };
    }
}

export async function monitorCandidatePool(market, limit = 12) {
    const pool = safeRead('runtime/candidate-pool.json', null);
    if (!pool?.candidates?.length)
        return { schema_version: 1, mode: 'candidate_monitor', generated_at: new Date().toISOString(), candidates: [], material_change: false, note: '候选池尚未生成，等待候选池刷新任务' };
    const discipline = safeRead('discipline.json', { state: 'UNKNOWN' });
    const goals = safeRead('goals.json', { status: 'needs_confirmation' });
    const profile = safeRead('profile.json', {});
    const goalProfile = buildCandidateGoalProfile(goals, profile);
    const previous = safeRead('runtime/candidate-monitor-latest.json', null);
    const poolCandidates = pool.candidates.slice(0, limit);
    const validations = await mapLimit(poolCandidates, 3, (candidate) => monitorCandidate(market, candidate));
    const reranked = rankModelCandidates(poolCandidates, validations, pool.market_regime ?? { state: 'mixed' }, Math.min(5, limit), goalProfile);
    const candidates = reranked.watchCandidates.map((candidate) => ({
        code: candidate.instrument.code,
        name: candidate.instrument.name,
        type: candidate.type,
        rank: candidate.rank,
        status: candidate.status,
        price: candidate.validation?.price ?? candidate.price,
        change_percent: candidate.validation?.change_percent ?? candidate.change_percent,
        ranking_score: candidate.ranking_score,
        cost_efficiency: candidate.component_scores?.cost_efficiency,
        goal_alignment: candidate.component_scores?.goal_alignment,
        goal_required_return_20d_percent: candidate.component_scores?.goal_required_return_20d_percent,
        opportunity_capacity_20d_percent: candidate.component_scores?.opportunity_capacity_20d_percent,
        checks: candidate.validation?.checks,
        technical_evidence: candidate.validation?.technical_evidence,
        blockers: candidate.validation?.blockers ?? [],
        risks: candidate.risks ?? [],
        conclusion: candidate.status === 'buy_ready'
            ? '模型与实时入场条件均已满足，仍须人工核对账户、纪律、费用和现金安全垫'
            : '模型关注门槛通过，但尚未达到买入就绪条件',
        data_as_of: candidate.validation?.data_as_of,
    }));
    const rejected = reranked.rejectedCandidates.map((candidate) => ({
        code: candidate.instrument.code,
        name: candidate.instrument.name,
        type: candidate.type,
        ranking_score: candidate.ranking_score,
        cost_efficiency: candidate.component_scores?.cost_efficiency,
        goal_alignment: candidate.component_scores?.goal_alignment,
        goal_required_return_20d_percent: candidate.component_scores?.goal_required_return_20d_percent,
        opportunity_capacity_20d_percent: candidate.component_scores?.opportunity_capacity_20d_percent,
        status: 'model_rejected',
        risks: candidate.risks ?? [],
        conclusion: '实时短周期信号即使满足，盈利目标覆盖率、回撤预算、模型绝对门槛或成本效率未通过，不再列入关注候选',
        data_as_of: candidate.validation?.data_as_of,
    }));
    const oldItems = [...(previous?.candidates ?? []), ...(previous?.rejected ?? [])];
    const currentItems = [...candidates, ...rejected];
    const oldStatus = new Map(oldItems.map((item) => [item.code, item.status]));
    const currentStatus = new Map(currentItems.map((item) => [item.code, item.status]));
    const changes = [
        ...currentItems.filter((item) => oldStatus.has(item.code) && oldStatus.get(item.code) !== item.status)
            .map((item) => ({ code: item.code, from: oldStatus.get(item.code), to: item.status })),
        ...oldItems.filter((item) => !currentStatus.has(item.code))
            .map((item) => ({ code: item.code, from: item.status, to: 'removed' })),
    ];
    const result = {
        schema_version: 1,
        mode: 'candidate_monitor',
        generated_at: new Date().toISOString(),
        pool_generated_at: pool.generated_at,
        goal_profile: goalProfile,
        entry_gate: ['STOPPED', 'COOLDOWN'].includes(discipline.state) ? 'blocked_by_discipline' : 'manual_confirmation_required',
        candidates,
        rejected,
        changes,
        material_change: changes.length > 0 || (!previous && candidates.some((item) => item.status === 'buy_ready')),
        disclaimer: '盘中短周期信号不能绕过盈利目标覆盖率、最大回撤、模型总分与成本效率门槛；buy_ready 仍不是买入指令，任何交易都必须由用户人工确认。',
    };
    writeJson(join(tradeMasterHome(), 'runtime', 'candidate-monitor-latest.json'), result);
    return result;
}
