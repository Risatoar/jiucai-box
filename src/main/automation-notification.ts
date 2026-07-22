export interface AutomationNotificationPayload {
  mode: string
  severity: 'info' | 'warning'
  title: string
  summary: string
  fingerprint: string
}

export const shouldSendAutomationNotification = (trigger: 'manual' | 'scheduled', result: string) =>
  trigger === 'scheduled' && /(买入|卖出|止损|风险|故障)/.test(result)

export const buildAutomationNotificationPayload = (taskId: string, mode: string, result: string, now = new Date(), taskTitle?: string): AutomationNotificationPayload => ({
  mode,
  severity: /风险|止损|故障/.test(result) ? 'warning' : 'info',
  title: `韭菜盒子 · ${taskTitle || taskId}`,
  summary: result,
  fingerprint: `${taskId}-${now.toISOString().slice(0, 16)}`
})
