import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildCandidateGoalProfile } from './candidate-goal-profile.js';
import { buildMarketRegime, buildScreeningShortlist, CANDIDATE_MODEL_VERSION, rankModelCandidates } from './candidate-model.js';
import { candidateModelStatus, evaluatePendingPredictions, recordCandidatePrediction } from './candidate-model-status.js';
import { buildEffectiveCandidateGoals } from './candidate-constraints.js';
import { buildCandidateUserProfile } from './candidate-user-profile.js';
import { monitorCandidate } from './candidate-validation.js';
import { buildMarketSectorSnapshot } from './market-sector-snapshot.js';
import { readJson, tradeMasterHome, writeJson } from './storage.js';

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

function nextAction(candidate) {
    if (candidate.status === 'buy_ready')
        return '人工复核买点';
    return {
        steady: '等待回踩企稳',
        short_3d: '3日内等待放量',
        medium_long: '等待趋势回踩',
        hot_leader: '等待分歧转强',
        limit_up: '只观察回封强度',
    }[candidate.strategy_lane] ?? '继续观察';
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
        const recommendation = {
            ...instrument,
            score: candidate.score,
            reasons: candidate.reasons,
            signal: candidate.status === 'buy_ready' ? '准备买入' : '观察',
            strategyLane: candidate.strategy_lane,
            strategyLabel: candidate.strategy_lane_label,
            suitableFor: candidate.suitable_for,
            nextAction: nextAction(candidate),
            model_version: CANDIDATE_MODEL_VERSION,
            status: 'active',
            source: 'agent',
            recommended_at: now,
        };
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
    const active = instruments.filter((item) => item.source === 'agent' && item.status === 'active').length;
    return { added, updated, removed, active };
}

