import { describe, expect, it } from 'vitest'
import type { VocSnapshot } from '../../../shared/types'
import { buildVocTrendDashboard } from './voc-trends'

describe('VOC trend dashboard', () => {
  it('summarizes today and recent actor changes without inventing unknown positions', () => {
    const now = new Date('2026-07-21T12:00:00.000Z')
    const snapshot = { sources: [
      { id: 'xian', displayName: '闲闲' }, { id: 'feng', displayName: '峰哥' }
    ], recentReports: [{ id: 'report-1', eventIds: ['position-event'], generatedAt: '2026-07-21T11:00:00.000Z', sourceIds: ['xian'], summary: '今日摘要', trendSummary: { today: '今天从重仓降为轻仓。', recent: '近7日从乐观转为踏空焦虑。' },
      positionActions: [{ sourceId: 'xian', contentId: 'position-1', action: '减仓', positionAfter: '轻仓', occurredAt: '2026-07-21T10:00:00.000Z' }],
      sentimentObservations: [{ sourceId: 'xian', contentId: 'position-1', sentiment: '踏空焦虑', occurredAt: '2026-07-21T10:01:00.000Z' }] }],
      recentEvents: [{ id: 'position-event', sourceId: 'xian', contentId: 'position-1', publishedAt: '2026-07-21T10:00:00.000Z', text: '今天股票减仓后变成轻仓。' }], pendingInboxCount: 0 } as unknown as VocSnapshot
    const result = buildVocTrendDashboard(snapshot, now)
    expect(result.today).toMatchObject({ summary: '今日方向推测：闲闲减仓。', actionCount: 1, activeSources: 1 })
    expect(result.actors[0]).toMatchObject({ position: '轻仓', sentiment: '踏空焦虑', todayActions: ['减仓'] })
    expect(result.actors[1]).toMatchObject({ position: '未知', sentiment: '未知', todayActions: [] })
  })

  it('keeps legacy report details out of the main conclusion', () => {
    const now = new Date('2026-07-21T12:00:00.000Z')
    const snapshot = { sources: [], recentEvents: [{ id: 'legacy-event', sourceId: 'xian', contentId: 'legacy-1', publishedAt: '2026-07-21T10:00:00.000Z', text: '#股票 今天卖飞了' }], pendingInboxCount: 0, recentReports: [{
      id: 'legacy-report', eventIds: ['legacy-event'], generatedAt: '2026-07-21T11:00:00.000Z', sourceIds: ['xian'],
      summary: '结论：今天整体出现卖飞焦虑，但没有可执行标的。 1. 闲闲 - 原始发布时间：2026-07-21 - 原始链接：https://example.com'
    }] } as unknown as VocSnapshot
    expect(buildVocTrendDashboard(snapshot, now).today.summary).toBe('今日方向推测：xian疑似减仓。')
  })

  it('infers only add reduce or clear actions from legacy content', () => {
    const now = new Date('2026-07-21T12:00:00.000Z')
    const eventBase = { schemaVersion: 1, platform: 'douyin', capturedAt: '2026-07-21T10:00:00.000Z', fingerprint: 'x', url: 'https://example.com', mediaType: 'video' }
    const snapshot = { sources: [
      { id: 'xian', displayName: '闲闲' }, { id: 'husband', displayName: '闲闲老公' }, { id: 'wang', displayName: '王小雨' }, { id: 'feng', displayName: '峰哥' }, { id: 'retire', displayName: '退出者' }
    ], recentReports: [{ id: 'report-3', eventIds: ['1', '2', '3', '4', '5'], generatedAt: '2026-07-21T11:00:00.000Z', sourceIds: ['xian', 'husband', 'wang', 'feng', 'retire'], summary: '今日有五条内容。' }], recentEvents: [
      { ...eventBase, id: '1', sourceId: 'xian', contentId: '1', publishedAt: '2026-07-21T09:00:00.000Z', text: '踏空加卖飞4W，血压飙升' },
      { ...eventBase, id: '2', sourceId: 'husband', contentId: '2', publishedAt: '2026-07-21T08:00:00.000Z', transcript: '早上股票我全清了，想重新开始' },
      { ...eventBase, id: '3', sourceId: 'wang', contentId: '3', publishedAt: '2026-07-21T07:00:00.000Z', transcript: '我的朋友股票赚了三十个点' },
      { ...eventBase, id: '4', sourceId: 'feng', contentId: '4', publishedAt: '2026-07-21T06:00:00.000Z', text: '现在这个股票位置选择割肉实在不是明智之举' },
      { ...eventBase, id: '5', sourceId: 'retire', contentId: '5', publishedAt: '2026-07-21T05:00:00.000Z', text: '我已经卸载同花顺，以后不再想着股票，说啥都不玩了' }
    ], pendingInboxCount: 0 } as unknown as VocSnapshot
    const result = buildVocTrendDashboard(snapshot, now)
    expect(result.actors.map((actor) => [actor.sourceId, actor.inferredAction])).toEqual([['xian', '减仓'], ['husband', '清仓'], ['wang', undefined], ['feng', undefined], ['retire', '清仓']])
    expect(result.actors[4]).toMatchObject({ inferenceNature: '疑似', inferenceConfidence: '中' })
    expect(result.today.actionLabels).toEqual(expect.arrayContaining(['减仓 1', '清仓 2']))
    expect(result.actors[0].tagEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ label: '减仓', category: 'action', quote: expect.stringContaining('卖飞4W') })]))
    expect(result.actors[1].tagEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ label: '清仓', category: 'action', quote: expect.stringContaining('全清了') })]))
  })

  it('把逃离火场且不要返回识别为中置信度疑似清仓', () => {
    const now = new Date('2026-07-22T02:00:00.000Z')
    const snapshot = { sources: [{ id: 'feng', displayName: '峰哥亡命天涯' }], recentReports: [], recentEvents: [{
      id: 'feng-today', sourceId: 'feng', contentId: 'R9P308cxK', publishedAt: '2026-07-22T01:29:00.000Z',
      text: '侥幸逃离火场之后不要返回，个人观点。', url: 'https://weibo.com/2397417584/R9P308cxK'
    }], pendingInboxCount: 0 } as unknown as VocSnapshot
    const actor = buildVocTrendDashboard(snapshot, now).actors[0]
    expect(actor).toMatchObject({ inferredAction: '清仓', inferenceNature: '疑似', inferenceConfidence: '中', todayActions: ['清仓'] })
    expect(actor.tagEvidence).toEqual(expect.arrayContaining([expect.objectContaining({ label: '清仓', quote: expect.stringContaining('逃离火场') })]))
  })
})
