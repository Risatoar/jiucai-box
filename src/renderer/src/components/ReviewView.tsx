import { AlertCircle, BarChart3, ClipboardList, LoaderCircle, RefreshCw, Star, TrendingUp } from 'lucide-react'
import { DatePicker } from './DatePicker'
import { ReviewLoadingState } from './ReviewLoadingState'
import { GroupedHotStocks, SectorCard } from './ReviewMarketResults'
import { useEffect, useRef, useState } from 'react'
import type {
  ReviewAggregate,
  ReviewCandidateReview,
  ReviewIndexAssessment,
  ReviewMarketOverview,
  ReviewOutcomeStatus,
  ReviewPeriod,
  ReviewReport,
  ReviewRequest,
  ReviewSignalReview
} from '../../../shared/review-types'
import type { MarketBar } from '../../../shared/types'
import { formatReviewSelection, normalizeReviewSelection } from '../../../shared/review-period'

const periodLabels: Record<ReviewPeriod, string> = { daily: '日报', weekly: '周报', monthly: '月报' }

const outcomeLabel: Record<ReviewOutcomeStatus, string> = {
  verified: '已验证',
  partial: '部分符合',
  failed: '已失效',
  watching: '仍在观察',
  pending: '待观察'
}

const outcomeTone: Record<ReviewOutcomeStatus, string> = {
  verified: 'verified',
  partial: 'partial',
  failed: 'failed',
  watching: 'watching',
  pending: 'pending',
}

const marketRegimeLabel: Record<string, string> = { supportive: '偏强', risk_on: '偏强', neutral: '震荡', defensive: '偏弱', risk_off: '偏弱', unknown: '待确认' }

const formatPct = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '--'
  const v = Number(value)
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

const formatPrice = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value) || value <= 0) return '--'
  return value.toFixed(value < 10 ? 3 : 2)
}

const shanghaiDate = () => {
  const d = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return v.year + '-' + v.month + '-' + v.day
}

