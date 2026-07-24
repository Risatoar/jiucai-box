const THEME_RULES = [
    { name: '半导体', pattern: /半导体|芯片|集成电路|科创芯片|电子|元件|光学光电子/ },
    { name: '人工智能', pattern: /人工智能|AI|算力|软件|云计算|数据|计算机|通信/ },
    { name: '机器人', pattern: /机器人|智能制造|自动化/ },
    { name: '证券', pattern: /证券|券商/ },
    { name: '军工', pattern: /军工|国防|航天|航空/ },
    { name: '新能源车', pattern: /新能源车|汽车|电池|锂电/ },
    { name: '光伏', pattern: /光伏|新能源|清洁能源/ },
    { name: '医药', pattern: /医药|医疗|创新药|生物|疫苗/ },
    { name: '消费', pattern: /消费|食品|酒|家电|旅游/ },
    { name: '有色', pattern: /有色|稀土|黄金|金属|资源/ },
    { name: '煤炭', pattern: /煤炭/ },
    { name: '银行', pattern: /银行/ },
    { name: '房地产', pattern: /地产|房地产|建材/ },
    { name: '港股科技', pattern: /港股科技|恒生科技|互联网/ },
];

const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, finite(value)));
const round = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};

export function inferMarketTheme(...texts) {
    const text = texts.filter(Boolean).join(' ');
    return THEME_RULES.find((rule) => rule.pattern.test(text))?.name ?? null;
}

// 细分概念板块：在粗粒度主题之上，提供更精细的题材/概念标签
const CONCEPT_RULES = [
    { name: '芯片设计', pattern: /芯片设计|Fabless|SoC|主控|MCU|单片机|集成电路|芯片制造|晶圆代工|晶圆厂|IDM/ },
    { name: '半导体设备', pattern: /半导体设备|晶圆设备|刻蚀|薄膜沉积|检测设备/ },
    { name: '半导体材料', pattern: /半导体材料|硅片|光刻胶|电子特气|靶材|封装材料/ },
    { name: '存储芯片', pattern: /存储|DRAM|NAND|Flash|NOR|内存/ },
    { name: '封测', pattern: /封测|封装|测试|SIP|先进封装/ },
    { name: '光刻胶', pattern: /光刻胶|光掩膜/ },
    { name: 'PCB', pattern: /PCB|印制电路|覆铜板|CCL|高频板/ },
    { name: 'AI算力', pattern: /AI算力|算力|服务器|GPU|光模块|CPO|高速铜缆|液冷/ },
    { name: '大模型', pattern: /大模型|LLM|生成式AI|AIGC|多模态/ },
    { name: '人工智能', pattern: /人工智能|AI|智能|机器视觉|语音识别/ },
    { name: '云计算', pattern: /云计算|云服务|IDC|数据中心/ },
    { name: '网络安全', pattern: /网络安全|信息安全|信创|密码/ },
    { name: '机器人', pattern: /机器人|机械手|协作机器人/ },
    { name: '减速器', pattern: /减速器|谐波|RV减速|行星减速/ },
    { name: '智能制造', pattern: /智能制造|工业互联|工业软件|自动化/ },
    { name: '低空经济', pattern: /低空经济|eVTOL|飞行汽车|无人机|通航/ },
    { name: '卫星互联网', pattern: /卫星|商业航天|北斗|星网/ },
    { name: '新能源车', pattern: /新能源车|电动汽车|智能驾驶|车联网/ },
    { name: '锂电池', pattern: /锂电|动力电池|电芯|电池回收/ },
    { name: '固态电池', pattern: /固态电池|半固态/ },
    { name: '光伏', pattern: /光伏|太阳能|硅料|硅片|组件/ },
    { name: '逆变器', pattern: /逆变器|储能变流器|PCS/ },
    { name: '储能', pattern: /储能|电池储能/ },
    { name: '风电', pattern: /风电|海上风电|风机/ },
    { name: '氢能', pattern: /氢能|燃料电池|加氢/ },
    { name: '创新药', pattern: /创新药|CXO|CRO|CDMO|小分子药/ },
    { name: '医疗器械', pattern: /医疗器械|诊断|检测|影像设备/ },
    { name: '疫苗', pattern: /疫苗|免疫/ },
    { name: '军工', pattern: /军工|国防|航天|航空|卫星导航/ },
    { name: '大飞机', pattern: /大飞机|航空发动机|商用航发/ },
    { name: '船舶', pattern: /船舶|造船|海工装备/ },
    { name: '证券', pattern: /证券|券商|投行/ },
    { name: '银行', pattern: /银行/ },
    { name: '保险', pattern: /保险/ },
    { name: '房地产', pattern: /地产|房地产|物业/ },
    { name: '建筑建材', pattern: /建筑|建材|水泥|玻璃/ },
    { name: '有色金属', pattern: /有色|铜|铝|锌|铅锌/ },
    { name: '黄金', pattern: /黄金|金价|贵金属/ },
    { name: '稀土', pattern: /稀土|永磁|钕铁硼/ },
    { name: '煤炭', pattern: /煤炭|焦煤/ },
    { name: '石油石化', pattern: /石油|石化|原油|天然气/ },
    { name: '电力', pattern: /电力|火电|水电|核电|电网/ },
    { name: '消费电子', pattern: /消费电子|手机|PC|平板|VR|AR|穿戴/ },
    { name: '家电', pattern: /家电|白电|黑电|厨电/ },
    { name: '食品饮料', pattern: /食品|饮料|白酒|啤酒|乳业/ },
    { name: '旅游酒店', pattern: /旅游|酒店|免税|景区/ },
    { name: '零售', pattern: /零售|超市|百货|电商/ },
    { name: '传媒游戏', pattern: /传媒|游戏|影视|广告/ },
    { name: '港股科技', pattern: /港股科技|恒生科技|互联网/ },
];

