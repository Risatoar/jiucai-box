import type { VocEvent, VocPositionActionKind, VocPositionState, VocSentiment, VocSnapshot } from '../../../shared/types'
import { isStockMarketVocEvent } from '../../../shared/voc-relevance'

export type VocInferredPositionAction = '加仓' | '减仓' | '清仓'

export interface VocTagEvidence {
  id: string
  label: string
  category: 'action' | 'sentiment' | 'context'
  quote: string
  occurredAt: string
  url?: string
  confidence?: '低' | '中' | '高'
}

export interface VocActorTrend {
  sourceId: string
  name: string
  position: VocPositionState
  sentiment: VocSentiment
  sentimentChange?: string
  inferredAction?: VocInferredPositionAction
  inferenceNature?: '明确' | '疑似'
  inferenceBasis?: string
  inferenceConfidence?: '中' | '高'
  todayActions: VocPositionActionKind[]
  recentActions: VocPositionActionKind[]
  todayUpdates: number
  recentUpdates: number
  latestAt?: string
  tagEvidence: VocTagEvidence[]
}

export interface VocTrendDashboard {
  today: { summary: string; actionCount: number; activeSources: number; actionLabels: string[]; sentimentLabels: string[] }
  recent: { summary: string; actionCount: number; activeSources: number; actionLabels: string[]; sentimentLabels: string[] }
  actors: VocActorTrend[]
}

const shanghaiDay = (value: string | Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(value))
const newerFirst = <T extends { occurredAt: string }>(left: T, right: T) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
const unique = <T>(items: T[]) => [...new Set(items)]
const counts = (items: string[]) => Object.entries(items.reduce<Record<string, number>>((all, item) => ({ ...all, [item]: (all[item] || 0) + 1 }), {}))
  .sort((left, right) => right[1] - left[1]).map(([label, count]) => `${label} ${count}`)
const compactSummary = (value: string, maxLength: number) => {
  const normalized = value.replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim().replace(/^结论[：:]\s*/, '')
  const conclusion = normalized.split(/\s(?=(?:1[.、]|一[、.])\s)/)[0].trim()
  if (conclusion.length <= maxLength) return conclusion
  const clipped = conclusion.slice(0, maxLength)
  const sentenceEnd = Math.max(clipped.lastIndexOf('。'), clipped.lastIndexOf('；'))
  return `${sentenceEnd > maxLength * .55 ? clipped.slice(0, sentenceEnd + 1) : clipped.trim()}…`
}
const structuredAction = (action: VocPositionActionKind): VocInferredPositionAction | undefined => action === '加仓' || action === '买入'
  ? '加仓' : ['减仓', '割肉', '止盈', '卖飞'].includes(action) ? '减仓' : ['清仓', '空仓'].includes(action) ? '清仓' : undefined
const inferenceRules: Array<{ action: VocInferredPositionAction; pattern: RegExp; confidence: '中' | '高' }> = [
  { action: '清仓', pattern: /全清|清仓|全部清|清光|空仓/g, confidence: '高' },
  { action: '清仓', pattern: /卸载同花顺|不再想着股票|不再玩股票|说啥都不玩了|股票.*不玩了|侥幸逃离火场之后不要返回|逃离火场.{0,8}不要返回/g, confidence: '中' },
  { action: '加仓', pattern: /加仓|补仓|又加|加了(?:一|两|几|\d)|买入|买了|上车/g, confidence: '中' },
  { action: '减仓', pattern: /减仓|卖飞|割肉|止盈|卖掉|卖了|减了/g, confidence: '中' }
]
const inferEventAction = (event: VocEvent) => {
  const evidence = [event.title, event.text, event.transcript, event.metadata?.screenText].filter((item): item is string => typeof item === 'string').join(' ')
  const matches = inferenceRules.flatMap((rule) => [...evidence.matchAll(rule.pattern)].map((match) => ({ ...rule, index: match.index || 0, phrase: match[0] }))).filter((match) => {
    const before = evidence.slice(Math.max(0, match.index - 14), match.index)
    const after = evidence.slice(match.index + match.phrase.length, match.index + match.phrase.length + 18)
    const planned = /(准备|打算|计划|考虑|想|如果|可能|建议|不要|别|不能|不该|不应|没必要|选择)$/.test(before)
    const negated = /^(?:实在|其实|现在)?(?:并)?不是.{0,6}(?:明智|合适)|^不明智|^没必要/.test(after)
    return !planned && !negated
  })
  const latest = matches.sort((left, right) => right.index - left.index)[0]
  if (!latest) return null
  const start = Math.max(0, latest.index - 8); const end = Math.min(evidence.length, latest.index + latest.phrase.length + 8)
  const quote = evidence.slice(start, end).replace(/\s+/g, ' ').trim()
  return { sourceId: event.sourceId, contentId: event.contentId, action: latest.action, occurredAt: event.publishedAt,
    basis: `内容线索“${quote}”`, quote, url: event.url, confidence: latest.confidence }
}

