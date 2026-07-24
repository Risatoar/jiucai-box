const ALL_INSTRUMENT_TYPES = ['stock', 'etf', 'cbond'];

const RISK_SCORE_BY_RATING = {
    '保守型': 15,
    '稳健型': 35,
    '平衡型': 50,
    '进取型': 72,
    '激进型': 90,
};

const STYLE_WEIGHTS = {
    '超短': { screening: 0.30, daily: 0.15, intraday: 0.40, risk: 0.15 },
    '短线': { screening: 0.25, daily: 0.25, intraday: 0.32, risk: 0.18 },
    '波段': { screening: 0.15, daily: 0.50, intraday: 0.15, risk: 0.20 },
    '中长线': { screening: 0.10, daily: 0.58, intraday: 0.08, risk: 0.24 },
};

const DEFAULT_STYLE_WEIGHTS = { screening: 0.20, daily: 0.37, intraday: 0.23, risk: 0.20 };

const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, finite(value)));
const round = (value, digits = 4) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};

const averageStyleWeights = (styles) => {
    const selected = styles.map((style) => STYLE_WEIGHTS[style]).filter(Boolean);
    if (!selected.length)
        return DEFAULT_STYLE_WEIGHTS;
    return Object.fromEntries(Object.keys(DEFAULT_STYLE_WEIGHTS).map((key) => [
        key,
        round(selected.reduce((sum, weights) => sum + weights[key], 0) / selected.length),
    ]));
};

const resolveAllowedTypes = (profile, goals) => {
    const configured = Array.isArray(goals?.constraints?.allowed_instrument_types)
        ? goals.constraints.allowed_instrument_types
        : profile?.instruments;
    const allowed = Array.isArray(configured)
        ? configured.filter((type) => ALL_INSTRUMENT_TYPES.includes(type))
        : [];
    return allowed.length ? [...new Set(allowed)] : [...ALL_INSTRUMENT_TYPES];
};

const experienceLevel = (experience) => {
    if (experience === '1年以内')
        return 'beginner';
    if (experience === '1-3年')
        return 'developing';
    if (experience === '3-5年')
        return 'experienced';
    if (experience === '5年以上')
        return 'advanced';
    return 'unknown';
};

export function buildCandidateUserProfile(profile = {}, goals = {}) {
    const styles = Array.isArray(profile.styles) ? profile.styles.filter((style) => STYLE_WEIGHTS[style]) : [];
    const habits = Array.isArray(profile.tradingHabits) ? profile.tradingHabits : [];
    const ratingScore = RISK_SCORE_BY_RATING[profile.riskRating];
    const riskScore = clamp(profile.riskScore ?? ratingScore ?? 50, 0, 100);
    const riskAppetite = 0.65 + riskScore / 100 * 0.9;
    const chaseGuard = habits.includes('容易追涨');
    const holdLossGuard = habits.includes('容易扛亏');
    const lowFrequency = habits.includes('偏好低频');
    const keyAlertsOnly = habits.includes('只看关键提醒');
    const intradayAvailable = habits.includes('盘中可盯盘');
    const reboundEnabled = styles.some((style) => ['超短', '短线', '波段'].includes(style));
    const dailyChangeLimits = {
        stock: { down: round(0.05 + riskScore / 100 * 0.07), up: round(0.035 + riskScore / 100 * 0.065) },
        etf: { down: round(0.035 + riskScore / 100 * 0.045), up: round(0.025 + riskScore / 100 * 0.045) },
        cbond: { down: round(0.08 + riskScore / 100 * 0.10), up: round(0.07 + riskScore / 100 * 0.11) },
    };
    const chasingLimits = {
        stock: round(Math.max(0.035, 0.03 + riskScore / 100 * 0.07 - (chaseGuard ? 0.015 : 0))),
        etf: round(Math.max(0.025, 0.02 + riskScore / 100 * 0.045 - (chaseGuard ? 0.01 : 0))),
        cbond: round(Math.max(0.07, 0.06 + riskScore / 100 * 0.10 - (chaseGuard ? 0.02 : 0))),
    };
    return {
        source: 'user_settings',
        allowed_instrument_types: resolveAllowedTypes(profile, goals),
        stock_boards: Array.isArray(profile.stockBoards) && profile.stockBoards.length ? [...profile.stockBoards] : null,
        styles,
        style_mode: styles.length >= 3 ? 'multi_horizon' : styles.length > 0 ? 'focused' : 'default',
        opportunity_modes: ['trend', ...(reboundEnabled || styles.length === 0 ? ['oversold_rebound'] : [])],
        style_weights: averageStyleWeights(styles),
        experience: profile.experience ?? '未设置',
        experience_level: experienceLevel(profile.experience),
        habits,
        risk_rating: profile.riskRating ?? '平衡型',
        risk_score: riskScore,
        risk_appetite_multiplier: round(riskAppetite),
        daily_change_limits: dailyChangeLimits,
        chasing_change_limits: chasingLimits,
        max_drawdown_percent: finite(goals?.max_drawdown, finite(profile.maxDrawdown) / 100) * 100 || null,
        behavior: {
            chase_guard: chaseGuard,
            hold_loss_guard: holdLossGuard,
            low_frequency: lowFrequency,
            key_alerts_only: keyAlertsOnly,
            intraday_available: intradayAvailable,
            minimum_score_adjustment: (keyAlertsOnly ? 2 : 0) + (lowFrequency ? 1 : 0),
        },
        guardrail: '画像只改变候选范围、周期权重和波动匹配；经验与风险等级不得绕过最大回撤、成本、追涨和人工确认门槛',
    };
}

