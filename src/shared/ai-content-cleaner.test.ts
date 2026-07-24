import { describe, it, expect } from 'vitest'
import { stripThinkingTags, cleanJsonStrings } from './ai-content-cleaner'

describe('stripThinkingTags', () => {
  it('剥离 antml thinking 标签对', () => {
    expect(stripThinkingTags('<antml thinking>推理</antml thinking>正文')).toBe('正文')
  })
  it('剥离 thinking 标签对', () => {
    expect(stripThinkingTags('<thinking>推理</thinking>答案')).toBe('答案')
  })
  it('剥离残留闭合标签', () => {
    expect(stripThinkingTags('正文</antml thinking>后续')).toBe('正文后续')
  })
  it('剥离残留开标签', () => {
    expect(stripThinkingTags('正文<antml thinking>后续')).toBe('正文后续')
  })
  it('无标签时保持原样', () => {
    expect(stripThinkingTags('正常内容')).toBe('正常内容')
  })
  it('空字符串返回空', () => {
    expect(stripThinkingTags('')).toBe('')
  })
})

describe('cleanJsonStrings', () => {
  it('递归清洗对象字符串字段', () => {
    const input = { summary: '<antml thinking>x</antml thinking>好', evidence: ['a</thinking>', 'b'] }
    const out = cleanJsonStrings(input)
    expect(out.summary).toBe('好')
    expect(out.evidence).toEqual(['a', 'b'])
  })
  it('保留非字符串字段', () => {
    const input = { count: 5, flag: true, list: [1, 2] }
    expect(cleanJsonStrings(input)).toEqual(input)
  })
})
