import { ChevronUp, Minus, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState, type PointerEvent, type WheelEvent } from 'react'
import type { ChartPeriod, MarketBar, WatchItem } from '../../../shared/types'
import { KlineIndicatorPane, type SubIndicator } from './KlineIndicatorPane'
import { bollingerBands, clampVisibleCount, cumulativeAveragePrice, exponentialMovingAverage, formatBarTime, formatVolume, movingAverage } from './kline-chart-utils'

interface KlineDetailPanelProps {
  item: WatchItem
  bars: MarketBar[]
  period: ChartPeriod
  loading: boolean
  error: string
  refreshedAt: string
  onPeriod: (period: ChartPeriod) => void
  onClose: () => void
}

type MainIndicator = 'MA' | 'EMA' | 'BOLL'
const periods: Array<[ChartPeriod, string]> = [
  ['timeline', '分时'], ['1m', '1分'], ['5m', '5分'], ['15m', '15分'], ['30m', '30分'],
  ['60m', '60分'], ['120m', '120分'], ['five_day', '五日'], ['1d', '日K'], ['1w', '周K'], ['1M', '月K']
]
const subIndicators: SubIndicator[] = ['VOL', 'MACD', 'KDJ', 'RSI']
const WIDTH = 1000
const HEIGHT = 338
const LEFT = 10
const RIGHT = 66
const PRICE_TOP = 18
const PRICE_BOTTOM = 300

const priceDigits = (value: number) => value < 10 ? 3 : 2
const priceText = (value: number) => value.toFixed(priceDigits(value))
const periodLabel = (period: ChartPeriod) => periods.find(([value]) => value === period)?.[1] || period

