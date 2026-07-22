import { describe, expect, it } from 'vitest'
import { buildAutomationNotificationPayload, shouldSendAutomationNotification } from './automation-notification'

describe('automation notification', () => {
  it('keeps the complete household strategy in the Feishu payload', () => {
    const owner = `## 我 → 我的主账户\n主账户策略：${'主账户内容'.repeat(180)}`
    const spouse = '## 老婆 → 老婆的账户\n老婆账户策略：鹏辉能源进入分阶段减仓观察区'
    const result = `${owner}\n\n${spouse}`
    const payload = buildAutomationNotificationPayload('intraday', 'intraday', result, new Date('2026-07-21T03:15:00.000Z'))
    expect(payload.summary).toBe(result)
    expect(payload.summary).toContain('## 我 → 我的主账户')
    expect(payload.summary).toContain(spouse)
    expect(payload.summary.indexOf('## 我 → 我的主账户')).toBeLessThan(payload.summary.indexOf('## 老婆 → 老婆的账户'))
    expect(payload.summary.length).toBeGreaterThan(450)
  })

  it('only sends scheduled results to Feishu', () => {
    expect(shouldSendAutomationNotification('manual', '老婆账户存在卖出风险')).toBe(false)
    expect(shouldSendAutomationNotification('scheduled', '老婆账户存在卖出风险')).toBe(true)
  })
})
