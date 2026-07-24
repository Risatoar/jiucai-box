import type { ReviewDateRange, ReviewPeriod } from './review-types'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const parseDate = (value: string): Date => {
  if (!ISO_DATE_PATTERN.test(value)) throw new Error(`无效日期：${value}`)
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) throw new Error(`无效日期：${value}`)
  return date
}

const formatDate = (date: Date): string => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const addDays = (value: string, days: number): string => {
  const date = parseDate(value)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDate(date)
}

export const normalizeReviewSelection = (period: ReviewPeriod, value: string): string => {
  const date = parseDate(value)
  if (period === 'daily') return formatDate(date)
  if (period === 'monthly') {
    date.setUTCDate(1)
    return formatDate(date)
  }
  const mondayOffset = (date.getUTCDay() + 6) % 7
  return addDays(formatDate(date), -mondayOffset)
}

export const getNaturalReviewRange = (
  period: ReviewPeriod,
  selection: string
): Omit<ReviewDateRange, 'tradingDate'> => {
  const start = normalizeReviewSelection(period, selection)
  if (period === 'daily') return { start, end: start }
  if (period === 'weekly') return { start, end: addDays(start, 6) }
  const date = parseDate(start)
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  return { start, end: formatDate(date) }
}

export const getReviewDateRange = (
  period: ReviewPeriod,
  selection: string,
  today?: string
): ReviewDateRange => {
  const tradingDate = normalizeReviewSelection(period, selection)
  const natural = getNaturalReviewRange(period, tradingDate)
  const end = today && natural.start <= today && today < natural.end ? today : natural.end
  return { ...natural, end, tradingDate }
}

const readableDay = (value: string, includeYear = true): string => {
  const [year, month, day] = value.split('-').map(Number)
  return `${includeYear ? `${year}年` : ''}${month}月${day}日`
}

export const formatReviewSelection = (period: ReviewPeriod, selection: string): string => {
  const normalized = normalizeReviewSelection(period, selection)
  if (period === 'daily') return readableDay(normalized)
  if (period === 'monthly') {
    const [year, month] = normalized.split('-').map(Number)
    return `${year}年${month}月`
  }
  const { start, end } = getNaturalReviewRange(period, normalized)
  return `${readableDay(start)}—${readableDay(end, start.slice(0, 4) !== end.slice(0, 4))}`
}