export function inferConceptTags(...texts) {
    const text = texts.filter(Boolean).join(' ');
    if (!text)
        return [];
    return CONCEPT_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);
}

export function buildHotThemeContext(successful) {
    const etfs = successful.find((item) => item.type === 'etf')?.items ?? [];
    const groups = new Map();
    for (const item of etfs) {
        const theme = inferMarketTheme(item.instrument?.name);
        if (!theme)
            continue;
        const items = groups.get(theme) ?? [];
        items.push(item);
        groups.set(theme, items);
    }
    return [...groups.entries()].map(([name, items]) => {
        const totalAmount = items.reduce((sum, item) => sum + finite(item.amount), 0);
        const weightedChange = totalAmount > 0
            ? items.reduce((sum, item) => sum + finite(item.changeRatio) * finite(item.amount), 0) / totalAmount * 100
            : 0;
        const breadth = items.filter((item) => finite(item.changeRatio) > 0.001).length / items.length * 100;
        const liquidity = clamp(Math.log10(Math.max(1, totalAmount / 100_000_000) + 1) * 55);
        const momentum = clamp(50 + weightedChange * 10);
        return {
            name,
            heat_score: round(liquidity * 0.5 + momentum * 0.3 + breadth * 0.2),
            total_amount: round(totalAmount, 0),
            change_percent: round(weightedChange),
            breadth_percent: round(breadth),
            representative_codes: items.sort((left, right) => finite(right.amount) - finite(left.amount))
                .slice(0, 3).map((item) => item.instrument.code),
        };
    }).sort((left, right) => right.heat_score - left.heat_score).slice(0, 8);
}

export function buildStockSectorIndex(snapshot) {
    const index = new Map();
    for (const sector of snapshot?.sectors ?? []) {
        const memberCodes = sector.member_codes?.length
            ? sector.member_codes
            : [...(sector.leaders ?? []), ...(sector.period_candidates ?? [])].map((item) => item.code);
        for (const code of memberCodes) {
            if (!index.has(String(code))) {
                index.set(String(code), {
                    name: String(sector.name ?? ''),
                    heat_score: sector.heat_score == null ? null : finite(sector.heat_score),
                    breadth_percent: sector.breadth_percent == null ? null : finite(sector.breadth_percent),
                    change_percent: sector.change_percent == null ? null : finite(sector.change_percent),
                });
            }
        }
    }
    return index;
}

