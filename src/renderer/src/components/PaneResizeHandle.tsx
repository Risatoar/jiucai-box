import { useEffect, useRef } from 'react'
import type { PaneSide } from '../utils/pane-layout'

interface PaneResizeHandleProps {
  side: PaneSide
  value: number
  min: number
  max: number
  onPointerResize: (clientX: number) => void
  onKeyboardResize: (delta: number) => void
  onReset: () => void
}

export function PaneResizeHandle({ side, value, min, max, onPointerResize, onKeyboardResize, onReset }: PaneResizeHandleProps) {
  const cleanupDrag = useRef<() => void>(() => undefined)
  const label = side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度'
  useEffect(() => () => cleanupDrag.current(), [])

  return <div
    className={`pane-resize-handle ${side}`}
    role="separator"
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    tabIndex={0}
    title={`${label}，双击恢复默认`}
    onDoubleClick={onReset}
    onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      onKeyboardResize(side === 'left' ? direction * 12 : direction * -12)
    }}
    onPointerDown={(event) => {
      event.preventDefault()
      cleanupDrag.current()
      document.body.classList.add('is-resizing-pane')
      const move = (pointerEvent: PointerEvent) => onPointerResize(pointerEvent.clientX)
      const finish = () => {
        document.body.classList.remove('is-resizing-pane')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        window.removeEventListener('blur', finish)
        cleanupDrag.current = () => undefined
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
      window.addEventListener('blur', finish)
      cleanupDrag.current = finish
    }}
  ><span /></div>
}
