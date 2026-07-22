import { useState, type FocusEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { MarketSignal } from '../../../shared/types'
import { marketSignalLevel, marketSignalTitle } from '../utils/market-signals'

interface SignalTraceMarkerProps {
  signal: MarketSignal
  x: number
  y: number
  timeLabel: string
  priceLabel: string
  onActiveChange?: (active: boolean) => void
}

const tooltipPosition = (x: number, y: number) => ({
  left: Math.max(8, Math.min(x + 12, window.innerWidth - 284)),
  top: Math.max(8, Math.min(y + 12, window.innerHeight - 210))
})

export function SignalTraceMarker({ signal, x, y, timeLabel, priceLabel, onActiveChange }: SignalTraceMarkerProps) {
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const showFromPointer = (event: PointerEvent<SVGGElement>) => { onActiveChange?.(true); setAnchor(tooltipPosition(event.clientX, event.clientY)) }
  const showFromFocus = (event: FocusEvent<SVGGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    onActiveChange?.(true); setAnchor(tooltipPosition(bounds.right, bounds.top + bounds.height / 2))
  }
  const title = marketSignalTitle(signal)
  return <>
    <g className="signal-trace-marker" aria-label={`${title}，${timeLabel}，价格${priceLabel}`} onBlur={() => { setAnchor(null); onActiveChange?.(false) }} onFocus={showFromFocus} onPointerEnter={showFromPointer} onPointerLeave={() => { setAnchor(null); onActiveChange?.(false) }} onPointerMove={showFromPointer} role="button" tabIndex={0}>
      <circle className="signal-trace-ring" cx={x} cy={y} r="6" />
      <circle className="signal-trace-dot" cx={x} cy={y} r="3.2" />
    </g>
    {anchor && createPortal(<div className="signal-trace-tooltip" role="tooltip" style={anchor}>
      <div className="signal-trace-tooltip-head"><span>信号溯源</span><em>{marketSignalLevel(signal)}</em></div>
      <strong>{title}</strong>
      <div className="signal-trace-meta"><span>{signal.period}</span><span>{timeLabel}</span><span>¥{priceLabel}</span>{signal.confidence != null && <span>{Math.round(signal.confidence * 100)}%</span>}</div>
      {signal.reasons.length > 0 && <div className="signal-trace-reasons">{signal.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>}
      {signal.invalidation && <p><b>失效：</b>{signal.invalidation}</p>}
      <small>{signal.kState === 'closed' ? '基于已闭合 K 线' : '形成中信号，仅作观察'}</small>
    </div>, document.body)}
  </>
}
