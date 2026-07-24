const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};
const clamp = (value) => Math.max(0, Math.min(100, finite(value)));

const leaderFrom = (row) => {
    const change = finite(row.f3);
    const amount = finite(row.f6);
    const turnover = finite(row.f8);
    const momentum = clamp(50 + change * 5);
    const liquidity = clamp(Math.log10(Math.max(1, amount / 10_000_000) + 1) * 38);
    const activity = clamp(turnover * 8);
    return {
        code: String(row.f12),
        name: String(row.f14),
        type: 'stock',
        price: round(row.f2, finite(row.f2) < 10 ? 3 : 2),
        change_percent: round(change),
        amount: round(amount, 0),
        turnover_percent: round(turnover),
        leadership_score: round(momentum * 0.55 + liquidity * 0.30 + activity * 0.15),
    };
};

export async function fetchEastmoneySectorSnapshot(requestJson, timeoutMs) {
    const fields = 'f12,f14,f3,f6,f104,f105,f106';
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=${fields}`;
    const payload = await requestJson(url, Math.min(timeoutMs, 8000));
    const boards = payload.data?.diff ?? [];
    if (!boards.length)
        throw new Error('东方财富没有返回行业板块数据');
    const maximumAmount = Math.max(1, ...boards.map((item) => finite(item.f6)));
    const ranked = boards.map((item) => {
        const rising = finite(item.f104);
        const falling = finite(item.f105);
        const flat = finite(item.f106);
        const total = rising + falling + flat;
        const breadth = total > 0 ? rising / total * 100 : 0;
        const change = finite(item.f3);
        const liquidity = Math.sqrt(finite(item.f6) / maximumAmount) * 100;
        return {
            board_code: String(item.f12 ?? ''),
            name: String(item.f14 ?? ''),
            stock_count: total,
            rising,
            falling,
            flat,
            breadth_percent: round(breadth),
            change_percent: round(change),
            total_amount: round(item.f6, 0),
            heat_score: round(clamp((50 + change * 9) * 0.4 + breadth * 0.35 + liquidity * 0.25)),
        };
    }).filter((item) => item.board_code && item.name)
        .sort((left, right) => right.heat_score - left.heat_score || right.total_amount - left.total_amount)
        .slice(0, 12);
    const sectors = await Promise.all(ranked.map(async (sector) => {
        const constituentFields = 'f12,f14,f2,f3,f6,f8';
        const constituentUrl = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:${sector.board_code}&fields=${constituentFields}`;
        const result = await requestJson(constituentUrl, Math.min(timeoutMs, 8000));
        const constituents = (result.data?.diff ?? []).filter((row) => {
            const code = String(row.f12 ?? '');
            const name = String(row.f14 ?? '');
            return /^\d{6}$/.test(code) && !/^(?:ST|\*ST|退市)|退$/.test(name);
        });
        const leaders = constituents.map(leaderFrom)
            .sort((left, right) => right.leadership_score - left.leadership_score || right.amount - left.amount)
            .slice(0, 5);
        return { ...sector, leaders, member_codes: constituents.map((row) => String(row.f12)) };
    }));
    const stockTotal = boards.reduce((sum, item) => sum + finite(item.f104) + finite(item.f105) + finite(item.f106), 0);
    return {
        scope: 'all_a_share_stocks',
        source: 'eastmoney_industry_boards',
        generated_at: new Date().toISOString(),
        stock_total: stockTotal,
        classified_stock_total: stockTotal,
        coverage_percent: stockTotal > 0 ? 100 : 0,
        sectors,
    };
}
