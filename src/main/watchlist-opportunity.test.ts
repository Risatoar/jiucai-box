import { describe, expect, it } from 'vitest'
import { analyzeWatchlistOpportunities, buildOpportunityReviewPool, parseWatchlistOpportunityAnalysis, type OpportunityCandidate } from './watchlist-opportunity'
import { filterVerifiedOpportunityCandidates } from './watchlist-scan'

const lanes = ['steady', 'short_3d', 'medium_long', 'hot_leader', 'limit_up']
const candidates: OpportunityCandidate[] = Array.from({ length: 12 }, (_, index) => ({
  code: `60000${index}`,
  name: `候选${index}`,
  type: 'stock',
  exchange: 'SH',
  score: 80 - index,
  strategyLane: lanes[Math.min(4, Math.floor(index / 2))],
  strategyLabel: `策略${Math.min(4, Math.floor(index / 2))}`
}))

describe('parseWatchlistOpportunityAnalysis', () => {
  it('accepts exactly ten known instruments and preserves two names per strategy basket', () => {
    const opportunities = candidates.slice(0, 10).map((item, index) => ({ code: item.code, score: 70 + index, reasons: [`复核理由${index}`] }))
    const parsed = parseWatchlistOpportunityAnalysis(JSON.stringify({ opportunities }), candidates.slice(0, 10))
    expect(parsed).toHaveLength(10)
    expect(parsed[0]).toMatchObject({ code: '600001', score: 71, reasons: ['复核理由1'], signal: '观察', strategyLane: 'steady', nextAction: '等待回踩企稳' })
    expect(lanes.map((lane) => parsed.filter((item) => item.strategyLane === lane).length)).toEqual([2, 2, 2, 2, 2])
    expect(parsed.filter((item) => item.strategyLane === 'limit_up').every((item) => item.nextAction === '只观察回封强度')).toBe(true)
  })

  it('marks a buy-ready candidate for manual review instead of automatic execution', () => {
    const readyCandidates = candidates.slice(0, 10).map((item, index) => ({
      ...item,
      technicalEvidence: { status: index === 0 ? 'buy_ready' : 'watching' }
    }))
    const opportunities = readyCandidates.map((item) => ({ code: item.code, score: item.score, reasons: ['验证完成'] }))
    const parsed = parseWatchlistOpportunityAnalysis(JSON.stringify({ opportunities }), readyCandidates)
    expect(parsed.find((item) => item.code === readyCandidates[0].code)).toMatchObject({ signal: '观察·上涨', nextAction: '人工复核买点' })
  })

  it('rejects incomplete AI output when enough screened candidates exist', () => {
    const opportunities = candidates.slice(0, 9).map((item) => ({ code: item.code, score: 80, reasons: ['理由'] }))
    expect(() => parseWatchlistOpportunityAnalysis(JSON.stringify({ opportunities }), candidates.slice(0, 10))).toThrow('AI 只完成了 9/10 个候选分析')
  })

  it('rejects the run when fewer than ten candidates survive the hard gates', () => {
    const opportunities = candidates.slice(0, 9).map((item, index) => ({ code: item.code, score: 80 - index, reasons: ['严格门槛通过'] }))
    expect(() => parseWatchlistOpportunityAnalysis(JSON.stringify({ opportunities }), candidates.slice(0, 9))).toThrow('确定性模型只形成 9/10')
  })

  it('ignores hallucinated and duplicate codes', () => {
    const opportunities = [
      ...candidates.slice(0, 10).map((item) => ({ code: item.code, score: 80, reasons: ['真实候选'] })),
      { code: candidates[0].code, score: 100, reasons: ['重复'] },
      { code: '999999', score: 100, reasons: ['不存在'] }
    ]
    const parsed = parseWatchlistOpportunityAnalysis(JSON.stringify({ opportunities }), candidates.slice(0, 10))
    expect(parsed).toHaveLength(10)
    expect(parsed.every((item) => item.code !== '999999')).toBe(true)
  })
})

describe('buildOpportunityReviewPool', () => {
  it('keeps every previous AI discovery in front of fresh screened candidates', () => {
    const previous = candidates.slice(0, 6)
    const screened = [candidates[0], candidates[6]]
    const live = previous.map((item, index) => ({ ...item, latestPrice: 10 + index, changePercent: index, volume: `${index + 1}亿` }))
    const pool = buildOpportunityReviewPool(screened, previous, live)
    expect(pool.slice(0, 6).map((item) => item.code)).toEqual(previous.map((item) => item.code))
    expect(pool[5]).toMatchObject({ latestPrice: 15, changePercent: 5, volume: '6亿' })
    expect(pool.at(-1)?.code).toBe(candidates[6].code)
  })

  it('does not call AI when no candidate survives the hard gates', async () => {
    await expect(analyzeWatchlistOpportunities({ provider: 'codex-local', baseUrl: '', model: '' }, [], []))
      .rejects.toThrow('只有 0/10 个候选通过')
  })
})

describe('filterVerifiedOpportunityCandidates', () => {
  it('does not pass unverified or model-rejected previous discoveries back to AI', () => {
    const input = [
      { ...candidates[0], technicalEvidence: { status: 'watching', technical_evidence: { daily: { above_ma20: true } } } },
      { ...candidates[1], technicalEvidence: { status: 'market_unavailable' } },
      candidates[2]
    ]
    expect(filterVerifiedOpportunityCandidates(input).map((item) => item.code)).toEqual([candidates[0].code])
  })
})
