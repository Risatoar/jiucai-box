import { describe, expect, it } from 'vitest'
import { nextAutomationRunAt } from './automation-schedule'

describe('automation schedule', () => {
  it('schedules the midday review at 12:00 Asia/Shanghai', () => {
    const next = nextAutomationRunAt({ enabled: true, schedule: { kind: 'cron', expression: '0 12 * * 1-5' } }, new Date('2026-07-21T03:59:30.000Z'))
    expect(next?.toISOString()).toBe('2026-07-21T04:00:00.000Z')
  })

  it('keeps candidate refresh inside both market sessions', () => {
    const task = { enabled: true, schedule: { kind: 'market_window', interval_minutes: 15, windows: ['09:30-11:30', '13:00-14:57'] } }
    expect(nextAutomationRunAt(task, new Date('2026-07-21T03:31:00.000Z'))?.toISOString()).toBe('2026-07-21T05:00:00.000Z')
    expect(nextAutomationRunAt(task, new Date('2026-07-21T05:02:00.000Z'))?.toISOString()).toBe('2026-07-21T05:02:00.000Z')
  })

  it('runs an all-day VOC window on weekends', () => {
    const task = { enabled: true, schedule: { kind: 'daily_window', interval_minutes: 2, windows: ['07:00-23:30'] } }
    expect(nextAutomationRunAt(task, new Date('2026-07-25T01:00:00.000Z'))?.toISOString()).toBe('2026-07-25T01:00:00.000Z')
  })
})