export function screeningMarketContext(item, type, hotThemes, stockSectorIndex = new Map()) {
    const sector = type === 'stock' ? stockSectorIndex.get(String(item.instrument?.code)) : null;
    const theme = type === 'etf'
        ? inferMarketTheme(item.instrument?.name)
        : type === 'stock' ? inferMarketTheme(sector?.name, item.industry, item.instrument?.name) : null;
    const matched = hotThemes.find((candidate) => candidate.name === theme);
    const sectorHeat = sector?.heat_score ?? null;
    const conceptTexts = type === 'etf'
        ? [item.instrument?.name]
        : type === 'stock' ? [sector?.name, item.industry, item.instrument?.name] : [];
    const concepts = inferConceptTags(...conceptTexts);
    return {
        theme,
        industry: sector?.name ?? item.industry ?? null,
        concepts,
        sector_heat_score: sectorHeat,
        theme_heat_score: Math.max(finite(matched?.heat_score), finite(sectorHeat)) || null,
        sector_breadth_percent: sector?.breadth_percent ?? null,
        sector_change_percent: sector?.change_percent ?? null,
        hot_themes: hotThemes,
    };
}

export function screeningReboundProbeScore(item, type, context, liquidityScore) {
    if (type === 'cbond')
        return 0;
    const change = finite(item.changeRatio) * 100;
    const amplitude = finite(item.amplitudeRatio) * 100;
    const declineFit = clamp(100 - Math.abs(change + 2.5) / 5.5 * 100);
    const amplitudeFit = clamp(amplitude / (type === 'etf' ? 4 : 7) * 100);
    const heat = finite(context.theme_heat_score, type === 'etf' ? 0 : 45);
    return round(declineFit * 0.32 + amplitudeFit * 0.20 + finite(liquidityScore) * 0.23 + heat * 0.25);
}

export function assessFundamentalContext(type, instrumentInfo) {
    if (type === 'etf') {
        return { status: 'not_applicable', score: 70, buy_ready_eligible: true, risks: [], event_risk_status: 'manual_check_required' };
    }
    const metadata = instrumentInfo?.metadata ?? {};
    if (type === 'cbond') {
        const complete = [metadata.conversion_premium, metadata.remaining_size, metadata.forced_redemption_status]
            .every((value) => value != null);
        return {
            status: complete ? 'verified' : 'incomplete',
            score: complete ? 65 : 45,
            buy_ready_eligible: complete,
            risks: complete ? [] : ['缺少转股溢价率、剩余规模或强赎状态，只能进入观察，不能标记买入就绪'],
            event_risk_status: complete ? 'provider_checked' : 'manual_check_required',
        };
    }
    if (!instrumentInfo?.metadata) {
        return {
            status: 'unavailable',
            score: 45,
            buy_ready_eligible: false,
            risks: ['股票估值与市值数据不可用，只能进入观察，不能标记买入就绪'],
            event_risk_status: 'manual_check_required',
        };
    }
    const pe = finite(metadata.pe_dynamic, NaN);
    const pb = finite(metadata.pb, NaN);
    const floatCap = finite(metadata.float_market_cap, NaN);
    let score = 70;
    const risks = [];
    if (!Number.isFinite(pe) || pe <= 0) {
        score -= 18;
        risks.push('动态市盈率无效或处于亏损状态');
    }
    else if (pe > 150) {
        score -= 18;
        risks.push('动态市盈率偏高');
    }
    else if (pe > 80)
        score -= 8;
    if (Number.isFinite(pb) && pb > 20) {
        score -= 12;
        risks.push('市净率偏高');
    }
    if (Number.isFinite(floatCap) && floatCap < 2_000_000_000) {
        score -= 10;
        risks.push('流通市值较小，波动和流动性风险更高');
    }
    return {
        status: 'verified',
        score: clamp(score),
        buy_ready_eligible: true,
        industry: metadata.industry ?? null,
        pe_dynamic: Number.isFinite(pe) ? pe : null,
        pb: Number.isFinite(pb) ? pb : null,
        float_market_cap: Number.isFinite(floatCap) ? floatCap : null,
        risks,
        event_risk_status: 'manual_check_required',
    };
}

