import { describe, expect, it } from 'vitest'
import type { TradeMasterSnapshot } from '../shared/types'
import { buildAutomationSystemPrompt, INTRADAY_SCOPE_INSTRUCTION } from './automation-prompt'

describe('automation system prompt', () => {
  it('keeps VOC monitoring independent from trade execution validation', () => {
    const prompt = buildAutomationSystemPrompt('voc_monitor', '本轮只处理 newEvents。', {} as TradeMasterSnapshot)

    expect(prompt).toContain('场外反指观察助手，不是交易执行助手')
    expect(prompt).toContain('不需要交叉验证具体证券、真实账户持仓、实际成交、成交价格、成交量、K线、完整收盘走势、手续费或交易成本')
    expect(prompt).toContain('缺少这些数据不会让反指推测失效')
    expect(prompt).not.toContain('当前交易记录')
    expect(prompt).not.toContain('accountScope')
    expect(prompt).not.toContain('daily_account_state')
  })

  it('requires account and instrument aggregation for trading automations', () => {
    const prompt = buildAutomationSystemPrompt('intraday', '盘中双通道。', {} as TradeMasterSnapshot)

    expect(prompt).toContain('账户内按标的聚合')
    expect(prompt).toContain('每个标的的结论、当前价和数据时间、策略、触发条件、失效条件、风险、下一检查点必须放在同一个连续区块内')
    expect(prompt).toContain('禁止先列全部标的')
    expect(prompt).toContain('主账户空仓时仍必须每轮完整扫描我的收藏和AI发现')
    expect(prompt).toContain('所有 monitoring_enabled=true 的账户都必须出现')
    expect(prompt).toContain('source=user/agent')
    expect(prompt).toContain('immediate_buy/immediate_sell/strong_buy/strong_sell/prepare_buy/prepare_sell/watch')
    expect(prompt).toContain('形成中的K线、单纯触价、证据不足只能写 watch')
    expect(prompt).toContain('executionStatus=ready')
    expect(prompt).toContain('任何一项不满足都必须降为 strong_buy/strong_sell')
    expect(prompt).toContain('executionValidUntil 必须晚于 dataAsOf 且最多只允许 5 分钟有效')
    expect(prompt).toContain('decision_policy_id=rolling-position-v25-robust-70')
    expect(prompt).toContain('没有本轮 plan 或 watchlist 统一模型证据')
    expect(prompt).toContain('actionPurpose 必须说明这次动作要完成什么')
    expect(prompt).toContain('trend_top_reduce=逃顶 · 卖出准备做T')
    expect(prompt).toContain('tradeIntent=t_reentry 时=买入完成做T')
  })

  it('forces the intraday model to switch between exit, reentry, range T and trend hold', () => {
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('position_guidance.state=full_exit_ready')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('清仓后继续监控重新买回点')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('state=reentry_watch/reentry_ready')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('state=range_low_add')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('state=range_high_reduce')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('state=trend_hold')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('单一MACD转弱、普通冲高或形成中的K线不得提示卖出')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('position_guidance.material_change=true 时禁止返回 NO_REPLY')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('opportunity_type=reentry_after_risk_reduction')
    expect(INTRADAY_SCOPE_INSTRUCTION).toContain('只有当前点位和全部执行闸门同时通过时才能写 immediate_buy/immediate_sell')
  })
})
