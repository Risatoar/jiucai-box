const leadershipBonus = (item) => { const leadership = Number(item.screening_leadership_score ?? 0); if (leadership >= 65) return 5; if (leadership >= 55) return 3; return 0; };
const scoreSort = (left, right) => (Number(right.screening_score ?? 0) + leadershipBonus(right)) - (Number(left.screening_score ?? 0) + leadershipBonus(left));
const rankedScoreSort = (left, right) => Number(right.ranking_score ?? 0) - Number(left.ranking_score ?? 0);


const selectWithinType = (items, quota) => {
    const ranked = [...items].sort(scoreSort);
    const selected = [];
    const add = (item) => {
        if (item && !selected.some((candidate) => candidate.instrument.code === item.instrument.code))
            selected.push(item);
    };
    for (const item of ranked.filter((candidate) => candidate.screening_lane === 'previous_agent').slice(0, quota))
        add(item);
    if (selected.length < quota)
        add(ranked.find((candidate) => candidate.screening_lane === 'rebound_probe'));
    for (const item of ranked) {
        if (selected.length >= quota)
            break;
        add(item);
    }
    return selected.slice(0, quota);
};

export function selectGlobalCandidateShortlist(items, maximum, regime = { state: 'mixed' }) {
    const effectiveMaximum = regime.state === 'defensive'
        ? Math.min(maximum, 5)
        : regime.state === 'mixed' && maximum <= 12
            ? Math.min(maximum, 8)
            : maximum;
    const unique = [...new Map(items.map((item) => [item.instrument.code, item])).values()];
    if (unique.length <= maximum)
        return unique.sort(scoreSort).map((item, index) => ({ ...item, rank: index + 1 }));
    const types = [...new Set(unique.map((item) => item.type))];
    const baseQuota = Math.floor(effectiveMaximum / types.length);
    let remainder = effectiveMaximum % types.length;
    const selected = [];
    for (const type of types) {
        const quota = baseQuota + (remainder > 0 ? 1 : 0);
        remainder -= remainder > 0 ? 1 : 0;
        selected.push(...selectWithinType(unique.filter((item) => item.type === type), quota));
    }
    const selectedCodes = new Set(selected.map((item) => item.instrument.code));
    const fallback = unique.filter((item) => !selectedCodes.has(item.instrument.code)).sort(scoreSort);
    while (selected.length < effectiveMaximum && fallback.length)
        selected.push(fallback.shift());
    return selected.sort(scoreSort).slice(0, effectiveMaximum)
        .map((item, index) => ({ ...item, rank: index + 1 }));
}

const DYNAMIC_THRESHOLDS = {
    stock: { amplitude: 5, volatility: 3.2 },
    etf: { amplitude: 4, volatility: 3 },
    cbond: { amplitude: 6, volatility: 4 },
};

export const STRATEGY_LANES = [
    { id: 'steady', label: '低波动稳健', suitable_for: '稳健选手' },
    { id: 'short_3d', label: '3日内短线', suitable_for: '短线选手' },
    { id: 'medium_long', label: '中长线趋势', suitable_for: '中长线选手' },
    { id: 'hot_leader', label: '热门主线龙头', suitable_for: '龙头战法选手' },
    { id: 'limit_up', label: '强势打板观察', suitable_for: '打板选手' },
];

export function classifyCandidateTempo(candidate, userProfile = {}) {
    const thresholds = DYNAMIC_THRESHOLDS[candidate.type] ?? DYNAMIC_THRESHOLDS.stock;
    const amplitude = Number(candidate.amplitude_percent ?? 0);
    const volatility = Number(candidate.validation?.technical_evidence?.daily?.realized_volatility_20d_percent ?? 0);
    const highElasticity = amplitude >= thresholds.amplitude || volatility >= thresholds.volatility;
    const aggressive = Number(userProfile?.risk_score ?? 50) >= 72;
    return {
        classification: highElasticity ? 'high_elasticity' : 'low_volatility',
        high_elasticity: highElasticity,
        amplitude_percent: amplitude,
        realized_volatility_20d_percent: volatility,
        maximum_low_volatility_candidates: aggressive ? 0 : 2,
    };
}

const clamp = (value) => Math.max(0, Math.min(100, Number(value ?? 0)));