export async function refreshCandidatePool(market, asOf = new Date().toISOString(), options = {}) {
    const portfolio = safeRead('portfolio.json', { positions: [] });
    const watchlist = safeRead('watchlist.json', { instruments: [] });
    const discipline = safeRead('discipline.json', { state: 'UNKNOWN' });
    const goals = safeRead('goals.json', { status: 'needs_confirmation' });
    const profile = safeRead('profile.json', {});
    const effectiveGoals = buildEffectiveCandidateGoals(goals, discipline);
    const goalProfile = buildCandidateGoalProfile(effectiveGoals, profile, asOf);
    const userProfile = buildCandidateUserProfile(profile, effectiveGoals);
    const previous = safeRead('runtime/candidate-pool.json', null);
    const heldCodes = new Set((portfolio.positions ?? []).filter((item) => item.quantity > 0 && item.status !== 'closed').map((item) => item.instrument?.code));
    const userRemovedCodes = new Set((watchlist.instruments ?? [])
        .filter((item) => item.status === 'removed' && item.removed_by === 'user')
        .map((item) => item.code));
    const userWatchCodes = new Set((watchlist.instruments ?? [])
        .filter((item) => item.status === 'active' && item.source === 'user')
        .map((item) => item.code));
    const excludedCodes = new Set([...heldCodes, ...userRemovedCodes, ...userWatchCodes]);
    const activeAgentItems = (watchlist.instruments ?? []).filter((item) => item.source === 'agent' && item.status === 'active');
    const automatedRemovals = (watchlist.instruments ?? []).filter((item) => item.source === 'agent' && item.status === 'removed' && item.removed_by === 'agent_refresh' && item.removed_at);
    const latestRemoval = automatedRemovals.map((item) => item.removed_at).sort().at(-1);
    const previousAgentItems = activeAgentItems.length ? activeAgentItems : automatedRemovals.filter((item) => item.removed_at === latestRemoval);
    const previousAgentCodes = new Set(previousAgentItems.map((item) => item.code));
    const watchedCodes = new Set([...(watchlist.instruments ?? []).filter((item) => item.status === 'active').map((item) => item.code), ...previousAgentCodes]);
    // 少选精选：默认 5 只；进取型及以上放宽到 8 只以覆盖龙头/热门/人气股
    const aggressiveDefault = finite(userProfile?.risk_score, 50) >= 72 ? 8 : 5;
    const maxCandidates = Math.max(1, Math.min(options.screeningOnly ? 45 : aggressiveDefault, finite(options.maxCandidates, options.screeningOnly ? 45 : aggressiveDefault)));
    const settled = [];
    for (const type of userProfile.allowed_instrument_types) {
        try {
            settled.push({ status: 'fulfilled', value: { type, ...(await market.universe(type)) } });
        }
        catch (reason) {
            settled.push({ status: 'rejected', reason });
        }
    }
    const successful = settled.filter((item) => item.status === 'fulfilled').map((item) => ({ ...item.value, items: [...item.value.items] }));
    if (!successful.length) {
        const sourceErrors = settled.map((item, index) => item.status === 'rejected' ? `${userProfile.allowed_instrument_types[index]}: ${item.reason?.message ?? String(item.reason)}` : '').filter(Boolean);
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
    let marketSectors;
    try {
        marketSectors = await market.sectors();
    }
    catch {
        marketSectors = buildMarketSectorSnapshot(successful);
    }
    const preliminary = buildScreeningShortlist(successful, excludedCodes, watchedCodes, previousAgentCodes, 45, userProfile, marketRegime, marketSectors);
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
        const validations = await mapLimit(preliminary, 5, (candidate) => monitorCandidate(market, candidate, userProfile));
        const modelResult = rankModelCandidates(preliminary, validations, marketRegime, maxCandidates, goalProfile, userProfile);
        candidates = modelResult.watchCandidates;
        buyReadyCandidates = modelResult.buyReadyCandidates;
        analyzed = modelResult.analyzed;
    }
    const benchmarks = successful.flatMap(({ items }) => items).filter((item) => ['510300', '510050', '159915', '588000', '512100', '513100', '513500'].includes(item.instrument.code))
        .map((item) => ({ code: item.instrument.code, name: item.instrument.name, price: item.price, change_percent: round(finite(item.changeRatio) * 100, 2), amount: item.amount }));
    if (options.screeningOnly && candidates.length === 0) {
        const failed = {
            ...(previous ?? { schema_version: 1, mode: 'candidate_refresh', candidates: [] }),
            generated_at: new Date().toISOString(),
            as_of: asOf,
            refresh_status: 'failed',
            stale_pool_preserved: Boolean(previous),
            source_errors: [`画像允许的市场共返回 ${successful.reduce((sum, item) => sum + item.items.length, 0)} 条行情，但没有标的通过候选初筛`],
            attempted_market_breadth: successful.map(({ type, items }) => summarizeUniverse(type, items)),
            disclaimer: '没有合格候选时禁止调用 AI 或清空原关注列表。',
        };
        writeJson(join(tradeMasterHome(), 'runtime', 'candidate-pool.json'), failed);
        return failed;
    }
    const diff = poolDiff(previous, candidates);
    const strategyBasketsComplete = options.screeningOnly || candidates.length >= (finite(userProfile?.risk_score, 50) >= 72 ? 7 : 5);
    const watchlistSync = options.syncWatchlist === false
        ? null
        : strategyBasketsComplete
            ? syncAiRecommendations(watchlist, candidates)
            : { skipped: true, reason: `五策略篮子只形成 ${candidates.length}/5 个候选，保留原关注列表` };
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
        market_sectors: marketSectors,
        benchmarks,
        candidates,
        watchlist_sync: watchlistSync,
        diff,
        source_errors: settled.flatMap((item, index) => item.status === 'rejected' ? [`${userProfile.allowed_instrument_types[index]}: ${item.reason?.message ?? String(item.reason)}`] : []),
        buy_ready_candidates: buyReadyCandidates,
        model: { ...candidateModelStatus(), model_version: CANDIDATE_MODEL_VERSION },
        market_regime: marketRegime,
        goal_profile: goalProfile,
        effective_constraints: effectiveGoals.constraints,
        user_profile_policy: userProfile,
        analyzed_candidates: analyzed,
        reevaluation: { requested: previousAgentCodes.size, reviewed: reevaluationCount },
        selection_policy: {
            maximum_candidates: maxCandidates,
            forced_minimum: false,
            strategy_baskets_complete: strategyBasketsComplete,
            mode: options.screeningOnly ? 'asset_specific_ai_review_shortlist' : 'candidate_model_v2',
            requirement: options.screeningOnly
                ? '按画像允许的品种分别做横截面初筛最多45个，之后补充日线风险与5/15分钟证据'
                : '成功结果固定5只且代码不重复：五类策略各1只；严格门槛不足时只允许观察级补位，不能自动变成买入就绪',
        },
        disclaimer: options.screeningOnly
            ? '这是交给深度分析的模型初筛，不是买入信号。'
            : strategyBasketsComplete
                ? '五类策略各1只，共5只；真正买入就绪仍允许为0。打板候选只是高风险观察，不是追涨或自动买入指令。'
                : `五策略篮子只形成 ${candidates.length}/5 个候选，本轮不替换原关注列表。`,
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

export async function monitorCandidatePool(market, limit = 12) {
    const pool = safeRead('runtime/candidate-pool.json', null);
    if (!pool?.candidates?.length)
        return { schema_version: 1, mode: 'candidate_monitor', generated_at: new Date().toISOString(), candidates: [], material_change: false, note: '候选池尚未生成，等待候选池刷新任务' };
    const discipline = safeRead('discipline.json', { state: 'UNKNOWN' });
    const goals = safeRead('goals.json', { status: 'needs_confirmation' });
    const profile = safeRead('profile.json', {});
    const effectiveGoals = buildEffectiveCandidateGoals(goals, discipline);
    const goalProfile = buildCandidateGoalProfile(effectiveGoals, profile);
    const userProfile = buildCandidateUserProfile(profile, effectiveGoals);
    const previous = safeRead('runtime/candidate-monitor-latest.json', null);
    const poolCandidates = pool.candidates.slice(0, limit);
    const validations = await mapLimit(poolCandidates, 3, (candidate) => monitorCandidate(market, candidate, userProfile));
    const reranked = rankModelCandidates(poolCandidates, validations, pool.market_regime ?? { state: 'mixed' }, Math.min(10, limit), goalProfile, userProfile);
    const candidates = reranked.watchCandidates.map((candidate) => ({
        code: candidate.instrument.code,
        name: candidate.instrument.name,
        type: candidate.type,
        rank: candidate.rank,
        status: candidate.status,
        strategy_type: candidate.strategy_type,
        strategy_lane: candidate.strategy_lane,
        strategy_lane_label: candidate.strategy_lane_label,
        suitable_for: candidate.suitable_for,
        strategy_lane_score: candidate.strategy_lane_score,
        selection_tier: candidate.selection_tier,
        price: candidate.validation?.price ?? candidate.price,
        change_percent: candidate.validation?.change_percent ?? candidate.change_percent,
        ranking_score: candidate.ranking_score,
        cost_efficiency: candidate.component_scores?.cost_efficiency,
        goal_alignment: candidate.component_scores?.goal_alignment,
        profile_alignment: candidate.component_scores?.profile_alignment,
        goal_required_return_20d_percent: candidate.component_scores?.goal_required_return_20d_percent,
        opportunity_capacity_20d_percent: candidate.component_scores?.opportunity_capacity_20d_percent,
        checks: candidate.validation?.checks,
        technical_evidence: candidate.validation?.technical_evidence,
        blockers: candidate.validation?.blockers ?? [],
        risks: candidate.risks ?? [],
        personalization: candidate.personalization,
        opportunity_evidence: candidate.opportunity_evidence,
        leadership_assessment: candidate.leadership_assessment,
        affordability: candidate.affordability,
        fundamental_assessment: candidate.fundamental_assessment,
        conclusion: candidate.status === 'buy_ready'
            ? '模型与实时入场条件均已满足，仍须人工核对账户、纪律、费用和现金安全垫'
            : candidate.selection_tier === 'fallback'
                ? '属于观察级补位，仅满足该策略的基础特征，尚未达到严格关注门槛和买入条件'
                : '模型关注门槛通过，但尚未达到买入就绪条件',
        data_as_of: candidate.validation?.data_as_of,
    }));
    const rejected = reranked.rejectedCandidates.map((candidate) => ({
        code: candidate.instrument.code,
        name: candidate.instrument.name,
        type: candidate.type,
        ranking_score: candidate.ranking_score,
        strategy_type: candidate.strategy_type,
        cost_efficiency: candidate.component_scores?.cost_efficiency,
        goal_alignment: candidate.component_scores?.goal_alignment,
        goal_required_return_20d_percent: candidate.component_scores?.goal_required_return_20d_percent,
        opportunity_capacity_20d_percent: candidate.component_scores?.opportunity_capacity_20d_percent,
        status: 'model_rejected',
        risks: candidate.risks ?? [],
        leadership_assessment: candidate.leadership_assessment,
        affordability: candidate.affordability,
        conclusion: '日线趋势、主线反弹或策略篮子基础特征未通过，不再列入关注候选',
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
        effective_constraints: effectiveGoals.constraints,
        user_profile_policy: userProfile,
        entry_gate: ['STOPPED', 'COOLDOWN'].includes(discipline.state) ? 'blocked_by_discipline' : 'manual_confirmation_required',
        candidates,
        buy_ready_candidates: candidates.filter((item) => item.status === 'buy_ready'),
        rejected,
        changes,
        material_change: changes.length > 0 || (!previous && candidates.some((item) => item.status === 'buy_ready')),
        disclaimer: '观察级候选可以未通过收益目标、回撤预算、总分或成本效率严格门槛；这些条件仍会阻止 buy_ready。任何交易都必须由用户人工确认。',
    };
    writeJson(join(tradeMasterHome(), 'runtime', 'candidate-monitor-latest.json'), result);
    return result;
}
