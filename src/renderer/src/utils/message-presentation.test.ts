import { describe, expect, it } from 'vitest'
import { buildMessagePresentation } from './message-presentation'

describe('message presentation', () => {
  it('识别定时任务完成但无材料变化', () => {
    const result = buildMessagePresentation('定时任务「盘中盯盘」执行完成，本次没有材料变化（NO_REPLY）。')

    expect(result.result).toMatchObject({ title: '盘中盯盘', state: 'no_change' })
    expect(result.structured).toBe(true)
    expect(result.lead).toBeUndefined()
  })

  it('把结论、风险和下一步拆成有语义的模块', () => {
    const result = buildMessagePresentation(`结论：继续持有观察，不追涨。

风险：
- 跌破 56.2 后原判断失效
- 盘中量能不足

下一步：
1. 等待完整 15 分钟 K 线
2. 收盘后复核持仓`)

    expect(result.lead).toBe('继续持有观察，不追涨。')
    expect(result.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '风险', tone: 'warning', items: ['跌破 56.2 后原判断失效', '盘中量能不足'] }),
      expect.objectContaining({ title: '下一步', tone: 'action', ordered: true })
    ]))
  })

  it('连续编号内容保持为一个有序清单', () => {
    const result = buildMessagePresentation('1. 核对持仓\n2. 检查风险\n3. 等待触发')

    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]).toMatchObject({ title: '要点', ordered: true, items: ['核对持仓', '检查风险', '等待触发'] })
  })

  it('短回答保持轻量，不误判成结果卡', () => {
    const result = buildMessagePresentation('当前没有明确买点，继续等待。')

    expect(result.result).toBeUndefined()
    expect(result.lead).toBe('当前没有明确买点，继续等待。')
  })

  it('依据消息状态展示失败结果', () => {
    const result = buildMessagePresentation('行情服务连接超时', 'error')

    expect(result.result).toMatchObject({ state: 'error', detail: '行情服务连接超时' })
  })

  it('把多账户回答识别为彼此独立的账户区块', () => {
    const result = buildMessagePresentation(`## 我 → 我的主账户
- 现金 7580 元
- 当前空仓

## 老婆 → 老婆的账户
- 鹏辉能源 300 股
- 可用数量 300 股`)

    expect(result.sections).toHaveLength(0)
    expect(result.groups).toHaveLength(2)
    expect(result.groups[0]).toMatchObject({ kind: 'account', account: { member: '我', name: '我的主账户' } })
    expect(result.groups[1]).toMatchObject({ kind: 'account', account: { member: '老婆', name: '老婆的账户' } })
  })

  it('把重复的条件字段归回各自标的，而不是拆成跨标的卡片', () => {
    const result = buildMessagePresentation(`## 本轮5个最值得关注
1. 127049 希望转2
2. 当前价：115.569 元
3. 排序依据：综合排名第1

### 触发条件
完整5分钟走势转稳，同时成交量改善。

### 失效条件
跌破今日低点115.04元。

### 下一检查点
下一根完整5分钟走势。
1. 127045 牧原转债
2. 当前价：125.613元
3. 排序依据：综合排名第2

### 触发条件
完整15分钟走势确认转稳。

### 主要风险
成交量不足。`)

    expect(result.sections).toHaveLength(0)
    expect(result.groups).toHaveLength(2)
    expect(result.groups[0]).toMatchObject({ instrument: { code: '127049', name: '希望转2' } })
    expect(result.groups[0].sections.map((section) => section.title)).toEqual(expect.arrayContaining(['本轮5个最值得关注', '触发条件', '失效条件', '下一检查点']))
    expect(result.groups[1]).toMatchObject({ instrument: { code: '127045', name: '牧原转债' } })
    expect(result.groups[1].sections.map((section) => section.title)).toEqual(expect.arrayContaining(['标的概览', '触发条件', '主要风险']))
  })

  it('在账户内部继续按标的聚合', () => {
    const result = buildMessagePresentation(`## 老婆 → 老婆的账户
### 300438 鹏辉能源
- 持仓300股，可用300股
#### 触发条件
- 完整15分钟重新站稳
#### 失效条件
- 跌破55.80元`)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]).toMatchObject({ kind: 'account', account: { member: '老婆', name: '老婆的账户' } })
    expect(result.groups[0].instruments).toHaveLength(1)
    expect(result.groups[0].instruments[0]).toMatchObject({ instrument: { code: '300438', name: '鹏辉能源' } })
  })
})