export function resolveValidatedMarketContext(candidate, instrumentInfo) {
    const metadata = instrumentInfo?.metadata ?? {};
    const theme = inferMarketTheme(
        candidate.market_context?.theme,
        metadata.industry,
        metadata.concept,
        candidate.instrument?.name,
    );
    const matched = candidate.market_context?.hot_themes?.find((item) => item.name === theme);
    const screeningConcepts = Array.isArray(candidate.market_context?.concepts) ? candidate.market_context.concepts : [];
    const extraConcepts = inferConceptTags(metadata.industry, metadata.concept, candidate.instrument?.name);
    const concepts = [...new Set([...screeningConcepts, ...extraConcepts])];
    return {
        theme,
        concepts,
        theme_heat_score: matched?.heat_score ?? candidate.market_context?.theme_heat_score ?? null,
        theme_evidence: matched ?? null,
    };
}

const barReturn = (bars, periods) => {
    const selected = bars.slice(-(periods + 1));
    const first = finite(selected.at(0)?.close, NaN);
    const last = finite(selected.at(-1)?.close, NaN);
    return Number.isFinite(first) && first > 0 && Number.isFinite(last) ? (last / first - 1) * 100 : 0;
};

export function assessThemeContinuity(bars, context = {}) {
    if (!context.theme || !Array.isArray(bars) || bars.length < 11) {
        return {
            status: 'unavailable',
            eligible: false,
            continuity_score: 0,
            mainline_score: round(finite(context.theme_heat_score) * 0.4),
            reason: '缺少板块代表ETF的连续日线，不能确认主线持续性',
        };
    }
    const usable = bars.slice(-21);
    const closes = usable.map((bar) => finite(bar.close, NaN)).filter(Number.isFinite);
    const returns = closes.slice(1).map((close, index) => closes[index] > 0 ? (close / closes[index] - 1) * 100 : 0);
    const return5 = barReturn(usable, 5);
    const return10 = barReturn(usable, 10);
    const return20 = barReturn(usable, 20);
    const positiveRatio10 = returns.slice(-10).filter((value) => value > 0.1).length / Math.min(10, returns.length) * 100;
    const ma5 = closes.slice(-5).reduce((sum, value) => sum + value, 0) / Math.min(5, closes.length);
    const ma10 = closes.slice(-10).reduce((sum, value) => sum + value, 0) / Math.min(10, closes.length);
    const latestReturn = returns.at(-1) ?? 0;
    const prior5Return = barReturn(usable.slice(0, -1), 5);
    const oneDaySpike = latestReturn >= 3 && prior5Return <= 0;
    const continuity = clamp(
        clamp(50 + return5 * 8) * 0.25
        + clamp(50 + return10 * 5) * 0.25
        + positiveRatio10 * 0.25
        + (ma5 >= ma10 ? 80 : 30) * 0.25
        - (oneDaySpike ? 30 : 0),
    );
    const mainline = round(finite(context.theme_heat_score) * 0.4 + continuity * 0.6);
    const eligible = continuity >= 55 && mainline >= 55 && !oneDaySpike;
    return {
        status: 'verified',
        eligible,
        continuity_score: round(continuity),
        mainline_score: mainline,
        return_5d_percent: round(return5),
        return_10d_percent: round(return10),
        return_20d_percent: round(return20),
        positive_days_ratio_10d: round(positiveRatio10),
        ma5_above_ma10: ma5 >= ma10,
        one_day_spike: oneDaySpike,
        reason: oneDaySpike
            ? '板块今天脉冲拉升，但此前5日没有延续，暂不认定为主线'
            : eligible ? `板块延续性 ${continuity.toFixed(1)}，主线分 ${mainline.toFixed(1)}` : `板块延续性 ${continuity.toFixed(1)}，尚未达到主线门槛`,
    };
}

