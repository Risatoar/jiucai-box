import { describe, expect, it } from 'vitest'
import { automationsFromSnapshot, disciplineLabel, feishuConfigFromSnapshot, gatesFromSnapshot, notificationEventsFromSnapshot, strategiesFromSnapshot } from './snapshot'

describe('notificationEventsFromSnapshot', () => {
  it('maps real audit fields, delivery evidence and newest-first order', () => {
    const notifications = notificationEventsFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null, automation: null,
      strategies: null, strategyCandidates: null, evolution: null,
      notificationAudit: { events: [
        { sent_at: '2026-07-20T06:39:11Z', mode: 'intraday', severity: 'warning', title: '候选闭合结构失效', fingerprint: 'first' },
        { sent_at: '2026-07-20T07:20:02Z', mode: 'post_market', severity: 'info', title: '盘后复盘完成', message_id: 'delivered' }
      ] }
    })

    expect(notifications).toMatchObject([
      { title: '盘后复盘完成', modeLabel: '盘后复盘', delivered: true },
      { title: '候选闭合结构失效', modeLabel: '盘中盯盘', severity: 'warning', delivered: false }
    ])
  })
})

describe('disciplineLabel', () => {
  it.each([
    ['NORMAL', '正常'],
    ['CAUTION', '警戒'],
    ['COOLDOWN', '冷静期'],
    ['STOPPED', '已停手'],
    ['UNKNOWN', '未知']
  ])('maps %s to its Chinese label', (state, label) => {
    expect(disciplineLabel(state)).toBe(label)
  })

  it('does not expose an unknown English enum', () => {
    expect(disciplineLabel('NEW_STATE')).toBe('未知状态')
  })

  it('uses the Chinese label in the discipline gate', () => {
    const gates = gatesFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: { state: 'CAUTION' }, strategyProfile: null, notifications: null, automation: null,
      strategies: null, strategyCandidates: null, evolution: null
    }, null)

    expect(gates.find((gate) => gate.id === 'discipline')).toMatchObject({ state: 'warn', detail: '警戒' })
  })
})

describe('strategiesFromSnapshot', () => {
  it('maps real active and candidate rules without inventing performance', () => {
    const strategies = strategiesFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null, automation: null,
      strategies: { version: '1.0.0', rules: [{ id: 'LR-1', instrument_type: 'cbond', warning_period: '1m', confirmation_period: '5m', require_closed_bar: true }] },
      strategyCandidates: [{ id: 'candidate-etf', target_rule: 'etf.fast_move_pressure_and_hard_risk_override', status: 'collecting_evidence', note: '等待验证', evidence: { history_samples: 12, out_of_sample_samples: 3, shadow_days: 2, profit_factor: 0.9 } }],
      evolution: { rules: [{ id: 'notify-change', title: '材料变化通知', category: 'output', description: '只报告变化' }] }
    })
    expect(strategies).toHaveLength(3)
    expect(strategies[0].instruments).toEqual(['cbond'])
    expect(strategies[1].name).toBe('ETF 快速涨跌应对')
    expect(strategies[1].evidence).toEqual({ history: 12, outOfSample: 3, shadowDays: 2 })
    expect(strategies[1].performance.profitFactor).toBe(0.9)
    expect(strategies.every((strategy) => strategy.performance.winRate === 0)).toBe(true)
  })
})

