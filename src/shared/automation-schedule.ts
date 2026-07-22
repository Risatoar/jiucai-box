const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const MINUTE_MS = 60_000

export interface AutomationSchedule {
  kind?: string
  expression?: string
  times?: string[]
  interval_minutes?: number
  windows?: string[]
}

export interface AutomationTaskInput {
  title: string
  description: string
  prompt: string
  enabled: boolean
  schedule: AutomationSchedule
}

export interface ScheduledAutomationTask {
  enabled?: boolean
  schedule?: AutomationSchedule
  last_run_at?: string
  next_run_at?: string
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

const wallClock = (date: Date): WallClock => {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay()
  }
}

const wallDate = (year: number, month: number, day: number, hour: number, minute: number) => (
  new Date(Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MS)
)

const addWallDays = (clock: WallClock, days: number) => {
  const date = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + days))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay()
  }
}

const isWeekday = (weekday: number) => weekday >= 1 && weekday <= 5

const numberList = (value = '') => value.split(',')
  .map((item) => Number(item))
  .filter(Number.isInteger)

const validDate = (value?: string) => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const nextCronRun = (schedule: AutomationSchedule, task: ScheduledAutomationTask, now: Date) => {
  const [minuteText, hourText] = String(schedule.expression || '').split(' ')
  const minutes = numberList(minuteText).filter((minute) => minute >= 0 && minute <= 59)
  const hours = numberList(hourText).filter((hour) => hour >= 0 && hour <= 23)
  const explicitTimes = (schedule.times || []).flatMap((value) => {
    const matched = /^(\d{2}):(\d{2})$/.exec(value)
    if (!matched) return []
    const hour = Number(matched[1]); const minute = Number(matched[2])
    return hour <= 23 && minute <= 59 ? [{ hour, minute }] : []
  })
  if (!explicitTimes.length && (!minutes.length || !hours.length)) return null

  const current = wallClock(now)
  const lastRun = validDate(task.last_run_at)
  const candidates = (explicitTimes.length ? explicitTimes : hours.flatMap((hour) => minutes.map((minute) => ({ hour, minute }))))
    .sort((left, right) => left.hour - right.hour || left.minute - right.minute)

  for (let offset = 0; offset <= 8; offset += 1) {
    const day = addWallDays(current, offset)
    if (!isWeekday(day.weekday)) continue
    for (const time of candidates) {
      const minuteStart = wallDate(day.year, day.month, day.day, time.hour, time.minute)
      const minuteEnd = new Date(minuteStart.getTime() + MINUTE_MS)
      if (minuteEnd.getTime() <= now.getTime()) continue
      const alreadyRan = lastRun && lastRun >= minuteStart && lastRun < minuteEnd
      if (!alreadyRan) return minuteStart < now ? now : minuteStart
    }
  }
  return null
}

const parseWindow = (value: string) => {
  const matched = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!matched) return null
  const [, startHour, startMinute, endHour, endMinute] = matched.map(Number)
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null
  return { startHour, startMinute, endHour, endMinute }
}

const nextWindowRun = (schedule: AutomationSchedule, task: ScheduledAutomationTask, now: Date, weekdaysOnly: boolean) => {
  const windows = (schedule.windows || []).map(parseWindow).filter((window) => window !== null)
  if (!windows.length) return null
  const current = wallClock(now)
  const interval = Math.max(1, Number(schedule.interval_minutes) || 3) * MINUTE_MS
  const lastRun = validDate(task.last_run_at)
  const earliest = Math.max(now.getTime(), lastRun ? lastRun.getTime() + interval : now.getTime())

  for (let offset = 0; offset <= 8; offset += 1) {
    const day = addWallDays(current, offset)
    if (weekdaysOnly && !isWeekday(day.weekday)) continue
    for (const window of windows) {
      const start = wallDate(day.year, day.month, day.day, window.startHour, window.startMinute)
      const end = wallDate(day.year, day.month, day.day, window.endHour, window.endMinute)
      const candidate = new Date(Math.max(start.getTime(), earliest))
      if (candidate <= end) return candidate
    }
  }
  return null
}

export const nextAutomationRunAt = (task: ScheduledAutomationTask, now = new Date()): Date | null => {
  if (task.enabled === false) return null
  const declaredNextRun = validDate(task.next_run_at)
  if (declaredNextRun && declaredNextRun > now) return declaredNextRun
  if (task.schedule?.kind === 'cron') return nextCronRun(task.schedule, task, now)
  if (task.schedule?.kind === 'market_window') return nextWindowRun(task.schedule, task, now, true)
  if (task.schedule?.kind === 'daily_window') return nextWindowRun(task.schedule, task, now, false)
  return null
}

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const pad = (value: number) => String(value).padStart(2, '0')

export const formatAutomationRunAt = (date: Date) => {
  const clock = wallClock(date)
  return `${clock.year}/${pad(clock.month)}/${pad(clock.day)} ${weekdays[clock.weekday]} ${pad(clock.hour)}:${pad(clock.minute)}`
}
