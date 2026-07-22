import type { VocEvent, VocPositionAction, VocPositionActionKind, VocPositionState, VocReportAnalysis, VocSentiment, VocSentimentObservation, VocTrendSummary } from './voc'
import { isStockMarketVocEvent } from './voc-relevance'

const payloadPattern = /<voc_analysis>([\s\S]*?)<\/voc_analysis>/i
const actionKinds = new Set<VocPositionActionKind>(['买入', '加仓', '减仓', '清仓', '空仓', '割肉', '止盈', '卖飞', '踏空', '持仓未动', '未确认'])
const positionStates = new Set<VocPositionState>(['空仓', '轻仓', '半仓', '重仓', '满仓', '未知'])
const sentiments = new Set<VocSentiment>(['恐慌', '谨慎', '中性', '乐观', '亢奋', '踏空焦虑', '未知'])
const confidenceLevels = new Set<VocPositionAction['confidence']>(['低', '中', '高'])
const clean = (value: unknown, maxLength: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
const normalizeEvidence = (value: string) => value.replace(/[\s，。！？：；、“”‘’（）()《》#\-]/g, '').toLowerCase()
const planLanguage = /(准备|打算|计划|考虑|想要?|可能|如果|要是|等.*再|再看看|或许|也许)/
const planThenCompleted = /(?:但|后来|结果|然后|刚刚|已经|实际|最终|最后).*(?:卖掉|卖了|清掉|清了|割了|买了|买进|加了|减了|只剩|降到|变成|空仓|没有操作|没操作|没动|仍然持有|继续持有|卖飞|踏空)/
const hasGroundedOutcome = (action: VocPositionActionKind, evidence: string) => {
  if (action === '未确认') return true
  if (planLanguage.test(evidence) && !planThenCompleted.test(evidence)) return false
  if (action === '卖飞') return /卖飞|(?:卖|清|割).*(?:飞|涨|新高|拉升)|(?:飞|涨|新高|拉升).*(?:卖|清|割)/.test(evidence)
  if (action === '踏空') return /踏空|(?:没买|没上车|未持有|空仓).*(?:飞|涨|新高|拉升)|(?:飞|涨|新高|拉升).*(?:没买|没上车|未持有|空仓)/.test(evidence)
  return true
}

export const stripVocAnalysisPayload = (value: string) => value.replace(payloadPattern, '').replace(/\n{3,}/g, '\n\n').trim()

const parsePayload = (value: string): Record<string, unknown> | null => {
  const matched = payloadPattern.exec(value)
  if (!matched) return null
  let parsed: unknown
  try { parsed = JSON.parse(matched[1]) }
  catch { return null }
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
}

const evidenceFor = (event: VocEvent) => [event.title, event.text, event.transcript, event.metadata?.screenText]
  .filter((item): item is string => typeof item === 'string').join('\n')

export const parseVocAnalysis = (value: string, events: VocEvent[]): VocReportAnalysis => {
  const payload = parsePayload(value)
  const eventMap = new Map(events.map((event) => [`${event.sourceId}:${event.contentId}`, event]))
  const actions: VocPositionAction[] = []
  const observations: VocSentimentObservation[] = []
  const rows = Array.isArray(payload?.positionActions) ? payload.positionActions : []
  for (const row of rows.slice(0, 30)) {
    if (!row || typeof row !== 'object') continue
    const input = row as Record<string, unknown>
    const sourceId = clean(input.sourceId, 100)
    const contentId = clean(input.contentId, 100)
    const event = eventMap.get(`${sourceId}:${contentId}`)
    const action = clean(input.action, 20) as VocPositionActionKind
    const evidence = clean(input.evidence, 240)
    if (!event || !isStockMarketVocEvent(event) || !actionKinds.has(action) || !evidence || !hasGroundedOutcome(action, evidence)) continue
    const normalizedQuote = normalizeEvidence(evidence)
    if (normalizedQuote.length < 2 || !normalizeEvidence(evidenceFor(event)).includes(normalizedQuote)) continue
    const requestedState = clean(input.positionAfter, 20) as VocPositionState
    const confidence = clean(input.confidence, 10) as VocPositionAction['confidence']
    actions.push({
      sourceId, contentId, action,
      positionAfter: positionStates.has(requestedState) ? requestedState : '未知',
      occurredAt: typeof input.occurredAt === 'string' && !Number.isNaN(Date.parse(input.occurredAt)) ? new Date(input.occurredAt).toISOString() : event.publishedAt,
      asset: clean(input.asset, 80) || undefined,
      sector: clean(input.sector, 80) || undefined,
      evidence,
      confidence: confidenceLevels.has(confidence) ? confidence : '低'
    })
  }
  const sentimentRows = Array.isArray(payload?.sentimentObservations) ? payload.sentimentObservations : []
  for (const row of sentimentRows.slice(0, 30)) {
    if (!row || typeof row !== 'object') continue
    const input = row as Record<string, unknown>
    const sourceId = clean(input.sourceId, 100)
    const contentId = clean(input.contentId, 100)
    const event = eventMap.get(`${sourceId}:${contentId}`)
    const sentiment = clean(input.sentiment, 20) as VocSentiment
    const evidence = clean(input.evidence, 240)
    const normalizedQuote = normalizeEvidence(evidence)
    if (!event || !isStockMarketVocEvent(event) || !sentiments.has(sentiment) || normalizedQuote.length < 2 || !normalizeEvidence(evidenceFor(event)).includes(normalizedQuote)) continue
    const confidence = clean(input.confidence, 10) as VocSentimentObservation['confidence']
    observations.push({ sourceId, contentId, sentiment, evidence,
      occurredAt: typeof input.occurredAt === 'string' && !Number.isNaN(Date.parse(input.occurredAt)) ? new Date(input.occurredAt).toISOString() : event.publishedAt,
      confidence: confidenceLevels.has(confidence) ? confidence : '低' })
  }
  const rawTrend = payload?.trendSummary && typeof payload.trendSummary === 'object' ? payload.trendSummary as Record<string, unknown> : null
  const today = clean(rawTrend?.today, 800)
  const recent = clean(rawTrend?.recent, 800)
  const trendSummary: VocTrendSummary | undefined = today || recent ? { today: today || '今日证据不足，暂无可靠变化。', recent: recent || '近期证据不足，暂无可靠趋势。' } : undefined
  return { positionActions: actions, sentimentObservations: observations, trendSummary }
}

export const parseVocPositionActions = (value: string, events: VocEvent[]) => parseVocAnalysis(value, events).positionActions

export const VOC_ANALYSIS_OUTPUT_INSTRUCTION = `在自然语言摘要末尾追加且只追加一个 <voc_analysis>JSON</voc_analysis> 数据块，格式：
{"trendSummary":{"today":"综合今天全部可用证据，只总结加仓、减仓、清仓方向和情绪变化，不超过120个汉字","recent":"结合 recentReports 总结近7日方向变化，不超过100个汉字；历史不足时明确写历史不足"},"positionActions":[{"sourceId":"必须来自本次事件","contentId":"必须来自本次事件","action":"买入|加仓|减仓|清仓|空仓|割肉|止盈|卖飞|踏空|持仓未动|未确认","positionAfter":"空仓|轻仓|半仓|重仓|满仓|未知","occurredAt":"ISO时间","asset":"标的或空字符串","sector":"板块或空字符串","evidence":"必须逐字摘自文案、语音转写或画面文字","confidence":"低|中|高"}],"sentimentObservations":[{"sourceId":"必须来自本次事件","contentId":"必须来自本次事件","sentiment":"恐慌|谨慎|中性|乐观|亢奋|踏空焦虑|未知","occurredAt":"ISO时间","evidence":"必须逐字摘自文案、语音转写或画面文字","confidence":"低|中|高"}]}
同一内容可有多个动作。只要原文存在已经发生的仓位方向线索，就归类为加仓、减仓或清仓；允许根据口语上下文做保守推测并降低置信度，不要求知道数量、成交价、账户范围或精确仓位。“想卖、可能卖、看空”仍不算已卖。“卖飞”必须有已卖出后继续上涨或本人明确说卖飞的证据；“踏空”必须有未持仓并错过上涨的证据。仓位比例不明确时 positionAfter=未知，但不要在自然语言里反复强调这些无关字段未知。今日和近期总结只写方向结论与情绪变化，不得附逐账号明细或原始链接。没有动作或情绪证据也必须输出空数组。`
