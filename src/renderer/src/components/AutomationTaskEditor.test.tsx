import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AutomationTask } from '../../../shared/types'
import { AutomationTaskEditor } from './AutomationTaskEditor'

const systemTask: AutomationTask = {
  id: 'pre_market', mode: 'pre_market', title: '盘前交易策略', description: '开盘前整理今天该看什么、该怎么做',
  prompt: '读取最新持仓和行情，没有变化返回 NO_REPLY。', enabled: true, isSystemDefault: true,
  schedule: '工作日 08:50', scheduleConfig: { kind: 'cron', times: ['08:50'] }, session: '结果保存在单独对话',
  state: 'healthy', lastRun: '尚无运行记录', nextRun: '2026/07/21 周二 08:50'
}

describe('AutomationTaskEditor', () => {
  it('shows task content and locks deletion for a system default task', () => {
    const html = renderToStaticMarkup(<AutomationTaskEditor task={systemTask} onClose={() => undefined} onSave={async () => ({ ok: true })} onDelete={async () => ({ ok: true })} />)
    expect(html).toContain('盘前交易策略')
    expect(html).toContain('读取最新持仓和行情，没有变化返回 NO_REPLY。')
    expect(html).toContain('系统任务不可删除')
    expect(html).toMatch(/automation-delete-button[^>]*disabled/)
  })

  it('provides safe defaults when creating a custom task', () => {
    const html = renderToStaticMarkup(<AutomationTaskEditor task={null} onClose={() => undefined} onSave={async () => ({ ok: true })} onDelete={async () => ({ ok: true })} />)
    expect(html).toContain('新建定时任务')
    expect(html).toContain('09:30')
    expect(html).toContain('NO_REPLY')
    expect(html).not.toContain('系统任务不可删除')
  })
})
