const taskTitles: Record<string, string> = {
  pre_market: '盘前交易策略',
  pre_open_refresh: '开盘前刷新',
  candidate_refresh: '盘中候选池刷新',
  intraday: '盘中盯盘',
  voc_monitor: '场外反指监控',
  midday_review: '午盘复盘',
  automation_health: '检查任务是否正常',
  formal_close: '正式收盘核对',
  post_market: '盘后复盘',
  refine: '优化交易规则'
}

export const systemAutomationTaskIds = [
  'pre_market', 'pre_open_refresh', 'candidate_refresh', 'intraday', 'voc_monitor', 'midday_review', 'automation_health', 'formal_close', 'post_market', 'refine'
] as const

const systemAutomationTaskIdSet = new Set<string>(systemAutomationTaskIds)

export const isSystemAutomationTask = (id: string) => systemAutomationTaskIdSet.has(id)

export const automationTaskTitle = (mode: string) => taskTitles[mode] || mode || '自动化任务'

export const automationSessionId = (taskId: string) => {
  const safeId = taskId.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return `automation-${safeId || 'task'}`
}

export const isAutomationSessionId = (sessionId: string | null | undefined) => Boolean(sessionId && /^automation-[a-zA-Z0-9_-]+$/.test(sessionId))
