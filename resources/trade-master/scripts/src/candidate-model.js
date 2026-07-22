export const CANDIDATE_MODEL_VERSION = 'candidate-model-v2.1.0';

const TYPES = ['stock', 'etf', 'cbond'];
const DEEP_SHORTLIST_PER_TYPE = 12;

const finite = (value, fallback = 0) => {
    if (value == null || value === '')
        return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, finite(value)));
const round = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};

const bell = (value, ideal, width) => clamp(100 - Math.abs(finite(value) - ideal) / Math.max(width, 0.0001) * 100);

const rankPercentiles = (items, selector) => {
    const sorted = [...items].sort((left, right) => finite(selector(left)) - finite(selector(right)));
    const result = new Map();
    let start = 0;
    while (start < sorted.length) {
        let end = start;
        const value = finite(selector(sorted[start]));
        while (end + 1 < sorted.length && finite(selector(sorted[end + 1])) === value)
            end += 1;
        const percentile = sorted.length <= 1 ? 50 : ((start + end) / 2) / (sorted.length - 1) * 100;
        for (let index = start; index <= end; index += 1)
            result.set(sorted[index].instrument.code, percentile);
        start = end + 1;
    }
    return result;
};

const tradable = (item, type, heldCodes) => {
    const instrument = item.instrument ?? {};
    const name = String(instrument.name ?? '');
    const change = finite(item.changeRatio);
    const amountFloor = type === 'stock' ? 80_000_000 : type === 'etf' ? 30_000_000 : 20_000_000;
    if (!instrument.code || heldCodes.has(instrument.code) || !item.price || finite(item.amount) < amountFloor)
        return false;
    if (/\*?ST|退市|退$/i.test(name) || /^[NC]/i.test(name) || instrument.exchange === 'BJ')
        return false;
    if (type === 'etf' && /货币|现金|日利|保证金/.test(name))
        return false;
    if (change < (type === 'cbond' ? -0.08 : -0.075) || change > (type === 'cbond' ? 0.07 : 0.045))
        return false;
    if (type === 'cbond' && (item.price < 90 || item.price > 160))
        return false;
    return true;
};

const componentWeights = {
    stock: { liquidity: 0.25, momentum: 0.28, stability: 0.25, activity: 0.22 },
    etf: { liquidity: 0.32, momentum: 0.24, stability: 0.30, activity: 0.14 },
    cbond: { liquidity: 0.24, momentum: 0.20, stability: 0.28, activity: 0.12, price: 0.16 },
};

const screeningComponents = (item, type, ranks) => {
    const changePercent = finite(item.changeRatio) * 100;
    const amplitudePercent = finite(item.amplitudeRatio) * 100;
    const turnoverPercent = finite(item.turnoverRatio) * 100;
    const momentumIdeal = type === 'stock' ? 1.5 : type === 'etf' ? 0.8 : 1.2;
    const momentumWidth = type === 'stock' ? 4.5 : type === 'etf' ? 3 : 5;
    const stabilityLimit = type === 'stock' ? 7 : type === 'etf' ? 4.5 : 6;
    const activityIdeal = type === 'stock' ? 5 : type === 'etf' ? 2 : 8;
    const activityWidth = type === 'stock' ? 8 : type === 'etf' ? 5 : 14;
    return {
        liquidity: round(ranks.amount.get(item.instrument.code) ?? 0),
        momentum: round(bell(changePercent, momentumIdeal, momentumWidth)),
        stability: round(clamp((stabilityLimit - amplitudePercent) / stabilityLimit * 100)),
        activity: round(bell(turnoverPercent, activityIdeal, activityWidth)),
        price: type === 'cbond' ? round(bell(item.price, 120, 40)) : undefined,
    };
};

const weightedScore = (components, weights) => round(Object.entries(weights)
    .reduce((sum, [key, weight]) => sum + finite(components[key]) * weight, 0));

const screeningCandidate = (item, type, ranks, watchedCodes) => {
    const components = screeningComponents(item, type, ranks);
    const baseScore = weightedScore(components, componentWeights[type]);
    const score = clamp(baseScore + (watchedCodes.has(item.instrument.code) ? 2 : 0));
    return {
        type,
        instrument: item.instrument,
        price: finite(item.price),
        change_percent: round(finite(item.changeRatio) * 100),
        amount: round(item.amount, 0),
        turnover_percent: round(finite(item.turnoverRatio) * 100),
        amplitude_percent: round(finite(item.amplitudeRatio) * 100),
        session_high: item.high ?? null,
        session_low: item.low ?? null,
        screening_score: round(score),
        screening_components: components,
        status: 'screened_for_model',
    };
};

