import { Activity, ArrowDownRight, ArrowUpRight, Info, MoreHorizontal, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChartPeriod, Gate, MarketAiInsight, MarketBar, MarketInsightRequest, MarketSessionPhase, Position, StrategyDefinition, WatchItem } from '../../../shared/types'
import { MARKET_INSIGHT_REFRESH_MS } from '../../../shared/market-insight'
import { cumulativeAveragePrice, formatBarTime, formatVolume, nearestBarIndex } from './kline-chart-utils'

interface InsightPanelProps {
  item: WatchItem | null
  watchlist?: WatchItem[]
  gates: Gate[]
  bars?: MarketBar[]
  chartLoading?: boolean
  chartError?: string
  period: ChartPeriod
  onPeriod: (period: ChartPeriod) => void
  onSelectItem?: (item: WatchItem) => void
  positions?: Position[]
  strategies?: StrategyDefinition[]
  discipline?: string
}

const WIDTH = 300
const HEIGHT = 116
const LEFT = 4
const RIGHT = 42
const TOP = 9
const BOTTOM = 102
const isTimeline = (period: ChartPeriod) => period === 'timeline' || period === 'five_day'
const priceText = (value: number) => value.toFixed(value < 10 ? 3 : 2)

function MiniMarketChart({ item, bars, period, emptyText }: { item: WatchItem; bars: MarketBar[]; period: ChartPeriod; emptyText: string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const visible = bars.slice(-(isTimeline(period) ? 180 : 64))
  if (!visible.length) return <div className="mini-chart"><div className="chart-empty">{emptyText}</div></div>
  const rawMin = Math.min(...visible.map((bar) => bar.low))
  const rawMax = Math.max(...visible.map((bar) => bar.high))
  const padding = Math.max((rawMax - rawMin) * .08, rawMax * .001)
  const min = rawMin - padding
  const max = rawMax + padding
  const x = (index: number) => LEFT + (WIDTH - LEFT - RIGHT) * index / Math.max(visible.length - 1, 1)
  const y = (value: number) => TOP + (max - value) / Math.max(max - min, Number.EPSILON) * (BOTTOM - TOP)
  const path = (values: Array<number | null>) => values.reduce((result, value, index) => value == null ? result : `${result}${result ? ' L' : 'M'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`, '')
  const closePath = path(visible.map((bar) => bar.close))
  const averages = cumulativeAveragePrice(visible)
  const averagePath = path(averages)
  const areaPath = `${closePath} L ${x(visible.length - 1)} ${BOTTOM} L ${x(0)} ${BOTTOM} Z`
  const grid = Array.from({ length: 3 }, (_, index) => max - (max - min) * index / 2)
  const timeIndexes = [...new Set([0, Math.floor((visible.length - 1) / 2), visible.length - 1])]
  const latest = item.latestPrice > 0 ? item.latestPrice : visible.at(-1)!.close
  const latestY = Math.max(TOP, Math.min(BOTTOM, y(latest)))
  const tone = item.changePercent >= 0 ? 'up' : 'down'
  const candleWidth = Math.max(1.8, Math.min(4.5, (WIDTH - LEFT - RIGHT) / visible.length * .62))
  const dailyAxis = ['1d', '1w', '1M'].includes(period)
  const activeIndex = hoverIndex == null ? null : Math.min(hoverIndex, visible.length - 1)
  const activeBar = activeIndex == null ? null : visible[activeIndex]
  const activeX = activeIndex == null ? null : x(activeIndex)
  const activeY = activeBar == null ? null : y(activeBar.close)

  return <div className="mini-chart interactive" aria-label={`${item.name}${isTimeline(period) ? '分时走势' : 'K 线简图'}，移动指针查看数据`}>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" onPointerLeave={() => setHoverIndex(null)} onPointerMove={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect()
      const pointerX = bounds.width ? (event.clientX - bounds.left) / bounds.width * WIDTH : LEFT
      setHoverIndex(nearestBarIndex(pointerX, LEFT, WIDTH - RIGHT, visible.length))
    }}>
      {grid.map((value) => <g key={value}><line className="mini-chart-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={y(value)} y2={y(value)} /><text className="mini-chart-axis" x={WIDTH - RIGHT + 6} y={y(value) + 3}>{priceText(value)}</text></g>)}
      {isTimeline(period) ? <>
        <path className={`mini-chart-area ${tone}`} d={areaPath} />
        <path className={`mini-price-path ${tone}`} d={closePath} />
        <path className="mini-average-path" d={averagePath} />
      </> : visible.map((bar, index) => {
        const candleX = x(index)
        const bodyTop = y(Math.max(bar.open, bar.close))
        const bodyHeight = Math.max(1.2, Math.abs(y(bar.open) - y(bar.close)))
        return <g className={bar.close >= bar.open ? 'mini-candle-up' : 'mini-candle-down'} key={`${bar.time}-${index}`}><line x1={candleX} x2={candleX} y1={y(bar.high)} y2={y(bar.low)} /><rect x={candleX - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} /></g>
      })}
      <line className={`mini-latest-line ${tone}`} x1={LEFT} x2={WIDTH - RIGHT} y1={latestY} y2={latestY} />
      <rect className={`mini-price-tag ${tone}`} x={WIDTH - RIGHT} y={latestY - 8} width={RIGHT} height={16} rx="2" />
      <text className="mini-price-text" x={WIDTH - RIGHT + 4} y={latestY + 3}>{priceText(latest)}</text>
      {timeIndexes.map((index) => <text className="mini-time-label" key={index} textAnchor={index === 0 ? 'start' : index === visible.length - 1 ? 'end' : 'middle'} x={x(index)} y={114}>{formatBarTime(visible[index].time, dailyAxis)}</text>)}
      {activeBar && activeX != null && activeY != null && <g className="mini-hover-layer">
        <line className="mini-crosshair" x1={activeX} x2={activeX} y1={TOP} y2={BOTTOM} />
        <line className="mini-crosshair" x1={LEFT} x2={WIDTH - RIGHT} y1={activeY} y2={activeY} />
        <circle className={`mini-hover-dot ${activeBar.close >= activeBar.open ? 'up' : 'down'}`} cx={activeX} cy={activeY} r="2.8" />
      </g>}
    </svg>
    {activeBar && activeIndex != null && <div className={`mini-chart-tooltip ${x(activeIndex) > WIDTH / 2 ? 'left' : 'right'}`}>
      <strong>{formatBarTime(activeBar.time, dailyAxis)}</strong>
      {isTimeline(period)
        ? <><span>价格 {priceText(activeBar.close)} · 均价 {priceText(averages[activeIndex])}</span><small>成交量 {formatVolume(activeBar.volume)}</small></>
        : <><span>开 {priceText(activeBar.open)} · 收 {priceText(activeBar.close)}</span><small>高 {priceText(activeBar.high)} · 低 {priceText(activeBar.low)}</small></>}
    </div>}
  </div>
}

const marketPhase = (): MarketSessionPhase => {
  const now = new Date()
  if ([0, 6].includes(now.getDay())) return 'closed'
  const minutes = now.getHours() * 60 + now.getMinutes()
  if (minutes < 9 * 60 + 15) return 'pre_market'
  if ((minutes <= 11 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60)) return 'intraday'
  return 'post_market'
}

const insightTime = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

function MarketSwitcher({ items, selectedCode, onSelect }: { items: WatchItem[]; selectedCode: string; onSelect?: (item: WatchItem) => void }) {
  if (!items.length || !onSelect) return null
  const ordered = [...items].sort((a, b) => Number(b.code === selectedCode) - Number(a.code === selectedCode))
  return <section className="market-switcher" aria-label="关注行情">
    <div className="market-switcher-title"><span>关注行情</span><small>{items.length} 个 · 点击切换</small></div>
    <div className="market-switcher-list" role="listbox" aria-label="切换关注标的">
      {ordered.map((entry) => <button aria-selected={entry.code === selectedCode} className={entry.code === selectedCode ? 'active' : ''} key={entry.code} onClick={() => onSelect(entry)} role="option" type="button">
        <span><strong title={entry.name}>{entry.name}</strong><small>{entry.code}</small></span>
        <span><b>{entry.latestPrice > 0 ? priceText(entry.latestPrice) : '--'}</b><em className={entry.changePercent >= 0 ? 'up' : 'down'}>{entry.latestPrice > 0 ? `${entry.changePercent >= 0 ? '+' : ''}${entry.changePercent.toFixed(2)}%` : '--'}</em></span>
      </button>)}
    </div>
  </section>
}

export function InsightPanel({ item, gates, bars = [], period, onPeriod }: InsightPanelProps) {
  return <aside className="insight-panel"><MarketInsightContent item={item} gates={gates} bars={bars} period={period} onPeriod={onPeriod} /></aside>
}

export function MarketInsightContent({ item, watchlist = [], gates, bars = [], chartLoading = false, chartError = '', period, onPeriod, onSelectItem, positions = [], strategies = [], discipline = 'CAUTION' }: InsightPanelProps) {
  const [details, setDetails] = useState(false)
  const [gateHelp, setGateHelp] = useState(false)
  const [aiInsight, setAiInsight] = useState<MarketAiInsight | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const householdPositions = item ? positions.filter((entry) => entry.instrument.code === item.code && entry.quantity > 0 && entry.status !== 'closed') : []
  const position = householdPositions[0] || null
  const phase = marketPhase()
  const analysisKey = item ? [item.code, period, bars.length ? 'ready' : 'empty', householdPositions.map((entry) => `${entry.memberId}:${entry.accountId}:${entry.quantity}:${entry.averageCost}`).join(','), discipline, gates.map((gate) => `${gate.id}:${gate.state}`).join(','), strategies.filter((strategy) => strategy.status === 'active').map((strategy) => `${strategy.id}:${strategy.version}`).join(',')].join('|') : ''
  const latestRequest = useRef<MarketInsightRequest | null>(null)
  latestRequest.current = item && bars.length ? { item, bars: bars.slice(-80), gates, position, householdPositions, strategies, discipline, period, phase } : null
  const requestInsight = async (force: boolean, isCancelled: () => boolean = () => false) => {
    const request = latestRequest.current
    if (!request) return
    const desktopApi = window.desktopApi
    if (!desktopApi) { setAiError('桌面桥接未连接，请在韭菜盒子桌面应用中生成研判'); return }
    setAiLoading(true)
    setAiError('')
    try {
      const result = await desktopApi.analyzeMarketInsight({ ...request, force })
      if (isCancelled()) return
      if (!result.ok || !result.insight) throw new Error(result.error || 'AI 暂时没有返回研判')
      setAiInsight(result.insight)
    } catch (error) {
      if (!isCancelled()) setAiError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!isCancelled()) setAiLoading(false)
    }
  }
  useEffect(() => {
    if (!analysisKey) return
    let cancelled = false
    const timer = window.setTimeout(() => { void requestInsight(false, () => cancelled) }, 350)
    return () => { cancelled = true; window.clearTimeout(timer) }
  // analysisKey captures the selected instrument and every evidence version used in the request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKey])
  useEffect(() => {
    setAiInsight(null)
    setAiError('')
  }, [item?.code, period])
  useEffect(() => {
    if (!aiInsight || !bars.length) return
    let cancelled = false
    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await requestInsight(false, () => cancelled)
        if (!cancelled) schedule()
      }, MARKET_INSIGHT_REFRESH_MS + 500)
    }
    schedule()
    return () => { cancelled = true; window.clearTimeout(timer) }
  // A successful refresh changes generatedAt and restarts this five-minute window.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.code, period, aiInsight?.generatedAt, Boolean(bars.length)])
  if (!item) return <div className="panel-empty"><Activity size={20} /><strong>还没选择品种</strong><span>从关注列表点选一个，这里会显示行情和下单前检查。</span></div>
  const positive = item.changePercent >= 0
  return (
    <div className="market-insight-content">
      <MarketSwitcher items={watchlist} selectedCode={item.code} onSelect={onSelectItem} />
      <div className="insight-header">
        <div><span className="instrument-type">{item.type === 'cbond' ? '转债' : item.type.toUpperCase()}</span><strong>{item.name}</strong><small>{item.code} · {item.exchange}</small></div>
        <button className="icon-button ghost" title="查看详情" onClick={() => setDetails((value) => !value)} type="button"><MoreHorizontal size={16} /></button>
      </div>
      {details && <div className="insight-detail">{item.type.toUpperCase()} · {item.exchange} · 来源：{item.source === 'agent' ? 'AI 发现' : '我的关注'} · 评分 {item.score || '待评估'}</div>}
      <div className="price-row">
        <strong>{item.latestPrice > 0 ? priceText(item.latestPrice) : '--'}</strong>
        {item.latestPrice > 0 && <span className={positive ? 'up' : 'down'}>{positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{positive ? '+' : ''}{item.changePercent.toFixed(2)}%</span>}
      </div>
      <div className="market-meta"><span><span className="live-dot" />实时</span><span>成交额 {item.volume}</span><span>{item.refreshedAt}</span></div>

      <section className="ai-market-section">
        <div className="panel-section-title"><span className="ai-section-label"><Sparkles size={13} />AI 盘中买卖参考</span><button className="ai-refresh" disabled={aiLoading || !bars.length} title="按最新行情重新生成" onClick={() => { void requestInsight(true) }} type="button"><RefreshCw className={aiLoading ? 'spin' : ''} size={12} />{aiLoading ? '分析中' : '更新'}</button></div>
        {!bars.length && <div className="ai-insight-empty">{chartLoading ? '正在读取真实行情，完成后自动生成。' : chartError || '等待真实行情后再生成，不使用示例数据。'}</div>}
        {aiLoading && !aiInsight && <div className="ai-insight-loading"><span /><span /><span /></div>}
        {aiError && !aiInsight && <div className="ai-insight-error"><strong>AI 研判未生成</strong><span>{aiError}</span><button onClick={() => { void requestInsight(true) }} type="button">重试</button></div>}
        {aiInsight && <div className="ai-insight-card">
          <div className="ai-insight-status"><span className={`open-advice ${aiInsight.openPosition === '支持' ? 'pass' : aiInsight.openPosition === '不支持' ? 'blocked' : 'warn'}`}>开仓：{aiInsight.openPosition}</span><span className="ai-insight-summary"><strong>{aiInsight.stance}</strong><span>置信度 {aiInsight.confidence}</span></span><time title="每 5 分钟自动更新">{insightTime(aiInsight.generatedAt)} · 5分钟更新</time></div>
          <div className="ai-insight-block"><small>当前交易策略</small><p>{aiInsight.currentStrategy}</p></div>
          <div className="ai-trade-points">
            <div className="buy"><strong>AI 买入参考</strong>{aiInsight.buyPoints?.length ? aiInsight.buyPoints.map((point) => <div className="ai-trade-point" key={`${point.label}-${point.price}`}><span><b>{point.label}</b><em>{point.price}</em></span>{point.accountScope && <small>{point.accountScope}</small>}<p>{point.condition}</p></div>) : <p className="ai-point-empty">当前没有可靠买点，不行动。</p>}</div>
            <div className="sell"><strong>AI 卖出参考</strong>{aiInsight.sellPoints?.length ? aiInsight.sellPoints.map((point) => <div className="ai-trade-point" key={`${point.label}-${point.price}`}><span><b>{point.label}</b><em>{point.price}</em></span>{point.accountScope && <small>{point.accountScope}</small>}<p>{point.condition}</p></div>) : <p className="ai-point-empty">当前没有明确卖点。</p>}</div>
          </div>
          <div className="ai-insight-block"><small>今日走势研判</small><p>{aiInsight.todayOutlook}</p></div>
          {aiInsight.nextSessionStrategy && <div className="ai-insight-block next-session"><small>下一交易日策略</small><p>{aiInsight.nextSessionStrategy}</p></div>}
          {(aiInsight.triggers.length > 0 || aiInsight.invalidation.length > 0) && <div className="ai-condition-grid">
            <div><strong>触发条件</strong>{aiInsight.triggers.map((value) => <span key={value}>{value}</span>)}</div>
            <div><strong>失效条件</strong>{aiInsight.invalidation.map((value) => <span key={value}>{value}</span>)}</div>
          </div>}
          <div className="ai-insight-foot">只展示 AI 本次实时研判，不展示底层策略信号 · 仅作辅助决策</div>
        </div>}
      </section>

      <div className="chart-toolbar"><div>{([['timeline', '分时'], ['1m', '1分'], ['1d', '日K'], ['1w', '周K']] as const).map(([value, label]) => <button key={value} className={period === value ? 'active' : ''} onClick={() => onPeriod(value)} type="button">{label}</button>)}</div><span>{chartLoading ? '正在加载' : bars.length ? `${bars.length} 根已加载` : chartError || '等待行情'}</span></div>
      <MiniMarketChart item={item} bars={bars} period={period} emptyText={chartLoading ? '正在加载 K 线…' : chartError || '暂无 K 线数据'} />

      <section className="gate-section">
        <div className="panel-section-title"><span>下单前检查</span><button title="查看检查说明" onClick={() => setGateHelp((value) => !value)} type="button"><Info size={13} /></button></div>
        {gateHelp && <p className="gate-help">系统会依次检查行情、账户、交易状态、费用和规则。有一项没通过，就不会建议下单。</p>}
        <div className="gates">
          {gates.map((gate) => (
            <div className="gate" key={gate.id}>
              <span className={`gate-state ${gate.state}`} />
              <div><strong>{gate.label}</strong><small>{gate.detail}</small></div>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
