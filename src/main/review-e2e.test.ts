import { describe, it, expect } from 'vitest'
import { resolveInstrumentName, readBarsFromCache } from './review-market-data'
import { stripThinkingTags, cleanJsonStrings } from '../shared/ai-content-cleaner'

describe('ETF 名称解析', () => {
  it('已知 ETF 代码返回真实名称', () => {
    expect(resolveInstrumentName('159755')).toBe('新能源车ETF')
    expect(resolveInstrumentName('518880')).toBe('黄金ETF')
    expect(resolveInstrumentName('512880')).toBe('证券ETF')
  })
  it('未知代码返回原始代码', () => {
    expect(resolveInstrumentName('999999')).toBe('999999')
  })
  it('有 fallback 且不等于代码时返回 fallback', () => {
    expect(resolveInstrumentName('159755', '自定义名')).toBe('自定义名')
  })
  it('fallback 等于代码时查 ETF 表', () => {
    expect(resolveInstrumentName('159755', '159755')).toBe('新能源车ETF')
  })
})

describe('Bars 缓存回退', () => {
  it('readBarsFromCache 返回数组（即使缓存为空也不抛错）', () => {
    const bars = readBarsFromCache('000001', '1d', 60, '2026-07-23')
    expect(Array.isArray(bars)).toBe(true)
  })
})

describe('方向收益计算逻辑验证', () => {
  // 模拟 latestDirectionalReturn 逻辑
  const round = (v: number) => Math.round(v * 100) / 100
  const directionalReturn = (record: any, latestPrice: number | null) => {
    const completed = [...record.outcomes].reverse().find((o: any) => o.status === 'completed' && o.directionalReturnPercent != null)
    if (completed) return round(completed.directionalReturnPercent)
    const ref = Number(record.referencePrice || 0)
    if (ref > 0 && latestPrice != null && latestPrice > 0) {
      const pct = (latestPrice / ref - 1) * 100
      return record.side === 'sell' ? round(-pct) : round(pct)
    }
    return null
  }

  it('completed outcome 直接使用其 directionalReturnPercent', () => {
    const record = { outcomes: [{ status: 'completed', directionalReturnPercent: 5.5 }], referencePrice: 10, side: 'buy' }
    expect(directionalReturn(record, 12)).toBe(5.5)
  })

  it('pending 买入信号从 referencePrice/latestPrice 计算', () => {
    const record = { outcomes: [], referencePrice: 10, side: 'buy' }
    expect(directionalReturn(record, 11)).toBe(10)
  })

  it('pending 卖出信号收益取反', () => {
    const record = { outcomes: [], referencePrice: 10, side: 'sell' }
    expect(directionalReturn(record, 11)).toBe(-10)
  })

  it('无参考价且无 completed 时返回 null', () => {
    const record = { outcomes: [], referencePrice: 0, side: 'buy' }
    expect(directionalReturn(record, 11)).toBeNull()
  })
})

describe('AI 内容清洗端到端', () => {
  it('完整污染报告能被正确清洗', () => {
    const dirty = {
      summary: '<antml thinking>内部推理</antml thinking>今日大盘上涨',
      sectors: [{ summary: '板块表现好</thinking>', evidence: ['证据1</antml thinking>', '证据2'] }],
      hotStocks: [{ summary: '<reasoning>分析</reasoning>龙头股' }],
      count: 5,
      flag: true
    }
    const clean = cleanJsonStrings(dirty)
    expect(clean.summary).toBe('今日大盘上涨')
    expect(clean.sectors[0].summary).toBe('板块表现好')
    expect(clean.sectors[0].evidence).toEqual(['证据1', '证据2'])
    expect(clean.hotStocks[0].summary).toBe('龙头股')
    expect(clean.count).toBe(5)
    expect(clean.flag).toBe(true)
  })

  it('嵌套多层标签全部剥离', () => {
    const input = '<antml thinking>A</antml thinking>结果<antml>B</antml>'
    expect(stripThinkingTags(input)).toBe('结果')
  })
})
