import { buildCandidateUserProfile } from './candidate-user-profile.js';
import {
    buildHotThemeContext,
    buildStockSectorIndex,
    screeningMarketContext,
    screeningReboundProbeScore,
} from './candidate-market-context.js';
import { selectGlobalCandidateShortlist } from './candidate-shortlist.js';

export { rankModelCandidates } from './candidate-ranking.js';
export const CANDIDATE_MODEL_VERSION = 'candidate-model-v2.9.0-hot-pullback';

const DEEP_SHORTLIST_PER_TYPE = 10;
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

const tradable = (item, type, excludedCodes, userProfile = {}) => {
    const instrument = item.instrument ?? {};
    const name = String(instrument.name ?? '');
    const amountFloor = type === 'stock' ? 80_000_000 : type === 'etf' ? 30_000_000 : 20_000_000;
    if (!instrument.code || excludedCodes.has(instrument.code) || !item.price || finite(item.amount) < amountFloor)
        return false;
    if (/\*?ST|退市|退$/i.test(name) || /^[NC]/i.test(name) || instrument.exchange === 'BJ')
        return false;
    if (type === 'stock' && !matchStockBoard(instrument.code, userProfile?.stock_boards))
        return false;
    if (type === 'etf' && /货币|现金|日利|保证金/.test(name))
        return false;
    const riskScore = finite(userProfile?.risk_score, 50);
    const aggressive = riskScore >= 72;
    const limits = type === 'stock'
        ? { down: aggressive ? 0.15 : 0.12, up: aggressive ? 0.24 : 0.21 }
        : type === 'etf' ? { down: 0.10, up: 0.12 } : { down: 0.15, up: 0.22 };
    return finite(item.changeRatio) >= -limits.down && finite(item.changeRatio) <= limits.up;
};

const STOCK_BOARD_PREFIXES = {
    main_sh: ['600', '601', '603', '605'],
    main_sz: ['000', '001', '002', '003'],
    chinext: ['300', '301'],
    star: ['688', '689'],
};

const matchStockBoard = (code, boards) => {
    if (!Array.isArray(boards) || !boards.length)
        return true;
    const prefixes = boards.flatMap((board) => STOCK_BOARD_PREFIXES[board] ?? []);
    if (!prefixes.length)
        return true;
    return prefixes.some((prefix) => String(code).startsWith(prefix));
};

const componentWeights = {
    stock: { liquidity: 0.20, momentum: 0.15, volatility_fit: 0.25, activity: 0.05, leadership: 0.35 },
    etf: { liquidity: 0.20, momentum: 0.15, volatility_fit: 0.25, activity: 0.05, leadership: 0.35 },
    cbond: { liquidity: 0.07, momentum: 0.18, volatility_fit: 0.48, activity: 0.08, leadership: 0.19 },
};

const screeningComponents = (item, type, ranks, userProfile, marketContext) => {
    const changePercent = finite(item.changeRatio) * 100;
    const amplitudePercent = finite(item.amplitudeRatio) * 100;
    const turnoverPercent = finite(item.turnoverRatio) * 100;
    const riskScore = finite(userProfile?.risk_score, 50);
    const amplitudeBase = type === 'stock' ? 3.2 : type === 'etf' ? 1.8 : 3.5;
    const riskScale = 0.6 + riskScore / 100 * 0.8;
    const momentumCap = 3 + riskScore / 100 * 3;
    const momentum = (changePercent >= 0 ? clamp(changePercent / momentumCap * 100) : 30) * riskScale;
    const amountRank = ranks.amount.get(item.instrument.code) ?? 0;
    const turnoverRank = ranks.activityAvailable ? ranks.turnover.get(item.instrument.code) ?? 0 : 50;
    const amplitudeRank = ranks.amplitude.get(item.instrument.code) ?? 0;
    const changeRank = ranks.change.get(item.instrument.code) ?? 0;
    const sectorHeat = finite(marketContext?.sector_heat_score, finite(marketContext?.theme_heat_score, type === 'stock' ? 45 : 40));
    return {
        liquidity: round(amountRank),
        momentum: round(momentum),
        volatility_fit: round(riskScore < 30
            ? bell(amplitudePercent, amplitudeBase * 0.8, amplitudeBase * 1.2)
            : clamp(amplitudePercent / (amplitudeBase * 2 * (0.6 + riskScore / 100 * 0.6)) * 100)),
        activity: ranks.activityAvailable
            ? round(bell(turnoverPercent, type === 'stock' ? 5 : type === 'etf' ? 2 : 8, type === 'stock' ? 8 : type === 'etf' ? 5 : 14))
            : undefined,
        capital_attention: round(amountRank * 0.55 + turnoverRank * 0.30 + amplitudeRank * 0.15),
        sector_heat: round(sectorHeat),
        leadership: round(amountRank * 0.42
            + turnoverRank * 0.23
            + amplitudeRank * 0.12
            + sectorHeat * 0.18
            + changeRank * 0.05),
    };
};

