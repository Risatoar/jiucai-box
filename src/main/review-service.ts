import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AiConfig } from '../shared/types'
import type {
  ReviewCandidateReview,
  ReviewDateRange,
  ReviewHotStock,
  ReviewIndexAssessment,
  ReviewMarketOverview,
  ReviewOutcomeStatus,
  ReviewPeriod,
  ReviewReport,
  ReviewRequest,
  ReviewSectorAnalysis,
  ReviewSignalReview,
  ReviewStage
} from '../shared/review-types'
import { buildAggregate, emptyReport, loadReviewReport, saveReviewReport } from './review-store'
import { readBarsFromCache } from './review-market-data'
import { collectMarketOverview } from './review-market-overview'
import { loadAiConfig } from './ai-config-store'
import { loadTradeMasterSnapshot, runTradeMaster } from './trade-master'
import { sendAiMessage } from './ai-provider'
import { stripThinkingTags, cleanJsonStrings } from '../shared/ai-content-cleaner'
import { getReviewDateRange, normalizeReviewSelection } from '../shared/review-period'

const REVIEW_PROMPT = `
你是交易复盘助手，面向 A 股交易者做每日/每周/每月市场复盘。
必须先读取输入中的 period 和 range：daily 只总结当日，weekly 总结整个自然周区间，monthly 总结整个自然月区间。周报和月报中的板块涨跌、宽度、成交额、龙头表现都已经按区间聚合，禁止写成“今天”“当日涨跌”或复述单日结论。
复盘分两层，必须严格分开：
第一层是【大盘与市场】：基于全市场真实数据（市场宽度、主要指数表现、热门板块热度、全市场扫描出的强势标的），判断指数环境、挖掘当天或近期的热门板块和变更趋势、识别龙头股和热门股。这一层绝对不能看用户的持仓、关注列表、自选股或推荐候选池，只能基于全市场客观数据。
第二层是【我的推荐复核】：复核 AI 此前推荐给用户的候选池和买卖信号，哪些验证了、哪些失效、哪些仍在观察，以及 AI 自身盲区。这一层只看用户自己的候选和信号。
用日常中文，先说结论和下一步。不要编造数据，信息不足就写清楚。
仅返回一个 JSON 对象，不要 Markdown。字段必须为：
indexAssessment（stance, summary, evidence[], nextSessionFocus）— 指数环境总判断；
sectors[]（id, name, trend, stage, summary, evidence[], leaders[], observation, winRate, suggestion, relatedCodes[]）— 热门板块，按热度和重要性排序，最多 8 个，必须基于全 A 股行业聚合数据，不要复述用户持仓；leaders 只能是该行业全量股票中扫描出的 A 股个股，禁止 ETF、指数和转债；
hotStocks[]（code, name, sector, role, changePercent, stage, summary, evidence[], nextScript, invalidation, suggestion）— 热门股/龙头股，最多 12 只，来自全 A 股行业强势个股，每只必须归属 sector；禁止使用用户关注股补位，禁止 ETF、指数和转债；
candidateSummary（对用户候选池表现的总结文字）、signalSummary（对用户信号复核的总结文字）— 这两段才是复核用户自己的推荐；
summary（整体复盘结论）。
trend 只能是 up/down/range/breakout/breakdown/unknown；stage 只能是 启动/加速/分歧/退潮/穿越/未知。
参考截图风格：每个题材要有明确判断、证据链（具体板块或个股表现+热度分数+涨跌+量能+宽度）、次日观察点和操作建议。
候选池和信号复核要如实写出哪些验证了、哪些失效、哪些仍在观察，以及 AI 自身的盲区。
`;
const shanghaiDate = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const parseBars = (output: string) => {
  try {
    const payload = JSON.parse(output) as { bars?: import('../shared/types').MarketBar[] }
    return Array.isArray(payload.bars) ? payload.bars : []
  } catch { return [] }
}

const fetchBars = async (code: string, period: string, limit: string, start?: string, end?: string) => {
  const args = ['bars', '--code', code, '--period', period, '--limit', limit]
  if (start) args.push('--start', start)
  if (end) args.push('--end', end)
  try {
    const bars = parseBars(await runTradeMaster('market', args))
    if (bars.length) return bars
  } catch { /* fall through to cache */ }
  return readBarsFromCache(code, period, Number(limit), start)
}

const round = (value: number) => Math.round(value * 100) / 100

const candidateStatus = (change: number | null): ReviewOutcomeStatus => {
  if (change == null) return 'pending'
  if (change >= 3) return 'verified'
  if (change <= -3) return 'failed'
  return 'watching'
}