export function buildMarketRegime(successful) {
    const stock = successful.find((item) => item.type === 'stock')?.items ?? [];
    const changes = stock.map((item) => finite(item.changeRatio, NaN)).filter(Number.isFinite);
    const risingRatio = changes.length ? changes.filter((value) => value > 0.001).length / changes.length : 0;
    const fallingRatio = changes.length ? changes.filter((value) => value < -0.001).length / changes.length : 0;
    const sorted = [...changes].sort((left, right) => left - right);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const state = fallingRatio >= 0.62 || median <= -0.012
        ? 'defensive'
        : risingRatio >= 0.58 && median >= 0.004 ? 'supportive' : 'mixed';
    return {
        state,
        stock_rising_ratio: round(risingRatio, 4),
        stock_falling_ratio: round(fallingRatio, 4),
        stock_median_change_percent: round(median * 100),
    };
}

export function buildScreeningShortlist(successful, heldCodes, watchedCodes, previousAgentCodes, maximum = 36) {
    const byType = successful.flatMap(({ type, items }) => {
        const usable = items.filter((item) => tradable(item, type, heldCodes));
        const ranks = { amount: rankPercentiles(usable, (item) => Math.log10(Math.max(1, finite(item.amount)))) };
        const ranked = usable.map((item) => screeningCandidate(item, type, ranks, watchedCodes))
            .sort((left, right) => right.screening_score - left.screening_score);
        const previous = ranked.filter((item) => previousAgentCodes.has(item.instrument.code));
        const fresh = ranked.slice(0, DEEP_SHORTLIST_PER_TYPE);
        return [...new Map([...previous, ...fresh].map((item) => [item.instrument.code, item])).values()];
    });
    return [...new Map(byType.map((item) => [item.instrument.code, item])).values()]
        .sort((left, right) => right.screening_score - left.screening_score)
        .slice(0, maximum)
        .map((item, index) => ({ ...item, rank: index + 1 }));
}

const dailyScore = (daily, type) => {
    if (!daily || daily.close == null || finite(daily.sample_count) < 20)
        return 0;
    const trend = daily.above_ma20 ? 70 : 20;
    const alignment = daily.ma5 != null && daily.ma20 != null && daily.ma5 >= daily.ma20 ? 100 : 25;
    const momentum = bell(daily.return_20d_percent, type === 'etf' ? 4 : 6, type === 'cbond' ? 8 : 10);
    const pullback = bell(daily.drawdown_from_20d_high_percent, type === 'etf' ? -4 : -6, type === 'cbond' ? 10 : 12);
    const minimumReturn = type === 'etf' ? 0.5 : type === 'cbond' ? 0.8 : 1;
    const targetReturn = type === 'etf' ? 4 : type === 'cbond' ? 5 : 8;
    const potential = clamp((finite(daily.return_20d_percent) - minimumReturn) / (targetReturn - minimumReturn) * 100);
    return round(trend * 0.25 + alignment * 0.20 + momentum * 0.20 + pullback * 0.15 + potential * 0.20);
};

const riskScore = (daily, candidate, type) => {
    const volatilityLimit = type === 'stock' ? 4.5 : type === 'etf' ? 3 : 4;
    const downsideLimit = type === 'stock' ? 3.5 : type === 'etf' ? 2.2 : 3.2;
    const volatility = clamp((volatilityLimit - finite(daily?.realized_volatility_20d_percent, volatilityLimit * 1.5)) / volatilityLimit * 100);
    const downside = clamp((downsideLimit - finite(daily?.downside_volatility_20d_percent, downsideLimit * 1.5)) / downsideLimit * 100);
    const amplitudeLimit = type === 'stock' ? 7 : type === 'etf' ? 4.5 : 6;
    const amplitude = clamp((amplitudeLimit - finite(candidate.amplitude_percent)) / amplitudeLimit * 100);
    return round(volatility * 0.4 + downside * 0.35 + amplitude * 0.25);
};

const costEfficiencyScore = (daily, type) => {
    const minimumReturn = type === 'stock' ? 2 : type === 'etf' ? 1 : 1.5;
    const fullScoreReturn = type === 'stock' ? 8 : type === 'etf' ? 4 : 6;
    return round(clamp((finite(daily?.return_20d_percent) - minimumReturn) / (fullScoreReturn - minimumReturn) * 100));
};