function MarketOverview({ overview }: { overview: ReviewMarketOverview }) {
  const stockBreadth = overview.breadth.find((b) => b.type === 'stock')
  const risingRatio = stockBreadth && stockBreadth.total ? Math.round((stockBreadth.rising / stockBreadth.total) * 1000) / 10 : null
  return (
    <section className="review-market-overview">
      <div className="review-section-title review-overview-title">
        <span><BarChart3 size={18} />市场总览</span>
        <span className={`review-scope-badge ${overview.dataScope === 'all_a_share_stocks' ? 'ready' : 'missing'}`}>
          {overview.dataScope === 'all_a_share_stocks'
            ? overview.stockCoverage?.sampleSize
              ? `全 A 股行业 · ${overview.stockCoverage.sampleSize} 只高流动性样本 · 覆盖 ${overview.stockCoverage.percent ?? '--'}%`
              : `全 A 股 · ${overview.stockCoverage?.total || '--'} 只 · 行业覆盖 ${overview.stockCoverage?.percent ?? '--'}%`
            : '全市场行业数据不足'}
        </span>
      </div>
      <div className="review-market-grid">
        <div className="review-market-card">
          <span className="review-market-label">市场状态</span>
          <strong className="review-market-regime">{marketRegimeLabel[overview.regime?.toLowerCase() || ''] || overview.regime || '待确认'}</strong>
          {stockBreadth && <small>上涨家数 {stockBreadth.rising} / {stockBreadth.total}</small>}
        </div>
        {stockBreadth && (
          <div className="review-market-card">
            <span className="review-market-label">上涨比例</span>
            <strong className={risingRatio != null && risingRatio >= 50 ? 'up' : 'down'}>{risingRatio != null ? risingRatio + '%' : '--'}</strong>
            <small>中位数 {formatPct(stockBreadth.medianChangePercent)}</small>
          </div>
        )}
        {overview.benchmarks.slice(0, 4).map((bench) => (
          <div className="review-market-card" key={bench.code}>
            <span className="review-market-label">{bench.name}</span>
            <strong className={(bench.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{formatPct(bench.changePercent)}</strong>
            <small>{bench.price != null ? bench.price.toFixed(3) : '--'}</small>
          </div>
        ))}
      </div>
      {overview.hotThemes.length > 0 && (
        <div className="review-themes">
          <div className="review-themes-title">热门板块</div>
          <div className="review-themes-list">
            {overview.hotThemes.map((theme, i) => (
              <div className="review-theme-chip" key={theme.name}>
                <span className="review-theme-rank">{i + 1}</span>
                <strong>{theme.name}</strong>
                <span className={(theme.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{formatPct(theme.changePercent)}</span>
                {theme.heatScore != null && <small>热度 {theme.heatScore}</small>}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function IndexAssessment({ data }: { data: ReviewIndexAssessment }) {
  return (
    <section className="review-index-assessment">
      <div className="review-section-title"><TrendingUp size={18} />指数环境</div>
      <div className="review-index-stance">{data.stance}</div>
      <p className="review-index-summary">{data.summary}</p>
      {data.evidence?.length > 0 && <ul className="review-evidence-list">{data.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <div className="review-next-focus"><strong>下一步关注：</strong>{data.nextSessionFocus}</div>
    </section>
  )
}


function Sparkline({ bars, height = 64 }: { bars?: MarketBar[]; height?: number }) {
  if (!bars || bars.length < 2) return <div className="review-sparkline review-sparkline-empty">暂无走势数据</div>
  const closes = bars.map((b) => Number(b.close) || 0).filter((v) => Number.isFinite(v) && v > 0)
  if (closes.length < 2) return <div className="review-sparkline review-sparkline-empty">暂无走势数据</div>
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const pad = 4
  const usableW = 300 - pad * 2
  const usableH = height - pad * 2
  const points = closes.map((close, i) => {
    const x = pad + (i / (closes.length - 1)) * usableW
    const y = pad + (1 - (close - min) / range) * usableH
    return [x, y] as const
  })
  const path = points.map(([x, y], i) => (i === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `L ${x.toFixed(1)} ${y.toFixed(1)}`)).join(' ')
  const last = points[points.length - 1]
  const first = points[0]
  const up = (closes[closes.length - 1] ?? 0) >= (closes[0] ?? 0)
  const stroke = up ? '#d93025' : '#1a8a4a'
  const area = `${path} L ${last[0].toFixed(1)} ${(height - pad).toFixed(1)} L ${first[0].toFixed(1)} ${(height - pad).toFixed(1)} Z`
  return (
    <div className="review-sparkline">
      <svg width="100%" height={height} viewBox={`0 0 300 ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkFill)" stroke="none" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} />
      </svg>
      <div className="review-sparkline-label">
        <span>{min.toFixed(2)}</span>
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  )
}

function CandidateReviewRow({ item, onRate }: { item: ReviewCandidateReview; onRate: (id: string, rating: number, note?: string) => void }) {
  return (
    <div className="review-candidate-row">
      <div className="review-candidate-header">
        <div className="review-candidate-name"><strong>{item.name}</strong><small>{item.code}</small></div>
        <span className={"review-outcome-badge " + outcomeTone[item.status]}>{outcomeLabel[item.status]}</span>
      </div>
      <div className="review-candidate-meta">
        <span>推荐价 {formatPrice(item.referencePrice)}</span>
        <span>现价 {formatPrice(item.latestPrice)}</span>
        <span className={item.changeSinceRecommend != null && item.changeSinceRecommend >= 0 ? 'up' : 'down'}>涨跌 {formatPct(item.changeSinceRecommend)}</span>
      </div>
      <p className="review-candidate-reason">{item.reason}</p>
      <Sparkline bars={item.bars} />
      <div className="review-rating-row">
        <span>评价</span>
        {[1,2,3,4,5].map(n => <button key={n} className={"review-star " + (n <= (item.userRating || 0) ? 'active' : '')} onClick={() => onRate(item.id, n === item.userRating ? 0 : n)} type="button"><Star size={14} /></button>)}
      </div>
    </div>
  )
}

function formatSignalTime(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }).format(d)
}

function SignalDetailModal({ item, onClose }: { item: ReviewSignalReview; onClose: () => void }) {
  const sideLabel = item.side === 'buy' ? '买入' : '卖出'
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)
  const addToWatch = async () => {
    if (!window.desktopApi || adding) return
    setAdding(true)
    try {
      await window.desktopApi.addWatchItem(item.code)
      setAdded(true)
    } catch { /* ignore */ }
    finally { setAdding(false) }
  }
  return (
    <div className="review-detail-backdrop" onClick={onClose}>
      <div className="review-detail-modal" onClick={(e) => e.stopPropagation()}>
        <header className="review-detail-header">
          <div className="review-detail-title">
            <strong>{item.name}</strong>
            <small>{item.code}</small>
          </div>
          <div className="review-detail-actions">
            <span className={"review-signal-side " + item.side}>{sideLabel}</span>
            <span className={"review-outcome-badge " + outcomeTone[item.outcomeStatus]}>{outcomeLabel[item.outcomeStatus]}</span>
            <button className="review-detail-watch" onClick={addToWatch} disabled={adding || added} type="button">
              {added ? '已加自选' : adding ? '添加中…' : '加自选'}
            </button>
            <button className="review-detail-close" onClick={onClose} type="button">关闭</button>
          </div>
        </header>
        <div className="review-detail-body">
          <div className="review-detail-grid">
            <div><span>信号时间</span><strong>{formatSignalTime(item.signalAt)}</strong></div>
            <div><span>信号价</span><strong>{formatPrice(item.referencePrice)}</strong></div>
            <div><span>现价</span><strong>{formatPrice(item.latestPrice)}</strong></div>
            <div><span>方向收益</span><strong className={(item.directionalReturnPercent ?? 0) >= 0 ? 'up' : 'down'}>{formatPct(item.directionalReturnPercent)}</strong></div>
            <div><span>策略</span><strong>{item.strategy || '--'}</strong></div>
            <div><span>置信度</span><strong>{item.level || '--'}</strong></div>
          </div>
          {item.summary && <p className="review-detail-summary">{item.summary}</p>}
          {item.evidence?.length > 0 && <div className="review-detail-evidence"><strong>证据链：</strong><ul>{item.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
          <Sparkline bars={item.bars} height={80} />
        </div>
      </div>
    </div>
  )
}

function SignalReviewRow({ item, onRate }: { item: ReviewSignalReview; onRate: (id: string, rating: number, note?: string) => void }) {
  const sideLabel = item.side === 'buy' ? '买入' : '卖出'
  const [detail, setDetail] = useState(false)
  return (
    <div className="review-signal-row compact">
      <div className="review-signal-header">
        <div className="review-signal-name" onClick={() => setDetail(true)}>
          <strong>{item.name}</strong>
          <small>{item.code}</small>
        </div>
        <div className="review-signal-header-right">
          <span className="review-signal-time">{formatSignalTime(item.signalAt)}</span>
          <span className={"review-signal-side " + item.side}>{sideLabel}</span>
          <span className={"review-outcome-badge " + outcomeTone[item.outcomeStatus]}>{outcomeLabel[item.outcomeStatus]}</span>
        </div>
      </div>
      <div className="review-signal-meta">
        <span>信号价 {formatPrice(item.referencePrice)}</span>
        <span>现价 {formatPrice(item.latestPrice)}</span>
        <span className={(item.directionalReturnPercent ?? 0) >= 0 ? 'up' : 'down'}>方向收益 {formatPct(item.directionalReturnPercent)}</span>
      </div>
      {item.summary && <p className="review-signal-summary">{item.summary}</p>}
      <div className="review-signal-bottom">
        <Sparkline bars={item.bars} height={40} />
        <div className="review-rating-row">
          <span>评价</span>
          {[1,2,3,4,5].map(n => <button key={n} className={"review-star " + (n <= (item.userRating || 0) ? 'active' : '')} onClick={() => onRate(item.id, n === item.userRating ? 0 : n)} type="button"><Star size={13} /></button>)}
        </div>
      </div>
      {detail && <SignalDetailModal item={item} onClose={() => setDetail(false)} />}
    </div>
  )
}

function AggregatePanel({ agg }: { agg: ReviewAggregate }) {
  return (
    <section className="review-aggregate">
      <div className="review-section-title"><ClipboardList size={18} />汇总分析</div>
      <div className="review-aggregate-grid">
        <div className="review-metric"><span className="review-metric-label">候选总数</span><strong>{agg.candidateTotal}</strong></div>
        <div className="review-metric"><span className="review-metric-label">已验证</span><strong className="verified">{agg.candidateVerified}</strong></div>
        <div className="review-metric"><span className="review-metric-label">已失效</span><strong className="failed">{agg.candidateFailed}</strong></div>
        <div className="review-metric"><span className="review-metric-label">已评价</span><strong>{agg.candidateRatedCount}<small>{agg.candidateAvgRating != null ? ' / ' + agg.candidateAvgRating + '星' : ''}</small></strong></div>
        <div className="review-metric"><span className="review-metric-label">信号准确率</span><strong>{agg.signalAccuracyPercent != null ? agg.signalAccuracyPercent + '%' : '--'}</strong></div>
        <div className="review-metric"><span className="review-metric-label">平均方向收益</span><strong className={(agg.averageDirectionalReturnPercent ?? 0) >= 0 ? 'up' : 'down'}>{formatPct(agg.averageDirectionalReturnPercent)}</strong></div>
        <div className="review-metric"><span className="review-metric-label">信号已评价</span><strong>{agg.signalRatedCount}<small>{agg.signalAvgRating != null ? ' / ' + agg.signalAvgRating + '星' : ''}</small></strong></div>
      </div>
      {agg.blindSpots?.length > 0 && <div className="review-blindspots"><strong>AI 盲区：</strong><ul>{agg.blindSpots.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
      {agg.suggestions?.length > 0 && <div className="review-suggestions"><strong>沉淀建议：</strong><ul>{agg.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
    </section>
  )
}

export function ReviewView() {
  const today = shanghaiDate()
  const [period, setPeriod] = useState<ReviewPeriod>('daily')
  const [periodSelections, setPeriodSelections] = useState<Record<ReviewPeriod, string>>({
    daily: today,
    weekly: normalizeReviewSelection('weekly', today),
    monthly: normalizeReviewSelection('monthly', today)
  })
  const [report, setReport] = useState<ReviewReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'sectors' | 'hotstocks' | 'candidates' | 'signals'>('sectors')
  const requestVersion = useRef(0)
  const tradingDate = periodSelections[period]

  const setTradingDate = (value: string) => {
    setPeriodSelections((current) => ({ ...current, [period]: value }))
  }

  const load = async (force = false) => {
    if (!window.desktopApi) return
    const version = ++requestVersion.current
    setLoading(true); setError('')
    const request: ReviewRequest = { period, tradingDate, force }
    try {
      const result = force ? await window.desktopApi.refreshReviewReport(request) : await window.desktopApi.getReviewReport(request)
      if (version !== requestVersion.current) return
      if (result.ok && result.report) setReport(result.report)
      else setError(result.error || '复盘报告加载失败')
    } catch (e) { if (version === requestVersion.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (version === requestVersion.current) setLoading(false) }
  }

  useEffect(() => {
    setReport(null)
    void load(false)
  }, [period, tradingDate])

  const rateItem = async (targetType: 'candidate' | 'signal', id: string, rating: number) => {
    if (!window.desktopApi || !report) return
    try {
      const result = await window.desktopApi.saveReviewRating(period, tradingDate, { targetType, targetId: id, rating })
      if (result.ok && result.report) setReport(result.report)
    } catch { /* ignore rating save errors */ }
  }

  const stage = report?.stage || 'idle'
  const busy = loading || stage === 'collecting' || stage === 'analyzing'
  const stageText = stage === 'collecting' ? '正在收集市场数据…' : stage === 'analyzing' ? 'AI 正在深度分析…' : '正在加载…'

  return (
    <section className="content-view review-view">
      <div className="view-heading">
        <div>
          <h1>交易复盘</h1>
          <p>市场评估、热门板块分析、AI 数据候选池与异动信号复核。报告按周期缓存，可切换日报、周报、月报。</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" disabled={busy} onClick={() => void load(true)} type="button">
            {busy ? <LoaderCircle size={15} className="spinning" /> : <RefreshCw size={15} />}
            {busy ? '分析中…' : '重新分析'}
          </button>
        </div>
      </div>

      <div className="review-toolbar">
        <div className="segmented-control">
          {(['daily','weekly','monthly'] as ReviewPeriod[]).map(p => (
            <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)} type="button">{periodLabels[p]}</button>
          ))}
        </div>
        <DatePicker
          value={tradingDate}
          max={today}
          onChange={setTradingDate}
          period={period}
        />
      </div>

      {error && <div className="review-error" role="alert"><AlertCircle size={16} />{error}</div>}

      {busy && report?.stage !== 'ready' && (
        <ReviewLoadingState
          selectionLabel={formatReviewSelection(period, tradingDate)}
          periodLabel={periodLabels[period]}
          stageText={stageText}
        />
      )}

      {report && report.stage === 'error' && <div className="review-error" role="alert"><AlertCircle size={16} />{report.error || '复盘生成失败'}</div>}

      {report && report.stage === 'ready' && <>
        {report.marketOverview && <MarketOverview overview={report.marketOverview} />}
        {report.indexAssessment && <IndexAssessment data={report.indexAssessment} />}
        {report.summary && <p className="review-summary">{report.summary}</p>}

        <div className="review-tabs">
          {[
            { id: 'sectors', label: '热门板块分析', count: report.sectors?.length },
            { id: 'hotstocks', label: '热门股 / 龙头股', count: report.hotStocks?.length },
            { id: 'candidates', label: 'AI 数据候选复核', count: report.candidateReviews?.length },
            { id: 'signals', label: '买卖信号复核', count: report.signalReviews?.length },
          ].map(t => (
            <button key={t.id} className={"review-tab " + (tab === t.id ? 'active' : '')} onClick={() => setTab(t.id as typeof tab)} type="button">
              {t.label}<small>{t.count ?? 0}</small>
            </button>
          ))}
        </div>

        {tab === 'sectors' && <div className="review-sectors">
          {report.sectors?.length ? report.sectors.map((s, i) => <SectorCard key={s.id} sector={s} index={i} />) : <div className="review-empty">暂无板块分析数据</div>}
        </div>}

        {tab === 'hotstocks' && <GroupedHotStocks stocks={report.hotStocks || []} />}

        {tab === 'candidates' && <div className="review-candidates">
          {report.candidateSummary && <div className="review-ai-summary"><strong>AI 候选池复核：</strong>{report.candidateSummary}</div>}
          {report.candidateReviews?.length ? report.candidateReviews.map(item => <CandidateReviewRow key={item.id} item={item} onRate={(id, rating) => rateItem('candidate', id, rating)} />) : <div className="review-empty">暂无候选复核数据</div>}
        </div>}

        {tab === 'signals' && <div className="review-signals">
          {report.signalSummary && <div className="review-ai-summary"><strong>AI 信号复核：</strong>{report.signalSummary}</div>}
          {report.signalReviews?.length ? report.signalReviews.map(item => <SignalReviewRow key={item.id} item={item} onRate={(id, rating) => rateItem('signal', id, rating)} />) : <div className="review-empty">暂无信号复核数据</div>}
        </div>}

        {report.aggregate && <AggregatePanel agg={report.aggregate} />}
      </>}
    </section>
  )
}
