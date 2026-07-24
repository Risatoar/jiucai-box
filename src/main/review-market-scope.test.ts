import { describe, expect, it } from 'vitest'
import type { ReviewMarketOverview } from '../shared/review-types'
import { buildAuthoritativeMarketSections } from './review-service'

describe('review full-market scope', () => {
  it('keeps authoritative full-market stock codes when AI returns watchlist or ETF items', () => {
    const overview: ReviewMarketOverview = {
      dataScope: 'all_a_share_stocks',
      regime: 'supportive',
      breadth: [],
      benchmarks: [],
      generatedAt: '2026-07-23T07:00:00.000Z',
      hotThemes: [{
        name: '证券',
        heatScore: 88,
        changePercent: 2.4,
        breadthPercent: 80,
        totalAmount: 100_000_000_000,
        stockCount: 30,
        representativeCodes: ['600030'],
        representatives: [{ code: '600030', name: '中信证券', type: 'stock', price: 30, changePercent: 6 }]
      }]
    }
    const result = buildAuthoritativeMarketSections(
      overview,
      [{ id: 'bad', name: '证券', trend: 'up', stage: '加速', summary: 'AI 文案', evidence: [], leaders: ['券商ETF'], representatives: [], observation: '', suggestion: '', relatedCodes: ['512000'] }],
      [{ code: '512000', name: '券商ETF', sector: '证券', role: '龙头', changePercent: 3, stage: '加速', summary: '', evidence: [], nextScript: '', invalidation: '', suggestion: '' }]
    )
    expect(result.sectors[0].leaders).toEqual(['中信证券'])
    expect(result.sectors[0].relatedCodes).toEqual(['600030'])
    expect(result.hotStocks.map((item) => item.code)).toEqual(['600030'])
    expect(result.hotStocks.every((item) => item.instrumentType === 'stock')).toBe(true)
  })
})