const strategyLaneScore = (candidate, lane) => {
    const scores = candidate.component_scores ?? {};
    const daily = candidate.validation?.technical_evidence?.daily ?? {};
    const checks = candidate.validation?.checks ?? {};
    const context = candidate.validation?.technical_evidence?.market_context ?? {};
    const fundamental = Number(candidate.fundamental_assessment?.score ?? scores.fundamental_quality ?? 45);
    const leadership = Number(candidate.leadership_assessment?.score ?? scores.leadership_quality ?? 0);
    const mainline = Number(context.continuity?.mainline_score ?? 0);
    const change = Number(candidate.change_percent ?? 0);
    const tempo = classifyCandidateTempo(candidate);
    const trend = daily.above_ma20 === true && Number(daily.ma5 ?? 0) >= Number(daily.ma20 ?? Infinity)
        && Number(daily.ma20_slope_5d_percent ?? 0) >= -0.3;
    const rebound = candidate.strategy_type === 'oversold_rebound' && candidate.opportunity_evidence?.eligible === true;
    const intradayConfirmed = checks.five_minute_structure === true || checks.fifteen_minute_structure === true;
    const chasing = checks.chasing_risk === true;
    const definitions = {
        steady: {
            strict: !tempo.high_elasticity && !chasing && trend && Number(scores.risk ?? 0) >= 55,
            fallback: !tempo.high_elasticity && !chasing && trend && Number(scores.risk ?? 0) >= 30,
            score: Number(scores.risk ?? 0) * 0.35 + Number(scores.daily ?? 0) * 0.25 + fundamental * 0.25 + leadership * 0.15,
        },
        short_3d: {
            strict: tempo.high_elasticity && !chasing && intradayConfirmed && (trend || rebound),
            fallback: tempo.high_elasticity && !chasing && (trend || rebound),
            score: Number(scores.intraday ?? 0) * 0.35 + Number(scores.screening ?? 0) * 0.20
                + leadership * 0.20 + Number(scores.cost_efficiency ?? 0) * 0.15 + Number(scores.daily ?? 0) * 0.10,
        },
        medium_long: {
            strict: !chasing && trend && Number(daily.return_20d_percent ?? 0) > 0 && fundamental >= 45,
            fallback: !chasing && (trend || rebound) && fundamental >= 35,
            score: Number(scores.daily ?? 0) * 0.35 + fundamental * 0.25 + Number(scores.risk ?? 0) * 0.20
                + leadership * 0.20,
        },
        hot_leader: {
            strict: tempo.high_elasticity && !chasing && (trend || rebound) && mainline >= 55 && leadership >= 55,
            fallback: !chasing && (trend || rebound) && mainline >= 40 && leadership >= 40,
            score: leadership * 0.35 + mainline * 0.30 + Number(scores.screening ?? 0) * 0.20 + Number(scores.daily ?? 0) * 0.15,
        },
        limit_up: {
            strict: candidate.type === 'stock' && tempo.high_elasticity && trend && change >= 5 && change <= 21 && leadership >= 55,
            fallback: candidate.type === 'stock' && tempo.high_elasticity && (trend || rebound)
                && change >= 1.5 && change <= 21 && leadership >= 40,
            score: clamp(change / 10 * 100) * 0.30 + leadership * 0.30 + Number(scores.intraday ?? 0) * 0.25
                + Number(scores.screening ?? 0) * 0.15,
        },
    };
    return definitions[lane.id];
};

export function selectCandidateMix(items, limit, userProfile = {}) {
    const ranked = [...items].sort(rankedScoreSort)
        .map((item) => ({ ...item, selection_character: classifyCandidateTempo(item, userProfile) }));
    const riskScore = Number(userProfile?.risk_score ?? 50);
    const aggressive = riskScore >= 72;
    const baseQuota = Math.max(1, Math.floor(limit / STRATEGY_LANES.length));
    const laneQuotas = new Map(STRATEGY_LANES.map((lane) => [lane.id, baseQuota]));
    if (aggressive) {
        laneQuotas.set('limit_up', baseQuota + 1);
        laneQuotas.set('hot_leader', baseQuota + 1);
    }
    // 激进用户不推低波动稳健标的，名额让给高波动篮子；maximum_low_volatility_candidates 由 classifyCandidateTempo 按风险评分算出
    const maxLowVolatilityCandidates = ranked[0]?.selection_character?.maximum_low_volatility_candidates ?? (aggressive ? 0 : 2);
    laneQuotas.set('steady', Math.min(laneQuotas.get('steady') ?? baseQuota, maxLowVolatilityCandidates));
    const selectedByLane = new Map(STRATEGY_LANES.map((lane) => [lane.id, []]));
    const used = new Set();
    const scarcityOrder = ['limit_up', 'hot_leader', 'short_3d', 'steady', 'medium_long'];
    for (const tier of ['strict', 'fallback']) {
        for (const laneId of scarcityOrder) {
            const lane = STRATEGY_LANES.find((item) => item.id === laneId);
            const remaining = (laneQuotas.get(lane.id) ?? baseQuota) - selectedByLane.get(lane.id).length;
            if (remaining <= 0)
                continue;
            const matches = ranked.map((candidate) => ({ candidate, assessment: strategyLaneScore(candidate, lane) }))
                .filter((item) => item.assessment[tier] && !used.has(item.candidate.instrument.code))
                .sort((left, right) => right.assessment.score - left.assessment.score)
                .slice(0, remaining);
            for (const { candidate, assessment } of matches) {
                used.add(candidate.instrument.code);
                selectedByLane.get(lane.id).push({
                    ...candidate,
                    strategy_lane: lane.id,
                    strategy_lane_label: lane.label,
                    suitable_for: lane.suitable_for,
                    strategy_lane_score: Math.round(assessment.score * 100) / 100,
                    selection_tier: tier,
                });
            }
        }
    }
    return STRATEGY_LANES.flatMap((lane) => selectedByLane.get(lane.id)).slice(0, limit);
}