const goalAlignment = (daily, type, goalProfile) => {
    if (!goalProfile?.active)
        return { score: null, eligible: true, opportunity_eligible: true, drawdown_eligible: true, required_return_20d_percent: null, opportunity_capacity_20d_percent: null, downside_capacity_20d_percent: null, drawdown_budget_percent: null, coverage_ratio: null };
    const required = finite(goalProfile.required_instrument_return_20d_percent?.[type]);
    if (!(required > 0))
        return { score: 0, eligible: false, opportunity_eligible: false, drawdown_eligible: false, required_return_20d_percent: required, opportunity_capacity_20d_percent: 0, downside_capacity_20d_percent: 0, drawdown_budget_percent: null, coverage_ratio: 0 };
    const trendReturn = Math.max(0, finite(daily?.return_20d_percent));
    const volatilityCapacity = Math.max(0, finite(daily?.realized_volatility_20d_percent)) * Math.sqrt(20);
    const downsideCapacity = Math.max(0, finite(daily?.downside_volatility_20d_percent)) * Math.sqrt(20);
    const opportunityCapacity = Math.max(trendReturn, volatilityCapacity);
    const drawdownBudget = finite(goalProfile.max_instrument_drawdown_budget_percent, Infinity);
    const opportunityEligible = trendReturn >= required * 0.45 && opportunityCapacity >= required * 0.85;
    const drawdownEligible = downsideCapacity <= drawdownBudget;
    const trendCoverage = clamp(trendReturn / required * 100);
    const capacityCoverage = clamp(opportunityCapacity / required * 100);
    return {
        score: round(trendCoverage * 0.65 + capacityCoverage * 0.35),
        eligible: opportunityEligible && drawdownEligible,
        opportunity_eligible: opportunityEligible,
        drawdown_eligible: drawdownEligible,
        required_return_20d_percent: round(required),
        opportunity_capacity_20d_percent: round(opportunityCapacity),
        downside_capacity_20d_percent: round(downsideCapacity),
        drawdown_budget_percent: Number.isFinite(drawdownBudget) ? round(drawdownBudget) : null,
        coverage_ratio: round(opportunityCapacity / required, 4),
    };
};

const intradayScore = (validation) => {
    const checks = validation?.checks ?? {};
    const volumeRatio = finite(validation?.technical_evidence?.intraday?.latest_volume_vs_recent_average);
    return round((checks.quote_and_closed_bars_verified ? 20 : 0)
        + (checks.five_minute_structure ? 25 : 0)
        + (checks.fifteen_minute_structure ? 25 : 0)
        + clamp(volumeRatio / 1.5 * 25, 0, 25)
        + (checks.chasing_risk ? 0 : 5));
};

const modelWeights = {
    stock: { screening: 0.20, daily: 0.38, intraday: 0.20, risk: 0.22 },
    etf: { screening: 0.18, daily: 0.37, intraday: 0.18, risk: 0.27 },
    cbond: { screening: 0.18, daily: 0.32, intraday: 0.20, risk: 0.30 },
};

const goalAwareModelWeights = {
    stock: { screening: 0.16, daily: 0.28, intraday: 0.17, risk: 0.19, goal_alignment: 0.20 },
    etf: { screening: 0.15, daily: 0.27, intraday: 0.15, risk: 0.23, goal_alignment: 0.20 },
    cbond: { screening: 0.15, daily: 0.24, intraday: 0.17, risk: 0.24, goal_alignment: 0.20 },
};

const buyReady = (candidate, validation, scores, regime) => {
    const daily = validation?.technical_evidence?.daily;
    const threshold = regime.state === 'defensive' ? 76 : 70;
    const dailyAligned = finite(daily?.sample_count) >= 20 && daily?.above_ma20 === true && daily?.ma5 != null && daily?.ma20 != null && daily.ma5 >= daily.ma20;
    return validation?.status === 'attention'
        && dailyAligned
        && scores.risk >= 48
        && scores.cost_efficiency >= 35
        && scores.goal_alignment_eligible !== false
        && scores.total >= threshold
        && validation?.checks?.chasing_risk !== true;
};

const watchEligible = (validation, scores, regime) => {
    const daily = validation?.technical_evidence?.daily;
    const threshold = regime.state === 'defensive' ? 68 : 65;
    return finite(daily?.sample_count) >= 20
        && daily?.above_ma20 === true
        && scores.daily >= 50
        && scores.risk >= 48
        && scores.cost_efficiency >= 35
        && scores.goal_alignment_eligible !== false
        && scores.total >= threshold
        && validation?.checks?.chasing_risk !== true;
};