export function KlineDetailPanel({ item, bars, period, loading, error, refreshedAt, onPeriod, onClose }: KlineDetailPanelProps) {
  const [visibleCount, setVisibleCount] = useState(72)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [mainIndicators, setMainIndicators] = useState<MainIndicator[]>(['MA'])
  const [subIndicator, setSubIndicator] = useState<SubIndicator>('MACD')
  useEffect(() => { setVisibleCount(period === 'timeline' || period === 'five_day' ? 300 : 72); setHoverIndex(null) }, [item.code, period])

  const actualVisibleCount = clampVisibleCount(visibleCount, bars.length)
  const startIndex = Math.max(0, bars.length - actualVisibleCount)
  const visibleBars = useMemo(() => bars.slice(startIndex), [bars, startIndex])
  const series = useMemo(() => {
    const closes = bars.map((bar) => bar.close)
    const boll = bollingerBands(bars)
    return {
      ma5: movingAverage(bars, 5).slice(startIndex),
      ma20: movingAverage(bars, 20).slice(startIndex),
      ema12: exponentialMovingAverage(closes, 12).slice(startIndex),
      ema26: exponentialMovingAverage(closes, 26).slice(startIndex),
      bollUpper: boll.map((value) => value.upper).slice(startIndex),
      bollMiddle: boll.map((value) => value.middle).slice(startIndex),
      bollLower: boll.map((value) => value.lower).slice(startIndex),
      average: cumulativeAveragePrice(bars).slice(startIndex)
    }
  }, [bars, startIndex])
  const plot = useMemo(() => {
    if (!visibleBars.length) return null
    const overlayValues = [
      ...(mainIndicators.includes('MA') ? [...series.ma5, ...series.ma20] : []),
      ...(mainIndicators.includes('EMA') ? [...series.ema12, ...series.ema26] : []),
      ...(mainIndicators.includes('BOLL') ? [...series.bollUpper, ...series.bollMiddle, ...series.bollLower] : []),
      ...(period === 'timeline' || period === 'five_day' ? series.average : [])
    ].filter((value): value is number => value != null && Number.isFinite(value))
    const prices = [...visibleBars.flatMap((bar) => [bar.high, bar.low]), ...overlayValues]
    const rawMin = Math.min(...prices)
    const rawMax = Math.max(...prices)
    const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.002)
    const min = rawMin - padding
    const max = rawMax + padding
    const step = (WIDTH - LEFT - RIGHT) / visibleBars.length
    const y = (price: number) => PRICE_TOP + (max - price) / (max - min || 1) * (PRICE_BOTTOM - PRICE_TOP)
    const x = (index: number) => LEFT + step * (index + 0.5)
    const path = (values: Array<number | null>) => values.reduce((result, value, index) => value == null ? result : `${result}${result ? ' L' : 'M'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`, '')
    const closePath = path(visibleBars.map((bar) => bar.close))
    const areaPath = closePath ? `${closePath} L ${x(visibleBars.length - 1)} ${PRICE_BOTTOM} L ${x(0)} ${PRICE_BOTTOM} Z` : ''
    return { min, max, step, x, y, path, closePath, areaPath }
  }, [visibleBars, series, mainIndicators, period])
  const activeBar = hoverIndex == null ? visibleBars.at(-1) : visibleBars[hoverIndex]
  const activeGlobalIndex = startIndex + (hoverIndex ?? Math.max(visibleBars.length - 1, 0))
  const previousClose = activeGlobalIndex > 0 ? bars[activeGlobalIndex - 1]?.close : undefined
  const activeChange = activeBar && previousClose ? (activeBar.close / previousClose - 1) * 100 : item.changePercent
  const zoom = (delta: number) => setVisibleCount((current) => clampVisibleCount(current + delta, bars.length))
  const toggleMainIndicator = (indicator: MainIndicator) => setMainIndicators((current) => current.includes(indicator) ? current.filter((item) => item !== indicator) : [...current, indicator])
  const resolvePointer = (event: PointerEvent<SVGSVGElement>) => {
    if (!plot) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = (event.clientX - bounds.left) / bounds.width * WIDTH
    setHoverIndex(Math.max(0, Math.min(visibleBars.length - 1, Math.floor((pointerX - LEFT) / plot.step))))
  }
  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    zoom(event.deltaY > 0 ? 12 : -12)
  }
  const tone = activeChange >= 0 ? 'up' : 'down'
  const priceGrid = plot ? Array.from({ length: 5 }, (_, index) => plot.max - (plot.max - plot.min) * index / 4) : []
  const timeIndexes = visibleBars.length ? [...new Set([0, Math.floor((visibleBars.length - 1) / 2), visibleBars.length - 1])] : []
  const dailyAxis = ['1d', '1w', '1M'].includes(period)

  return (
    <section className="kline-detail" aria-label={`${item.name} K 线详情`}>
      <header className="kline-header">
        <div className="kline-identity"><span className="asset-badge">{item.type === 'cbond' ? '债' : item.type === 'etf' ? 'E' : '股'}</span><div><strong>{item.name}</strong><small>{item.code} · {item.exchange}</small></div></div>
        <div className="kline-readout">
          <span><small>开</small><b>{activeBar ? priceText(activeBar.open) : '--'}</b></span>
          <span><small>高</small><b className="up">{activeBar ? priceText(activeBar.high) : '--'}</b></span>
          <span><small>低</small><b className="down">{activeBar ? priceText(activeBar.low) : '--'}</b></span>
          <span><small>收</small><b className={tone}>{activeBar ? priceText(activeBar.close) : '--'}</b></span>
          <span><small>涨跌</small><b className={tone}>{activeBar ? `${activeChange >= 0 ? '+' : ''}${activeChange.toFixed(2)}%` : '--'}</b></span>
          <span><small>成交量</small><b>{activeBar ? formatVolume(activeBar.volume) : '--'}</b></span>
        </div>
        <button className="icon-button ghost kline-collapse" title="收起 K 线" aria-label="收起 K 线" onClick={onClose} type="button"><ChevronUp size={16} /></button>
      </header>
      <>
        <div className="kline-toolbar">
          <div className="kline-periods" aria-label="K 线周期">{periods.map(([value, label]) => <button className={period === value ? 'active' : ''} onClick={() => onPeriod(value)} key={value} type="button">{label}</button>)}</div>
          <div className="kline-tools"><span>{loading ? '更新中…' : refreshedAt ? `${refreshedAt} 更新` : '等待行情'}</span><button className="icon-button ghost" disabled={!bars.length} onClick={() => zoom(12)} title="缩小区间" aria-label="缩小区间" type="button"><Minus size={14} /></button><button className="icon-button ghost" disabled={!bars.length} onClick={() => zoom(-12)} title="放大区间" aria-label="放大区间" type="button"><Plus size={14} /></button><button className="icon-button ghost" disabled={!bars.length} onClick={() => setVisibleCount(period === 'timeline' || period === 'five_day' ? 300 : 72)} title="重置缩放" aria-label="重置缩放" type="button"><RotateCcw size={13} /></button></div>
        </div>
        <div className="indicator-toolbar" aria-label="技术指标">
          <span>主图</span>{(['MA', 'EMA', 'BOLL'] as const).map((value) => <button className={mainIndicators.includes(value) ? 'active' : ''} onClick={() => toggleMainIndicator(value)} key={value} type="button">{value}</button>)}
          <i />
          <span>副图</span>{subIndicators.map((value) => <button className={subIndicator === value ? 'active' : ''} onClick={() => setSubIndicator(value)} key={value} type="button">{value}</button>)}
        </div>
        <div className="kline-canvas-wrap">
          {loading && !bars.length ? <div className="kline-state"><span className="kline-loader" /><strong>正在加载真实行情</strong><small>读取 {periodLabel(period)} 数据</small></div> : error && !bars.length ? <div className="kline-state error"><strong>暂时无法显示 K 线</strong><small>{error}</small></div> : plot ? (
            <svg className="kline-canvas" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" onPointerMove={resolvePointer} onPointerLeave={() => setHoverIndex(null)} onWheel={handleWheel} role="img" aria-label={`${item.name}${periodLabel(period)}图`}>
              <defs><linearGradient id={`timeline-fill-${item.code}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c94942" stopOpacity=".18" /><stop offset="1" stopColor="#c94942" stopOpacity="0" /></linearGradient></defs>
              <rect width={WIDTH} height={HEIGHT} fill="transparent" />
              {priceGrid.map((price) => <g key={price}><line className="kline-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={plot.y(price)} y2={plot.y(price)} /><text className="kline-axis-label" x={WIDTH - RIGHT + 8} y={plot.y(price) + 3}>{priceText(price)}</text></g>)}
              {period === 'timeline' || period === 'five_day' ? <><path className="timeline-area" fill={`url(#timeline-fill-${item.code})`} d={plot.areaPath} /><path className="timeline-line" d={plot.closePath} /><path className="average-line" d={plot.path(series.average)} /></> : visibleBars.map((bar, index) => {
                const x = plot.x(index); const candleWidth = Math.max(2, Math.min(10, plot.step * .62)); const bodyTop = plot.y(Math.max(bar.open, bar.close)); const bodyHeight = Math.max(1.4, Math.abs(plot.y(bar.open) - plot.y(bar.close)))
                return <g className={bar.close >= bar.open ? 'candle-up' : 'candle-down'} key={`${bar.time}-${index}`}><line className="candle-wick" x1={x} x2={x} y1={plot.y(bar.high)} y2={plot.y(bar.low)} /><rect className="candle-body" x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} /></g>
              })}
              {mainIndicators.includes('MA') && <><path className="ma-line ma5" d={plot.path(series.ma5)} /><path className="ma-line ma20" d={plot.path(series.ma20)} /></>}
              {mainIndicators.includes('EMA') && <><path className="ma-line ema12" d={plot.path(series.ema12)} /><path className="ma-line ema26" d={plot.path(series.ema26)} /></>}
              {mainIndicators.includes('BOLL') && <><path className="ma-line boll-upper" d={plot.path(series.bollUpper)} /><path className="ma-line boll-middle" d={plot.path(series.bollMiddle)} /><path className="ma-line boll-lower" d={plot.path(series.bollLower)} /></>}
              {timeIndexes.map((index) => <text className="kline-time-label" textAnchor={index === 0 ? 'start' : index === visibleBars.length - 1 ? 'end' : 'middle'} x={plot.x(index)} y={326} key={index}>{formatBarTime(visibleBars[index].time, dailyAxis)}</text>)}
              {hoverIndex != null && activeBar && <g className="crosshair"><line x1={plot.x(hoverIndex)} x2={plot.x(hoverIndex)} y1={PRICE_TOP} y2={PRICE_BOTTOM} /><line x1={LEFT} x2={WIDTH - RIGHT} y1={plot.y(activeBar.close)} y2={plot.y(activeBar.close)} /><rect x={WIDTH - RIGHT} y={plot.y(activeBar.close) - 9} width={RIGHT} height={18} /><text x={WIDTH - RIGHT + 6} y={plot.y(activeBar.close) + 3}>{priceText(activeBar.close)}</text></g>}
            </svg>
          ) : null}
        </div>
        {bars.length > 0 && <KlineIndicatorPane bars={bars} startIndex={startIndex} visibleCount={visibleBars.length} hoverIndex={hoverIndex} indicator={subIndicator} onHover={setHoverIndex} />}
        <footer className="kline-footer"><span>{visibleBars.length ? `${periodLabel(period)} · 显示 ${visibleBars.length} / ${bars.length} 根` : '暂无行情'}</span><span>滚轮缩放 · 悬浮联动主图与指标</span></footer>
      </>
    </section>
  )
}
