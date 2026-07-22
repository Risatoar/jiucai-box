import { describe, expect, it } from 'vitest'
import type { VocEvent } from './voc'
import { parseVocAnalysis, parseVocPositionActions, stripVocAnalysisPayload } from './voc-analysis'

const event: VocEvent = {
  schemaVersion: 1,
  id: 'event-1', fingerprint: 'event-1', sourceId: 'douyin-xianxian', platform: 'douyin', contentId: 'video-1',
  publishedAt: '2026-07-21T06:30:00.000Z', capturedAt: '2026-07-21T06:31:00.000Z',
  url: 'https://www.douyin.com/video/video-1', mediaType: 'video',
  text: '今天割肉减仓了一半，现在只剩轻仓。', transcript: '这波真的卖飞了。'
}

describe('VOC position action payload', () => {
  it('parses grounded position actions and uses the event time as fallback', () => {
    const value = `结论：博主今天主动降低仓位。\n<voc_analysis>{"trendSummary":{"today":"今天从重仓降为轻仓。","recent":"近7日情绪转谨慎。"},"positionActions":[{"sourceId":"douyin-xianxian","contentId":"video-1","action":"减仓","positionAfter":"轻仓","asset":"","sector":"科技","evidence":"今天割肉减仓了一半","confidence":"高"},{"sourceId":"douyin-xianxian","contentId":"video-1","action":"卖飞","positionAfter":"未知","evidence":"这波真的卖飞了","confidence":"中"}],"sentimentObservations":[{"sourceId":"douyin-xianxian","contentId":"video-1","sentiment":"恐慌","evidence":"今天割肉减仓了一半","confidence":"高"}]}</voc_analysis>`
    expect(parseVocPositionActions(value, [event])).toEqual([
      expect.objectContaining({ action: '减仓', positionAfter: '轻仓', sector: '科技', occurredAt: event.publishedAt, confidence: '高' }),
      expect.objectContaining({ action: '卖飞', positionAfter: '未知', confidence: '中' })
    ])
    expect(parseVocAnalysis(value, [event])).toMatchObject({ sentimentObservations: [{ sentiment: '恐慌', confidence: '高' }], trendSummary: { today: '今天从重仓降为轻仓。', recent: '近7日情绪转谨慎。' } })
    expect(stripVocAnalysisPayload(value)).toBe('结论：博主今天主动降低仓位。')
  })

  it('drops actions with an unknown event or evidence absent from the source', () => {
    const value = `<voc_analysis>{"positionActions":[{"sourceId":"douyin-xianxian","contentId":"missing","action":"空仓","evidence":"现在空仓","confidence":"高"},{"sourceId":"douyin-xianxian","contentId":"video-1","action":"清仓","evidence":"已经全部清仓","confidence":"高"}]}</voc_analysis>`
    expect(parseVocPositionActions(value, [event])).toEqual([])
  })

  it('rejects planned operations and ungrounded 卖飞 or 踏空 conclusions', () => {
    const plannedEvent = { ...event, text: '今天准备减仓，如果再跌就割肉。后来我卖了。' }
    const value = `<voc_analysis>{"positionActions":[{"sourceId":"douyin-xianxian","contentId":"video-1","action":"减仓","positionAfter":"未知","evidence":"今天准备减仓","confidence":"高"},{"sourceId":"douyin-xianxian","contentId":"video-1","action":"割肉","positionAfter":"未知","evidence":"如果再跌就割肉","confidence":"高"},{"sourceId":"douyin-xianxian","contentId":"video-1","action":"卖飞","positionAfter":"未知","evidence":"后来我卖了","confidence":"高"}]}</voc_analysis>`
    expect(parseVocPositionActions(value, [plannedEvent])).toEqual([])
  })
})
