import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReviewCandidateReview, ReviewSignalReview } from '../shared/review-types'
import { buildAggregate, emptyReport, loadReviewReport, saveReviewRating, saveReviewReport } from './review-store'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'review-store-test-'))
  process.env.TRADE_MASTER_HOME = home
})

afterEach(async () => {
  delete process.env.TRADE_MASTER_HOME
  await rm(home, { recursive: true, force: true })
})

const candidate = (overrides: Partial<ReviewCandidateReview> = {}): ReviewCandidateReview => ({
  id: 'candidate-000001',
  code: '000001',
  name: '平安银行',
  recommendedAt: '2026-07-23',
  recommendation: 'AI 推荐关注',
  reason: '测试候选',
  referencePrice: 10,
  latestPrice: 10.5,
  changeSinceRecommend: 5,
  status: 'verified',
  summary: '',
  evidence: [],
  ...overrides
})

const signal = (overrides: Partial<ReviewSignalReview> = {}): ReviewSignalReview => ({
  id: 'signal-000001',
  code: '000001',
  name: '平安银行',
  side: 'buy',
  signal: 'strong_buy',
  strategy: 'breakout',
  level: '中',
  signalAt: '2026-07-23T10:00:00+08:00',
  signalDate: '2026-07-23',
  referencePrice: 10,
  latestPrice: 10.8,
  outcomeStatus: 'verified',
  directionalReturnPercent: 8,
  summary: '',
  evidence: [],
  ...overrides
})

describe('buildAggregate', () => {
  it('counts candidate outcomes and computes rating averages', () => {
    const agg = buildAggregate([
      candidate({ id: 'c1', status: 'verified', userRating: 4 }),
      candidate({ id: 'c2', status: 'failed', userRating: 2 }),
      candidate({ id: 'c3', status: 'watching' })
    ], [
      signal({ id: 's1', outcomeStatus: 'verified', directionalReturnPercent: 6, userRating: 5 }),
      signal({ id: 's2', outcomeStatus: 'failed', directionalReturnPercent: -4, userRating: 3 })
    ])
    expect(agg.candidateTotal).toBe(3)
    expect(agg.candidateVerified).toBe(1)
    expect(agg.candidateFailed).toBe(1)
    expect(agg.candidateWatching).toBe(1)
    expect(agg.candidateRatedCount).toBe(2)
    expect(agg.candidateAvgRating).toBe(3)
    expect(agg.signalTotal).toBe(2)
    expect(agg.signalEvaluated).toBe(2)
    expect(agg.signalAccuracyPercent).toBe(50)
    expect(agg.averageDirectionalReturnPercent).toBe(1)
    expect(agg.signalRatedCount).toBe(2)
    expect(agg.signalAvgRating).toBe(4)
    expect(agg.blindSpots.length).toBeGreaterThan(0)
    expect(agg.suggestions.length).toBeGreaterThan(0)
  })

  it('returns null averages when nothing is rated or evaluated', () => {
    const agg = buildAggregate([candidate({ status: 'pending', changeSinceRecommend: null })], [])
    expect(agg.candidateRatedCount).toBe(0)
    expect(agg.candidateAvgRating).toBeNull()
    expect(agg.signalRatedCount).toBe(0)
    expect(agg.signalAvgRating).toBeNull()
    expect(agg.signalAccuracyPercent).toBeNull()
    expect(agg.averageDirectionalReturnPercent).toBeNull()
    expect(agg.blindSpots).toContain('信号样本不足，暂不能形成稳定的准确率结论')
  })
})

describe('saveReviewRating', () => {
  it('keeps concurrent atomic saves valid', async () => {
    const range = { start: '2026-07-23', end: '2026-07-23', tradingDate: '2026-07-23' }
    await expect(Promise.all([
      saveReviewReport({ ...emptyReport('daily', range, 'collecting'), summary: '第一次保存' }),
      saveReviewReport({ ...emptyReport('daily', range, 'analyzing'), summary: '第二次保存' })
    ])).resolves.toHaveLength(2)
    const reloaded = await loadReviewReport('daily', '2026-07-23')
    expect(['第一次保存', '第二次保存']).toContain(reloaded?.summary)
  })

  it('throws when the report does not exist yet', async () => {
    await expect(saveReviewRating('daily', '2026-07-23', { targetType: 'candidate', targetId: 'candidate-000001', rating: 4 }))
      .rejects.toThrow('该周期复盘报告尚未生成，无法保存评价')
  })

  it('stores the user rating and recomputes the aggregate', async () => {
    const range = { start: '2026-07-23', end: '2026-07-23', tradingDate: '2026-07-23' }
    const report = {
      ...emptyReport('daily', range, 'ready'),
      candidateReviews: [candidate()],
      signalReviews: [signal()],
      aggregate: buildAggregate([candidate()], [signal()])
    }
    await saveReviewReport(report)
    const updated = await saveReviewRating('daily', '2026-07-23', { targetType: 'candidate', targetId: 'candidate-000001', rating: 5, note: '符合预期' })
    expect(updated.candidateReviews?.[0].userRating).toBe(5)
    expect(updated.candidateReviews?.[0].userNote).toBe('符合预期')
    expect(updated.aggregate?.candidateRatedCount).toBe(1)
    expect(updated.aggregate?.candidateAvgRating).toBe(5)

    const reloaded = await loadReviewReport('daily', '2026-07-23')
    expect(reloaded?.candidateReviews?.[0].userRating).toBe(5)
    expect(reloaded?.aggregate?.candidateAvgRating).toBe(5)
  })

  it('clamps the rating into the 0-5 range and clears a rating with 0', async () => {
    const range = { start: '2026-07-23', end: '2026-07-23', tradingDate: '2026-07-23' }
    const report = {
      ...emptyReport('daily', range, 'ready'),
      signalReviews: [signal()],
      aggregate: buildAggregate([], [signal()])
    }
    await saveReviewReport(report)
    const high = await saveReviewRating('daily', '2026-07-23', { targetType: 'signal', targetId: 'signal-000001', rating: 9 })
    expect(high.signalReviews?.[0].userRating).toBe(5)
    const cleared = await saveReviewRating('daily', '2026-07-23', { targetType: 'signal', targetId: 'signal-000001', rating: 0 })
    expect(cleared.signalReviews?.[0].userRating).toBe(0)
    expect(cleared.aggregate?.signalRatedCount).toBe(0)
  })
})
