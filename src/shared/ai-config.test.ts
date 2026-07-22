import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_TIMEOUT_SECONDS, normalizeAiTimeoutSeconds, resolveAiTimeoutMs } from './ai-config'

describe('AI timeout config', () => {
  it('defaults old or invalid configs to 120 seconds', () => {
    expect(normalizeAiTimeoutSeconds()).toBe(DEFAULT_AI_TIMEOUT_SECONDS)
    expect(normalizeAiTimeoutSeconds(Number.NaN)).toBe(DEFAULT_AI_TIMEOUT_SECONDS)
    expect(resolveAiTimeoutMs()).toBe(120_000)
  })

  it('rounds and clamps user values to the supported range', () => {
    expect(normalizeAiTimeoutSeconds(10)).toBe(30)
    expect(normalizeAiTimeoutSeconds(125.6)).toBe(126)
    expect(normalizeAiTimeoutSeconds(1200)).toBe(900)
  })
})
