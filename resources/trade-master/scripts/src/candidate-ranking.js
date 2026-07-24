import { buildCandidateUserProfile, scoreCandidateProfileFit } from './candidate-user-profile.js';
import { assessCandidateAffordability } from './candidate-constraints.js';
import { assessReboundOpportunity, assessSectorLeadership } from './candidate-market-context.js';
import { selectCandidateMix } from './candidate-shortlist.js';

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

const dailyScore = (daily, type, userProfile = {}) => {
    if (!daily || daily.close == null || finite(daily.sample_count) < 20)
        return 0;
    const riskScore = finite(userProfile?.risk_score, 50);
    const aggressive = riskScore >= 72;
    const trend = daily.above_ma20 ? 70 : 20;
    const alignment = daily.ma5 != null && daily.ma20 != null && daily.ma5 >= daily.ma20 ? 100 : 25;
    const momentumIdeal = type === 'etf' ? 2.5 : type === 'cbond' ? 3.5 : 3;
    const momentumWidth = type === 'cbond' ? 14 : 12;
    const momentum = bell(finite(daily.return_20d_percent), momentumIdeal, aggressive ? momentumWidth * 1.8 : momentumWidth);
    const pullback = bell(finite(daily.drawdown_from_20d_high_percent), type === 'etf' ? -3 : -4.5, type === 'cbond' ? 10 : 9);
    const reversionFloor = type === 'etf' ? 15 : type === 'cbond' ? 18 : 16;
    const reversionCeiling = aggressive ? (type === 'etf' ? 28 : type === 'cbond' ? 30 : 26) : reversionFloor;
    const reversion = finite(daily.return_20d_percent) > reversionCeiling
        ? clamp(100 - (finite(daily.return_20d_percent) - reversionCeiling) * (aggressive ? 4 : 8))
        : 80;
    return round(trend * 0.22 + alignment * 0.18 + momentum * 0.22 + pullback * 0.18 + reversion * 0.20);
};

const riskScore = (daily, candidate, type, userProfile) => {
    const appetite = finite(userProfile?.risk_appetite_multiplier, 1);
    const volatilityBase = type === 'stock' ? 4.5 : type === 'etf' ? 3 : 4;
    const downsideBase = type === 'stock' ? 3.5 : type === 'etf' ? 2.2 : 3.2;
    const amplitudeBase = type === 'stock' ? 7 : type === 'etf' ? 4.5 : 6;
    const volatilityIdeal = volatilityBase * appetite * 0.52;
    const amplitudeIdeal = amplitudeBase * appetite * 0.45;
    const volatility = bell(finite(daily?.realized_volatility_20d_percent, volatilityBase * 1.5), volatilityIdeal, volatilityBase * appetite * 0.75);
    const downsideLimit = downsideBase * Math.min(1.2, appetite) * (userProfile?.behavior?.hold_loss_guard ? 0.85 : 1);
    const downside = clamp((downsideLimit - finite(daily?.downside_volatility_20d_percent, downsideLimit * 1.5)) / downsideLimit * 100);
    const amplitude = bell(finite(candidate.amplitude_percent), amplitudeIdeal, amplitudeBase * appetite * 0.8);
    return round(volatility * 0.4 + downside * 0.35 + amplitude * 0.25);
};

const costEfficiencyScore = (daily, type) => {
    const minimumReturn = type === 'stock' ? 2 : type === 'etf' ? 1 : 1.5;
    const fullScoreReturn = type === 'stock' ? 8 : type === 'etf' ? 4 : 6;
    const base = clamp((finite(daily?.return_20d_percent) - minimumReturn) / (fullScoreReturn - minimumReturn) * 100);
    const reversionCeiling = type === 'stock' ? 12 : type === 'etf' ? 8 : 10;
    const reversionPenalty = finite(daily?.return_20d_percent) > reversionCeiling
        ? (finite(daily?.return_20d_percent) - reversionCeiling) * 10
        : 0;
    return round(clamp(base - reversionPenalty));
};

const reboundCostEfficiencyScore = (rebound, type) => {
    const minimumReturn = type === 'etf' ? 0.8 : 1.2;
    const fullScoreReturn = type === 'etf' ? 4 : 6;
    return round(clamp((finite(rebound?.recovery_capacity_percent) - minimumReturn) / (fullScoreReturn - minimumReturn) * 100));
};

