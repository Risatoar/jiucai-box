export const DEFAULT_AI_TIMEOUT_SECONDS = 120
export const MIN_AI_TIMEOUT_SECONDS = 30
export const MAX_AI_TIMEOUT_SECONDS = 900

export const normalizeAiTimeoutSeconds = (value?: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_AI_TIMEOUT_SECONDS
  return Math.min(MAX_AI_TIMEOUT_SECONDS, Math.max(MIN_AI_TIMEOUT_SECONDS, Math.round(value!)))
}

export const resolveAiTimeoutMs = (value?: number): number => normalizeAiTimeoutSeconds(value) * 1000

export const normalizeCodexCliModel = (value?: string): string => {
  const selected = value?.trim() || ''
  const legacyRelaySelection = /^auto_model\/([^/]+)$/.exec(selected)
  return legacyRelaySelection?.[1] || selected
}
