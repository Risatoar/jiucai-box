import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  formatReviewSelection,
  getNaturalReviewRange,
  normalizeReviewSelection
} from '../../../shared/review-period'
import type { ReviewPeriod } from '../../../shared/review-types'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

const toDate = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const toIso = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

interface DatePickerProps {
  value: string
  max?: string
  onChange: (value: string) => void
  placeholder?: string
  period?: ReviewPeriod
}

export function DatePicker({
  value,
  max,
  onChange,
  placeholder = '选择日期',
  period = 'daily'
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = value ? toDate(value) : new Date()
  const [viewYear, setViewYear] = useState(selected.getFullYear())
  const [viewMonth, setViewMonth] = useState(selected.getMonth())

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  useEffect(() => {
    setViewYear(selected.getFullYear())
    setViewMonth(selected.getMonth())
  }, [period, value])

  const maxDate = max ? toDate(max) : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay = new Date(viewYear, viewMonth + 1, 0)
  const leadingBlanks = firstDay.getDay()
  const daysInMonth = lastDay.getDate()

  const cells: (Date | null)[] = []
  for (let i = 0; i < leadingBlanks; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewYear, viewMonth, d))

  const goMonth = (delta: number) => {
    let m = viewMonth + delta
    let y = viewYear
    while (m < 0) { m += 12; y -= 1 }
    while (m > 11) { m -= 12; y += 1 }
    setViewYear(y); setViewMonth(m)
  }

  const pick = (d: Date) => {
    onChange(normalizeReviewSelection(period, toIso(d)))
    setOpen(false)
  }

  const pickMonth = (month: number) => {
    pick(new Date(viewYear, month, 1))
  }

  const displayValue = value ? formatReviewSelection(period, value) : placeholder
  const selectedRange = value ? getNaturalReviewRange(period, value) : null
  const dialogLabel = period === 'daily' ? '选择复盘日期' : period === 'weekly' ? '选择复盘周' : '选择复盘月份'
  const footerLabel = period === 'daily' ? '今天' : period === 'weekly' ? '本周' : '本月'
  const currentSelection = max || toIso(today)

  return (
    <div className={`dp-root dp-${period}`} ref={containerRef}>
      <button
        className="dp-trigger"
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`复盘日期：${displayValue}`}
      >
        <CalendarDays size={15} />
        <span className="dp-trigger-text">{displayValue}</span>
        <ChevronRight size={13} className={`dp-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="dp-popover" role="dialog" aria-label={dialogLabel}>
          <div className="dp-header">
            <button
              className="dp-nav"
              onClick={() => period === 'monthly' ? setViewYear((year) => year - 1) : goMonth(-1)}
              type="button"
              aria-label={period === 'monthly' ? '上一年' : '上个月'}
            ><ChevronLeft size={16} /></button>
            <div className="dp-title">{viewYear}年{period === 'monthly' ? '' : MONTH_NAMES[viewMonth]}</div>
            <button
              className="dp-nav"
              onClick={() => period === 'monthly' ? setViewYear((year) => year + 1) : goMonth(1)}
              type="button"
              aria-label={period === 'monthly' ? '下一年' : '下个月'}
            ><ChevronRight size={16} /></button>
          </div>

          {period === 'monthly' ? (
            <div className="dp-month-grid">
              {MONTH_NAMES.map((monthName, month) => {
                const monthDate = new Date(viewYear, month, 1)
                const maxMonth = max ? normalizeReviewSelection('monthly', max) : null
                const iso = toIso(monthDate)
                const disabled = maxMonth ? iso > maxMonth : false
                const isSelected = value
                  ? selected.getFullYear() === viewYear && selected.getMonth() === month
                  : false
                return (
                  <button
                    key={monthName}
                    className={`dp-month${isSelected ? ' selected' : ''}`}
                    disabled={disabled}
                    onClick={() => !disabled && pickMonth(month)}
                    type="button"
                  >
                    {monthName}
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <div className="dp-weekdays">
                {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
              </div>

              <div className="dp-grid">
                {cells.map((d, i) => {
                  if (d === null) return <span key={`blank-${i}`} className="dp-cell dp-empty" />
                  const afterMax = maxDate ? d > maxDate : false
                  const disabled = Boolean(afterMax)
                  const isToday = isSameDay(d, today)
                  const iso = toIso(d)
                  const isSelected = period === 'daily' && value ? isSameDay(d, selected) : false
                  const inSelectedWeek = period === 'weekly'
                    && selectedRange != null
                    && iso >= selectedRange.start
                    && iso <= selectedRange.end
                  return (
                    <button
                      key={iso}
                      className={`dp-cell${isSelected ? ' selected' : ''}${inSelectedWeek ? ' week-selected' : ''}${isToday && !isSelected ? ' today' : ''}${disabled ? ' disabled' : ''}`}
                      disabled={disabled}
                      onClick={() => !disabled && pick(d)}
                      type="button"
                    >
                      {d.getDate()}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="dp-footer">
            <span className="dp-footer-hint">
              {period === 'weekly' ? '点击任意一天选择整周' : period === 'monthly' ? '按自然月生成报告' : '按单个交易日生成报告'}
            </span>
            <button
              className="dp-today"
              onClick={() => pick(toDate(currentSelection))}
              type="button"
            >
              {footerLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