const weightedScore = (components, weights) => {
    const available = Object.entries(weights).filter(([key]) => components[key] != null);
    const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    return round(available.reduce((sum, [key, weight]) => sum + finite(components[key]) * weight, 0) / totalWeight);
};

const classifyHeatState = (type, components, changePercent) => {
    if (type !== 'stock')
        return null;
    if (finite(components.leadership) < 65 || finite(components.capital_attention) < 65)
        return 'ordinary';
    if (changePercent >= 5)
        return 'hot_overheated';
    if (changePercent <= -7)
        return 'hot_breakdown';
    if (changePercent <= -0.5)
        return 'hot_pullback';
    return 'hot_trend';
};

const screeningCandidate = (item, type, ranks, watchedCodes, userProfile, hotThemes, sectorIndex) => {
    const marketContext = screeningMarketContext(item, type, hotThemes, sectorIndex);
    const components = screeningComponents(item, type, ranks, userProfile, marketContext);
    const changePercent = finite(item.changeRatio) * 100;
    const heatState = classifyHeatState(type, components, changePercent);
    const leadership = components.leadership;
    const overheatThreshold = type === 'cbond' ? 3 : type === 'stock' ? 3.5 : 3;
    const heatRiskFactor = 1 - finite(userProfile?.risk_score, 50) / 200;
    const overheatPenalty = changePercent > overheatThreshold
        ? Math.min(25 * heatRiskFactor, (changePercent - overheatThreshold) * 4 * heatRiskFactor)
        : 0;
    const amplitudeThreshold = type === 'cbond' ? 2 + finite(userProfile?.risk_score, 50) / 100 * 5 : 100;
    const amplitudePenalty = finite(item.amplitudeRatio) * 100 > amplitudeThreshold
        ? Math.min(45 * heatRiskFactor, (finite(item.amplitudeRatio) * 100 - amplitudeThreshold) * 8 * heatRiskFactor)
        : 0;
    const pullbackBonus = heatState === 'hot_pullback' ? Math.min(18, leadership * 0.22) : 0;
    const leadershipBonus = leadership >= 65 ? 20 : leadership >= 55 ? 12 : leadership >= 45 ? 5 : 0;
    const chasePenalty = changePercent >= 5 ? Math.min(15, (changePercent - 5) * 3) : 0;
    const score = clamp(weightedScore(components, componentWeights[type])
        + (watchedCodes.has(item.instrument.code) ? 2 : 0)
        + pullbackBonus + leadershipBonus - overheatPenalty - amplitudePenalty - chasePenalty);
    return {
        type,
        instrument: item.instrument,
        price: finite(item.price),
        change_percent: round(changePercent),
        amount: round(item.amount, 0),
        turnover_percent: round(finite(item.turnoverRatio) * 100),
        amplitude_percent: round(finite(item.amplitudeRatio) * 100),
        session_high: item.high ?? null,
        session_low: item.low ?? null,
        screening_score: round(score),
        screening_profile_score: round(components.volatility_fit * 0.55 + components.momentum * 0.25 + components.liquidity * 0.20),
        screening_rebound_score: screeningReboundProbeScore(item, type, marketContext, components.liquidity),
        screening_leadership_score: leadership,
        screening_components: components,
        screening_data_availability: { turnover: ranks.activityAvailable },
        market_context: marketContext,
        heat_state: heatState,
        above_ma20: item.above_ma20 ?? null,
        ma5_ge_ma20: item.ma5_ge_ma20 ?? null,
        ma20_slope_5d: item.ma20_slope_5d ?? null,
        status: 'screened_for_model',
    };
};

