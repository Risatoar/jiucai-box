/* ===== AI 输出内容清洗 · 剥离思维链标签 ===== */

export const stripThinkingTags = (content: string): string => {
  if (!content) return ''
  let cleaned = content
  const tagPatterns = [
    /<antml\s+thinking[^>]*>[\s\S]*?<\/antml\s*thinking[^>]*>/gi,
    /<antml[^>]*>[\s\S]*?<\/antml[^>]*>/gi,
    /<thinking[^>]*>[\s\S]*?<\/thinking[^>]*>/gi,
    /<reasoning[^>]*>[\s\S]*?<\/reasoning[^>]*>/gi,
    /<think[^>]*>[\s\S]*?<\/think[^>]*>/gi,
    /<internal[^>]*>[\s\S]*?<\/internal[^>]*>/gi,
  ]
  for (const pattern of tagPatterns) {
    cleaned = cleaned.replace(pattern, '')
  }
  cleaned = cleaned.replace(/<\/(?:antml\s*thinking|antml|thinking|reasoning|think|internal)[^>]*>/gi, '')
  cleaned = cleaned.replace(/<(?:antml\s*thinking|antml|thinking|reasoning|think|internal)[^>]*\/?>/gi, '')
  return cleaned.trim()
}

export const cleanJsonStrings = <T>(value: T): T => {
  if (typeof value === 'string') return stripThinkingTags(value) as unknown as T
  if (Array.isArray(value)) return value.map(item => cleanJsonStrings(item)) as unknown as T
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cleanJsonStrings(val)
    }
    return result as unknown as T
  }
  return value
}
