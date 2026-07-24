import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildMarketSectorSnapshot } from './market-sector-snapshot.js';

const execFileAsync = promisify(execFile);

const SW_LEVEL_ONE = [
    ['美容护理', 'sw1_770000'], ['环保', 'sw1_760000'], ['石油石化', 'sw1_750000'],
    ['煤炭', 'sw1_740000'], ['通信', 'sw1_730000'], ['传媒', 'sw1_720000'],
    ['计算机', 'sw1_710000'], ['国防军工', 'sw1_650000'], ['机械设备', 'sw1_640000'],
    ['电力设备', 'sw1_630000'], ['建筑装饰', 'sw1_620000'], ['建筑材料', 'sw1_610000'],
    ['综合', 'sw1_510000'], ['非银金融', 'sw1_490000'], ['银行', 'sw1_480000'],
    ['社会服务', 'sw1_460000'], ['商贸零售', 'sw1_450000'], ['房地产', 'sw1_430000'],
    ['交通运输', 'sw1_420000'], ['公用事业', 'sw1_410000'], ['医药生物', 'sw1_370000'],
    ['轻工制造', 'sw1_360000'], ['纺织服饰', 'sw1_350000'], ['食品饮料', 'sw1_340000'],
    ['家用电器', 'sw1_330000'], ['汽车', 'sw1_280000'], ['电子', 'sw1_270000'],
    ['有色金属', 'sw1_240000'], ['钢铁', 'sw1_230000'], ['基础化工', 'sw1_220000'],
    ['农林牧渔', 'sw1_110000'],
];

const number = (value, divisor = 1) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed / divisor : null;
};

const inferInstrument = (code, name = '') => {
    const normalized = String(code).replace(/\.(SH|SZ|BJ)$/i, '').trim();
    const exchange = /^(5|6|11)/.test(normalized) ? 'SH' : /^(0|1|2|3|12)/.test(normalized) ? 'SZ' : /^(4|8|92)/.test(normalized) ? 'BJ' : 'UNKNOWN';
    const type = name.includes('转债') || /^(11|12)/.test(normalized)
        ? 'cbond'
        : name.toUpperCase().includes('ETF') || /^(15|16|50|51|52|56|58)/.test(normalized) ? 'etf' : /^\d{6}$/.test(normalized) ? 'stock' : 'unknown';
    return { code: normalized, name, type, exchange, quoteId: `${exchange === 'SH' ? 1 : 0}.${normalized}` };
};

const curl = async (url, timeoutMs, headers, maxBuffer) => {
    const headerArgs = Object.entries(headers ?? {}).flatMap(([key, value]) => ['-H', `${key}: ${value}`]);
    const seconds = String(Math.max(2, Math.ceil(timeoutMs / 1000)));
    return execFileAsync('/usr/bin/curl', ['-LsS', '--max-time', seconds, ...headerArgs, url], { maxBuffer });
};

const curlJson = async (url, timeoutMs, headers) => JSON.parse((await curl(url, timeoutMs, headers, 8 * 1024 * 1024)).stdout);
const curlText = async (url, timeoutMs, headers) => (await curl(url, timeoutMs, headers, 1024 * 1024)).stdout;

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

const shanghaiParts = (date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
    return { date: `${pick('year')}-${pick('month')}-${pick('day')}`, minutes: Number(pick('hour')) * 60 + Number(pick('minute')) };
};

const barClosed = (time, period, now = new Date()) => {
    const current = shanghaiParts(now);
    const barDate = time.slice(0, 10);
    if (barDate < current.date)
        return true;
    if (barDate > current.date)
        return false;
    if (period === '1d')
        return current.minutes >= 900;
    const match = time.match(/(\d{2}):(\d{2})/);
    if (!match)
        return false;
    return current.minutes >= Number(match[1]) * 60 + Number(match[2]) + Number(period.slice(0, -1));
};

const comparableTime = (value) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return Date.parse(`${value}T15:00:00+08:00`);
    const normalized = value.replace(' ', 'T');
    return Date.parse(`${/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized}+08:00`);
};

const filterBars = (bars, options) => {
    const start = options?.start ? comparableTime(options.start) : null;
    const end = options?.end ? comparableTime(options.end) : null;
    const asOfDate = options?.asOf ? new Date(options.asOf) : null;
    const asOf = asOfDate && Number.isFinite(asOfDate.getTime()) ? asOfDate.getTime() : null;
    return bars.filter((bar) => {
        const time = comparableTime(bar.time);
        return !(start != null && time < start) && !(end != null && time > end) && !(asOf != null && (!barClosed(bar.time, bar.period, asOfDate) || time > asOf));
    });
};

export function normalizeSinaUniverseRow(item, type, collectedAt = new Date().toISOString()) {
    const code = String(item.code ?? '').trim();
    const name = String(item.name ?? '').trim();
    const price = number(item.trade);
    if (!/^\d{6}$/.test(code) || !name || price == null || price <= 0)
        return null;
    const previousClose = number(item.settlement);
    const high = number(item.high);
    const low = number(item.low);
    return {
        instrument: { ...inferInstrument(code, name), type }, price, changeRatio: number(item.changepercent, 100), volume: number(item.volume), amount: number(item.amount),
        amplitudeRatio: previousClose && high != null && low != null ? Math.max(0, (high - low) / previousClose) : 0,
        turnoverRatio: number(item.turnoverratio, 100), high, low, open: number(item.open), previousClose, source: 'sina', collectedAt,
    };
}

