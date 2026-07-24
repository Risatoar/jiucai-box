import { describe, expect, it } from 'vitest'
import { normalizeCodexModels } from './codex-models'

describe('normalizeCodexModels', () => {
  it('keeps visible available models and their picker metadata', () => {
    expect(normalizeCodexModels([
      {
        id: 'gpt-5.6-terra',
        model: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        description: 'Balanced',
        hidden: false,
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Lower latency' }],
        inputModalities: ['text', 'image']
      },
      { model: 'hidden-model', displayName: 'Hidden', hidden: true }
    ])).toEqual([{
      id: 'gpt-5.6-terra',
      displayName: 'GPT-5.6 Terra',
      description: 'Balanced',
      isDefault: true,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Lower latency' }],
      inputModalities: ['text', 'image']
    }])
  })

  it('deduplicates model ids and falls back to the id as its label', () => {
    expect(normalizeCodexModels([
      { id: 'gpt-5.4' },
      { model: 'gpt-5.4', displayName: 'Duplicate' },
      null
    ])).toEqual([{
      id: 'gpt-5.4',
      displayName: 'gpt-5.4',
      description: undefined,
      isDefault: false,
      defaultReasoningEffort: undefined,
      supportedReasoningEfforts: undefined,
      inputModalities: undefined
    }])
  })

  it('uses the CLI model id instead of a managed relay catalog name', () => {
    expect(normalizeCodexModels([{
      id: 'alwaysday1',
      model: 'auto_model/alwaysday1',
      displayName: 'Always Day 1',
      hidden: false
    }])).toEqual([expect.objectContaining({
      id: 'alwaysday1',
      displayName: 'Always Day 1'
    })])
  })

  it('normalizes a managed relay id to the bare CLI model name', () => {
    expect(normalizeCodexModels([{
      id: 'auto_model/alwaysday1',
      displayName: 'alwaysday1',
      hidden: false
    }])).toEqual([expect.objectContaining({
      id: 'alwaysday1',
      displayName: 'alwaysday1'
    })])
  })
})
