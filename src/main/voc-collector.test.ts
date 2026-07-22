import { describe, expect, it } from 'vitest'
import { isWithinVocLookback, parsePlatformTime, reconcileCompletedByArtifacts } from './voc-collector'

describe('VOC 平台发布时间解析', () => {
  it('解析抖音完整发布时间并保留上海时区含义', () => {
    expect(parsePlatformTime('发布时间：2026-07-21 15:25')).toBe('2026-07-21T07:25:00.000Z')
  })

  it('解析微博两位年份发布时间', () => {
    expect(parsePlatformTime('26-7-21 11:53')).toBe('2026-07-21T03:53:00.000Z')
  })

  it('不把未知格式替换成采集时间', () => {
    expect(parsePlatformTime('刚刚发布')).toBeNull()
  })

  it('解析相对分钟用于微博列表兜底', () => {
    const now = new Date('2026-07-21T08:00:00.000Z')
    expect(parsePlatformTime('27分钟前', now)).toBe('2026-07-21T07:33:00.000Z')
  })

  it('按滚动 24 小时判断内容是否需要处理', () => {
    const cutoff = Date.parse('2026-07-21T02:00:00.000Z')
    expect(isWithinVocLookback('2026-07-21T02:00:00.000Z', cutoff)).toBe(true)
    expect(isWithinVocLookback('2026-07-21T01:59:59.999Z', cutoff)).toBe(false)
  })
})

describe('VOC 旧采集状态修复', () => {
  it('只保留存在真实采集产物的完成记录', () => {
    const completed = {
      'weibo-fengge': ['kept', 'missing'],
      'douyin-xianxian': ['also-kept']
    }
    const artifacts = new Set([
      'weibo-fengge\u0000kept',
      'douyin-xianxian\u0000also-kept'
    ])

    expect(reconcileCompletedByArtifacts(completed, artifacts)).toEqual({
      'weibo-fengge': ['kept'],
      'douyin-xianxian': ['also-kept']
    })
  })
})
