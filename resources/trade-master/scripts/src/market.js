import { MarketCache } from './cache.js';
const LIVE_AS_OF_TOLERANCE_MS = 10 * 60_000;
const LIVE_INTRADAY_CACHE_MS = 60_000;
const LIVE_DAILY_CACHE_MS = 5 * 60_000;
const liveAsOf = (options, now = Date.now()) => {
    const value = options?.asOf ?? options?.end;
    if (!value)
        return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && Math.abs(now - timestamp) <= LIVE_AS_OF_TOLERANCE_MS;
};
export const marketBarsCacheKey = (providerId, code, period, limit, options = {}, now = Date.now()) => {
    if (!liveAsOf(options, now))
        return `bars:${providerId}:${code}:${period}:${limit}:${JSON.stringify(options)}`;
    const { asOf: _asOf, end: _end, ...stableOptions } = options;
    return `bars:${providerId}:${code}:${period}:${limit}:${JSON.stringify({ ...stableOptions, live: true })}`;
};
const marketBarsMaxAge = (period, options) => {
    if (liveAsOf(options))
        return ['1d', '1w', '1M'].includes(period) ? LIVE_DAILY_CACHE_MS : LIVE_INTRADAY_CACHE_MS;
    return options.asOf || options.end ? null : LIVE_INTRADAY_CACHE_MS;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round(finite(value) * scale) / scale;
};
const clamp = (value) => Math.max(0, Math.min(100, finite(value)));
const mapLimit = async (items, limit, mapper) => {
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
};
const periodLeaderScore = (changePercent, amount, maximumAmount) => {
    const momentum = clamp(50 + finite(changePercent) * 4);
    const liquidity = clamp(Math.sqrt(finite(amount) / Math.max(1, maximumAmount)) * 100);
    return round(momentum * 0.7 + liquidity * 0.3);
};
function shanghaiClock(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return { weekday: pick('weekday'), minutes: Number(pick('hour')) * 60 + Number(pick('minute')) };
}
function inTradingSession(date) {
    const { weekday, minutes } = shanghaiClock(date);
    if (weekday === 'Sat' || weekday === 'Sun')
        return false;
    return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
}
export class MarketService {
    providers;
    config;
    cache;
    constructor(providers, config) {
        this.providers = providers;
        this.config = config;
        this.cache = new MarketCache(config.cache);
    }
    cacheStatus() {
        return this.cache.status();
    }
    pruneCache() {
        return this.cache.prune();
    }
    async search(query) {
        const errors = [];
        for (const provider of this.providers.filter((item) => item.searchInstruments)) {
            try {
                const items = await provider.searchInstruments(query);
                if (items.length > 0)
                    return items;
            }
            catch (error) {
                errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (errors.length > 0)
            throw new Error(`标的搜索失败：${errors.join('; ')}`);
        return [];
    }
    async info(code) {
        const provider = this.providers.find((item) => item.getInstrument);
        if (!provider?.getInstrument)
            throw new Error('没有可用的标的信息数据源');
        return provider.getInstrument(code);
    }
    async universe(type) {
        const providers = this.providers.filter((item) => item.listUniverse);
        if (!providers.length)
            throw new Error('没有可用的全市场枚举数据源');
        const errors = [];
        for (const provider of providers) {
            try {
                const key = `universe:${provider.id}:full-v2:${type}`;
                const items = await this.cache.getOrLoad(key, () => provider.listUniverse(type), 5 * 60_000, provider.id);
                if (items.length)
                    return { items, source: provider.id, reconstructed: true, errors };
                errors.push(`${provider.id}: 空数据`);
            }
            catch (error) {
                errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        throw new Error(`没有可用全市场行情：${errors.join('; ')}`);
    }
    async sectors() {
        const providers = this.providers.filter((item) => item.listSectorSnapshot);
        if (!providers.length)
            throw new Error('没有可用全市场行业板块数据源');
        const errors = [];
        for (const provider of providers) {
            try {
                const key = `sectors:${provider.id}:all-a-share-v3`;
                return await this.cache.getOrLoad(key, () => provider.listSectorSnapshot(), 5 * 60_000, provider.id);
            }
            catch (error) {
                errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        throw new Error(`没有可用全市场行业板块：${errors.join('; ')}`);
    }
    async sectorPeriod(start, end) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
            throw new Error('行业周期参数必须是有效的开始和结束日期');
        const snapshot = await this.sectors();
        const sectors = Array.isArray(snapshot.sectors) ? snapshot.sectors : [];
        const jobs = sectors.flatMap((sector) => {
            const candidates = Array.isArray(sector.period_candidates)
                ? sector.period_candidates
                : Array.isArray(sector.leaders) ? sector.leaders : [];
            return candidates.map((candidate) => ({ sector, candidate }));
        });
        const rows = await mapLimit(jobs, 10, async ({ sector, candidate }) => {
            try {
                const result = await this.bars(String(candidate.code), '1d', 40, { start, end });
                const bars = result.bars.filter((bar) => String(bar.time).slice(0, 10) >= start
                    && String(bar.time).slice(0, 10) <= end);
                const first = bars[0];
                const last = bars.at(-1);
                if (!first || !last || finite(first.open) <= 0)
                    return null;
                const amount = bars.reduce((sum, bar) => {
                    const reported = finite(bar.amount);
                    if (reported > 0)
                        return sum + reported;
                    const averagePrice = (finite(bar.open) + finite(bar.close)) / 2;
                    return sum + Math.max(0, finite(bar.volume) * averagePrice);
                }, 0);
                return {
                    sector_name: String(sector.name),
                    code: String(candidate.code),
                    name: String(candidate.name || candidate.code),
                    type: 'stock',
                    price: round(last.close, finite(last.close) < 10 ? 3 : 2),
                    change_percent: round((finite(last.close) / finite(first.open) - 1) * 100),
                    amount: round(amount, 0),
                    amount_estimated: bars.some((bar) => finite(bar.amount) <= 0),
                    trading_days: bars.length,
                };
            }
            catch {
                return null;
            }
        });
        const available = rows.filter((row) => row != null);
        const maximumAmount = Math.max(1, ...available.map((row) => row.amount));
        const aggregated = sectors.flatMap((sector) => {
            const sample = available.filter((row) => row.sector_name === String(sector.name));
            if (!sample.length)
                return [];
            const totalAmount = sample.reduce((sum, row) => sum + row.amount, 0);
            const amountEstimated = sample.some((row) => row.amount_estimated);
            const weightedChange = totalAmount > 0 && !amountEstimated
                ? sample.reduce((sum, row) => sum + row.change_percent * row.amount, 0) / totalAmount
                : sample.reduce((sum, row) => sum + row.change_percent, 0) / sample.length;
            const rising = sample.filter((row) => row.change_percent > 0.1).length;
            const falling = sample.filter((row) => row.change_percent < -0.1).length;
            const breadth = rising / sample.length * 100;
            const leaders = sample.map((row) => ({
                ...row,
                leadership_score: periodLeaderScore(row.change_percent, row.amount, maximumAmount),
            })).sort((left, right) => right.leadership_score - left.leadership_score
                || right.change_percent - left.change_percent).slice(0, 5);
            return [{
                name: String(sector.name),
                stock_count: Number(sector.stock_count || 0),
                sample_stock_count: sample.length,
                rising,
                falling,
                flat: sample.length - rising - falling,
                breadth_percent: round(breadth),
                change_percent: round(weightedChange),
                total_amount: round(totalAmount, 0),
                amount_estimated: amountEstimated,
                leaders,
            }];
        });
        const maximumSectorAmount = Math.max(1, ...aggregated.map((sector) => sector.total_amount));
        const ranked = aggregated.map((sector) => ({
            ...sector,
            heat_score: round(
                clamp(50 + sector.change_percent * 7) * 0.5
                + sector.breadth_percent * 0.3
                + clamp(Math.sqrt(sector.total_amount / maximumSectorAmount) * 100) * 0.2
            ),
        })).sort((left, right) => right.heat_score - left.heat_score
            || right.total_amount - left.total_amount);
        const rising = available.filter((row) => row.change_percent > 0.1).length;
        const falling = available.filter((row) => row.change_percent < -0.1).length;
        return {
            scope: 'all_a_share_stocks',
            source: 'full_market_sw1_period_sample',
            generated_at: new Date().toISOString(),
            range: { start, end },
            stock_total: Number(snapshot.stock_total || 0),
            classified_stock_total: Number(snapshot.classified_stock_total || 0),
            coverage_percent: Number(snapshot.coverage_percent || 0),
            sample_stock_total: available.length,
            period_breadth: {
                type: 'stock',
                total: available.length,
                rising,
                falling,
                flat: available.length - rising - falling,
                median_change_percent: available.length
                    ? round([...available].sort((left, right) => left.change_percent - right.change_percent)[Math.floor(available.length / 2)].change_percent)
                    : null,
                total_amount: round(available.reduce((sum, row) => sum + row.amount, 0), 0),
            },
            sectors: ranked,
        };
    }
    async quotes(code) {
        const candidates = this.providers.filter((item) => item.getQuote);
        const quotes = [];
        const errors = [];
        const minimum = Math.max(1, this.config.minimum_quote_sources_for_precise_signal ?? 1);
        for (const provider of candidates) {
            try {
                quotes.push(await provider.getQuote(code));
                if (quotes.length >= minimum)
                    break;
            }
            catch (error) {
                errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return { quotes, errors };
    }
    async quotesMany(codes, concurrency = 6) {
        const uniqueCodes = [...new Set(codes.map((code) => String(code).trim()).filter(Boolean))];
        if (uniqueCodes.length > 100)
            throw new Error('批量报价一次最多支持 100 个标的');
        const quotes = new Array(uniqueCodes.length);
        const errors = [];
        let cursor = 0;
        const worker = async () => {
            while (cursor < uniqueCodes.length) {
                const index = cursor++;
                const code = uniqueCodes[index];
                try {
                    const result = await this.quotes(code);
                    if (result.quotes[0])
                        quotes[index] = result.quotes[0];
                    for (const error of result.errors)
                        errors.push(`${code}: ${error}`);
                }
                catch (error) {
                    errors.push(`${code}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        };
        const workerCount = Math.max(1, Math.min(concurrency, uniqueCodes.length));
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return { quotes: quotes.filter(Boolean), errors };
    }
    async quickQuote(code) {
        const candidates = this.providers.filter((item) => item.getQuote).sort((left, right) => (left.id === 'tencent' ? -1 : 0) - (right.id === 'tencent' ? -1 : 0));
        const errors = [];
        for (const provider of candidates) {
            try {
                return { quote: await provider.getQuote(code), source: provider.id, errors };
            }
            catch (error) {
                errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        throw new Error(`没有可用报价：${errors.join('; ')}`);
    }
    async bars(code, period, limit, options = {}) {
        const errors = [];
        const minimumTradingDays = Math.max(0, Number(options.minimumTradingDays) || 0);
        let bestPartial = null;
        const providers = this.providers.filter((item) => item.getBars).sort((left, right) => (left.id === 'tencent' ? -1 : 0) - (right.id === 'tencent' ? -1 : 0));
        for (const provider of providers) {
            try {
                const cacheKey = marketBarsCacheKey(provider.id, code, period, limit, options);
                const liveMaxAge = marketBarsMaxAge(period, options);
                const maxAge = liveMaxAge ?? (this.config.cache?.retention_days ?? 30) * 86_400_000;
                const bars = await this.cache.getOrLoad(cacheKey, () => provider.getBars(code, period, limit, options), maxAge, provider.id);
                if (bars.length > 0) {
                    const tradingDays = new Set(bars.map((bar) => String(bar.time).slice(0, 10))).size;
                    if (minimumTradingDays === 0 || tradingDays >= minimumTradingDays)
                        return { bars, source: provider.id, errors, cache_key: cacheKey, trading_days: tradingDays };
                    if (!bestPartial || tradingDays > bestPartial.trading_days)
                        bestPartial = { bars, source: provider.id, cache_key: cacheKey, trading_days: tradingDays };
                    errors.push(`${provider.id}: 仅${tradingDays}个交易日，低于${minimumTradingDays}日门槛`);
                    continue;
                }
                errors.push(`${provider.id}: 空数据`);
            }
            catch (error) {
                errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (bestPartial)
            return { ...bestPartial, errors, partial_coverage: true };
        throw new Error(`没有可用 K 线：${errors.join('; ')}`);
    }
    async evidence(code, period, limit) {
        const [quoteResult, barResult] = await Promise.all([this.quotes(code), this.bars(code, period, limit)]);
        if (quoteResult.quotes.length === 0)
            throw new Error(`没有可用报价：${quoteResult.errors.join('; ')}`);
        const prices = quoteResult.quotes.map((item) => item.price);
        const max = Math.max(...prices);
        const min = Math.min(...prices);
        const spread = max > 0 ? (max - min) / max : null;
        const conflict = spread != null && spread > this.config.quote_conflict_ratio;
        const latestTimes = quoteResult.quotes
            .map((item) => item.exchangeTime ? Date.parse(item.exchangeTime) : NaN)
            .filter(Number.isFinite);
        const latest = latestTimes.length > 0 ? Math.max(...latestTimes) : null;
        const now = new Date();
        const delayMinutes = latest == null ? null : Math.max(0, (now.getTime() - latest) / 60_000);
        const stale = inTradingSession(now) && (delayMinutes == null || delayMinutes > this.config.stale_after_minutes);
        const verified = quoteResult.quotes.length >= this.config.minimum_quote_sources_for_precise_signal && !conflict && !stale;
        const reasons = [];
        if (stale)
            reasons.push(`行情延迟超过 ${this.config.stale_after_minutes} 分钟或缺少交易所时间`);
        if (conflict)
            reasons.push(`多源价格偏差 ${(spread * 100).toFixed(2)}% 超过阈值`);
        if (quoteResult.quotes.length < this.config.minimum_quote_sources_for_precise_signal)
            reasons.push('有效报价源不足');
        if (barResult.bars.at(-1)?.closed === false)
            reasons.push('最新 K 线尚未闭合');
        return {
            instrument: quoteResult.quotes[0].instrument,
            quotes: quoteResult.quotes,
            bars: barResult.bars,
            market_state: {
                collected_at: now.toISOString(),
                latest_exchange_time: latest == null ? null : new Date(latest).toISOString(),
                stale,
                conflict,
                verified,
                price_spread_ratio: spread,
                reasons,
            },
            provider_errors: [...quoteResult.errors, ...barResult.errors],
        };
    }
}