const signalStatus = (record: import('../shared/types').SignalLedgerRecord): ReviewOutcomeStatus => {
  if (record.caseKind === 'goodcase') return 'verified'
  if (record.caseKind === 'badcase') return 'failed'
  if (record.caseKind === 'neutral') return 'partial'
  return 'pending'
}

const latestDirectionalReturn = (record: import('../shared/types').SignalLedgerRecord, latestPrice: number | null) => {
  const completed = [...record.outcomes].reverse().find((o) => o.status === 'completed' && o.directionalReturnPercent != null)
  if (completed) return round(completed.directionalReturnPercent as number)
  const ref = Number(record.referencePrice || 0)
  if (ref > 0 && latestPrice != null && latestPrice > 0) {
    const pct = (latestPrice / ref - 1) * 100
    return record.side === 'sell' ? round(-pct) : round(pct)
  }
  return null
}

const tradeMasterHome = () => process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')

const collectCandidates = async (range: ReviewDateRange): Promise<ReviewCandidateReview[]> => {
  const snapshot = await loadTradeMasterSnapshot();
  const raw = snapshot.watchlist as { items?: Array<Record<string, unknown>> } | null;
  const items = raw?.items || [];
  const agentItems = items.filter((item) => item.source === 'agent' || item.source === 'ai');
  const result: ReviewCandidateReview[] = [];
  for (const item of agentItems.slice(0, 30)) {
    const code = String(item.code || '');
    if (!/^\d{6}$/.test(code)) continue;
    const recommendedAt = String(item.addedAt || item.updatedAt || range.tradingDate)
    const recommendedDate = recommendedAt.slice(0, 10)
    if (recommendedDate < range.start || recommendedDate > range.end) continue
    const bars = await fetchBars(code, '1d', '40', range.start, range.end);
    const last = bars.at(-1);
    const reference = Number(item.referencePrice || item.avgCost || bars[0]?.close || 0) || null;
    const latest = last?.close || Number(item.latestPrice || 0) || null;
    const change = reference && latest ? round((latest / reference - 1) * 100) : null;
    result.push({
      id: 'candidate-' + code,
      code,
      name: String(item.name || code),
      recommendedAt,
      recommendation: String(item.signal || item.nextAction || 'AI 推荐关注'),
      reason: String(item.suitableFor || item.strategyLabel || 'AI 候选池扫描'),
      referencePrice: reference,
      latestPrice: latest,
      changeSinceRecommend: change,
      status: candidateStatus(change),
      summary: '',
      evidence: [],
      bars
    });
  }
  return result;
}

const collectSignals = async (range: ReviewDateRange): Promise<ReviewSignalReview[]> => {
  let records: import('../shared/types').SignalLedgerRecord[] = [];
  try {
    const ledger = JSON.parse(await readFile(join(tradeMasterHome(), 'signals', 'ledger.json'), 'utf8')) as { records?: import('../shared/types').SignalLedgerRecord[] };
    records = Array.isArray(ledger.records) ? ledger.records : [];
  } catch { records = [] }
  const filtered = records.filter((r) => r.signalDate >= range.start && r.signalDate <= range.end).slice(0, 200);
  const result: ReviewSignalReview[] = [];
  for (const record of filtered) {
    const bars = await fetchBars(record.code, '1d', '45', record.signalDate, range.end);
    const last = bars.at(-1);
    result.push({
      id: record.id,
      code: record.code,
      name: record.name,
      side: record.side,
      signal: record.signal,
      strategy: record.strategy || '',
      level: record.confidence,
      signalAt: record.recordedAt,
      signalDate: record.signalDate,
      referencePrice: record.referencePrice,
      latestPrice: last?.close || null,
      outcomeStatus: signalStatus(record),
      directionalReturnPercent: latestDirectionalReturn(record, last?.close || null),
      summary: record.summary || '',
      evidence: record.evidence || [],
      bars
    });
  }
  return result;
}

const parseAiAnalysis = (content: string): Record<string, unknown> => {
  const stripped = stripThinkingTags(content);
  const trimmed = stripped.trim();
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(trimmed);
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return cleanJsonStrings(parsed) as Record<string, unknown>;
    } catch { /* try next candidate */ }
  }
  throw new Error('AI 返回的不是有效 JSON 复盘报告，请重新生成');
}

const withTimeout = <T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds)
    void promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })


const trendFromChange = (change: number | null): ReviewSectorAnalysis["trend"] => {
  if (change == null) return "unknown";
  if (change >= 3) return "breakout";
  if (change >= 0.5) return "up";
  if (change <= -3) return "breakdown";
  if (change <= -0.5) return "down";
  return "range";
}