const selectFreshShortlist = (ranked, type, regime = { state: 'mixed' }, userProfile = {}) => {
    const profileSlots = 2;
    const minScore = regime.state === 'defensive' ? 62 : regime.state === 'mixed' ? 58 : 52;
    const riskScore = finite(userProfile?.risk_score, 50);
    const aggressive = riskScore >= 72;
    const limitUpSlots = type === 'stock' && aggressive ? 3 : type === 'stock' && riskScore >= 50 ? 1 : 0;
    const hotTrendSlots = aggressive ? 4 : 3;
    const qualityMax = aggressive ? 5 : 8;
    const qualityRankKey = (item) => {
        const leadership = finite(item.screening_leadership_score);
        const tier = leadership >= 65 ? 40 : leadership >= 55 ? 20 : 0;
        const pullback = item.heat_state === 'hot_pullback' ? 25 : 0;
        const changePenalty = finite(item.change_percent) > 2 ? (finite(item.change_percent) - 2) * 5 : 0;
        return tier + pullback - changePenalty + finite(item.screening_score) * 0.4;
    };
    const qualityRanked = ranked.filter((item) => item.screening_score >= minScore)
        .sort((left, right) => qualityRankKey(right) - qualityRankKey(left));
    const pullbackSlots = type === 'stock' && regime.state !== 'supportive' ? 4 : 0;
    const pullback = ranked.filter((item) => item.heat_state === 'hot_pullback'
        && finite(item.screening_components?.volatility_fit) >= 35)
        .sort((left, right) => finite(right.screening_leadership_score) - finite(left.screening_leadership_score))
        .slice(0, pullbackSlots)
        .map((item) => ({ ...item, screening_lane: 'pullback' }));
    const selected = new Set(pullback.map((item) => item.instrument.code));
    const hotTrend = type === 'stock'
        ? ranked.filter((item) => item.heat_state === 'hot_trend' && !selected.has(item.instrument.code))
            .sort((left, right) => finite(right.screening_leadership_score) - finite(left.screening_leadership_score))
            .slice(0, hotTrendSlots)
            .map((item) => ({ ...item, screening_lane: 'hot_trend' }))
        : [];
    hotTrend.forEach((item) => selected.add(item.instrument.code));
    const qualityBudget = Math.max(1, Math.min(qualityMax, DEEP_SHORTLIST_PER_TYPE - profileSlots - pullback.length - hotTrend.length - limitUpSlots));
    const quality = qualityRanked.filter((item) => !selected.has(item.instrument.code)
        && item.heat_state !== 'hot_overheated'
        && item.heat_state !== 'hot_breakdown'
        && finite(item.screening_leadership_score) >= (type === 'cbond' ? 35 : 45)
        && finite(item.change_percent) < (type === 'cbond' ? 5 : 3)
        && (type !== 'etf' || finite(item.screening_components?.volatility_fit) >= 30)
        && (type !== 'stock' || finite(item.screening_components?.volatility_fit) >= 45))
        .slice(0, qualityBudget)
        .map((item) => ({ ...item, screening_lane: 'quality' }));
    quality.forEach((item) => selected.add(item.instrument.code));
    const limitUp = type === 'stock' && limitUpSlots > 0
        ? ranked.filter((item) => !selected.has(item.instrument.code)
            && (item.heat_state === 'hot_overheated' || item.heat_state === 'hot_trend')
            && finite(item.screening_leadership_score) >= 60
            && finite(item.change_percent) >= 1.5
            && finite(item.change_percent) <= 24)
            .sort((left, right) => finite(right.screening_leadership_score) - finite(left.screening_leadership_score))
            .slice(0, limitUpSlots)
            .map((item) => ({ ...item, screening_lane: 'limit_up' }))
        : [];
    limitUp.forEach((item) => selected.add(item.instrument.code));
        const profileFit = ranked.filter((item) => !selected.has(item.instrument.code)
        && finite(item.screening_components?.volatility_fit) >= 30)
        .sort((left, right) =>
            finite(right.screening_profile_score) * 0.85 + finite(right.screening_leadership_score) * 0.15
            - finite(left.screening_profile_score) * 0.85 - finite(left.screening_leadership_score) * 0.15)
        .slice(0, profileSlots)
        .map((item) => ({ ...item, screening_lane: 'profile_fit' }));
    profileFit.forEach((item) => selected.add(item.instrument.code));
    const remaining = Math.max(0, DEEP_SHORTLIST_PER_TYPE - pullback.length - hotTrend.length - quality.length - profileFit.length);
    const fallback = ranked.filter((item) => !selected.has(item.instrument.code)
        && item.screening_score >= (regime.state === 'defensive' ? 60 : regime.state === 'mixed' ? 55 : 48)
        && finite(item.change_percent) < 5
        && finite(item.screening_leadership_score) >= 45
        && finite(item.screening_components?.volatility_fit) >= 30)
        .sort((left, right) => finite(right.screening_leadership_score) - finite(left.screening_leadership_score))
        .slice(0, Math.min(1, remaining))
        .map((item) => ({ ...item, screening_lane: 'quality_fallback' }));
    return [...pullback, ...hotTrend, ...limitUp, ...quality, ...profileFit, ...fallback];
};

