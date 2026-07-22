import { describe, expect, it } from 'vitest'
import { MULTI_ACCOUNT_OUTPUT_INSTRUCTION } from './account-separation'

describe('multi account output instruction', () => {
  it('要求按成员和账户独立输出且禁止合并事实', () => {
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('## 成员名 → 账户名')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('持仓事实、可用数量、策略、风险和下一步')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('不得汇总不同账户的成本、数量、现金或交易动作')
  })
})