const bell = (value, ideal, width) => clamp(100 - Math.abs(finite(value) - ideal) / Math.max(width, 0.0001) * 100, 0, 100);

export function scoreCandidateProfileFit(candidate, daily, userProfile) {
    const type = candidate.type;
    const appetite = finite(userProfile?.risk_appetite_multiplier, 1);
    const volatilityBase = type === 'stock' ? 1.8 : type === 'etf' ? 1.0 : 2.2;
    const amplitudeBase = type === 'stock' ? 3.2 : type === 'etf' ? 1.8 : 4.2;
    const volatility = finite(daily?.realized_volatility_20d_percent, volatilityBase);
    const amplitude = finite(candidate.amplitude_percent, amplitudeBase);
    const volatilityFit = bell(volatility, volatilityBase * appetite, volatilityBase * 1.35);
    const amplitudeFit = bell(amplitude, amplitudeBase * appetite, amplitudeBase * 1.4);
    const change = finite(candidate.change_percent);
    let experienceFit = 70;
    if (userProfile?.experience_level === 'beginner')
        experienceFit = type === 'etf' ? 100 : type === 'stock' ? 70 : 45;
    else if (userProfile?.experience_level === 'developing')
        experienceFit = type === 'cbond' ? 65 : 85;
    else if (['experienced', 'advanced'].includes(userProfile?.experience_level))
        experienceFit = type === 'cbond' ? 90 : type === 'stock' ? 88 : 82;
    let behaviorFit = 85;
    const risks = [];
    if (userProfile?.behavior?.chase_guard && change > finite(userProfile?.chasing_change_limits?.[type]) * 100 * 0.7) {
        behaviorFit -= 25;
        risks.push('画像显示容易追涨，涨幅偏大时提高等待确认门槛');
    }
    if (userProfile?.behavior?.hold_loss_guard && finite(daily?.downside_volatility_20d_percent) > volatilityBase * 0.55) {
        behaviorFit -= 20;
        risks.push('画像显示容易扛亏，下行波动偏高时降低排序');
    }
    if (userProfile?.behavior?.low_frequency && amplitude > amplitudeBase) {
        behaviorFit -= 18;
        risks.push('偏好低频，日内振幅过高时降低排序');
    }
    const score = round(volatilityFit * 0.36 + amplitudeFit * 0.24 + experienceFit * 0.20 + clamp(behaviorFit, 0, 100) * 0.20, 2);
    return {
        score,
        volatility_fit: round(volatilityFit, 2),
        amplitude_fit: round(amplitudeFit, 2),
        experience_fit: experienceFit,
        behavior_fit: clamp(behaviorFit, 0, 100),
        reasons: [`${userProfile?.risk_rating ?? '平衡型'}画像的波动匹配分 ${score}`],
        risks,
    };
}

export { ALL_INSTRUMENT_TYPES };
