export type VocPlatform = 'weibo' | 'douyin' | 'wechat' | 'manual'

export type VocSourceStatus = 'needs_binding' | 'needs_connector' | 'ready' | 'error'

export interface VocSource {
  id: string
  platform: VocPlatform
  displayName: string
  handle: string
  profileUrl?: string
  enabled: boolean
  inverseWeight: number
  status: VocSourceStatus
  lastCheckedAt?: string
  lastSeenPublishedAt?: string
  lastError?: string
}

export interface VocInboxItem {
  schemaVersion: 1
  sourceId: string
  platform: VocPlatform
  contentId: string
  publishedAt: string
  capturedAt?: string
  url: string
  mediaType: 'post' | 'video' | 'article' | 'live' | 'comment'
  title?: string
  text?: string
  transcript?: string
  metadata?: Record<string, unknown>
}

export interface VocEvent extends VocInboxItem {
  id: string
  capturedAt: string
  fingerprint: string
}

export type VocPositionActionKind = '买入' | '加仓' | '减仓' | '清仓' | '空仓' | '割肉' | '止盈' | '卖飞' | '踏空' | '持仓未动' | '未确认'
export type VocPositionState = '空仓' | '轻仓' | '半仓' | '重仓' | '满仓' | '未知'
export type VocSentiment = '恐慌' | '谨慎' | '中性' | '乐观' | '亢奋' | '踏空焦虑' | '未知'

export interface VocPositionAction {
  sourceId: string
  contentId: string
  action: VocPositionActionKind
  positionAfter: VocPositionState
  occurredAt: string
  asset?: string
  sector?: string
  evidence: string
  confidence: '低' | '中' | '高'
}

export interface VocSentimentObservation {
  sourceId: string
  contentId: string
  sentiment: VocSentiment
  occurredAt: string
  evidence: string
  confidence: '低' | '中' | '高'
}

export interface VocTrendSummary {
  today: string
  recent: string
}

export interface VocReportAnalysis {
  positionActions: VocPositionAction[]
  sentimentObservations: VocSentimentObservation[]
  trendSummary?: VocTrendSummary
}

export interface VocRiskReport {
  id: string
  generatedAt: string
  eventIds: string[]
  sourceIds: string[]
  summary: string
  positionActions?: VocPositionAction[]
  sentimentObservations?: VocSentimentObservation[]
  trendSummary?: VocTrendSummary
}

export interface VocSnapshot {
  schemaVersion: 1
  home: string
  sources: VocSource[]
  recentEvents: VocEvent[]
  recentReports: VocRiskReport[]
  pendingInboxCount: number
  loadedAt: string
  errors: string[]
}

export const extractDouyinProfileId = (profileUrl?: string) => {
  if (!profileUrl) return ''
  try {
    const url = new URL(profileUrl)
    if (url.hostname !== 'www.douyin.com') return ''
    return url.pathname.match(/^\/user\/([^/]+)/)?.[1] || ''
  } catch { return '' }
}

export const defaultVocSources: VocSource[] = [
  { id: 'weibo-fengge', platform: 'weibo', displayName: '峰哥亡命天涯', handle: '峰哥亡命天涯', profileUrl: 'https://weibo.com/u/2397417584', enabled: true, inverseWeight: 0.8, status: 'needs_connector' },
  { id: 'douyin-wangxiaoyu', platform: 'douyin', displayName: '王小雨', handle: '王小雨', profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAAnXWkUFUhRjw4gvZYRO7p-CN3tXtoegnAes_fInpek_s?from_tab_name=main', enabled: true, inverseWeight: 0.8, status: 'needs_connector' },
  { id: 'douyin-dazengzi', platform: 'douyin', displayName: '大曾子', handle: '大曾子', profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAAvvDHLEVJuBsbqZDOFU9HprIQ62SQh0IJBQmVWFld6k4?from_tab_name=main', enabled: true, inverseWeight: 0.8, status: 'needs_connector' },
  { id: 'douyin-xianxian', platform: 'douyin', displayName: '闲闲', handle: '闲闲', profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAARFgJObhkQdfuKwAmU8XIKNposPKQnQbNeSsuGmrxlVRWJv83LIAbxbch_cOGBRXM?from_tab_name=main', enabled: true, inverseWeight: 0.8, status: 'needs_connector' },
  { id: 'douyin-xianxian-husband', platform: 'douyin', displayName: '闲闲老公', handle: '闲闲老公', profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAALMi0G2nrvuUgP00z8zZgndA8w9j3kTI0vZK4ZSK079MUcUuPBAi1WOHa-SByU32C?from_tab_name=main', enabled: true, inverseWeight: 0.8, status: 'needs_connector' }
]