export function normalizeSinaBar(row, period, reference = new Date()) {
    const time = String(row.day ?? '');
    const bar = { time, open: Number(row.open), close: Number(row.close), high: Number(row.high), low: Number(row.low), volume: Number(row.volume), amount: number(row.amount), period, closed: barClosed(time, period, reference), source: 'sina' };
    return time && [bar.open, bar.close, bar.high, bar.low].every(Number.isFinite) ? bar : null;
}

export class SinaUniverseProvider {
    id = 'sina';
    constructor(timeoutMs) { this.timeoutMs = timeoutMs; }

    async listUniverse(type) {
        const node = type === 'stock' ? 'hs_a' : type === 'etf' ? 'etf_hq_fund' : 'hskzz_z';
        const headers = { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' };
        const count = Number(await curlJson(`https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=${node}`, this.timeoutMs, headers));
        if (!Number.isFinite(count) || count <= 0)
            throw new Error('新浪行情没有返回市场总数');
        const pages = Array.from({ length: Math.ceil(count / 100) }, (_, index) => index + 1);
        const chunks = await mapLimit(pages, 8, async (page) => {
            const params = new URLSearchParams({ page: String(page), num: '100', sort: 'amount', asc: '0', node, symbol: '' });
            const rows = await curlJson(`https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?${params}`, this.timeoutMs, headers);
            if (!Array.isArray(rows))
                throw new Error(`新浪行情第 ${page} 页格式异常`);
            return rows;
        });
        const collectedAt = new Date().toISOString();
        const normalized = chunks.flat().map((item) => normalizeSinaUniverseRow(item, type, collectedAt)).filter((item) => item != null);
        if (!normalized.length)
            throw new Error('新浪行情没有返回全市场列表');
        return [...new Map(normalized.map((item) => [item.instrument.code, item])).values()];
    }

    async listSectorSnapshot() {
        const headers = { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' };
        const sectors = await mapLimit(SW_LEVEL_ONE, 6, async ([industry, node]) => {
            const count = Number(await curlJson(`https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=${node}`, this.timeoutMs, headers));
            if (!Number.isFinite(count) || count <= 0)
                return [];
            const pages = Array.from({ length: Math.ceil(count / 100) }, (_, index) => index + 1);
            const chunks = await mapLimit(pages, 3, async (page) => {
                const params = new URLSearchParams({ page: String(page), num: '100', sort: 'amount', asc: '0', node, symbol: '' });
                const rows = await curlJson(`https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?${params}`, this.timeoutMs, headers);
                return Array.isArray(rows) ? rows : [];
            });
            const collectedAt = new Date().toISOString();
            return chunks.flat().map((item) => {
                const normalized = normalizeSinaUniverseRow(item, 'stock', collectedAt);
                return normalized ? { ...normalized, industry } : null;
            }).filter((item) => item != null);
        });
        const snapshot = buildMarketSectorSnapshot([{ type: 'stock', items: sectors.flat() }]);
        if (!snapshot.sectors.length)
            throw new Error('新浪行情没有返回申万一级行业成分');
        return { ...snapshot, source: 'sina_sw1_full_universe' };
    }

    async getQuote(code) {
        const instrument = inferInstrument(code);
        const prefix = instrument.exchange === 'SH' ? 'sh' : instrument.exchange === 'BJ' ? 'bj' : 'sz';
        const text = await curlText(`https://hq.sinajs.cn/list=${prefix}${instrument.code}`, this.timeoutMs, { Referer: 'https://finance.sina.com.cn/' });
        const fields = text.match(/="([\s\S]*)"/)?.[1]?.split(',');
        const price = number(fields?.[3]);
        const previousClose = number(fields?.[2]);
        if (!fields || price == null || price <= 0)
            throw new Error(`新浪行情没有返回 ${code}`);
        const date = fields[30];
        const time = fields[31];
        return { instrument, price, open: number(fields[1]), previousClose, high: number(fields[4]), low: number(fields[5]), volume: number(fields[8]), amount: number(fields[9]), changeRatio: previousClose ? (price - previousClose) / previousClose : null, exchangeTime: /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && /^\d{2}:\d{2}:\d{2}$/.test(time ?? '') ? `${date}T${time}+08:00` : null, collectedAt: new Date().toISOString(), source: this.id };
    }

    async getBars(code, period, limit, options) {
        const scale = ({ '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '120m': 120, '1d': 240 })[period];
        if (!scale)
            throw new Error(`新浪 K 线暂不支持 ${period}`);
        const instrument = inferInstrument(code);
        const prefix = instrument.exchange === 'SH' ? 'sh' : instrument.exchange === 'BJ' ? 'bj' : 'sz';
        const params = new URLSearchParams({ symbol: `${prefix}${instrument.code}`, scale: String(scale), ma: 'no', datalen: String(Math.min(1023, Math.max(limit, 2))) });
        const rows = await curlJson(`https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?${params}`, this.timeoutMs, { Referer: 'https://finance.sina.com.cn/' });
        if (!Array.isArray(rows))
            throw new Error(`新浪 K 线没有返回 ${code}`);
        const reference = options?.asOf ? new Date(options.asOf) : new Date();
        return filterBars(rows.map((row) => normalizeSinaBar(row, period, reference)).filter((bar) => bar != null), options).slice(-limit);
    }
}
