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
})
