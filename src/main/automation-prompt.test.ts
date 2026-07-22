import { describe, expect, it } from 'vitest'
import type { TradeMasterSnapshot } from '../shared/types'
import { buildAutomationSystemPrompt } from './automation-prompt'

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
    expect(prompt).toContain('prepare_buy/prepare_sell/watch')
    expect(prompt).toContain('形成中的K线、单纯触价、证据不足只能写 watch')
  })
})