const goalAlignment = (daily, type, goalProfile, strategyType, rebound) => {
    if (!goalProfile?.active)
        return { score: null, eligible: true, opportunity_eligible: true, drawdown_eligible: true, required_return_20d_percent: null, opportunity_capacity_20d_percent: null, downside_capacity_20d_percent: null, drawdown_budget_percent: null, coverage_ratio: null };
    const required = finite(goalProfile.required_instrument_return_20d_percent?.[type]);
    if (!(required > 0))
        return { score: 0, eligible: false, opportunity_eligible: false, drawdown_eligible: false, required_return_20d_percent: required, opportunity_capacity_20d_percent: 0, downside_capacity_20d_percent: 0, drawdown_budget_percent: null, coverage_ratio: 0 };
    const trendReturn = strategyType === 'oversold_rebound'
        ? Math.max(0, finite(rebound?.rebound_from_low_percent))
        : Math.max(0, finite(daily?.return_20d_percent));
    const volatilityCapacity = strategyType === 'oversold_rebound'
        ? Math.max(0, finite(rebound?.recovery_capacity_percent))
        : Math.max(0, finite(daily?.realized_volatility_20d_percent)) * Math.sqrt(20);
    const downsideCapacity = Math.max(0, finite(daily?.downside_volatility_20d_percent)) * Math.sqrt(20);
    const opportunityCapacity = Math.max(trendReturn, volatilityCapacity);
    const drawdownBudget = finite(goalProfile.max_instrument_drawdown_budget_percent, Infinity);
    const minimumTrendCoverage = strategyType === 'oversold_rebound' ? 0.15 : 0.45;
    const opportunityEligible = trendReturn >= required * minimumTrendCoverage && opportunityCapacity >= required * 0.85;
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

const personalizedWeights = (type, goalActive, userProfile) => {
    const assetWeights = goalActive ? goalAwareModelWeights[type] : modelWeights[type];
    const styleWeights = userProfile?.style_weights ?? { screening: 0.20, daily: 0.37, intraday: 0.23, risk: 0.20 };
    const goalWeight = goalActive ? 0.20 : 0;
    const profileWeight = 0.08;
    const fundamentalWeight = 0.12;
    const remaining = 1 - goalWeight - profileWeight - fundamentalWeight;
    const blended = Object.fromEntries(['screening', 'daily', 'intraday', 'risk'].map((key) => [
        key,
        finite(assetWeights[key]) * 0.55 + finite(styleWeights[key]) * 0.45,
    ]));
    const total = Object.values(blended).reduce((sum, value) => sum + value, 0) || 1;
    const result = Object.fromEntries(Object.entries(blended).map(([key, value]) => [key, round(value / total * remaining, 4)]));
    if (goalActive)
        result.goal_alignment = goalWeight;
    result.profile_alignment = profileWeight;
    result.fundamental_quality = fundamentalWeight;
    return result;
};

const buyReady = (candidate, validation, scores, regime, userProfile, strategyType, rebound, affordability, fundamental, leadership) => {
    const daily = validation?.technical_evidence?.daily;
    const threshold = (regime.state === 'defensive' ? 76 : 70) + finite(userProfile?.behavior?.minimum_score_adjustment);
    const dailyAligned = strategyType === 'oversold_rebound'
        ? rebound?.eligible && rebound?.reversal_confirmed
        : finite(daily?.sample_count) >= 20
            && (daily?.above_ma20 === true || finite(daily?.ma20_slope_5d_percent) >= -0.15)
            && daily?.ma5 != null && daily?.ma20 != null
            && (daily.ma5 >= daily.ma20 || daily?.above_ma20 === true);
    return validation?.status === 'attention'
        && dailyAligned
        && affordability.eligible
        && fundamental.buy_ready_eligible !== false
        && leadership.eligible
        && scores.risk >= 48
        && scores.cost_efficiency >= 35
        && scores.goal_alignment_eligible !== false
        && scores.total >= threshold
        && validation?.checks?.chasing_risk !== true;
};

const watchEligible = (validation, scores, regime, userProfile, strategyType, rebound, leadership, fundamental) => {
    const daily = validation?.technical_evidence?.daily;
    const progressive = finite(userProfile?.risk_score, 50) >= 65;
    const aggressive = finite(userProfile?.risk_score, 50) >= 72;
    const threshold = (regime.state === 'defensive' ? 66 : progressive ? 55 : 62) + finite(userProfile?.behavior?.minimum_score_adjustment);
    const opportunityEligible = strategyType === 'oversold_rebound'
        ? rebound?.eligible && scores.daily >= 55
        : finite(daily?.sample_count) >= 20
            && (daily?.above_ma20 === true || finite(daily?.ma20_slope_5d_percent) >= -0.2)
            && (daily?.ma5 != null && daily?.ma20 != null && daily.ma5 >= daily.ma20 || daily?.above_ma20 === true)
            && scores.daily >= (aggressive ? 38 : 50);
    return finite(daily?.sample_count) >= 20
        && opportunityEligible
        && leadership.eligible
        && scores.risk >= (progressive ? 35 : 48)
        && scores.cost_efficiency >= 35
        && scores.total >= threshold
        && (fundamental == null || fundamental.buy_ready_eligible !== false || fundamental.status === 'not_applicable');
};

const watchCatalogEligible = (validation, scores, strategyType, rebound) => {
    const daily = validation?.technical_evidence?.daily;
    const trend = daily?.above_ma20 === true
        && daily?.ma5 != null
        && daily?.ma20 != null
        && daily.ma5 >= daily.ma20
        && finite(daily?.ma20_slope_5d_percent) >= -0.5;
    const reboundEligible = strategyType === 'oversold_rebound'
        && rebound?.eligible === true
        && finite(scores.daily) >= 45;
    return finite(daily?.sample_count) >= 20 && (trend || reboundEligible) && finite(scores.risk) >= 20;
};

const explain = (candidate, validation, scores, ready, goalProfile, profileFit, strategyType, rebound, affordability, fundamental, leadership) => {
    const daily = validation?.technical_evidence?.daily ?? {};
    const reasons = [
        `所属${candidate.type === 'stock' ? '股票' : candidate.type === 'etf' ? 'ETF' : '可转债'}模型排名靠前，风险调整分 ${scores.total}`,
        strategyType === 'oversold_rebound' && rebound.reason,
        leadership.eligible && leadership.reason,
        goalProfile?.active && `设置目标要求20日毛收益空间约 ${scores.goal_required_return_20d_percent}%，当前历史机会容量约 ${scores.opportunity_capacity_20d_percent}%`,
        profileFit?.reasons?.[0],
        daily.above_ma20 ? '日线位于20日均线上方' : '日线尚未站上20日均线，只能观察',
        validation?.status === 'attention' ? '5/15分钟闭合结构与量能已确认' : '盘中入场结构尚未完整确认',
    ].filter(Boolean);
    const risks = [
        scores.risk < 48 && '历史波动或日内振幅偏高',
        scores.cost_efficiency < 35 && '近20日价格空间偏小，交易成本占比风险较高',
        scores.goal_opportunity_eligible === false && `近20日趋势与波动容量不足以覆盖设置中的约 ${scores.goal_required_return_20d_percent}% 收益空间要求`,
        scores.goal_drawdown_eligible === false && `下行波动容量超过设置对应的约 ${scores.goal_drawdown_budget_percent}% 标的回撤预算`,
        validation?.checks?.chasing_risk && '接近日内高位，存在追涨风险',
        !affordability.eligible && affordability.reason,
        !leadership.eligible && leadership.reason,
        ...(fundamental?.risks ?? []),
        ...(profileFit?.risks ?? []),
        daily.above_ma20 === false && '中期趋势仍偏弱',
        ...(validation?.blockers ?? []),
    ].filter(Boolean);
    return {
        reasons: [...new Set(reasons)].slice(0, 3),
        risks: [...new Set(risks)].slice(0, 4),
        trigger: ready ? '买入条件已满足，仍须人工核对账户、纪律、费用、公告事件和现金安全垫' : strategyType === 'oversold_rebound' ? '继续等待热门板块、止跌结构、闭合K线和量能同时满足' : '继续等待日线趋势、闭合K线和量能同时满足',
        invalidation: candidate.session_low ? `跌破当日低点 ${candidate.session_low} 或日线重新跌破20日均线` : '日线跌破20日均线或短周期结构转弱',
    };
};

export function rankModelCandidates(shortlist, validations, regime, limit = 5, goalProfile = { active: false }, userProfile = buildCandidateUserProfile()) {
    const validationByCode = new Map(validations.map((item) => [item.code, item]));
    const scored = shortlist.flatMap((candidate) => {
        const validation = validationByCode.get(candidate.instrument.code);
        if (!validation || validation.status === 'market_unavailable')
            return [];
        const daily = validation.technical_evidence?.daily;
        const assessedRebound = assessReboundOpportunity(candidate, daily, validation);
        const rebound = userProfile?.opportunity_modes?.includes('oversold_rebound')
            ? assessedRebound
            : { ...assessedRebound, eligible: false, reason: '当前交易周期未启用超跌反弹通道' };
        const strategyType = rebound.eligible ? 'oversold_rebound' : 'trend';
        const alignment = goalAlignment(daily, candidate.type, goalProfile, strategyType, rebound);
        const profileFit = scoreCandidateProfileFit(candidate, daily, userProfile);
        const fundamental = validation.technical_evidence?.fundamental
            ?? { status: 'unavailable', score: 45, buy_ready_eligible: false, risks: ['基本面数据不可用'] };
        const affordability = assessCandidateAffordability(candidate, goalProfile);
        const leadership = assessSectorLeadership(candidate, daily, validation, userProfile, strategyType, rebound);
        const scores = {
            screening: round(candidate.screening_score),
            daily: strategyType === 'oversold_rebound' ? rebound.score : dailyScore(daily, candidate.type, userProfile),
            intraday: intradayScore(validation),
            risk: riskScore(daily, candidate, candidate.type, userProfile),
            cost_efficiency: strategyType === 'oversold_rebound' ? reboundCostEfficiencyScore(rebound, candidate.type) : costEfficiencyScore(daily, candidate.type),
            goal_alignment: alignment.score,
            profile_alignment: profileFit.score,
            fundamental_quality: finite(fundamental.score, 45),
            leadership_quality: leadership.score,
            goal_alignment_eligible: alignment.eligible,
            goal_opportunity_eligible: alignment.opportunity_eligible,
            goal_drawdown_eligible: alignment.drawdown_eligible,
            goal_required_return_20d_percent: alignment.required_return_20d_percent,
            opportunity_capacity_20d_percent: alignment.opportunity_capacity_20d_percent,
            downside_capacity_20d_percent: alignment.downside_capacity_20d_percent,
            goal_drawdown_budget_percent: alignment.drawdown_budget_percent,
            goal_coverage_ratio: alignment.coverage_ratio,
        };
        const weights = personalizedWeights(candidate.type, goalProfile?.active, userProfile);
        const regimePenalty = regime.state === 'defensive' && candidate.type !== 'etf'
            ? 7
            : regime.state === 'supportive' && finite(candidate.change_percent) >= finite(userProfile?.chasing_change_limits?.[candidate.type], 0.05) * 100 ? 6 : 0;
        const costPenalty = clamp((35 - scores.cost_efficiency) / 35 * 18, 0, 18);
        const leadershipPenalty = clamp((leadership.required_score - leadership.score) / leadership.required_score * 12, 0, 12);
        const weighted = Object.entries(weights).reduce((sum, [key, weight]) => sum + finite(scores[key]) * weight, 0);
        scores.total = round(clamp(weighted - regimePenalty - costPenalty - leadershipPenalty));
        const modelEligible = watchEligible(validation, scores, regime, userProfile, strategyType, rebound, leadership, fundamental);
        const catalogEligible = watchCatalogEligible(validation, scores, strategyType, rebound);
        const ready = buyReady(candidate, validation, scores, regime, userProfile, strategyType, rebound, affordability, fundamental, leadership);
        return [{
            ...candidate,
            score: scores.total,
            ranking_score: scores.total,
            component_scores: scores,
            model_weights: weights,
            strategy_type: strategyType,
            opportunity_evidence: strategyType === 'oversold_rebound' ? rebound : null,
            leadership_assessment: leadership,
            affordability,
            fundamental_assessment: fundamental,
            personalization: { risk_rating: userProfile.risk_rating, styles: userProfile.styles, experience: userProfile.experience, profile_fit: profileFit },
            status: modelEligible && ready ? 'buy_ready' : modelEligible ? 'watching' : 'model_rejected',
            model_eligible: modelEligible,
            watch_catalog_eligible: catalogEligible,
            confidence: 'unvalidated',
            validation,
            ...explain(candidate, validation, scores, ready, goalProfile, profileFit, strategyType, rebound, affordability, fundamental, leadership),
        }];
    });
    const ranked = scored.filter((item) => item.watch_catalog_eligible)
        .sort((left, right) => right.ranking_score - left.ranking_score);
    const watchCandidates = selectCandidateMix(ranked, Math.max(1, Math.min(10, limit)), userProfile)
        .map((item, index) => {
            const selectionTier = item.model_eligible ? item.selection_tier : 'fallback';
            return {
                ...item,
                rank: index + 1,
                selection_tier: selectionTier,
                status: item.model_eligible && item.status === 'buy_ready' ? 'buy_ready' : 'watching',
                risks: selectionTier === 'fallback'
                    ? ['观察级补位：只满足策略基础特征，严格门槛尚未全部通过', ...(item.risks ?? [])].slice(0, 4)
                    : item.risks,
            };
        });
    const selectedCodes = new Set(watchCandidates.map((item) => item.instrument.code));
    return {
        watchCandidates,
        buyReadyCandidates: watchCandidates.filter((item) => item.status === 'buy_ready'),
        rejectedCandidates: scored.filter((item) => !selectedCodes.has(item.instrument.code))
            .sort((left, right) => right.ranking_score - left.ranking_score),
        analyzed: scored.length,
    };
}
