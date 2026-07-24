import { SinaUniverseProvider } from './sina-provider.js';
import { fetchEastmoneySectorSnapshot } from './eastmoney-sector-snapshot.js';
export { normalizeSinaBar, normalizeSinaUniverseRow } from './sina-provider.js';

function number(value, divisor = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed / divisor : null;
}
function exchangeForCode(code) {
    if (/^(5|6|11)/.test(code))
        return 'SH';
    if (/^(0|1|2|3|12)/.test(code))
        return 'SZ';
    if (/^(4|8|92)/.test(code))
        return 'BJ';
    return 'UNKNOWN';
}
function typeForCode(code, label = '') {
    if (label.includes('转债') || /^(11|12)/.test(code))
        return 'cbond';
    if (label.toUpperCase().includes('ETF') || /^(15|16|50|51|52|56|58)/.test(code))
        return 'etf';
    return /^\d{6}$/.test(code) ? 'stock' : 'unknown';
}
export function inferInstrument(code, name = '') {
    const normalized = code.replace(/\.(SH|SZ|BJ)$/i, '').trim();
    const exchange = exchangeForCode(normalized);
    return {
        code: normalized,
        name,
        type: typeForCode(normalized, name),
        exchange,
        quoteId: `${exchange === 'SH' ? 1 : 0}.${normalized}`,
    };
}
async function fetchWithTimeout(url, timeoutMs, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok)
            throw new Error(`HTTP ${response.status}: ${url}`);
        return response;
    }
    finally {
        clearTimeout(timer);
    }
}
async function fetchJson(url, timeoutMs, init) {
    const response = await fetchWithTimeout(url, timeoutMs, init);
    const text = await response.text();
    try {
        return JSON.parse(text);
    }
    catch {
        const start = text.indexOf('(');
        const end = text.lastIndexOf(')');
        if (start >= 0 && end > start)
            return JSON.parse(text.slice(start + 1, end));
        throw new Error(`数据源返回了无法解析的响应：${text.slice(0, 80)}`);
    }
}