const explain = (candidate, validation, scores, ready, goalProfile) => {
    const daily = validation?.technical_evidence?.daily ?? {};
    const reasons = [
        `所属${candidate.type === 'stock' ? '股票' : candidate.type === 'etf' ? 'ETF' : '可转债'}模型排名靠前，风险调整分 ${scores.total}`,
        goalProfile?.active && `设置目标要求20日毛收益空间约 ${scores.goal_required_return_20d_percent}%，当前历史机会容量约 ${scores.opportunity_capacity_20d_percent}%`,
        daily.above_ma20 ? '日线位于20日均线上方' : '日线尚未站上20日均线，只能观察',
        validation?.status === 'attention' ? '5/15分钟闭合结构与量能已确认' : '盘中入场结构尚未完整确认',
    ].filter(Boolean);
    const risks = [
        scores.risk < 48 && '历史波动或日内振幅偏高',
        scores.cost_efficiency < 35 && '近20日价格空间偏小，交易成本占比风险较高',
        scores.goal_opportunity_eligible === false && `近20日趋势与波动容量不足以覆盖设置中的约 ${scores.goal_required_return_20d_percent}% 收益空间要求`,
        scores.goal_drawdown_eligible === false && `下行波动容量超过设置对应的约 ${scores.goal_drawdown_budget_percent}% 标的回撤预算`,
        validation?.checks?.chasing_risk && '接近日内高位，存在追涨风险',
        daily.above_ma20 === false && '中期趋势仍偏弱',
        ...(validation?.blockers ?? []),
    ].filter(Boolean);
    return {
        reasons: [...new Set(reasons)].slice(0, 3),
        risks: [...new Set(risks)].slice(0, 4),
        trigger: ready ? '买入条件已满足，仍须人工核对账户、纪律、费用和现金安全垫' : '继续等待日线趋势、闭合K线和量能同时满足',
        invalidation: candidate.session_low ? `跌破当日低点 ${candidate.session_low} 或日线重新跌破20日均线` : '日线跌破20日均线或短周期结构转弱',
    };
};

const selectDiverse = (ranked, limit) => {
    const counts = new Map(TYPES.map((type) => [type, 0]));
    const selected = [];
    for (const item of ranked) {
        if ((counts.get(item.type) ?? 0) >= 3)
            continue;
        selected.push(item);
        counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
        if (selected.length >= limit)
            break;
    }
    return selected;
};

export function rankModelCandidates(shortlist, validations, regime, limit = 5, goalProfile = { active: false }) {
    const validationByCode = new Map(validations.map((item) => [item.code, item]));
    const scored = shortlist.flatMap((candidate) => {
        const validation = validationByCode.get(candidate.instrument.code);
        if (!validation || validation.status === 'market_unavailable')
            return [];
        const alignment = goalAlignment(validation.technical_evidence?.daily, candidate.type, goalProfile);
        const scores = {
            screening: round(candidate.screening_score),
            daily: dailyScore(validation.technical_evidence?.daily, candidate.type),
            intraday: intradayScore(validation),
            risk: riskScore(validation.technical_evidence?.daily, candidate, candidate.type),
            cost_efficiency: costEfficiencyScore(validation.technical_evidence?.daily, candidate.type),
            goal_alignment: alignment.score,
            goal_alignment_eligible: alignment.eligible,
            goal_opportunity_eligible: alignment.opportunity_eligible,
            goal_drawdown_eligible: alignment.drawdown_eligible,
            goal_required_return_20d_percent: alignment.required_return_20d_percent,
            opportunity_capacity_20d_percent: alignment.opportunity_capacity_20d_percent,
            downside_capacity_20d_percent: alignment.downside_capacity_20d_percent,
            goal_drawdown_budget_percent: alignment.drawdown_budget_percent,
            goal_coverage_ratio: alignment.coverage_ratio,
        };
        const weights = goalProfile?.active ? goalAwareModelWeights[candidate.type] : modelWeights[candidate.type];
        const regimePenalty = regime.state === 'defensive' && candidate.type !== 'etf' ? 7 : 0;
        const costPenalty = clamp((35 - scores.cost_efficiency) / 35 * 18, 0, 18);
        const weighted = Object.entries(weights).reduce((sum, [key, weight]) => sum + finite(scores[key]) * weight, 0);
        scores.total = round(clamp(weighted - regimePenalty - costPenalty));
        const modelEligible = watchEligible(validation, scores, regime);
        const ready = buyReady(candidate, validation, scores, regime);
        return [{
            ...candidate,
            score: scores.total,
            ranking_score: scores.total,
            component_scores: scores,
            status: modelEligible && ready ? 'buy_ready' : modelEligible ? 'watching' : 'model_rejected',
            model_eligible: modelEligible,
            confidence: 'unvalidated',
            validation,
            ...explain(candidate, validation, scores, ready, goalProfile),
        }];
    });
    const ranked = scored.filter((item) => item.model_eligible)
        .sort((left, right) => right.ranking_score - left.ranking_score);
    const watchCandidates = selectDiverse(ranked, Math.max(1, Math.min(5, limit)))
        .map((item, index) => ({ ...item, rank: index + 1 }));
    return {
        watchCandidates,
        buyReadyCandidates: watchCandidates.filter((item) => item.status === 'buy_ready'),
        rejectedCandidates: scored.filter((item) => !item.model_eligible).sort((left, right) => right.ranking_score - left.ranking_score),
        analyzed: scored.length,
    };
}