export function assessReboundOpportunity(candidate, daily, validation) {
    const context = validation?.technical_evidence?.market_context ?? {};
    const type = candidate.type;
    if (type === 'cbond')
        return { eligible: false, score: 0, reason: '可转债缺少正股板块映射，不启用板块超跌反弹通道' };
    const drawdown = Math.abs(Math.min(0, finite(daily?.drawdown_from_20d_high_percent)));
    const threshold = type === 'etf' ? 8 : 12;
    const oversoldDepth = clamp((drawdown - threshold) / threshold * 70 + 55);
    const reboundFromLow = Math.max(0, finite(daily?.rebound_from_20d_low_percent));
    const rsi = finite(daily?.rsi14, 50);
    const stabilization = clamp(reboundFromLow / (type === 'etf' ? 3 : 5) * 55
        + (rsi >= 28 && rsi <= 52 ? 25 : 0)
        + (validation?.checks?.five_minute_structure ? 10 : 0)
        + (validation?.checks?.fifteen_minute_structure ? 10 : 0));
    const continuity = context.continuity ?? {};
    const heat = finite(continuity.mainline_score, finite(context.theme_heat_score));
    const score = round(oversoldDepth * 0.32 + stabilization * 0.30 + heat * 0.25
        + clamp(finite(validation?.technical_evidence?.intraday?.latest_volume_vs_recent_average) / 1.5 * 100) * 0.13);
    const eligible = continuity.eligible === true && heat >= 55 && drawdown >= threshold && stabilization >= 45;
    const recoveryCapacity = Math.max(
        reboundFromLow,
        Math.min(drawdown * 0.65, finite(daily?.realized_volatility_20d_percent) * Math.sqrt(20)),
    );
    return {
        eligible,
        score,
        theme: context.theme ?? null,
        theme_heat_score: heat,
        theme_continuity: continuity,
        drawdown_percent: round(drawdown),
        oversold_depth_score: round(oversoldDepth),
        rebound_from_low_percent: round(reboundFromLow),
        stabilization_score: round(stabilization),
        reversal_confirmed: stabilization >= 60,
        recovery_capacity_percent: round(recoveryCapacity),
        reason: eligible
            ? `${context.theme}主线分 ${heat.toFixed(1)}，20日高点回撤 ${drawdown.toFixed(1)}%，出现止跌反弹证据`
            : '板块主线持续性、超跌深度或止跌证据不足',
    };
}

export function assessSectorLeadership(candidate, daily, validation, userProfile, strategyType, rebound) {
    const context = validation?.technical_evidence?.market_context ?? {};
    const riskScore = finite(userProfile?.risk_score, 50);
    const screeningLeadership = finite(candidate.screening_leadership_score, 50);
    const return20 = finite(daily?.return_20d_percent);
    const volatility = finite(daily?.realized_volatility_20d_percent);
    const heat = finite(context.continuity?.mainline_score, finite(context.theme_heat_score, 40));
    const trendStrength = clamp(50 + return20 * 5);
    const volatilityStrength = clamp(volatility / (candidate.type === 'etf' ? 2 : 3.5) * 100);
    const score = strategyType === 'oversold_rebound'
        ? round(heat * 0.35 + finite(rebound?.stabilization_score) * 0.35 + screeningLeadership * 0.30)
        : round(screeningLeadership * 0.45 + trendStrength * 0.30 + heat * 0.15 + volatilityStrength * 0.10);
    const defensiveOnly = candidate.type === 'stock'
        && volatility < 1.25
        && return20 < 4
        && finite(candidate.amplitude_percent) < 2.2
        && heat < 50;
    const required = riskScore < 30 ? 35 : riskScore >= 65 ? 50 : 45;
    const eligible = score >= required && !(riskScore >= 45 && defensiveOnly);
    return {
        score,
        eligible,
        required_score: required,
        defensive_only: defensiveOnly,
        theme: context.theme ?? null,
        theme_heat_score: context.theme_heat_score ?? null,
        theme_continuity: context.continuity ?? null,
        reason: defensiveOnly
            ? '缺少板块热度、相对强度和波动空间，属于低弹性防御型标的'
            : eligible ? `板块与个股领导力 ${score}，达到当前画像门槛 ${required}` : `板块与个股领导力 ${score}，低于当前画像门槛 ${required}`,
    };
}