export function buildMarketRegime(successful) {
    const stock = successful.find((item) => item.type === 'stock')?.items ?? [];
    const changes = stock.map((item) => finite(item.changeRatio, NaN)).filter(Number.isFinite);
    const risingRatio = changes.length ? changes.filter((value) => value > 0.001).length / changes.length : 0;
    const fallingRatio = changes.length ? changes.filter((value) => value < -0.001).length / changes.length : 0;
    const sorted = [...changes].sort((left, right) => left - right);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    return {
        state: fallingRatio >= 0.62 || median <= -0.012
            ? 'defensive'
            : risingRatio >= 0.58 && median >= 0.004 ? 'supportive' : 'mixed',
        stock_rising_ratio: round(risingRatio, 4),
        stock_falling_ratio: round(fallingRatio, 4),
        stock_median_change_percent: round(median * 100),
    };
}

export function buildScreeningShortlist(successful, excludedCodes, watchedCodes, previousAgentCodes, maximum = 36, userProfile = buildCandidateUserProfile(), regime = { state: 'mixed' }, marketSectors = null) {
    const hotThemes = buildHotThemeContext(successful);
    const sectorIndex = buildStockSectorIndex(marketSectors);
    const byType = successful.flatMap(({ type, items }) => {
        if (!userProfile.allowed_instrument_types.includes(type))
            return [];
        const usable = items.filter((item) => tradable(item, type, excludedCodes, userProfile));
        const activitySamples = usable.filter((item) => finite(item.turnoverRatio) > 0).length;
        const ranks = {
            amount: rankPercentiles(usable, (item) => Math.log10(Math.max(1, finite(item.amount)))),
            change: rankPercentiles(usable, (item) => finite(item.changeRatio)),
            amplitude: rankPercentiles(usable, (item) => finite(item.amplitudeRatio)),
            turnover: rankPercentiles(usable, (item) => finite(item.turnoverRatio)),
            activityAvailable: activitySamples >= Math.max(3, Math.ceil(usable.length * 0.1)),
        };
        const ranked = usable.map((item) => screeningCandidate(item, type, ranks, watchedCodes, userProfile, hotThemes, sectorIndex))
            .sort((left, right) => right.screening_score - left.screening_score);
        const previous = ranked.filter((item) => previousAgentCodes.has(item.instrument.code))
            .map((item) => ({ ...item, screening_lane: 'previous_agent' }));
        const fresh = selectFreshShortlist(ranked, type, regime, userProfile);
        return [...new Map([...previous, ...fresh].map((item) => [item.instrument.code, item])).values()];
    });
    return selectGlobalCandidateShortlist(byType, maximum, regime);
}
