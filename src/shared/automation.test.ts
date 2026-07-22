import { describe, expect, it } from 'vitest'
import { automationSessionId, automationTaskTitle, isAutomationSessionId, isSystemAutomationTask } from './automation'

describe('automation helpers', () => {
  it('builds stable safe session ids and task titles', () => {
    expect(automationSessionId('pre_market')).toBe('automation-pre_market')
    expect(automationSessionId('../bad task')).toBe('automation-bad-task')
    expect(isAutomationSessionId('automation-intraday')).toBe(true)
    expect(isAutomationSessionId('normal-automation-chat')).toBe(false)
    expect(automationTaskTitle('pre_market')).toBe('盘前交易策略')
    expect(automationTaskTitle('candidate_refresh')).toBe('盘中候选池刷新')
    expect(automationTaskTitle('midday_review')).toBe('午盘复盘')
    expect(isSystemAutomationTask('candidate_refresh')).toBe(true)
    expect(isSystemAutomationTask('midday_review')).toBe(true)
  })
})