function eastmoneyPeriod(period) {
    return ({ '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1d': 101, '1w': 102, '1M': 103 })[period];
}
function shanghaiParts(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
    }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return {
        date: `${pick('year')}-${pick('month')}-${pick('day')}`,
        minutes: Number(pick('hour')) * 60 + Number(pick('minute')),
        weekday: pick('weekday'),
    };
}
function barClosed(time, period, now = new Date()) {
    const current = shanghaiParts(now);
    const barDate = time.slice(0, 10);
    if (barDate < current.date)
        return true;
    if (barDate > current.date)
        return false;
    if (period === '1d' || period === '1w' || period === '1M')
        return current.minutes >= 900;
    const match = time.match(/(\d{2}):(\d{2})/);
    if (!match)
        return false;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return current.minutes >= minutes + eastmoneyPeriod(period);
}
function comparableTime(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return Date.parse(`${value}T15:00:00+08:00`);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value) && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
        const normalized = value.replace(' ', 'T');
        return Date.parse(`${/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized}+08:00`);
    }
    return Date.parse(value);
}
function filterBarsForQuery(bars, options) {
    const start = options?.start ? comparableTime(options.start) : null;
    const end = options?.end ? comparableTime(options.end) : null;
    const asOfDate = options?.asOf ? new Date(options.asOf) : null;
    const asOf = asOfDate && Number.isFinite(asOfDate.getTime()) ? asOfDate.getTime() : null;
    return bars.filter((bar) => {
        const time = comparableTime(bar.time);
        if (start != null && Number.isFinite(start) && time < start)
            return false;
        if (end != null && Number.isFinite(end) && time > end)
            return false;
        if (asOf != null && (!barClosed(bar.time, bar.period, asOfDate) || time > asOf))
            return false;
        return true;
    });
}
export class EastmoneyProvider {
    timeoutMs;
    id = 'eastmoney';
    constructor(timeoutMs) {
        this.timeoutMs = timeoutMs;
    }
    async listUniverse(type) {
        const fs = type === 'cbond'
            ? 'b:MK0354'
            : type === 'etf'
                ? 'b:MK0021,b:MK0022,b:MK0023,b:MK0024'
                : 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
        const fields = 'f12,f13,f14,f2,f3,f5,f6,f7,f8,f15,f16,f17,f18,f100';
        const rows = [];
        const pageSize = 100;
        for (let page = 1; page <= 80; page += 1) {
            const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${fs}&fields=${fields}`;
            let payload = null;
            for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                    payload = await fetchJson(url, Math.min(this.timeoutMs, 5000));
                    break;
                }
                catch (error) {
                    if (attempt === 1) {
                        throw error;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
            }
            if (!payload)
                break;
            const batch = payload.data?.diff ?? [];
            rows.push(...batch);
            const total = Number(payload.data?.total ?? 0);
            if (batch.length < pageSize || (total > 0 && rows.length >= total))
                break;
            await new Promise((resolve) => setTimeout(resolve, 350));
        }
        const collectedAt = new Date().toISOString();
        return rows.map((item) => {
            const code = String(item.f12 ?? '');
            const name = String(item.f14 ?? '');
            if (!code || !name || (type === 'cbond' && !name.endsWith('转债')))
                return null;
            const market = Number(item.f13 ?? (exchangeForCode(code) === 'SH' ? 1 : 0));
            const inferred = inferInstrument(code, name);
            const instrument = { ...inferred, name, type, quoteId: `${market}.${code}` };
            const price = number(item.f2);
            if (price == null || price <= 0)
                return null;
            return {
                instrument,
                industry: type === 'stock' && item.f100 ? String(item.f100) : null,
                price,
                changeRatio: number(item.f3, 100),
                volume: number(item.f5),
                amount: number(item.f6),
                amplitudeRatio: number(item.f7, 100),
                turnoverRatio: number(item.f8, 100),
                high: number(item.f15),
                low: number(item.f16),
                open: number(item.f17),
                previousClose: number(item.f18),
                source: this.id,
                collectedAt,
            };
        }).filter((item) => item != null);
    }
    async listSectorSnapshot() {
        return fetchEastmoneySectorSnapshot(fetchJson, this.timeoutMs);
    }
    async searchInstruments(query) {
        const normalized = query.trim();
        if (/^\d{6}$/.test(normalized)) {
            try {
                return [(await this.getQuote(normalized)).instrument];
            }
            catch {
                return [inferInstrument(normalized)];
            }
        }
        const universes = await Promise.allSettled([
            this.listUniverse('stock'),
            this.listUniverse('etf'),
            this.listUniverse('cbond'),
        ]);
        const keyword = normalized.toLowerCase();
        const merged = universes.flatMap((result) => result.status === 'fulfilled' ? result.value.map((item) => item.instrument) : []);
        const unique = new Map();
        for (const item of merged) {
            if (!item.code.includes(keyword) && !item.name.toLowerCase().includes(keyword))
                continue;
            unique.set(item.code, item);
            if (unique.size >= 20)
                break;
        }
        return [...unique.values()];
    }
    async getInstrument(code) {
        const instrument = inferInstrument(code);
        const fields = 'f57,f58,f84,f85,f116,f117,f162,f167,f127,f128';
        const payload = await fetchJson(`https://push2.eastmoney.com/api/qt/stock/get?secid=${instrument.quoteId}&fltt=2&fields=${fields}`, this.timeoutMs);
        const data = payload.data;
        if (!data)
            throw new Error(`东方财富没有返回 ${code} 的标的信息`);
        return {
            ...instrument,
            code: String(data.f57 ?? instrument.code),
            name: String(data.f58 ?? instrument.name),
            metadata: {
                total_shares: number(data.f84),
                float_shares: number(data.f85),
                total_market_cap: number(data.f116),
                float_market_cap: number(data.f117),
                pe_dynamic: number(data.f162),
                pb: number(data.f167),
                industry: data.f127 ? String(data.f127) : null,
                concept: data.f128 ? String(data.f128) : null,
            },
            source: this.id,
        };
    }
    async getQuote(code) {
        const instrument = inferInstrument(code);
        const fields = 'f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f86,f170';
        const payload = await fetchJson(`https://push2.eastmoney.com/api/qt/stock/get?secid=${instrument.quoteId}&fields=${fields}`, this.timeoutMs);
        const data = payload.data;
        if (!data)
            throw new Error(`东方财富没有返回 ${code} 的行情`);
        const decimals = Number(data.f59 ?? 2);
        const divisor = 10 ** decimals;
        const price = number(data.f43, divisor);
        if (price == null)
            throw new Error(`东方财富 ${code} 最新价无效`);
        const timestamp = number(data.f86);
        return {
            instrument: { ...instrument, name: String(data.f58 ?? instrument.name), code: String(data.f57 ?? instrument.code) },
            price,
            open: number(data.f46, divisor),
            high: number(data.f44, divisor),
            low: number(data.f45, divisor),
            previousClose: number(data.f60, divisor),
            volume: number(data.f47),
            amount: number(data.f48),
            changeRatio: number(data.f170, 10000),
            exchangeTime: timestamp == null ? null : new Date(timestamp * 1000).toISOString(),
            collectedAt: new Date().toISOString(),
            source: this.id,
        };
    }
    async getBars(code, period, limit, options) {
        const instrument = inferInstrument(code);
        const params = new URLSearchParams({
            secid: instrument.quoteId,
            klt: String(eastmoneyPeriod(period)),
            fqt: '1',
            lmt: String(limit),
            fields1: 'f1,f2,f3,f4,f5,f6',
            fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
        });
        const dateParam = (value) => value.slice(0, 10).replaceAll('-', '');
        if (options?.start)
            params.set('beg', dateParam(options.start));
        if (options?.end)
            params.set('end', dateParam(options.end));
        else if (options?.asOf)
            params.set('end', dateParam(options.asOf));
        const payload = await fetchJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`, this.timeoutMs);
        const reference = options?.asOf ? new Date(options.asOf) : new Date();
        const bars = (payload.data?.klines ?? []).map((line) => {
            const [time, open, close, high, low, volume, amount] = line.split(',');
            return {
                time,
                open: Number(open),
                close: Number(close),
                high: Number(high),
                low: Number(low),
                volume: Number(volume),
                amount: number(amount),
                period,
                closed: barClosed(time, period, reference),
                source: this.id,
            };
        }).filter((bar) => [bar.open, bar.close, bar.high, bar.low].every(Number.isFinite));
        return filterBarsForQuery(bars, options).slice(-limit);
    }
}

export class TencentProvider {
    timeoutMs;
    id = 'tencent';
    constructor(timeoutMs) {
        this.timeoutMs = timeoutMs;
    }
    async searchInstruments(query) {
        const response = await fetchWithTimeout(`https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(query)}&t=all`, this.timeoutMs, { headers: { Referer: 'https://gu.qq.com/' } });
        const text = new TextDecoder('gbk').decode(new Uint8Array(await response.arrayBuffer()));
        const raw = text.match(/v_hint=("[\s\S]*");?/)?.[1];
        if (!raw)
            return [];
        const body = JSON.parse(raw);
        return body.split('^').map((item) => {
            const [market, code, name, , label] = item.split('~');
            const inferred = inferInstrument(code, `${name} ${label}`);
            const exchange = market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : market === 'bj' ? 'BJ' : 'UNKNOWN';
            return { ...inferred, name, exchange, quoteId: `${exchange === 'SH' ? 1 : 0}.${code}` };
        }).filter((item) => item.code && item.exchange !== 'UNKNOWN' && item.type !== 'unknown').slice(0, 20);
    }
    async getQuote(code) {
        const instrument = inferInstrument(code);
        const prefix = instrument.exchange === 'SH' ? 'sh' : instrument.exchange === 'BJ' ? 'bj' : 'sz';
        const response = await fetchWithTimeout(`https://qt.gtimg.cn/q=${prefix}${instrument.code}`, this.timeoutMs, {
            headers: { Referer: 'https://gu.qq.com/' },
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const text = new TextDecoder('gbk').decode(bytes);
        const body = text.match(/="([\s\S]*)"/)?.[1];
        if (!body)
            throw new Error(`腾讯行情没有返回 ${code}`);
        const fields = body.split('~');
        const price = number(fields[3]);
        if (price == null)
            throw new Error(`腾讯行情 ${code} 最新价无效`);
        const rawTime = fields[30];
        const exchangeTime = /^\d{14}$/.test(rawTime ?? '')
            ? `${rawTime.slice(0, 4)}-${rawTime.slice(4, 6)}-${rawTime.slice(6, 8)}T${rawTime.slice(8, 10)}:${rawTime.slice(10, 12)}:${rawTime.slice(12, 14)}+08:00`
            : null;
        const summaryAmount = number(fields[35]?.split('/')[2]);
        const amountInTenThousands = number(fields[37]);
        return {
            instrument: { ...instrument, name: fields[1] || instrument.name },
            price,
            previousClose: number(fields[4]),
            open: number(fields[5]),
            high: number(fields[33]),
            low: number(fields[34]),
            volume: number(fields[36]),
            amount: summaryAmount ?? (amountInTenThousands == null ? null : amountInTenThousands * 10_000),
            changeRatio: number(fields[32], 100),
            exchangeTime,
            collectedAt: new Date().toISOString(),
            source: this.id,
        };
    }
    async getBars(code, period, limit, options) {
        const instrument = inferInstrument(code);
        const prefix = instrument.exchange === 'SH' ? 'sh' : instrument.exchange === 'BJ' ? 'bj' : 'sz';
        const symbol = `${prefix}${instrument.code}`;
        const daily = period === '1d' || period === '1w' || period === '1M';
        const frequency = period === '1d' ? 'day' : period === '1w' ? 'week' : period === '1M' ? 'month' : `m${period.slice(0, -1)}`;
        const url = daily
            ? `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},${frequency},,,${limit},qfq`
            : `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${symbol},${frequency},,${limit}`;
        const payload = await fetchJson(url, this.timeoutMs, {
            headers: { Referer: 'https://gu.qq.com/' },
        });
        const record = payload.data?.[symbol];
        if (!record)
            throw new Error(`腾讯 K 线没有返回 ${code}`);
        const key = daily ? `qfq${frequency}` : frequency;
        const rows = (record[key] ?? []);
        const reference = options?.asOf ? new Date(options.asOf) : new Date();
        const bars = rows.map((row) => {
            const rawTime = String(row[0]);
            const time = /^\d{12}$/.test(rawTime)
                ? `${rawTime.slice(0, 4)}-${rawTime.slice(4, 6)}-${rawTime.slice(6, 8)} ${rawTime.slice(8, 10)}:${rawTime.slice(10, 12)}`
                : rawTime;
            return {
                time,
                open: Number(row[1]),
                close: Number(row[2]),
                high: Number(row[3]),
                low: Number(row[4]),
                volume: Number(row[5]),
                amount: null,
                period,
                closed: barClosed(time, period, reference),
                source: this.id,
            };
        }).filter((bar) => [bar.open, bar.close, bar.high, bar.low].every(Number.isFinite));
        return filterBarsForQuery(bars, options).slice(-limit);
    }
}
export class TushareProvider {
    config;
    timeoutMs;
    id = 'tushare';
    constructor(config, timeoutMs) {
        this.config = config;
        this.timeoutMs = timeoutMs;
    }
    async call(apiName, params, fields) {
        if (!this.config.enabled || !this.config.token)
            throw new Error('Tushare 未启用或 Token 为空');
        const payload = await fetchJson(this.config.endpoint, this.timeoutMs, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ api_name: apiName, token: this.config.token, params, fields: fields.join(',') }),
        });
        if (payload.code !== 0)
            throw new Error(`Tushare ${apiName}: ${payload.msg ?? payload.code}`);
        const keys = payload.data?.fields ?? fields;
        return (payload.data?.items ?? []).map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index]])));
    }
    async getBars(code, period, limit, options) {
        if (period !== '1d')
            throw new Error('Tushare 适配器首版只提供日线补充');
        const instrument = inferInstrument(code);
        const tsCode = `${instrument.code}.${instrument.exchange}`;
        const api = instrument.type === 'cbond' ? 'cb_daily' : 'daily';
        const rows = await this.call(api, { ts_code: tsCode }, ['trade_date', 'open', 'high', 'low', 'close', 'vol', 'amount']);
        const bars = rows.slice(0, limit).reverse().map((row) => ({
            time: String(row.trade_date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.vol),
            amount: number(row.amount),
            period,
            closed: true,
            source: this.id,
        }));
        return filterBarsForQuery(bars, options).slice(-limit);
    }
}
export function createProviders(config) {
    const providers = new Map();
    if (config.sina?.enabled !== false)
        providers.set('sina', new SinaUniverseProvider(config.request_timeout_ms));
    if (config.eastmoney.enabled)
        providers.set('eastmoney', new EastmoneyProvider(config.request_timeout_ms));
    if (config.tencent.enabled)
        providers.set('tencent', new TencentProvider(config.request_timeout_ms));
    if (config.tushare.enabled && config.tushare.token)
        providers.set('tushare', new TushareProvider(config.tushare, config.request_timeout_ms));
    return [...new Set(['sina', 'tencent', ...config.priority])].map((id) => providers.get(id)).filter((item) => Boolean(item));
}
