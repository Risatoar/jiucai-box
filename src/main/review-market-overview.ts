import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  ReviewDateRange,
  ReviewHotTheme,
  ReviewMarketOverview,
  ReviewPeriod,
  ReviewRepresentative
} from '../shared/review-types'
import { runTradeMaster } from './trade-master'

type UnknownRecord = Record<string, unknown>

const round = (value: number) => Math.round(value * 100) / 100
const numberOrNull = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const tradeMasterHome = () => process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')

const readPool = async (): Promise<UnknownRecord> => {
  try {
    return JSON.parse(await readFile(join(tradeMasterHome(), 'runtime', 'candidate-pool.json'), 'utf8')) as UnknownRecord
  } catch {
    return {}
  }
}

const liveSectorSnapshot = async (): Promise<UnknownRecord | null> => {
  try {
    const output = await runTradeMaster('market', ['sectors'])
    const parsed = JSON.parse(output) as UnknownRecord
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const representativeFrom = (raw: UnknownRecord): ReviewRepresentative | null => {
  const code = String(raw.code || '')
  if (!/^\d{6}$/.test(code) || String(raw.type || '') !== 'stock') return null
  return {
    code,
    name: String(raw.name || code),
    type: 'stock',
    price: numberOrNull(raw.price),
    changePercent: numberOrNull(raw.change_percent),
    amount: numberOrNull(raw.amount),
    turnoverPercent: numberOrNull(raw.turnover_percent),
    leadershipScore: numberOrNull(raw.leadership_score)
  }
}

const themesFrom = (snapshot: UnknownRecord | null): ReviewHotTheme[] => {
  const sectors = snapshot && Array.isArray(snapshot.sectors) ? snapshot.sectors as UnknownRecord[] : []
  return sectors.flatMap((sector) => {
    const name = String(sector.name || '')
    if (!name) return []
    const leadersRaw = Array.isArray(sector.leaders) ? sector.leaders as UnknownRecord[] : []
    const representatives = leadersRaw.map(representativeFrom).filter((item): item is ReviewRepresentative => Boolean(item))
    return [{
      name,
      heatScore: numberOrNull(sector.heat_score),
      changePercent: numberOrNull(sector.change_percent),
      breadthPercent: numberOrNull(sector.breadth_percent),
      totalAmount: numberOrNull(sector.total_amount),
      amountEstimated: sector.amount_estimated === true,
      stockCount: Number(sector.stock_count || 0),
      sampleStockCount: Number(sector.sample_stock_count || 0) || undefined,
      representativeCodes: representatives.map((item) => item.code),
      representatives
    }]
  }).sort((left, right) => (right.heatScore ?? 0) - (left.heatScore ?? 0)).slice(0, 12)
}

const parseOutput = (output: string): UnknownRecord => {
  const parsed = JSON.parse(output) as UnknownRecord
  return parsed && typeof parsed === 'object' ? parsed : {}
}

const periodSectorSnapshot = async (range: ReviewDateRange): Promise<UnknownRecord> => {
  const output = await runTradeMaster('market', [
    'sector-period',
    '--start', range.start,
    '--end', range.end
  ])
  const parsed = parseOutput(output)
  if (!Array.isArray(parsed.sectors) || parsed.sectors.length === 0) {
    throw new Error('全市场周期行业聚合没有返回有效板块')
  }
  return parsed
}

const periodBenchmarks = async (
  raw: UnknownRecord[],
  range: ReviewDateRange
) => Promise.all(raw.map(async (item) => {
  const code = String(item.code || '')
  try {
    const payload = parseOutput(await runTradeMaster('market', [
      'bars',
      '--code', code,
      '--period', '1d',
      '--limit', '40',
      '--start', range.start,
      '--end', range.end
    ]))
    const bars = Array.isArray(payload.bars) ? payload.bars as UnknownRecord[] : []
    const first = bars[0]
    const last = bars.at(-1)
    const open = numberOrNull(first?.open)
    const close = numberOrNull(last?.close)
    return {
      code,
      name: String(item.name || code),
      price: close,
      changePercent: open && close ? round((close / open - 1) * 100) : null,
      amount: bars.reduce((sum, bar) => sum + (numberOrNull(bar.amount) || 0), 0)
    }
  } catch {
    return {
      code,
      name: String(item.name || code),
      price: numberOrNull(item.price),
      changePercent: null,
      amount: null
    }
  }
}))

export const collectMarketOverview = async (
  period: ReviewPeriod,
  range: ReviewDateRange
): Promise<ReviewMarketOverview> => {
  const pool = await readPool()
  const persisted = pool.market_sectors && typeof pool.market_sectors === 'object'
    ? pool.market_sectors as UnknownRecord
    : null
  const live = period === 'daily' ? await liveSectorSnapshot() : null
  const sectorSnapshot = period === 'daily'
    ? live || persisted
    : await periodSectorSnapshot(range)
  const periodBreadth = sectorSnapshot?.period_breadth
  const breadthRaw = periodBreadth && typeof periodBreadth === 'object'
    ? [periodBreadth as UnknownRecord]
    : Array.isArray(pool.market_breadth) ? pool.market_breadth as UnknownRecord[] : []
  const breadth = breadthRaw.map((item) => ({
    type: String(item.type || ''),
    total: Number(item.total || 0),
    rising: Number(item.rising || 0),
    falling: Number(item.falling || 0),
    flat: Number(item.flat || 0),
    medianChangePercent: item.median_change_percent != null ? round(Number(item.median_change_percent)) : null,
    totalAmount: item.total_amount != null ? Number(item.total_amount) : null
  }))
  const benchRaw = Array.isArray(pool.benchmarks) ? pool.benchmarks as UnknownRecord[] : []
  const benchmarks = period === 'daily'
    ? benchRaw.map((item) => ({
        code: String(item.code || ''),
        name: String(item.name || ''),
        price: numberOrNull(item.price),
        changePercent: item.change_percent != null ? round(Number(item.change_percent)) : null,
        amount: numberOrNull(item.amount)
      }))
    : await periodBenchmarks(benchRaw, range)
  const periodStockBreadth = breadth.find((item) => item.type === 'stock')
  const risingRatio = periodStockBreadth?.total
    ? periodStockBreadth.rising / periodStockBreadth.total
    : null
  const regime = period === 'daily'
    ? pool.market_regime && typeof pool.market_regime === 'object'
      ? String((pool.market_regime as UnknownRecord).state || '') || null
      : null
    : risingRatio == null ? null : risingRatio >= 0.58 ? 'supportive' : risingRatio < 0.42 ? 'defensive' : 'neutral'
  const scope = String(sectorSnapshot?.scope || '')
  return {
    dataScope: scope === 'all_a_share_stocks' ? 'all_a_share_stocks' : 'unavailable',
    stockCoverage: sectorSnapshot ? {
      total: Number(sectorSnapshot.stock_total || 0),
      classified: Number(sectorSnapshot.classified_stock_total || 0),
      percent: Number(sectorSnapshot.coverage_percent || 0),
      source: String(sectorSnapshot.source || ''),
      sampleSize: Number(sectorSnapshot.sample_stock_total || 0) || undefined
    } : undefined,
    regime,
    breadth,
    benchmarks,
    hotThemes: themesFrom(sectorSnapshot),
    generatedAt: sectorSnapshot && typeof sectorSnapshot.generated_at === 'string'
      ? sectorSnapshot.generated_at
      : typeof pool.generated_at === 'string' ? pool.generated_at : null
  }
}
