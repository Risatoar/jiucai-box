import { describe, expect, it } from 'vitest'
import { MULTI_ACCOUNT_OUTPUT_INSTRUCTION } from './account-separation'

describe('multi account output instruction', () => {
  it('要求按成员和账户独立输出且禁止合并事实', () => {
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('## 成员名 → 账户名')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('持仓事实、可用数量、策略、风险和下一步')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('不得汇总不同账户的成本、数量、现金或交易动作')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('空仓账户也不能省略')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('关注池扫描结果')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('账户内按标的聚合')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('### 6位代码 名称')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('禁止把多个标的')
    expect(MULTI_ACCOUNT_OUTPUT_INSTRUCTION).toContain('## 公共市场信息')
  })
})
