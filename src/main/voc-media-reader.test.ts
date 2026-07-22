import { describe, expect, it } from 'vitest'
import { assessVocTranscript } from './voc-media-reader'

describe('VOC 语音识别质量门禁', () => {
  it('rejects corrupted output and keeps normal Chinese speech', () => {
    expect(assessVocTranscript('我现在�现在要不要减仓')).toBe('rejected')
    expect(assessVocTranscript('今天半导体冲高，我准备先减一点仓位')).toBe('usable')
  })

  it('marks highly repetitive output for review', () => {
    expect(assessVocTranscript('不要追涨不要追涨不要追涨不要追涨不要追涨不要追涨')).toBe('needs_review')
    expect(assessVocTranscript(`明天可能回落${'嘿'.repeat(60)}`)).toBe('needs_review')
  })
})
