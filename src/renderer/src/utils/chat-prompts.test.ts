import { describe, expect, it } from 'vitest'
import { automationQuickActions, chatQuickActions, emptyStateSuggestions } from './chat-prompts'

describe('chat prompts', () => {
  it('provides today and tomorrow strategy entries in the empty state', () => {
    expect(emptyStateSuggestions.map((suggestion) => suggestion.label)).toEqual(expect.arrayContaining([
      '给我今天的交易策略',
      '提前制定明天的交易策略'
    ]))
  })

  it('reuses every empty-state prompt as a compact conversation shortcut', () => {
    expect(chatQuickActions).toHaveLength(emptyStateSuggestions.length)
    expect(chatQuickActions.map((action) => action.prompt)).toEqual(emptyStateSuggestions.map((suggestion) => suggestion.prompt))
  })

  it('provides task-specific follow-ups for automation conversations', () => {
    expect(automationQuickActions.map((action) => action.label)).toEqual(expect.arrayContaining([
      '总结本次结果',
      '逐只解释策略',
      '重新核对持仓',
      '下一检查点'
    ]))
    expect(automationQuickActions.every((action) => action.prompt.includes('本次'))).toBe(true)
  })
})
