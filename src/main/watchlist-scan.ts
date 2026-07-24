import type { WatchItem } from '../shared/types'
import { loadAiConfig } from './ai-config-store'
import { runTradeMaster } from './trade-master'
import { loadAgentWatchItemsForReview, loadRuntimeCandidates, syncAgentWatchItems } from './watchlist-store'
import { analyzeWatchlistOpportunities, buildOpportunityReviewPool, type OpportunityCandidate } from './watchlist-opportunity'

interface MarketBreadth { type?: string; total?: number }
interface CandidateRefresh {
  refresh_status?: string
  source_errors?: string[]
  source?: string[]
  market_breadth?: MarketBreadth[]
  attempted_market_breadth?: MarketBreadth[]
}

interface MonitoredCandidate {
  code?: string
  status?: string
  checks?: unknown
  technical_evidence?: unknown
  blockers?: unknown
  conclusion?: string
  data_as_of?: string
  error?: string
  strategy_lane?: string
  strategy_lane_label?: string
  suitable_for?: string
}

interface CandidateMonitor { candidates?: MonitoredCandidate[] }

export interface WatchlistScanResult {
  ok: boolean
  added?: number
  updated?: number
  removed?: number
  active?: number
  reviewed?: number
  analyzed?: number
  scanned?: number
  enriched?: number
  durationMs?: number
  aiDurationMs?: number
  sources?: string[]
  error?: string
}

const attachTechnicalEvidence = (candidates: OpportunityCandidate[], monitor: CandidateMonitor): OpportunityCandidate[] => {
  const byCode = new Map((monitor.candidates || []).map((item) => [item.code, item]))
  return candidates.map((candidate) => {
    const evidence = byCode.get(candidate.code)
    return evidence ? {
      ...candidate,
      technicalEvidence: evidence,
      strategyLane: evidence.strategy_lane,
      strategyLabel: evidence.strategy_lane_label,
      suitableFor: evidence.suitable_for
    } : candidate
  })
}

export const filterVerifiedOpportunityCandidates = (candidates: OpportunityCandidate[]): OpportunityCandidate[] => candidates.filter((item) => {
  const evidence = item.technicalEvidence as MonitoredCandidate | undefined
  return Boolean(evidence?.technical_evidence && ['watching', 'buy_ready'].includes(String(evidence.status)))
})

const countScanned = (refresh: CandidateRefresh) => (refresh.market_breadth || refresh.attempted_market_breadth || [])
  .reduce((sum, item) => sum + Number(item.total || 0), 0)

export const scanWatchlistOpportunities = async (liveItems: WatchItem[] = []): Promise<WatchlistScanResult> => {
  const startedAt = Date.now()
  try {
    const previous = await loadAgentWatchItemsForReview()
    const refreshed = JSON.parse(await runTradeMaster('candidate', [
      'refresh', '--as-of', new Date().toISOString(), '--limit', '45', '--screening-only', '--no-sync'
    ])) as CandidateRefresh
    if (refreshed.refresh_status !== 'success') {
      throw new Error(`全市场初筛没有完成${refreshed.source_errors?.length ? `：${refreshed.source_errors.join('；')}` : ''}，已保留原关注列表`)
    }

    const screened = await loadRuntimeCandidates()
    const safeLiveItems = Array.isArray(liveItems)
      ? liveItems.filter((item) => previous.some((old) => old.code === item.code) && /^\d{6}$/.test(item.code))
      : []
    const reviewPool = buildOpportunityReviewPool(screened, previous, safeLiveItems)
    if (!reviewPool.length) throw new Error('全市场初筛没有留下可复核候选，已保留原关注列表')

    const monitored = JSON.parse(await runTradeMaster('candidate', ['monitor', '--limit', String(reviewPool.length)])) as CandidateMonitor
    const enrichedPool = attachTechnicalEvidence(reviewPool, monitored)
    const verifiedPool = filterVerifiedOpportunityCandidates(enrichedPool)
    const enriched = verifiedPool.length
    if (enriched !== 10) throw new Error(`只有 ${enriched}/10 个候选完成五策略篮子验证（共复核 ${reviewPool.length} 个），已保留原关注列表`)

    const aiStartedAt = Date.now()
    const analyzed = await analyzeWatchlistOpportunities(await loadAiConfig(), verifiedPool, previous.map((item) => item.code))
    const aiDurationMs = Date.now() - aiStartedAt
    const sync = await syncAgentWatchItems(analyzed)
    if (sync.skipped) throw new Error(sync.reason || '候选列表写入失败，已保留原关注列表')
    return {
      ok: true,
      ...sync,
      reviewed: previous.length,
      analyzed: reviewPool.length,
      scanned: countScanned(refreshed),
      enriched,
      durationMs: Date.now() - startedAt,
      aiDurationMs,
      sources: refreshed.source || []
    }
  } catch (error) {
    return { ok: false, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }
  }
}
