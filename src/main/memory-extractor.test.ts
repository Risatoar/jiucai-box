import { describe, expect, it } from 'vitest'
import { validateMemoryCandidates } from './memory-extractor'

describe('memory extraction validation', () => {
  it('accepts high-confidence supported memories from fenced JSON', () => {
    const raw = '```json\n{"memories":[{"content":"用户偏好先看结论","category":"preference","confidence":0.95}]}\n```'
    expect(validateMemoryCandidates(raw)).toEqual([{ content: '用户偏好先看结论', category: 'preference' }])
  })

  it('rejects low-confidence or unsupported candidates', () => {
    const raw = '{"memories":[{"content":"用户目前持有某股票","category":"preference","confidence":0.99},{"content":"用户可能偏好短线","category":"preference","confidence":0.5}]}'
    expect(validateMemoryCandidates(raw)).toEqual([])
  })
})
