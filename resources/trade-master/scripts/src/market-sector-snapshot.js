const finite = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const round = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};

const clamp = (value) => Math.max(0, Math.min(100, finite(value)));

const validStock = (item) => {
    const name = String(item.instrument?.name ?? '');
    return item.instrument?.type === 'stock'
        && /^\d{6}$/.test(String(item.instrument?.code ?? ''))
        && Boolean(item.industry)
        && !/^(?:ST|\*ST|退市)|退$/.test(name);
};

const stockLeadershipScore = (item) => {
    const changePercent = finite(item.changeRatio) * 100;
    const momentum = clamp(50 + changePercent * 5);
    const liquidity = clamp(Math.log10(Math.max(1, finite(item.amount) / 10_000_000) + 1) * 38);
    const activity = clamp(finite(item.turnoverRatio) * 8);
    return round(momentum * 0.55 + liquidity * 0.30 + activity * 0.15);
};

const leaderRecord = (item) => ({
    code: String(item.instrument.code),
    name: String(item.instrument.name),
    type: 'stock',
    price: round(item.price, item.price < 10 ? 3 : 2),
    change_percent: round(finite(item.changeRatio) * 100),
    amount: round(item.amount, 0),
    turnover_percent: round(finite(item.turnoverRatio) * 100),
    leadership_score: stockLeadershipScore(item),
});

const periodCandidateRecord = (item) => ({
    code: String(item.instrument.code),
    name: String(item.instrument.name),
    type: 'stock',
    price: round(item.price, item.price < 10 ? 3 : 2),
    amount: round(item.amount, 0),
});

export function buildMarketSectorSnapshot(successful, generatedAt = new Date().toISOString()) {
    const allStocks = successful.find((entry) => entry.type === 'stock')?.items ?? [];
    const stocks = allStocks.filter(validStock);
    const grouped = new Map();
    for (const stock of stocks) {
        const industry = String(stock.industry).trim();
        if (!industry)
            continue;
        const items = grouped.get(industry) ?? [];
        items.push(stock);
        grouped.set(industry, items);
    }
    const rawSectors = [...grouped.entries()].map(([name, items]) => {
        const totalAmount = items.reduce((sum, item) => sum + finite(item.amount), 0);
        const weightedChange = totalAmount > 0
            ? items.reduce((sum, item) => sum + finite(item.changeRatio) * finite(item.amount), 0) / totalAmount * 100
            : items.reduce((sum, item) => sum + finite(item.changeRatio), 0) / Math.max(1, items.length) * 100;
        const rising = items.filter((item) => finite(item.changeRatio) > 0.001).length;
        const leaders = [...items]
            .sort((left, right) => stockLeadershipScore(right) - stockLeadershipScore(left)
                || finite(right.amount) - finite(left.amount))
            .slice(0, 5)
            .map(leaderRecord);
        const periodCandidates = [...items]
            .sort((left, right) => finite(right.amount) - finite(left.amount))
            .slice(0, 10)
            .map(periodCandidateRecord);
        return {
            name,
            stock_count: items.length,
            rising,
            falling: items.filter((item) => finite(item.changeRatio) < -0.001).length,
            breadth_percent: round(rising / Math.max(1, items.length) * 100),
            change_percent: round(weightedChange),
            total_amount: round(totalAmount, 0),
            leaders,
            period_candidates: periodCandidates,
            member_codes: [...new Set(items.map((item) => String(item.instrument.code)))],
        };
    });
    const maxAmount = Math.max(1, ...rawSectors.map((sector) => sector.total_amount));
    const sectors = rawSectors.map((sector) => {
        const momentum = clamp(50 + sector.change_percent * 9);
        const liquidity = clamp(Math.sqrt(sector.total_amount / maxAmount) * 100);
        const heatScore = round(momentum * 0.4 + sector.breadth_percent * 0.35 + liquidity * 0.25);
        return { ...sector, heat_score: heatScore };
    }).sort((left, right) => right.heat_score - left.heat_score
        || right.total_amount - left.total_amount);
    return {
        scope: 'all_a_share_stocks',
        source: 'eastmoney_full_stock_universe',
        generated_at: generatedAt,
        stock_total: allStocks.length,
        classified_stock_total: stocks.length,
        coverage_percent: round(stocks.length / Math.max(1, allStocks.length) * 100),
        sectors,
    };
}
