import { MarketCache } from './cache.js';
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
        const providers = this.providers.filter((item) => item.getBars).sort((left, right) => (left.id === 'tencent' ? -1 : 0) - (right.id === 'tencent' ? -1 : 0));
        for (const provider of providers) {
            try {
                const cacheKey = `bars:${provider.id}:${code}:${period}:${limit}:${JSON.stringify(options)}`;
                const historical = Boolean(options.asOf || options.end);
                const maxAge = historical ? (this.config.cache?.retention_days ?? 30) * 86_400_000 : 60_000;
                const bars = await this.cache.getOrLoad(cacheKey, () => provider.getBars(code, period, limit, options), maxAge, provider.id);
                if (bars.length > 0)
                    return { bars, source: provider.id, errors, cache_key: cacheKey };
                errors.push(`${provider.id}: 空数据`);
            }
            catch (error) {
                errors.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
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