const stageFromChange = (change: number | null): ReviewSectorAnalysis["stage"] => {
  if (change == null) return "未知";
  if (change >= 5) return "加速";
  if (change >= 2) return "启动";
  if (change >= -1) return "分歧";
  if (change >= -3) return "退潮";
  return "穿越";
}

export const buildAuthoritativeMarketSections = (
  marketOverview: ReviewMarketOverview,
  aiSectors: ReviewSectorAnalysis[] = [],
  aiStocks: ReviewHotStock[] = []
) => {
  const fmt = (value: number | null | undefined, suffix = '') => value == null ? '--' : value + suffix
  const sectors = marketOverview.hotThemes.slice(0, 8).map((theme, index) => {
    const ai = aiSectors.find((item) => item.name === theme.name)
    const base: ReviewSectorAnalysis = {
      id: 'sector-' + (theme.name || index),
      name: theme.name || `板块${index + 1}`,
      trend: trendFromChange(theme.changePercent),
      stage: stageFromChange(theme.changePercent),
      summary: `${theme.name}行业热度 ${fmt(theme.heatScore)}，涨跌幅 ${fmt(theme.changePercent, '%')}，上涨宽度 ${fmt(theme.breadthPercent, '%')}。`,
      evidence: [
        theme.sampleStockCount
          ? `覆盖全市场行业，周期统计采用 ${theme.sampleStockCount} 只高流动性样本，${theme.amountEstimated ? '估算' : ''}累计成交额 ${theme.totalAmount != null ? (theme.totalAmount / 1e8).toFixed(2) + ' 亿' : '--'}`
          : `覆盖 ${theme.stockCount || '--'} 只行业个股，成交额 ${theme.totalAmount != null ? (theme.totalAmount / 1e8).toFixed(2) + ' 亿' : '--'}`,
        theme.representatives.length ? `全行业个股龙头：${theme.representatives.map((item) => item.name).join('、')}` : '未扫描到合格个股龙头'
      ],
      leaders: theme.representatives.map((item) => item.name),
      representatives: theme.representatives,
      observation: theme.changePercent != null && theme.changePercent >= 2
        ? '行业处于加速阶段，次日关注上涨宽度和量能能否延续。'
        : '行业有热度但强度尚未扩散，次日关注是否分歧转一致。',
      winRate: theme.breadthPercent != null ? round(theme.breadthPercent) : null,
      suggestion: theme.heatScore != null && theme.heatScore >= 70
        ? '热度靠前，等待分歧后的结构确认，不追高。'
        : '热度一般，先观察，不因单只个股异动追涨。',
      relatedCodes: theme.representativeCodes
    }
    if (!ai) return base
    return {
      ...base,
      summary: ai.summary || base.summary,
      evidence: ai.evidence?.length ? ai.evidence : base.evidence,
      observation: ai.observation || base.observation,
      suggestion: ai.suggestion || base.suggestion
    }
  })
  const hotStocks = marketOverview.hotThemes.slice(0, 6).flatMap((theme) =>
    theme.representatives.slice(0, 3).map((representative, index) => {
      const ai = aiStocks.find((item) => item.code === representative.code)
      const base: ReviewHotStock = {
        code: representative.code,
        name: representative.name,
        sector: theme.name,
        role: index === 0 ? '龙头' : '补涨',
        changePercent: representative.changePercent ?? theme.changePercent,
        price: representative.price,
        instrumentType: 'stock',
        turnoverRate: representative.turnoverPercent,
        stage: stageFromChange(representative.changePercent ?? theme.changePercent),
        summary: `${theme.name}行业全市场个股排名第 ${index + 1}，行业热度 ${fmt(theme.heatScore)}。`,
        evidence: [
          `行业覆盖 ${theme.stockCount || '--'} 只股票，上涨宽度 ${fmt(theme.breadthPercent, '%')}`,
          `个股涨跌 ${fmt(representative.changePercent, '%')}，现价 ${fmt(representative.price)}`
        ],
        nextScript: '次日观察行业上涨宽度和个股量价能否继续确认。',
        invalidation: '行业热度明显回落，或个股结构转弱且无法快速收回。',
        suggestion: '只作观察，等待完整量价结构确认，不追高。'
      }
      if (!ai) return base
      return {
        ...base,
        summary: ai.summary || base.summary,
        evidence: ai.evidence?.length ? ai.evidence : base.evidence,
        nextScript: ai.nextScript || base.nextScript,
        invalidation: ai.invalidation || base.invalidation,
        suggestion: ai.suggestion || base.suggestion
      }
    })
  ).slice(0, 12)
  return { sectors, hotStocks }
}

