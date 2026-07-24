import { AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronDown, Clipboard, Download, ExternalLink, History, LogIn, Radio, Save, Settings2, Upload, Waves } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { VocSnapshot, VocSource } from '../../../shared/types'
import { isStockMarketVocEvent } from '../../../shared/voc-relevance'
import { buildVocSourceTransferJson } from '../../../shared/voc-source-transfer'
import { buildVocTrendDashboard, type VocActorTrend, type VocTagEvidence } from '../utils/voc-trends'
import { VocSourceImportDialog } from './VocSourceImportDialog'

interface VocMonitorViewProps {
  snapshot: VocSnapshot | null | undefined
  onUpdateSource: (id: string, patch: Pick<VocSource, 'profileUrl' | 'enabled'>) => Promise<{ ok: boolean; error?: string }>
  onImportSources: (raw: string) => Promise<{ ok: boolean; imported?: number; added?: number; error?: string }>
  onOpenExternal: (url: string) => Promise<boolean>
  onOpenLogin: () => Promise<{ ok: boolean; error?: string }>
}

const platformLabel = { weibo: '微博', douyin: '抖音', wechat: '公众号', manual: '手动' }
const timeLabel = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚无记录'
const actionTone = (action: string) => ['买入', '加仓'].includes(action) ? 'increase' : ['卖飞', '踏空'].includes(action) ? 'missed' : ['减仓', '清仓', '空仓', '割肉', '止盈'].includes(action) ? 'reduce' : 'neutral'
const sentimentTone = (sentiment: string) => ['恐慌', '谨慎'].includes(sentiment) ? 'cool' : ['乐观', '亢奋', '踏空焦虑'].includes(sentiment) ? 'hot' : 'neutral'
const directionFor = (action: string) => ['买入', '加仓'].includes(action) ? '加仓' : ['减仓', '割肉', '止盈', '卖飞'].includes(action) ? '减仓' : ['清仓', '空仓'].includes(action) ? '清仓' : null
type DrilldownScope = 'account' | 'action' | 'sentiment' | 'today' | 'recent'
const drilldownLabel: Record<DrilldownScope, string> = { account: '账号近期内容', action: '仓位判断相关内容', sentiment: '情绪判断相关内容', today: '今天更新', recent: '近 7 日更新' }
const shanghaiDay = (value: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
const eventExcerpt = (event: VocSnapshot['recentEvents'][number]) => [event.title, event.transcript, event.metadata?.screenText, event.text]
  .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))?.replace(/\s+/g, ' ').trim().slice(0, 280) || '该条内容没有可展示的文字'

