import { useMemo, type PointerEvent } from 'react'
import type { MarketBar } from '../../../shared/types'
import { calculateKdj, calculateMacd, calculateRsi, formatVolume } from './kline-chart-utils'

export type SubIndicator = 'VOL' | 'MACD' | 'KDJ' | 'RSI'

interface KlineIndicatorPaneProps {
  bars: MarketBar[]
  startIndex: number
  visibleCount: number
  hoverIndex: number | null
  indicator: SubIndicator
  onHover: (index: number | null) => void
}

const WIDTH = 1000
const HEIGHT = 142
const LEFT = 10
const RIGHT = 66
const TOP = 28
const BOTTOM = 124
const fixed = (value?: number | null) => value == null || !Number.isFinite(value) ? '--' : value.toFixed(2)

export function KlineIndicatorPane({ bars, startIndex, visibleCount, hoverIndex, indicator, onHover }: KlineIndicatorPaneProps) {
  const visibleBars = useMemo(() => bars.slice(startIndex, startIndex + visibleCount), [bars, startIndex, visibleCount])
  const macd = useMemo(() => calculateMacd(bars).slice(startIndex, startIndex + visibleCount), [bars, startIndex, visibleCount])
  const kdj = useMemo(() => calculateKdj(bars).slice(startIndex, startIndex + visibleCount), [bars, startIndex, visibleCount])
  const rsi = useMemo(() => calculateRsi(bars).slice(startIndex, startIndex + visibleCount), [bars, startIndex, visibleCount])
  const activeIndex = hoverIndex ?? Math.max(visibleBars.length - 1, 0)
  const step = (WIDTH - LEFT - RIGHT) / Math.max(visibleBars.length, 1)
  const x = (index: number) => LEFT + step * (index + 0.5)
  const numericValues = indicator === 'VOL' ? visibleBars.map((bar) => bar.volume)
    : indicator === 'MACD' ? macd.flatMap((value) => [value.dif, value.dea, value.histogram])
      : indicator === 'KDJ' ? kdj.flatMap((value) => [value.k, value.d, value.j])
        : rsi.filter((value): value is number => value != null)
  let min = indicator === 'VOL' || indicator === 'RSI' ? 0 : Math.min(0, ...numericValues)
  let max = indicator === 'RSI' ? 100 : indicator === 'VOL' ? Math.max(...numericValues, 1) : Math.max(0, ...numericValues)
  if (indicator === 'KDJ') { min = Math.min(-20, min); max = Math.max(120, max) }
  if (max - min < 1e-8) { max += .01; min -= .01 }
  const y = (value: number) => TOP + (max - value) / (max - min || 1) * (BOTTOM - TOP)
  const path = (items: Array<number | null>) => items.reduce((result, value, index) => value == null ? result : `${result}${result ? ' L' : 'M'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`, '')
  const resolvePointer = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerX = (event.clientX - bounds.left) / bounds.width * WIDTH
    onHover(Math.max(0, Math.min(visibleBars.length - 1, Math.floor((pointerX - LEFT) / step))))
  }
  const legend = (() => {
    if (indicator === 'VOL') return `VOL ${visibleBars[activeIndex] ? formatVolume(visibleBars[activeIndex].volume) : '--'}`
    if (indicator === 'MACD') return `MACD(12,26,9)  DIF ${fixed(macd[activeIndex]?.dif)}  DEA ${fixed(macd[activeIndex]?.dea)}  柱 ${fixed(macd[activeIndex]?.histogram)}`
    if (indicator === 'KDJ') return `KDJ(9,3,3)  K ${fixed(kdj[activeIndex]?.k)}  D ${fixed(kdj[activeIndex]?.d)}  J ${fixed(kdj[activeIndex]?.j)}`
    return `RSI(14)  ${fixed(rsi[activeIndex])}`
  })()

  return (
    <div className="indicator-pane">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" onPointerMove={resolvePointer} onPointerLeave={() => onHover(null)} role="img" aria-label={`${indicator} 技术指标`}>
        <rect width={WIDTH} height={HEIGHT} fill="transparent" />
        <text className="indicator-legend" x={LEFT} y={16}>{legend}</text>
        {[TOP, (TOP + BOTTOM) / 2, BOTTOM].map((value) => <line className="indicator-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={value} y2={value} key={value} />)}
        {indicator === 'VOL' && visibleBars.map((sourceBar, index) => {
          const volume = sourceBar.volume
          return <rect className={sourceBar?.close >= sourceBar?.open ? 'indicator-up' : 'indicator-down'} x={x(index) - Math.min(5, step * .32)} y={y(volume)} width={Math.max(1.5, Math.min(10, step * .64))} height={Math.max(1, BOTTOM - y(volume))} key={index} />
        })}
        {indicator === 'MACD' && <>
          <line className="indicator-zero" x1={LEFT} x2={WIDTH - RIGHT} y1={y(0)} y2={y(0)} />
          {macd.map((value, index) => <rect className={value.histogram >= 0 ? 'indicator-up' : 'indicator-down'} x={x(index) - Math.min(4, step * .28)} y={Math.min(y(value.histogram), y(0))} width={Math.max(1.2, Math.min(8, step * .56))} height={Math.max(1, Math.abs(y(value.histogram) - y(0)))} key={index} />)}
          <path className="indicator-line gold" d={path(macd.map((value) => value.dif))} />
          <path className="indicator-line blue" d={path(macd.map((value) => value.dea))} />
        </>}
        {indicator === 'KDJ' && <>
          <path className="indicator-line gold" d={path(kdj.map((value) => value.k))} />
          <path className="indicator-line blue" d={path(kdj.map((value) => value.d))} />
          <path className="indicator-line violet" d={path(kdj.map((value) => value.j))} />
        </>}
        {indicator === 'RSI' && <>
          <line className="indicator-threshold" x1={LEFT} x2={WIDTH - RIGHT} y1={y(70)} y2={y(70)} />
          <line className="indicator-threshold" x1={LEFT} x2={WIDTH - RIGHT} y1={y(30)} y2={y(30)} />
          <path className="indicator-line violet" d={path(rsi)} />
        </>}
        {hoverIndex != null && <line className="indicator-crosshair" x1={x(hoverIndex)} x2={x(hoverIndex)} y1={TOP} y2={BOTTOM} />}
        <text className="indicator-axis-label" x={WIDTH - RIGHT + 8} y={TOP + 3}>{indicator === 'VOL' ? formatVolume(max) : fixed(max)}</text>
        <text className="indicator-axis-label" x={WIDTH - RIGHT + 8} y={BOTTOM + 3}>{indicator === 'VOL' ? '0' : fixed(min)}</text>
      </svg>
    </div>
  )
}