export const buildVocTrendDashboard = (snapshot: VocSnapshot, now = new Date()): VocTrendDashboard => {
  const todayKey = shanghaiDay(now)
  const recentCutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const relevantEvents = snapshot.recentEvents.filter((event) => Date.parse(event.publishedAt) >= recentCutoff && isStockMarketVocEvent(event))
  const relevantEventById = new Map(relevantEvents.map((event) => [event.id, event]))
  const relevantEventByKey = new Map(relevantEvents.map((event) => [`${event.sourceId}:${event.contentId}`, event]))
  const reportSources = new Map(snapshot.recentReports.map((report) => [report.id, new Set(report.eventIds.map((id) => relevantEventById.get(id)?.sourceId).filter((id): id is string => Boolean(id)))]))
  const todayReportSources = new Map(snapshot.recentReports.map((report) => [report.id, new Set(report.eventIds.map((id) => relevantEventById.get(id)).filter((event): event is VocEvent => Boolean(event)).filter((event) => shanghaiDay(event.publishedAt) === todayKey).map((event) => event.sourceId))]))
  const recentReports = snapshot.recentReports.filter((report) => Date.parse(report.generatedAt) >= recentCutoff && Boolean(reportSources.get(report.id)?.size))
  const todayReports = recentReports.filter((report) => Boolean(todayReportSources.get(report.id)?.size))
  const relevantEventKeys = new Set(relevantEvents.map((event) => `${event.sourceId}:${event.contentId}`))
  const allActions = recentReports.flatMap((report) => report.positionActions || []).filter((action) => relevantEventKeys.has(`${action.sourceId}:${action.contentId}`))
  const allSentiments = recentReports.flatMap((report) => report.sentimentObservations || []).filter((item) => relevantEventKeys.has(`${item.sourceId}:${item.contentId}`))
  const recentActions = allActions.filter((action) => Date.parse(action.occurredAt) >= recentCutoff)
  const todayActions = recentActions.filter((action) => shanghaiDay(action.occurredAt) === todayKey)
  const recentSentiments = allSentiments.filter((item) => Date.parse(item.occurredAt) >= recentCutoff)
  const todaySentiments = recentSentiments.filter((item) => shanghaiDay(item.occurredAt) === todayKey)
  const inferredSignals = relevantEvents.map(inferEventAction).filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((signal) => !recentActions.some((action) => action.sourceId === signal.sourceId && action.contentId === signal.contentId && structuredAction(action.action)))
  const todaySignals = inferredSignals.filter((signal) => shanghaiDay(signal.occurredAt) === todayKey)
  const collectDirectionFacts = (actions: typeof recentActions, signals: typeof inferredSignals) => {
    const facts = actions.flatMap((action) => {
      const direction = structuredAction(action.action)
      return direction ? [{ sourceId: action.sourceId, contentId: action.contentId, direction, suspected: false }] : []
    }).concat(signals.map((signal) => ({ sourceId: signal.sourceId, contentId: signal.contentId, direction: signal.action, suspected: true })))
    return [...new Map(facts.map((fact) => [`${fact.sourceId}:${fact.contentId}:${fact.direction}`, fact])).values()]
  }
  const todayDirectionFacts = collectDirectionFacts(todayActions, todaySignals)
  const recentDirectionFacts = collectDirectionFacts(recentActions, inferredSignals)
  const sourceNames = new Map(snapshot.sources.map((source) => [source.id, source.displayName]))
  const summarizeDirections = (prefix: string, facts: typeof recentDirectionFacts, fallback: string) => {
    if (!facts.length) return fallback
    const grouped = new Map<string, Map<VocInferredPositionAction, boolean>>()
    for (const fact of facts) {
      const directions = grouped.get(fact.sourceId) || new Map<VocInferredPositionAction, boolean>()
      directions.set(fact.direction, (directions.get(fact.direction) ?? true) && fact.suspected); grouped.set(fact.sourceId, directions)
    }
    return `${prefix}：${[...grouped].map(([sourceId, directions]) => `${sourceNames.get(sourceId) || sourceId}${[...directions].map(([direction, suspected]) => `${suspected ? '疑似' : ''}${direction}`).join('、')}`).join('；')}。`
  }
  const todaySummary = summarizeDirections('今日方向推测', todayDirectionFacts, compactSummary(todayReports.find((report) => report.trendSummary?.today)?.trendSummary?.today
    || todayReports[0]?.summary || '今天暂时没有新的股市仓位动作。', 220))
  const recentSummary = summarizeDirections('近7日方向推测', recentDirectionFacts, compactSummary(recentReports.find((report) => report.trendSummary?.recent)?.trendSummary?.recent
    || (recentReports.length ? `近7日共形成 ${recentReports.length} 份股市风险摘要，暂未识别加减清方向。` : '近7日暂无股市相关更新。'), 150))
  const actorRows = snapshot.sources.map((source) => {
    const sourceEvents = relevantEvents.filter((event) => event.sourceId === source.id).sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    const sourceRecentActions = recentActions.filter((action) => action.sourceId === source.id).sort(newerFirst)
    const sourceTodayActions = sourceRecentActions.filter((action) => shanghaiDay(action.occurredAt) === todayKey)
    const sourceSentiments = recentSentiments.filter((item) => item.sourceId === source.id).sort(newerFirst)
    const sourceSignals = inferredSignals.filter((item) => item.sourceId === source.id).sort(newerFirst)
    const latestStructured = sourceRecentActions.find((action) => structuredAction(action.action))
    const useStructured = Boolean(latestStructured && (!sourceSignals[0] || Date.parse(latestStructured.occurredAt) >= Date.parse(sourceSignals[0].occurredAt)))
    const inferredAction = useStructured && latestStructured ? structuredAction(latestStructured.action) : sourceSignals[0]?.action
    const knownPosition = sourceRecentActions.find((action) => action.positionAfter !== '未知')?.positionAfter || '未知'
    const latestSentiment = sourceSentiments[0]?.sentiment || '未知'
    const earliestSentiment = sourceSentiments.at(-1)?.sentiment
    const sourceReports = recentReports.filter((report) => reportSources.get(report.id)?.has(source.id))
    const latestTimes = [...sourceRecentActions, ...sourceSentiments, ...sourceSignals].map((item) => item.occurredAt)
    const inferredTodayAction = sourceSignals.find((item) => shanghaiDay(item.occurredAt) === todayKey)?.action
    const actionEvidence = sourceRecentActions.flatMap((action) => {
      const event = relevantEventByKey.get(`${action.sourceId}:${action.contentId}`)
      const direction = structuredAction(action.action)
      const labels: string[] = direction && direction !== action.action ? [action.action, direction] : [action.action]
      return labels.map((label) => ({ id: `${action.contentId}-${action.action}-${label}`, label, category: 'action' as const, quote: action.evidence,
        occurredAt: action.occurredAt, url: event?.url, confidence: action.confidence }))
    })
    const inferredEvidence = sourceSignals.map((signal) => ({ id: `${signal.contentId}-${signal.action}-inferred`, label: signal.action, category: 'action' as const,
      quote: signal.quote, occurredAt: signal.occurredAt, url: signal.url, confidence: signal.confidence }))
    const sentimentEvidence = sourceSentiments.map((item) => ({ id: `${item.contentId}-${item.sentiment}`, label: item.sentiment, category: 'sentiment' as const,
      quote: item.evidence, occurredAt: item.occurredAt, url: relevantEventByKey.get(`${item.sourceId}:${item.contentId}`)?.url, confidence: item.confidence }))
    const contextEvidence = !inferredAction ? sourceEvents.map((event) => ({ id: `${event.contentId}-no-action`, label: '无明确动作', category: 'context' as const,
      quote: [event.title, event.text, event.transcript, event.metadata?.screenText].find((item): item is string => typeof item === 'string' && Boolean(item.trim()))?.replace(/\s+/g, ' ').slice(0, 220) || '该内容没有可识别文字',
      occurredAt: event.publishedAt, url: event.url })) : []
    return {
      sourceId: source.id, name: source.displayName, position: knownPosition, sentiment: latestSentiment,
      inferredAction, inferenceNature: inferredAction ? useStructured ? '明确' as const : '疑似' as const : undefined, inferenceBasis: useStructured ? '来自已识别仓位动作' : sourceSignals[0]?.basis,
      inferenceConfidence: useStructured && latestStructured ? latestStructured.confidence === '低' ? '中' : latestStructured.confidence : sourceSignals[0]?.confidence,
      sentimentChange: earliestSentiment && earliestSentiment !== latestSentiment ? `${earliestSentiment} → ${latestSentiment}` : undefined,
      todayActions: unique([...sourceTodayActions.map((action) => structuredAction(action.action)).filter((action): action is VocInferredPositionAction => Boolean(action)), ...(inferredTodayAction ? [inferredTodayAction] : [])]),
      recentActions: unique([...sourceRecentActions.map((action) => structuredAction(action.action)).filter((action): action is VocInferredPositionAction => Boolean(action)), ...sourceSignals.map((item) => item.action)]).slice(0, 5),
      todayUpdates: sourceReports.filter((report) => todayReportSources.get(report.id)?.has(source.id)).length,
      recentUpdates: sourceReports.length,
      latestAt: latestTimes.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || sourceReports[0]?.generatedAt,
      tagEvidence: [...actionEvidence, ...inferredEvidence, ...sentimentEvidence, ...contextEvidence]
    }
  })
  return {
    today: { summary: todaySummary, actionCount: todayDirectionFacts.length, activeSources: unique(todayReports.flatMap((report) => [...(todayReportSources.get(report.id) || [])])).length,
      actionLabels: counts(todayDirectionFacts.map((item) => item.direction)), sentimentLabels: counts(todaySentiments.map((item) => item.sentiment)) },
    recent: { summary: recentSummary, actionCount: recentDirectionFacts.length, activeSources: unique(recentReports.flatMap((report) => [...(reportSources.get(report.id) || [])])).length,
      actionLabels: counts(recentDirectionFacts.map((item) => item.direction)), sentimentLabels: counts(recentSentiments.map((item) => item.sentiment)) },
    actors: actorRows
  }
}