export function VocMonitorView({ snapshot, onUpdateSource, onImportSources, onOpenExternal, onOpenLogin }: VocMonitorViewProps) {
  const sources = snapshot?.sources || []
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [transferMessage, setTransferMessage] = useState('')
  const [transferError, setTransferError] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedEvidence, setSelectedEvidence] = useState<{ sourceId: string; label: string; category: VocTagEvidence['category']; items: VocTagEvidence[] } | null>(null)
  const [selectedDrilldown, setSelectedDrilldown] = useState<{ sourceId: string; scope: DrilldownScope } | null>(null)
  useEffect(() => { setDrafts(Object.fromEntries(sources.map((source) => [source.id, source.profileUrl || '']))) }, [snapshot?.loadedAt])
  const ready = sources.filter((source) => source.status === 'ready' && source.enabled).length
  const stockEvents = useMemo(() => (snapshot?.recentEvents || []).filter((event) => Date.now() - Date.parse(event.publishedAt) <= 7 * 24 * 60 * 60 * 1000 && isStockMarketVocEvent(event)), [snapshot?.recentEvents])
  const stockEventIds = useMemo(() => new Set(stockEvents.map((event) => event.id)), [stockEvents])
  const stockEventKeys = useMemo(() => new Set(stockEvents.map((event) => `${event.sourceId}:${event.contentId}`)), [stockEvents])
  const relevantReports = useMemo(() => (snapshot?.recentReports || []).filter((report) => report.eventIds.some((id) => stockEventIds.has(id))), [snapshot?.recentReports, stockEventIds])
  const latest = relevantReports[0]
  const eventCount = stockEvents.length
  const sourceNames = useMemo(() => Object.fromEntries(sources.map((source) => [source.id, source.displayName])), [sources])
  const trends = useMemo(() => snapshot ? buildVocTrendDashboard(snapshot) : null, [snapshot])
  const latestTrendAt = useMemo(() => {
    const effectiveUpdates = stockEvents.map((event) => event.publishedAt)
    const fallbackChecks = sources.map((source) => source.lastCheckedAt).filter((value): value is string => Boolean(value))
    return [...effectiveUpdates, ...(!effectiveUpdates.length ? fallbackChecks : [])].sort((left, right) => Date.parse(right) - Date.parse(left))[0]
  }, [sources, stockEvents])
  const reportDirection = (report: NonNullable<typeof snapshot>['recentReports'][number]) => {
    const directions = new Map<string, Set<string>>()
    for (const action of report.positionActions || []) {
      if (!stockEventKeys.has(`${action.sourceId}:${action.contentId}`)) continue
      const direction = directionFor(action.action)
      if (!direction) continue
      const labels = directions.get(action.sourceId) || new Set<string>()
      labels.add(direction); directions.set(action.sourceId, labels)
    }
    if (!directions.size) return '本批内容没有足够线索判断加仓、减仓或清仓，暂记为无明确动作。'
    return `方向推测：${[...directions].map(([sourceId, labels]) => `${sourceNames[sourceId] || sourceId} ${[...labels].join('、')}`).join('；')}。`
  }
  const toggleEvidence = (sourceId: string, label: string, category: VocTagEvidence['category'], items: VocTagEvidence[]) => {
    const matching = items.filter((item) => item.label === label && item.category === category).sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    if (!matching.length) return
    setSelectedDrilldown(null)
    setSelectedEvidence((current) => current?.sourceId === sourceId && current.label === label && current.category === category ? null : { sourceId, label, category, items: matching })
  }
  const toggleDrilldown = (sourceId: string, scope: DrilldownScope) => {
    setSelectedEvidence(null)
    setSelectedDrilldown((current) => current?.sourceId === sourceId && current.scope === scope ? null : { sourceId, scope })
  }
  const interactiveCellProps = (sourceId: string, scope: DrilldownScope) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': `查看${drilldownLabel[scope]}`,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest('button')) return
      toggleDrilldown(sourceId, scope)
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
      event.preventDefault(); toggleDrilldown(sourceId, scope)
    }
  })
  const drilldownEvents = (actor: VocActorTrend, scope: DrilldownScope) => {
    const all = stockEvents.filter((event) => event.sourceId === actor.sourceId).sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    if (scope === 'today') return all.filter((event) => shanghaiDay(event.publishedAt) === shanghaiDay(new Date()))
    if (scope !== 'action' && scope !== 'sentiment') return all
    const category = scope === 'action' ? 'action' : 'sentiment'
    const evidenceUrls = new Set(actor.tagEvidence.filter((item) => item.category === category && item.url).map((item) => item.url))
    const matched = all.filter((event) => evidenceUrls.has(event.url))
    return matched.length ? matched : all
  }
  const save = async (source: VocSource, enabled = source.enabled) => {
    setSaving(source.id); setMessage('')
    const result = await onUpdateSource(source.id, { profileUrl: drafts[source.id] || '', enabled })
    setSaving(null); setMessage(result.ok ? `${source.displayName} 已保存` : result.error || '保存失败')
  }
  const openLogin = async () => {
    setMessage('正在打开专用登录窗口…')
    const result = await onOpenLogin()
    setMessage(result.ok ? '请分别登录微博和抖音，完成后直接关闭该 Chrome 窗口' : result.error || '登录窗口打开失败')
  }
  const exportJson = () => {
    const content = buildVocSourceTransferJson(sources, drafts)
    const url = URL.createObjectURL(new Blob([`${content}\n`], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `场外情绪监控账号-${new Date().toISOString().slice(0, 10)}.json`; anchor.click()
    URL.revokeObjectURL(url); setTransferError(false); setTransferMessage(`已导出 ${sources.length} 个监控账号`)
  }
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(buildVocSourceTransferJson(sources, drafts))
      setCopied(true); setTransferError(false); setTransferMessage(`已复制 ${sources.length} 个监控账号的 JSON`)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { setTransferError(true); setTransferMessage('复制失败，请检查系统剪贴板权限') }
  }
  const importJson = async (raw: string) => {
    setTransferMessage('')
    const result = await onImportSources(raw)
    setTransferError(!result.ok)
    setTransferMessage(result.ok ? `已导入 ${result.imported || 0} 个账号${result.added ? `，其中新增 ${result.added} 个` : ''}` : result.error || '导入失败')
    return result
  }
  return (
    <section className="content-view voc-view">
      <div className="view-heading"><div><h1>场外情绪</h1><p>把重点博主的公开表达转成反向情绪风险因子，不单独作为买卖依据。{message && <span className="inline-notice"> {message}</span>}</p></div></div>
      <div className="voc-summary">
        <div><Radio size={16} /><span><strong>{ready}/{sources.length} 个账号已绑定</strong><small>绑定主页后仍需采集连接器提供内容</small></span></div>
        <div><Waves size={16} /><span><strong>{eventCount} 条近期内容</strong><small>重复内容按平台内容 ID 去重</small></span></div>
        <div><AlertTriangle size={16} /><span><strong>{relevantReports.length} 份风险摘要</strong><small>{latest ? `最近生成 ${timeLabel(latest.generatedAt)}` : '等待第一条股市更新'}</small></span></div>
      </div>

      {trends && <section className="voc-section voc-insight-brief">
        <header><div><strong>反指总结</strong><span>先看结论，再按需下钻账号和原始证据。</span></div><div className="voc-header-actions"><small>{latest ? `更新于 ${timeLabel(latest.generatedAt)}` : '等待首次更新'}</small><button aria-expanded={settingsOpen} className="voc-settings-toggle" onClick={() => setSettingsOpen((value) => !value)} type="button"><Settings2 size={13} />监控设置<ChevronDown className={settingsOpen ? 'open' : ''} size={13} /></button></div></header>
        <div className="voc-insight-layout">
          <article className="voc-insight-today">
            <div className="voc-insight-kicker"><CalendarDays size={16} /><strong>今日核心结论</strong><span>{trends.today.activeSources} 个账号有更新 · {trends.today.actionCount} 个方向动作</span></div>
            <p>{trends.today.summary}</p>
            <div className="voc-period-tags">{trends.today.actionLabels.map((item) => <span className="action" key={item}>{item}</span>)}{trends.today.sentimentLabels.map((item) => <span className="sentiment" key={item}>{item}</span>)}{!trends.today.actionLabels.length && !trends.today.sentimentLabels.length && <span>动作与情绪证据仍不足</span>}</div>
          </article>
          <article className="voc-insight-recent">
            <div className="voc-insight-kicker"><History size={15} /><strong>近 7 日趋势</strong><span>{trends.recent.activeSources} 个账号 · {trends.recent.actionCount} 个动作</span></div>
            <p>{trends.recent.summary}</p>
            <div className="voc-period-tags">{trends.recent.actionLabels.map((item) => <span className="action" key={item}>{item}</span>)}{trends.recent.sentimentLabels.map((item) => <span className="sentiment" key={item}>{item}</span>)}</div>
          </article>
        </div>
      </section>}

      {settingsOpen && <section className="voc-section voc-settings-panel">
        <header><div><strong>重点监控账号</strong><span>使用独立 Chrome 登录态，只读取下列公开主页。</span></div><div className="voc-source-transfer-actions"><button className="secondary-button" onClick={() => void copyJson()} type="button">{copied ? <Check size={13} /> : <Clipboard size={13} />}{copied ? '已复制' : '复制 JSON'}</button><button className="secondary-button" onClick={exportJson} type="button"><Download size={13} />导出 JSON</button><button className="secondary-button" onClick={() => setImportOpen(true)} type="button"><Upload size={13} />导入 JSON</button><button className="secondary-button" onClick={() => void openLogin()} type="button"><LogIn size={13} />登录采集浏览器</button></div></header>
        {transferMessage && <p aria-live="polite" className={transferError ? 'voc-transfer-notice error' : 'voc-transfer-notice'}>{transferMessage}</p>}
        <div className="voc-source-list">{sources.map((source) => (
          <article key={source.id}>
            <span className={`voc-platform ${source.platform}`}>{platformLabel[source.platform]}</span>
            <div className="voc-source-copy"><strong>{source.displayName}</strong><small title={source.lastError}>{source.status === 'ready' ? `采集正常 · 最近检查 ${timeLabel(source.lastCheckedAt)}` : source.status === 'error' ? `采集异常 · ${source.lastError || '请检查登录状态'}` : source.status === 'needs_connector' ? '等待首次采集' : '缺少唯一账号主页'}</small></div>
            <div className="voc-url-field"><input aria-label={`${source.displayName}主页链接`} placeholder="粘贴账号主页 HTTPS 链接" value={drafts[source.id] || ''} onChange={(event) => setDrafts({ ...drafts, [source.id]: event.target.value })} />{source.profileUrl && <button title="打开主页" aria-label={`打开${source.displayName}主页`} onClick={() => void onOpenExternal(source.profileUrl!)} type="button"><ExternalLink size={13} /></button>}</div>
            <button className={source.enabled ? 'switch on' : 'switch'} aria-label={`${source.enabled ? '停用' : '启用'}${source.displayName}`} onClick={() => void save(source, !source.enabled)} type="button"><span /></button>
            <button className="secondary-button" disabled={saving === source.id || drafts[source.id] === (source.profileUrl || '')} onClick={() => void save(source)} type="button"><Save size={13} />保存</button>
          </article>
        ))}</div>
      </section>}

      {trends && <section className="voc-section voc-trends">
        <header><div><strong>各账号仓位动作与情绪</strong><span>从标题、文案和口播中判断大致方向，不追究数量与价格。</span></div><div className="voc-trend-header-meta"><small className="voc-last-update">最近更新时间 {timeLabel(latestTrendAt)}</small><small>点击标签查看事实依据</small></div></header>
        <div className="voc-actor-table">
          <div className="voc-actor-head"><span>反指账号</span><span>仓位动作推测</span><span>当前情绪 / 变化</span><span>今天做了什么</span><span>近 7 日操作轨迹</span></div>
          {trends.actors.map((actor) => <Fragment key={actor.sourceId}><div className="voc-actor-row">
            <div className="voc-actor-cell voc-actor-name" {...interactiveCellProps(actor.sourceId, 'account')}><strong>{actor.name}</strong><small>{actor.latestAt ? `更新 ${timeLabel(actor.latestAt)}` : '近期无有效证据'}</small></div>
            <div className="voc-actor-cell voc-inference" title={actor.inferenceBasis} {...interactiveCellProps(actor.sourceId, 'action')}>{actor.inferredAction ? <button className={actionTone(actor.inferredAction)} onClick={() => toggleEvidence(actor.sourceId, actor.inferredAction!, 'action', actor.tagEvidence)} type="button">{actor.inferenceNature === '疑似' ? '疑似' : ''}{actor.inferredAction}</button> : actor.tagEvidence.some((item) => item.category === 'context') ? <button className="unknown" onClick={() => toggleEvidence(actor.sourceId, '无明确动作', 'context', actor.tagEvidence)} type="button">无明确动作</button> : <span className="unknown">无明确动作</span>}<small>{actor.inferenceBasis || '未发现加减清线索'}{actor.inferenceConfidence ? ` · ${actor.inferenceConfidence}置信` : ''}</small></div>
            <div className="voc-actor-cell voc-sentiment" {...interactiveCellProps(actor.sourceId, 'sentiment')}>{actor.sentiment !== '未知' ? <button className={sentimentTone(actor.sentiment)} onClick={() => toggleEvidence(actor.sourceId, actor.sentiment, 'sentiment', actor.tagEvidence)} type="button">{actor.sentiment}</button> : <span className="neutral">未知</span>}<small>{actor.sentimentChange || (actor.sentiment === '未知' ? '等待情绪证据' : '近期无明显转变')}</small></div>
            <div className="voc-actor-cell voc-mini-actions" {...interactiveCellProps(actor.sourceId, 'today')}>{actor.todayActions.length ? actor.todayActions.map((action) => <button className={actionTone(action)} onClick={() => toggleEvidence(actor.sourceId, action, 'action', actor.tagEvidence)} type="button" key={action}>{action}</button>) : <small>{actor.todayUpdates ? '有更新 · 动作未确认' : '今日无更新'}</small>}</div>
            <div className="voc-actor-cell voc-action-trail" {...interactiveCellProps(actor.sourceId, 'recent')}>{actor.recentActions.length ? actor.recentActions.map((action, index) => <Fragment key={action}>{index ? <span>→</span> : null}<button onClick={() => toggleEvidence(actor.sourceId, action, 'action', actor.tagEvidence)} type="button">{action}</button></Fragment>) : <small>{actor.recentUpdates ? '有内容 · 操作未知' : '近 7 日无更新'}</small>}</div>
          </div>{selectedEvidence?.sourceId === actor.sourceId && <div className="voc-tag-evidence">
            <div className="voc-evidence-title"><span>判断依据</span><strong>{actor.name} · {actor.inferenceNature === '疑似' && selectedEvidence.category === 'action' && selectedEvidence.label === actor.inferredAction ? '疑似' : ''}{selectedEvidence.label}</strong><button onClick={() => setSelectedEvidence(null)} type="button">收起</button></div>
            <div className="voc-evidence-items">{selectedEvidence.items.slice(0, 5).map((item) => <article key={item.id}><div><span>{timeLabel(item.occurredAt)}</span>{item.confidence && <span>{item.confidence}置信</span>}</div><p>“{item.quote}”</p>{item.url && <button onClick={() => void onOpenExternal(item.url!)} type="button"><ExternalLink size={12} />查看原始内容</button>}</article>)}</div>
          </div>}{selectedDrilldown?.sourceId === actor.sourceId && <div className="voc-content-drilldown">
            <div className="voc-content-drilldown-title"><div><span>最近更新内容</span><strong>{actor.name} · {drilldownLabel[selectedDrilldown.scope]}</strong></div><button onClick={() => setSelectedDrilldown(null)} type="button">收起</button></div>
            {drilldownEvents(actor, selectedDrilldown.scope).length ? <div className="voc-content-list">{drilldownEvents(actor, selectedDrilldown.scope).slice(0, 12).map((event) => <article key={event.id}>
              <div><span>{platformLabel[event.platform]}</span><time>{timeLabel(event.publishedAt)}</time>{event.mediaType === 'video' && <em>视频</em>}</div>
              <p>{eventExcerpt(event)}</p>
              <button onClick={() => void onOpenExternal(event.url)} type="button"><ExternalLink size={12} />查看原始内容</button>
            </article>)}</div> : <div className="voc-content-empty">该范围内没有新的股市相关内容</div>}
          </div>}</Fragment>)}
        </div>
      </section>}

      <section className="voc-section voc-reports">
        <header><div><strong>最近风险与仓位动作</strong><span>先看整体方向，需要时再展开完整分析。</span></div><small>不追究数量、价格与账户范围</small></header>
        {relevantReports.length ? <div>{relevantReports.slice(0, 12).map((report) => <article key={report.id}>
          <div className="voc-report-heading"><CheckCircle2 size={14} /><strong>{timeLabel(report.generatedAt)}</strong><small>{report.sourceIds.length} 个账号 · {report.eventIds.filter((id) => stockEventIds.has(id)).length} 条股市内容{report.positionActions?.filter((action) => stockEventKeys.has(`${action.sourceId}:${action.contentId}`)).length ? ` · ${report.positionActions.filter((action) => stockEventKeys.has(`${action.sourceId}:${action.contentId}`)).length} 个仓位动作` : ''}</small></div>
          {report.positionActions?.some((action) => stockEventKeys.has(`${action.sourceId}:${action.contentId}`)) ? <div className="voc-action-list">{report.positionActions.filter((action) => stockEventKeys.has(`${action.sourceId}:${action.contentId}`)).map((action, index) => <div className="voc-action-row" key={`${action.sourceId}-${action.contentId}-${action.action}-${index}`}>
            <span className={`voc-action-badge ${actionTone(action.action)}`}>{action.action}</span>
            <div className="voc-action-copy"><div><strong>{sourceNames[action.sourceId] || action.sourceId}</strong><span>{timeLabel(action.occurredAt)} · 置信度{action.confidence}{action.positionAfter !== '未知' ? ` · 操作后${action.positionAfter}` : ''}</span></div><p title={action.evidence}>“{action.evidence}”</p></div>
            {(action.asset || action.sector) && <span className="voc-action-target">{[action.sector, action.asset].filter(Boolean).join(' · ')}</span>}
          </div>)}</div> : null}
          <p className="voc-report-direction">{reportDirection(report)}</p>
          <details className="voc-report-details"><summary>查看完整分析与原文链接</summary><p className="voc-report-summary">{report.summary}</p></details>
        </article>)}</div> : <div className="voc-empty"><Waves size={22} /><strong>还没有可分析的场外更新</strong><span>账号主页和采集连接器就绪后，新增内容会在 2 分钟内进入分析。</span></div>}
      </section>
      {importOpen && <VocSourceImportDialog onClose={() => setImportOpen(false)} onImport={importJson} />}
    </section>
  )
}