describe('automationsFromSnapshot', () => {
  it('allows a planned task to be tested manually before system scheduling is installed', () => {
    const tasks = automationsFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null,
      strategies: null, strategyCandidates: null, evolution: null,
      automation: { install_status: 'planned', tasks: [{ id: 'pre_market', mode: 'pre_market', enabled: true }] }
    })

    expect(tasks).toMatchObject([{ id: 'pre_market', enabled: true, state: 'idle', nextRun: '待安装' }])
  })

  it('keeps a disabled task unavailable for manual runs', () => {
    const tasks = automationsFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null,
      strategies: null, strategyCandidates: null, evolution: null,
      automation: { install_status: 'installed', tasks: [{ id: 'intraday', mode: 'intraday', enabled: false }] }
    })

    expect(tasks[0]).toMatchObject({ enabled: false, nextRun: '已停用' })
  })

  it('localizes system task machine names and generic descriptions', () => {
    const tasks = automationsFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-21T01:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null,
      strategies: null, strategyCandidates: null, evolution: null,
      automation: { install_status: 'installed', tasks: [
        { id: 'candidate_refresh', mode: 'candidate_refresh', title: 'candidate_refresh', description: '按设定时间自动检查并提醒' },
        { id: 'midday_review', mode: 'midday_review', title: 'midday_review', description: '按设定时间自动检查并提醒' }
      ] }
    })

    expect(tasks).toMatchObject([
      { title: '盘中候选池刷新', description: '全市场筛选五类策略各2只，共10只候选，并单独标出上涨关注标的' },
      { title: '午盘复盘', description: '总结上午盘面，并整理下午的操作重点' }
    ])
  })

  it('shows the next concrete cron time in Beijing time', () => {
    const tasks = automationsFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:49:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null,
      strategies: null, strategyCandidates: null, evolution: null,
      automation: { install_status: 'installed', tasks: [{ id: 'pre_market', mode: 'pre_market', enabled: true, schedule: { kind: 'cron', expression: '50 8 * * 1-5' } }] }
    })

    expect(tasks[0].nextRun).toBe('2026/07/20 周一 08:50')
  })

  it('moves a finished cron minute to the next weekday', () => {
    const tasks = automationsFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-24T00:51:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null,
      strategies: null, strategyCandidates: null, evolution: null,
      automation: { install_status: 'installed', tasks: [{ id: 'pre_market', mode: 'pre_market', enabled: true, schedule: { kind: 'cron', expression: '50 8 * * 1-5' } }] }
    })

    expect(tasks[0].nextRun).toBe('2026/07/27 周一 08:50')
  })

  it('shows the next market opening after the trading windows close', () => {
    const tasks = automationsFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T08:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null,
      strategies: null, strategyCandidates: null, evolution: null,
      automation: { install_status: 'installed', tasks: [{
        id: 'intraday', mode: 'intraday', enabled: true,
        schedule: { kind: 'market_window', interval_minutes: 3, windows: ['09:30-11:30', '13:00-14:57'] }
      }] }
    })

    expect(tasks[0].nextRun).toBe('2026/07/21 周二 09:30')
  })

  it('maps a custom task with editable content and explicit run times', () => {
    const tasks = automationsFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-21T01:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, notifications: null,
      strategies: null, strategyCandidates: null, evolution: null,
      automation: { install_status: 'installed', tasks: [{
        id: 'custom-lunch', mode: 'custom', title: '午间检查', description: '检查午间风险', prompt: '读取最新持仓，没有变化返回 NO_REPLY。', enabled: true,
        schedule: { kind: 'cron', times: ['11:25'] }
      }] }
    })

    expect(tasks[0]).toMatchObject({
      title: '午间检查', description: '检查午间风险', prompt: '读取最新持仓，没有变化返回 NO_REPLY。',
      isSystemDefault: false, schedule: '工作日 11:25', nextRun: '2026/07/21 周二 11:25'
    })
  })
})

describe('feishuConfigFromSnapshot', () => {
  it('reuses an enabled private notification configuration', () => {
    const config = feishuConfigFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, automation: null,
      strategies: null, strategyCandidates: null, evolution: null,
      notifications: {
        enabled: true,
        receiver: { type: 'user_id', id: 'ou_current_user' },
        identity: 'bot',
        cli_path: '/opt/lark-cli',
        duplicate_window_minutes: 60
      }
    })

    expect(config).toEqual({
      receiverType: 'user_id', receiverId: 'ou_current_user', identity: 'bot',
      cliPath: '/opt/lark-cli', duplicateWindowMinutes: 60
    })
  })

  it('does not expose an incomplete notification configuration as connected', () => {
    expect(feishuConfigFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, automation: null,
      strategies: null, strategyCandidates: null, evolution: null,
      notifications: { enabled: true, receiver: { type: 'user_id', id: '' } }
    })).toBeNull()
  })

  it('keeps the readable label of a configured group', () => {
    expect(feishuConfigFromSnapshot({
      home: '/tmp/trade-master', userProfile: null, loadedAt: '2026-07-20T00:00:00Z', errors: [],
      portfolio: null, watchlist: null, goals: null, discipline: null, strategyProfile: null, automation: null,
      strategies: null, strategyCandidates: null, evolution: null,
      notifications: { enabled: true, receiver: { type: 'chat_id', id: 'oc_trading', label: '交易提醒群' } }
    })).toMatchObject({ receiverType: 'chat_id', receiverId: 'oc_trading', receiverLabel: '交易提醒群' })
  })
})
