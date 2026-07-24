import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('default automation templates', () => {
  it('contains full-session candidate refresh and the 12:00 midday review', async () => {
    const path = join(process.cwd(), 'resources/trade-master/assets/automation-templates.json')
    const template = JSON.parse(await readFile(path, 'utf8')) as { tasks: Array<{ id: string; title: string; description: string; prompt?: string; schedule: Record<string, unknown> }> }
    expect(template.tasks.find((task) => task.id === 'candidate_refresh')).toMatchObject({ title: '盘中候选池刷新', description: '全市场筛选五类策略各2只，共10只候选，并单独标出买入就绪标的' })
    expect(template.tasks.find((task) => task.id === 'midday_review')).toMatchObject({ title: '午盘复盘', description: '总结上午盘面，并整理下午的操作重点' })
    expect(template.tasks.find((task) => task.id === 'pre_open_refresh')).toMatchObject({ description: '按持仓更新当日可用数量，并刷新账户、行情和关注品种' })
    expect(template.tasks.find((task) => task.id === 'intraday')).toMatchObject({ description: '监控持仓推荐级买卖信号，并扫描我的收藏和AI发现的高质量买点' })
    expect(template.tasks.find((task) => task.id === 'candidate_refresh')?.schedule).toEqual({
      kind: 'market_window', interval_minutes: 15, windows: ['09:30-11:30', '13:00-14:57']
    })
    expect(template.tasks.find((task) => task.id === 'midday_review')?.schedule).toEqual({ kind: 'cron', expression: '0 12 * * 1-5' })
    expect(template.tasks.find((task) => task.id === 'voc_monitor')).toMatchObject({
      title: '场外反指监控',
      schedule: { kind: 'daily_window', interval_minutes: 2, windows: ['07:00-23:30'] }
    })
    expect(template.tasks.find((task) => task.id === 'voc_monitor')?.prompt).toContain('加仓、减仓、清仓还是无明确动作')
    expect(template.tasks.find((task) => task.id === 'voc_monitor')?.prompt).toContain('今日和近7日总结')
    expect(template.tasks.find((task) => task.id === 'voc_monitor')?.prompt).toContain('不需要交叉验证具体证券、真实持仓、成交记录、价格、成交量、K线、完整收盘走势、手续费或交易成本')
    expect(template.tasks.find((task) => task.id === 'voc_monitor')?.prompt).toContain('不要输出用户持仓调整或买卖建议')
    expect(template.tasks.find((task) => task.id === 'voc_monitor')?.prompt).toContain('足球、篮球、竞彩、买球、娱乐和日常生活内容一律忽略')
    expect(template.tasks.find((task) => task.id === 'formal_close')?.description).toContain('1/3/7/15交易日信号结果')
    expect(template.tasks.find((task) => task.id === 'rolling_backtest')).toMatchObject({
      title: '滚动买卖点回测',
      schedule: { kind: 'cron', expression: '35 15 * * 1-5' }
    })
    expect(template.tasks.find((task) => task.id === 'rolling_backtest')?.description).toContain('公开固定25只')
    expect(template.tasks.find((task) => task.id === 'post_market')?.description).toContain('做T闭环')
    expect(template.tasks.find((task) => task.id === 'refine')?.description).toContain('80%')
    const runtime = await readFile(join(process.cwd(), 'resources/trade-master/scripts/dist/automation.js'), 'utf8')
    expect(runtime).toContain("task.id === 'pre_open_refresh'")
    expect(runtime).toContain('candidate_model_v2')
    expect(runtime).toContain("mode === 'voc_monitor'")
    expect(runtime).toContain('vocPromptNeedsUpgrade')
    expect(runtime).toContain('不需要交叉验证具体证券、真实账户持仓、实际成交、成交价格、成交量、K线、完整收盘走势、手续费或交易成本')
    expect(runtime).toContain('new_buy_signals')
    expect(runtime).toContain('source=user')
    expect(runtime).toContain('source=agent')
    expect(runtime).toContain('## 成员名 → 账户名')
    expect(runtime).toContain('同一证券存在于多个账户时也必须按账户分别生成策略卡')
    expect(runtime).toContain('账户内按标的聚合')
    expect(runtime).toContain('所有候选必须按单个标的聚合')
    expect(runtime).toContain('空仓账户固定写明')
    expect(runtime).toContain('反向指标只能提高风险警惕，不能单独触发交易')
    expect(runtime).toContain('1/3/7/15')
    expect(runtime).toContain("mode === 'rolling_backtest'")
    expect(runtime).toContain('七类场景')
    expect(runtime).toContain('95%置信下界')
    expect(runtime).toContain('signalReviewPromptNeedsUpgrade')
  })
})
