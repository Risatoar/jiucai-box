import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { MarketBar, StockStrategyCardData } from '../../../shared/types'
import { formatBarTime, formatVolume, movingAverage } from './kline-chart-utils'
import { cardFallbackPrice, parseStockBars, parseStockLiveQuote, type StockLiveQuote } from '../utils/stock-strategy-market'

const WIDTH = 520
const HEIGHT = 124
const LEFT = 8
const RIGHT = 48
const TOP = 10
const BOTTOM = 102
const priceText = (value: number) => value.toFixed(value < 10 ? 3 : 2)
const amountText = (value: number | null) => value == null ? '--' : value >= 100_000_000 ? `${(value / 100_000_000).toFixed(2)}亿` : value >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : String(Math.round(value))
const marketTime = (value: string | null) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'

function StrategyMiniKline({ bars }: { bars: MarketBar[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const visible = bars.slice(-48)
  const plot = useMemo(() => {
    if (!visible.length) return null
    const rawMin = Math.min(...visible.map((bar) => bar.low))
    const rawMax = Math.max(...visible.map((bar) => bar.high))
    const padding = Math.max((rawMax - rawMin) * .08, rawMax * .001)
    const min = rawMin - padding
    const max = rawMax + padding
    const step = (WIDTH - LEFT - RIGHT) / visible.length
    const x = (index: number) => LEFT + step * (index + .5)
    const y = (value: number) => TOP + (max - value) / Math.max(max - min, Number.EPSILON) * (BOTTOM - TOP)
    const ma5 = movingAverage(visible, 5)
    const maPath = ma5.reduce((path, value, index) => value == null ? path : `${path}${path ? ' L' : 'M'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`, '')
    return { min, max, step, x, y, maPath }
  }, [bars])
  if (!plot) return <div className="strategy-kline-empty">暂无 5 分钟 K 线</div>
  const activeIndex = hoverIndex ?? visible.length - 1
  const active = visible[activeIndex]
  const candleWidth = Math.max(2, Math.min(6, plot.step * .62))
  const grid = [plot.max, (plot.max + plot.min) / 2, plot.min]
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = (event.clientX - bounds.left) / Math.max(bounds.width, 1) * WIDTH
    setHoverIndex(Math.max(0, Math.min(visible.length - 1, Math.floor((pointerX - LEFT) / plot.step))))
  }

  return <div className="strategy-mini-kline">
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" onPointerMove={onPointerMove} onPointerLeave={() => setHoverIndex(null)} role="img" aria-label="5 分钟 K 线缩略图">
      {grid.map((price) => <g key={price}><line className="strategy-kline-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={plot.y(price)} y2={plot.y(price)} /><text x={WIDTH - RIGHT + 5} y={plot.y(price) + 3}>{priceText(price)}</text></g>)}
      {visible.map((bar, index) => {
        const x = plot.x(index)
        const top = plot.y(Math.max(bar.open, bar.close))
        const height = Math.max(1.2, Math.abs(plot.y(bar.open) - plot.y(bar.close)))
        return <g className={bar.close >= bar.open ? 'up' : 'down'} key={`${bar.time}-${index}`}><line x1={x} x2={x} y1={plot.y(bar.high)} y2={plot.y(bar.low)} /><rect x={x - candleWidth / 2} y={top} width={candleWidth} height={height} /></g>
      })}
      <path className="strategy-ma5" d={plot.maPath} />
      {hoverIndex != null && <line className="strategy-crosshair" x1={plot.x(activeIndex)} x2={plot.x(activeIndex)} y1={TOP} y2={BOTTOM} />}
      <text className="strategy-kline-time" x={LEFT} y={120}>{formatBarTime(visible[0].time, false)}</text>
      <text className="strategy-kline-time" textAnchor="end" x={WIDTH - RIGHT} y={120}>{formatBarTime(visible.at(-1)!.time, false)}</text>
    </svg>
    <div className="strategy-kline-readout"><strong>{formatBarTime(active.time, false)}</strong><span>开 {priceText(active.open)}</span><span>高 {priceText(active.high)}</span><span>低 {priceText(active.low)}</span><span>收 {priceText(active.close)}</span><span>量 {formatVolume(active.volume)}</span></div>
  </div>
}

export function StockStrategyMarket({ card }: { card: StockStrategyCardData }) {
  const [quote, setQuote] = useState<StockLiveQuote | null>(null)
  const [bars, setBars] = useState<MarketBar[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const runningRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!window.desktopApi || runningRef.current) return
    runningRef.current = true
    setRefreshing(true)
    try {
      const [quoteResult, barsResult] = await Promise.all([
        window.desktopApi.runTradeMaster('market', ['quote', '--code', card.code]),
        window.desktopApi.runTradeMaster('market', ['bars', '--code', card.code, '--period', '5m', '--limit', '80'])
      ])
      const nextQuote = quoteResult.ok ? parseStockLiveQuote(quoteResult.output) : null
      const nextBars = barsResult.ok ? parseStockBars(barsResult.output) : []
      if (nextQuote) setQuote(nextQuote)
      if (nextBars.length) setBars(nextBars)
      setError(nextQuote || nextBars.length ? '' : quoteResult.error || barsResult.error || '行情源暂未返回数据')
    } finally {
      runningRef.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [card.code])

  useEffect(() => {
    setQuote(null); setBars([]); setLoading(true); setError('')
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const latest = quote?.price ?? bars.at(-1)?.close ?? cardFallbackPrice(card)
  const change = quote?.changePercent ?? null
  return <section className="stock-live-market" aria-label={`${card.name}实时行情`}>
    <header><div><strong>实时行情</strong><span>5 分钟 K 线 · 30 秒自动刷新</span></div><button disabled={refreshing} onClick={() => void refresh()} title="立即刷新行情" type="button"><RefreshCw className={refreshing ? 'spin' : ''} size={12} />{refreshing ? '更新中' : '刷新'}</button></header>
    {loading && !quote && !bars.length ? <div className="stock-live-state"><span className="kline-loader" />正在读取真实行情</div> : error && !quote && !bars.length ? <div className="stock-live-state error">{error}</div> : <>
      <div className="stock-live-quote">
        <div className="stock-live-price"><strong>{latest == null ? '--' : priceText(latest)}</strong><span className={(change ?? 0) >= 0 ? 'up' : 'down'}>{change == null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}</span></div>
        <dl><div><dt>开</dt><dd title={quote?.open == null ? '--' : priceText(quote.open)}>{quote?.open == null ? '--' : priceText(quote.open)}</dd></div><div><dt>高</dt><dd title={quote?.high == null ? '--' : priceText(quote.high)}>{quote?.high == null ? '--' : priceText(quote.high)}</dd></div><div><dt>低</dt><dd title={quote?.low == null ? '--' : priceText(quote.low)}>{quote?.low == null ? '--' : priceText(quote.low)}</dd></div><div><dt>成交额</dt><dd title={amountText(quote?.amount ?? null)}>{amountText(quote?.amount ?? null)}</dd></div><div><dt>来源</dt><dd title={quote?.source || 'K 线行情'}>{quote?.source || 'K 线行情'}</dd></div><div><dt>时间</dt><dd title={marketTime(quote?.exchangeTime ?? bars.at(-1)?.time ?? null)}>{marketTime(quote?.exchangeTime ?? bars.at(-1)?.time ?? null)}</dd></div></dl>
      </div>
      <StrategyMiniKline bars={bars} />
    </>}
  </section>
}