const buildDeterministicReport = (
  period: ReviewPeriod,
  range: ReviewDateRange,
  marketOverview: ReviewMarketOverview,
  indexBars: import('../shared/types').MarketBar[],
  candidates: ReviewCandidateReview[],
  signals: ReviewSignalReview[]
): ReviewReport => {
  const stockBreadth = marketOverview.breadth.find((b) => b.type === 'stock');
  const risingRatio = stockBreadth && stockBreadth.total ? Math.round((stockBreadth.rising / stockBreadth.total) * 1000) / 10 : null;
  const firstIndex = indexBars[0];
  const lastIndex = indexBars.at(-1);
  const indexChange = firstIndex && lastIndex && firstIndex.open > 0
    ? round((lastIndex.close / firstIndex.open - 1) * 100)
    : null;
  const periodText = period === 'daily' ? '当日' : period === 'weekly' ? '本周' : '本月'
  const stance = risingRatio != null
    ? risingRatio >= 60 ? '偏强，多头占优' : risingRatio >= 50 ? '震荡偏强' : risingRatio >= 40 ? '震荡偏弱' : '偏弱，空头占优'
    : '数据不足，待确认';
  const fmt = (v: number | null | undefined, suffix = '') => (v == null ? '--' : v + suffix);
  const indexAssessment: ReviewIndexAssessment = {
    stance,
    summary: `${periodText}全市场统计样本 ${fmt(stockBreadth?.total)} 只，上涨 ${fmt(stockBreadth?.rising)} 只、下跌 ${fmt(stockBreadth?.falling)} 只，上涨比例 ${fmt(risingRatio, '%')}，中位数涨跌幅 ${fmt(stockBreadth?.medianChangePercent, '%')}。上证指数区间涨跌 ${fmt(indexChange, '%')}。`,
    evidence: [
      `市场宽度：上涨 ${fmt(stockBreadth?.rising)} / 总 ${fmt(stockBreadth?.total)}，下跌 ${fmt(stockBreadth?.falling)}，平盘 ${fmt(stockBreadth?.flat)}`,
      ...marketOverview.benchmarks.slice(0, 4).map((b) => `${b.name}：${fmt(b.changePercent, '%')}，现价 ${b.price != null ? b.price.toFixed(3) : '--'}`),
    ],
    nextSessionFocus: risingRatio != null && risingRatio >= 55
      ? '上涨家数占优，观察领涨板块能否延续；若指数同步放量上攻则确认强势。'
      : '上涨家数不足，等待指数选择方向；重点观察热门板块热度是否扩散。',
  };
  const { sectors, hotStocks } = buildAuthoritativeMarketSections(marketOverview)
  const aggregate = buildAggregate(candidates, signals);
  const candidateSummary = candidates.length
    ? `本轮共复核 ${candidates.length} 个 AI 推荐候选，其中已验证 ${aggregate.candidateVerified} 个、已失效 ${aggregate.candidateFailed} 个、仍在观察 ${aggregate.candidateWatching} 个。`
    : '本轮暂无 AI 推荐候选复核数据。';
  const signalSummary = signals.length
    ? `本轮共复核 ${signals.length} 条买卖信号，已评价 ${aggregate.signalEvaluated} 条，信号准确率 ${fmt(aggregate.signalAccuracyPercent, '%')}。`
    : '本轮暂无买卖信号复核数据。';
  return {
    schemaVersion: 1,
    id: `review-${period}-${range.tradingDate}`,
    period,
    range,
    stage: 'ready',
    generatedAt: new Date().toISOString(),
    dataAsOf: new Date().toISOString(),
    marketOverview,
    indexAssessment,
    sectors,
    hotStocks,
    candidateReviews: candidates,
    signalReviews: signals,
    aggregate,
    candidateSummary,
    signalSummary,
    summary: `基于${periodText}全市场客观数据生成（AI 深度分析暂不可用）。市场状态：${marketOverview.regime || '未知'}；周期上涨比例 ${fmt(risingRatio, '%')}。热门板块：${marketOverview.hotThemes.slice(0, 3).map(t => t.name).filter(Boolean).join('、') || '暂无'}。`,
  };
}
const generateReviewReportOnce = async (request: ReviewRequest): Promise<ReviewReport> => {
  const today = shanghaiDate(new Date());
  const tradingDate = normalizeReviewSelection(request.period, request.tradingDate || today);
  const range = getReviewDateRange(request.period, tradingDate, today);
  const existing = await loadReviewReport(request.period, tradingDate);
  if (!request.force && existing && existing.stage === 'ready') return existing;

  const collecting: ReviewReport = { ...emptyReport(request.period, range, 'collecting') };
  await saveReviewReport(collecting);

  let indexBars: import('../shared/types').MarketBar[] = [];
  let marketOverview: ReviewMarketOverview = { regime: null, breadth: [], benchmarks: [], hotThemes: [], generatedAt: null };
  let candidates: ReviewCandidateReview[] = [];
  let signals: ReviewSignalReview[] = [];
  try {
    [indexBars, marketOverview, candidates, signals] = await Promise.all([
      fetchBars('000001', '1d', '60', range.start, range.end),
      collectMarketOverview(request.period, range),
      collectCandidates(range),
      collectSignals(range)
    ]);
  } catch (error) {
    const fallback = buildDeterministicReport(request.period, range, marketOverview, indexBars, candidates, signals);
    fallback.period = request.period;
    fallback.id = `review-${request.period}-${range.tradingDate}`;
    fallback.error = error instanceof Error ? error.message : String(error);
    return saveReviewReport(fallback);
  }

  const analyzing: ReviewReport = {
    ...collecting,
    stage: 'analyzing',
    marketOverview,
    rawData: { indexBars, candidates, signals }
  };
  await saveReviewReport(analyzing);

  try {
    const config = await loadAiConfig();
    const evidencePayload = {
      period: request.period,
      range,
      marketOverview,
      indexBars: indexBars.slice(-30),
      candidates: candidates.map(({ bars, ...rest }) => rest),
      signals: signals.map(({ bars, ...rest }) => rest)
    };
    const content = await withTimeout(sendAiMessage(config, [
      { role: 'system', content: REVIEW_PROMPT },
      { role: 'user', content: `复盘数据：${JSON.stringify(evidencePayload)}` }
    ], { purpose: 'automation' }), 90_000, 'AI 深度文案生成超时，已切换为全市场规则分析');

    const raw = parseAiAnalysis(content);
    const indexAssessment = raw.indexAssessment as ReviewIndexAssessment | undefined;
    const aiSectors = Array.isArray(raw.sectors) ? raw.sectors as ReviewSectorAnalysis[] : [];
    const aiStocks = Array.isArray(raw.hotStocks) ? raw.hotStocks as ReviewHotStock[] : [];
    const { sectors, hotStocks } = buildAuthoritativeMarketSections(marketOverview, aiSectors, aiStocks)
    const aggregate = buildAggregate(candidates, signals);

    const ready: ReviewReport = {
      ...analyzing,
      stage: 'ready',
      generatedAt: new Date().toISOString(),
      dataAsOf: new Date().toISOString(),
      indexAssessment,
      sectors,
      hotStocks,
      candidateReviews: candidates,
      signalReviews: signals,
      aggregate,
      candidateSummary: typeof raw.candidateSummary === 'string' ? raw.candidateSummary : '',
      signalSummary: typeof raw.signalSummary === 'string' ? raw.signalSummary : '',
      summary: typeof raw.summary === 'string' ? raw.summary : ''
    };
    return saveReviewReport(ready);
  } catch (error) {
    const fallback = buildDeterministicReport(request.period, range, marketOverview, indexBars, candidates, signals);
    fallback.period = request.period;
    fallback.id = `review-${request.period}-${range.tradingDate}`;
    fallback.error = error instanceof Error ? error.message : String(error);
    return saveReviewReport(fallback);
  }
}

const reviewRuns = new Map<string, Promise<ReviewReport>>();

export const generateReviewReport = (request: ReviewRequest): Promise<ReviewReport> => {
  const today = shanghaiDate(new Date());
  const tradingDate = normalizeReviewSelection(request.period, request.tradingDate || today);
  const key = `${request.period}:${tradingDate}`;
  const active = reviewRuns.get(key);
  if (active) return active;
  const run = generateReviewReportOnce({ ...request, tradingDate })
    .finally(() => reviewRuns.delete(key));
  reviewRuns.set(key, run);
  return run;
};

export const getReviewReport = async (request: ReviewRequest): Promise<ReviewReport> => {
  const today = shanghaiDate(new Date());
  const tradingDate = normalizeReviewSelection(request.period, request.tradingDate || today);
  const existing = await loadReviewReport(request.period, tradingDate);
  if (existing?.stage === 'ready') return existing;
  return generateReviewReport({ ...request, tradingDate });
}
