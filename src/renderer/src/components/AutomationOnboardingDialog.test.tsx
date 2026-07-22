import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AutomationOnboardingDialog } from './AutomationOnboardingDialog'

describe('AutomationOnboardingDialog', () => {
  it('清楚说明用途、安全边界和一键开启入口', () => {
    const html = renderToStaticMarkup(<AutomationOnboardingDialog taskCount={10} busy={false} onEnable={() => undefined} onDismiss={() => undefined} />)
    expect(html).toContain('要开启定时任务吗？')
    expect(html).toContain('10 个默认任务')
    expect(html).toContain('不会下单、撤单，也不会修改券商账户')
    expect(html).toContain('一键开启定时任务')
    expect(html).toContain('暂不开启')
  })

  it('开启中锁定操作并展示失败原因', () => {
    const html = renderToStaticMarkup(<AutomationOnboardingDialog taskCount={6} busy error="本地任务服务不可用" onEnable={() => undefined} onDismiss={() => undefined} />)
    expect(html).toContain('正在开启…')
    expect(html).toContain('本地任务服务不可用')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })
})
