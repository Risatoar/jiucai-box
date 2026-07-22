import { describe, expect, it } from 'vitest'
import { shouldShowAutomationOnboarding } from './useAutomationOnboarding'

describe('automation onboarding prompt', () => {
  it('只向尚未处理且还没安装定时任务的新用户展示', () => {
    expect(shouldShowAutomationOnboarding('pending', 'planned')).toBe(true)
    expect(shouldShowAutomationOnboarding('pending', 'installed')).toBe(false)
    expect(shouldShowAutomationOnboarding('dismissed', 'planned')).toBe(false)
    expect(shouldShowAutomationOnboarding(null, 'planned')).toBe(false)
  })
})
