import type { ChatSessionSummary } from '../../../shared/types'

export const upsertSessionSummary = (items: ChatSessionSummary[], changed: ChatSessionSummary) => [
  changed,
  ...items.filter((item) => item.id !== changed.id)
].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
