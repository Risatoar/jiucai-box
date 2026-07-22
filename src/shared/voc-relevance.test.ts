import { describe, expect, it } from 'vitest'
import type { VocInboxItem } from './voc'
import { isStockMarketVocEvent } from './voc-relevance'

const item = (text: string): VocInboxItem => ({
  schemaVersion: 1,
  sourceId: 'weibo-fengge',
  platform: 'weibo',
  contentId: 'content-1',
  publishedAt: '2026-07-21T03:53:00.000Z',
  url: 'https://weibo.com/example',
  mediaType: 'post',
  text
})

describe('VOC 股市内容过滤', () => {
  it('排除买球内容，不能把买了识别成加仓', () => {
    expect(isStockMarketVocEvent(item('Max 关注 买了1000元阿根廷，今晚看比赛'))).toBe(false)
  })

  it('保留真实股票仓位与情绪内容', () => {
    expect(isStockMarketVocEvent(item('清仓后大盘涨了，这次真的卖飞了 #股票'))).toBe(true)
    expect(isStockMarketVocEvent(item('半导体跌停，吓得我卸载同花顺'))).toBe(true)
    expect(isStockMarketVocEvent(item('坚持科技，半導體芯片明天冲高我就走一点'))).toBe(true)
    expect(isStockMarketVocEvent(item('有色现在拿得住，后面考虑走一点'))).toBe(true)
  })

  it('保留监控账号使用的明确股市逃顶隐喻', () => {
    expect(isStockMarketVocEvent(item('侥幸逃离火场之后不要返回，个人观点。'))).toBe(true)
  })
})
