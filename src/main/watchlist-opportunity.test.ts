import { describe, expect, it } from 'vitest'
import { analyzeWatchlistOpportunities, buildOpportunityReviewPool, parseWatchlistOpportunityAnalysis, type OpportunityCandidate } from './watchlist-opportunity'

const candidates: OpportunityCandidate[] = Array.from({ length: 7 }, (_, index) => ({
  code: `60000${index}`,
  name: `候选${index}`,
  type: 'stock',
  exchange: 'SH',
  score: 80 - index
}))

describe('parseWatchlistOpportunityAnalysis', () => {
  it('accepts five or more known instruments and applies the AI ranking', () => {
    const opportunities = candidates.slice(0, 5).map((item, index) => ({ code: item.code, score: 70 + index, reasons: [`复核理由${index}`] }))
    const parsed = parseWatchlistOpportunityAnalysis(JSON.stringify({ opportunities }), candidates)
    expect(parsed).toHaveLength(5)
    expect(parsed[0]).toMatchObject({ code: '600004', score: 74, reasons: ['复核理由4'], signal: '观察' })
  })

  it('rejects incomplete AI output when enough screened candidates exist', () => {
    const opportunities = candidates.slice(0, 4).map((item) => ({ code: item.code, score: 80, reasons: ['理由'] }))
    expect(() => parseWatchlistOpportunityAnalysis(JSON.stringify({ opportunities }), candidates)).toThrow('AI 只完成了 4/5 个候选分析')
  })

  it('ignores hallucinated and duplicate codes', () => {
    const opportunities = [
      ...candidates.slice(0, 5).map((item) => ({ code: item.code, score: 80, reasons: ['真实候选'] })),
      { code: candidates[0].code, score: 100, reasons: ['重复'] },
      { code: '999999', score: 100, reasons: ['不存在'] }
    ]
    const parsed = parseWatchlistOpportunityAnalysis(JSON.stringify({ opportunities }), candidates)
    expect(parsed).toHaveLength(5)
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

  it('does not treat an empty or undersized shortlist as a completed AI analysis', async () => {
    await expect(analyzeWatchlistOpportunities({ provider: 'codex-local', baseUrl: '', model: '' }, candidates.slice(0, 4), []))
      .rejects.toThrow('少于最低 5 个')
  })
})
