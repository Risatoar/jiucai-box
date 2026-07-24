import type { AutomationTask, FeishuConfigInput, Gate, HouseholdSnapshot, InstrumentType, NotificationAuditEvent, Position, StrategyDefinition, TradeMasterSnapshot, WatchItem } from '../../../shared/types'
import { resolveConceptTags } from './concept-tags'
import { automationTaskTitle, isSystemAutomationTask } from '../../../shared/automation'
import { formatAutomationRunAt, nextAutomationRunAt, type ScheduledAutomationTask } from '../../../shared/automation-schedule'

interface RawPosition {
  instrument?: { code?: string; name?: string; type?: string; exchange?: string }
  quantity?: number
  available_quantity?: number
  average_cost?: number
  status?: string
}

export const positionsFromSnapshot = (snapshot: TradeMasterSnapshot | null): Position[] => {
  if (snapshot?.household?.accounts?.length) {
    const memberNames = new Map(snapshot.household.members.map((member) => [member.id, member.name]))
    return snapshot.household.accounts.flatMap((account) => account.positions.map((position) => ({
      ...position,
      latestPrice: 0,
      changePercent: 0,
      pnl: 0,
      pnlPercent: 0,
      memberId: account.memberId,
      memberName: memberNames.get(account.memberId) || '家人',
      accountId: account.id,
      accountName: account.name
    })))
  }
  const portfolio = snapshot?.portfolio as { positions?: RawPosition[] } | null
  if (!portfolio?.positions) return []
  return portfolio.positions.map((position) => ({
    instrument: {
      code: position.instrument?.code || '--',
      name: position.instrument?.name || '未知标的',
      type: position.instrument?.type === 'stock' || position.instrument?.type === 'etf' ? position.instrument.type : 'cbond',
      exchange: position.instrument?.exchange === 'SZ' || position.instrument?.exchange === 'BJ' ? position.instrument.exchange : 'SH'
    },
    quantity: position.quantity || 0,
    availableQuantity: position.available_quantity || 0,
    averageCost: position.average_cost ?? null,
    latestPrice: 0,
    changePercent: 0,
    pnl: 0,
    pnlPercent: 0,
    status: position.status === 'closed' ? 'closed' : 'confirmed'
  }))
}

interface RawWatchItem {
  code?: string
  name?: string
  type?: string
  exchange?: string
  source?: string
  status?: string
  score?: number
  signal?: string
  strategyLane?: string
  strategyLabel?: string
  suitableFor?: string
  strategy_lane?: string
  strategy_lane_label?: string
  suitable_for?: string
  nextAction?: string
  next_action?: string
  reasons?: string[]
  theme?: string
  industry?: string
  concepts?: string[]
}

const STOCK_BOARD_PREFIXES: Record<string, string[]> = {
  main_sh: ['600', '601', '603', '605'],
  main_sz: ['000', '001', '002', '003'],
  chinext: ['300', '301'],
  star: ['688', '689'],
}

const inferStockBoard = (code: string, type: string): WatchItem['board'] => {
  if (type !== 'stock')
    return undefined;
  for (const [board, prefixes] of Object.entries(STOCK_BOARD_PREFIXES)) {
    if (prefixes.some((prefix) => String(code).startsWith(prefix)))
      return board as WatchItem['board'];
  }
  return 'other';
};

const BOARD_LABELS: Record<string, string> = {
  main_sh: '沪市主板',
  main_sz: '深市主板',
  chinext: '创业板',
  star: '科创板',
  other: '其他',
};

export const boardLabel = (board?: WatchItem['board']) => board ? BOARD_LABELS[board] || '' : '';

export const watchlistFromSnapshot = (snapshot: TradeMasterSnapshot | null): WatchItem[] => {
  const watchlist = snapshot?.watchlist as { instruments?: RawWatchItem[] } | null
  const closed = new Set(['closed', 'closed_case', 'removed', 'archived'])
  const explicit: WatchItem[] = (watchlist?.instruments || []).filter((item) => !closed.has(item.status || '')).map((item): WatchItem => ({
    code: item.code || '--',
    name: item.name || '未知标的',
    type: item.type === 'stock' || item.type === 'etf' ? item.type : 'cbond',
    exchange: item.exchange === 'SZ' || item.exchange === 'BJ' ? item.exchange : 'SH',
    latestPrice: 0,
    changePercent: 0,
    volume: '--',
    score: Number(item.score || 0),
    source: /agent|auto|screen/i.test(item.source || '') ? 'agent' : 'user',
    signal: ['观察', '准备买入', '风险预警', '今日停手'].includes(item.signal || '') ? item.signal as WatchItem['signal'] : '未评估',
    refreshedAt: '待刷新',
    strategyLane: item.strategyLane || item.strategy_lane,
    strategyLabel: item.strategyLabel || item.strategy_lane_label,
    suitableFor: item.suitableFor || item.suitable_for,
    nextAction: item.nextAction || item.next_action,
    reasons: Array.isArray(item.reasons) ? item.reasons : undefined,
    board: inferStockBoard(item.code || '--', item.type === 'stock' || item.type === 'etf' ? item.type : 'cbond'),
    theme: item.theme || item.industry || undefined,
    sector: item.theme || item.industry || undefined,
    concepts: resolveConceptTags({
      type: item.type === 'stock' || item.type === 'etf' ? item.type : 'cbond',
      name: item.name || '',
      code: item.code || '',
      concepts: Array.isArray(item.concepts) ? item.concepts : undefined,
      theme: item.theme,
      sector: item.industry,
    }),
  }))
  const portfolio = snapshot?.portfolio as { positions?: RawPosition[] } | null
  const householdPositions = snapshot?.household?.accounts.flatMap((account) => account.positions.map((position) => ({
    instrument: position.instrument,
    quantity: position.quantity,
    status: position.status
  })))
  for (const position of householdPositions || portfolio?.positions || []) {
    if (!position.quantity || position.status === 'closed' || explicit.some((item) => item.code === position.instrument?.code)) continue
    explicit.push({
      code: position.instrument?.code || '--', name: position.instrument?.name || '未知标的', type: position.instrument?.type === 'stock' || position.instrument?.type === 'etf' ? position.instrument.type : 'cbond',
      exchange: position.instrument?.exchange === 'SZ' || position.instrument?.exchange === 'BJ' ? position.instrument.exchange : 'SH', latestPrice: 0, changePercent: 0, volume: '--', score: 0, source: 'user', signal: '未评估', refreshedAt: '待刷新'
    })
  }
  return explicit
}

export const gatesFromSnapshot = (snapshot: TradeMasterSnapshot | null, item: WatchItem | null): Gate[] => {
  const portfolio = snapshot?.portfolio as { pending_events?: unknown[]; conflicts?: unknown[] } | null
  const discipline = disciplineFromSnapshot(snapshot)
  const activeRules = (snapshot?.strategies as { rules?: unknown[] } | null)?.rules?.length || 0
  const quoteReady = Boolean(item && item.latestPrice > 0 && item.refreshedAt !== '待刷新')
  const conflicts = portfolio?.conflicts?.length || 0
  const pending = portfolio?.pending_events?.length || 0
  return [
    { id: 'data', label: '行情', state: quoteReady ? 'pass' : 'warn', detail: quoteReady ? `已更新 · ${item?.refreshedAt}` : '还没有拿到最新行情' },
    { id: 'account', label: '交易记录', state: conflicts ? 'blocked' : snapshot?.portfolio ? 'pass' : 'warn', detail: conflicts ? `${conflicts} 条记录对不上，需先核对` : pending ? `${pending} 笔买卖等你确认` : snapshot?.portfolio ? '持仓记录已读取' : '交易记录未读取' },
    { id: 'discipline', label: '交易状态', state: discipline === 'STOPPED' ? 'blocked' : discipline === 'NORMAL' ? 'pass' : 'warn', detail: disciplineLabel(discipline) },
    { id: 'cost', label: '费用', state: 'warn', detail: '下单前还要计算手续费和价格变化' },
    { id: 'strategy', label: '交易规则', state: activeRules ? 'pass' : 'warn', detail: activeRules ? `已读取 ${activeRules} 条正在使用的规则` : '还没有正在使用的规则' }
  ]
}

const taskDescriptions: Record<string, string> = {
  pre_market: '开盘前整理今天该看什么、该怎么做',
  pre_open_refresh: '开盘前更新账户、行情和关注品种',
  candidate_refresh: '全市场筛选五类策略各2只，共10只候选，并单独标出买入就绪标的',
  intraday: '持仓、关注品种或候选标的有重要变化时提醒你',
  voc_monitor: '高频检查重点博主更新，提取板块与买卖情绪并提示风险',
  midday_review: '总结上午盘面，并整理下午的操作重点',
  automation_health: '检查定时任务和飞书提醒是否正常',
  formal_close: '刷新正式收盘行情，并回填到期的1/3/7/15交易日信号结果',
  post_market: '复盘历史买卖点，筛选有效与失误案例并反思卖飞、漏接回等问题',
  refine: '基于历史信号案例生成待验证策略候选，不直接改写活动规则'
}

const scheduleText = (schedule: ScheduledAutomationTask['schedule'] = {}) => {
  if (schedule.kind === 'market_window') return `交易时段每 ${String(schedule.interval_minutes || '--')} 分钟`
  if (schedule.kind === 'daily_window') return `每天每 ${String(schedule.interval_minutes || '--')} 分钟`
  if (schedule.kind === 'cron') {
    if (schedule.times?.length) return `工作日 ${schedule.times.join('、')}`
    const [minuteText, hourText] = String(schedule.expression || '').split(' ')
    const minutes = minuteText?.split(',').filter(Boolean) || []
    const hours = hourText?.split(',').filter(Boolean) || []
    const times = hours.flatMap((hour) => minutes.map((minute) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`))
    return times.length ? `工作日 ${times.join('、')}` : '工作日按设定时间运行'
  }
  return '待配置'
}

export const automationsFromSnapshot = (snapshot: TradeMasterSnapshot | null): AutomationTask[] => {
  const manifest = snapshot?.automation as { install_status?: string; tasks?: Array<ScheduledAutomationTask & { id?: string; mode?: string; title?: string; description?: string; prompt?: string; system_default?: boolean; last_status?: string }> } | null
  const loadedAt = snapshot?.loadedAt ? new Date(snapshot.loadedAt) : new Date()
  const now = Number.isNaN(loadedAt.getTime()) ? new Date() : loadedAt
  return (manifest?.tasks || []).map((task) => {
    const mode = task.mode || task.id || 'unknown'
    const systemDefault = task.system_default === true || isSystemAutomationTask(task.id || mode)
    const rawTitle = task.title?.trim()
    const rawDescription = task.description?.trim()
    const title = systemDefault && (!rawTitle || rawTitle === task.id || rawTitle === mode) ? automationTaskTitle(mode) : rawTitle || automationTaskTitle(mode)
    const description = systemDefault && (!rawDescription || rawDescription === '按设定时间自动检查并提醒') ? taskDescriptions[mode] || '按设定时间自动检查并提醒' : rawDescription || taskDescriptions[mode] || '按设定时间自动检查并提醒'
    const installed = manifest?.install_status === 'installed'
    return {
      id: task.id || mode,
      title,
      description,
      schedule: scheduleText(task.schedule),
      session: '结果保存在单独对话',
      mode,
      enabled: task.enabled !== false,
      state: task.last_status === 'failed' ? 'warning' : installed ? 'healthy' : 'idle',
      lastRun: task.last_run_at ? new Date(task.last_run_at).toLocaleString('zh-CN') : '尚无运行记录',
      nextRun: !installed
        ? '待安装'
        : task.enabled === false
          ? '已停用'
          : (() => {
              const nextRun = nextAutomationRunAt(task, now)
              return nextRun ? formatAutomationRunAt(nextRun) : '规则待完善'
            })(),
      prompt: task.prompt?.trim() || '读取最新交易数据，按任务目标检查并给出结论；没有重要变化时返回 NO_REPLY。',
      isSystemDefault: systemDefault,
      scheduleConfig: task.schedule || {}
    }
  })
}

const notificationModeLabels: Record<string, string> = {
  automation_health: '任务检查',
  pre_market: '盘前策略',
  pre_open_refresh: '开盘刷新',
  candidate_refresh: '候选池刷新',
  intraday: '盘中盯盘',
  voc_monitor: '场外反指监控',
  midday_review: '午盘复盘',
  formal_close: '正式收盘',
  post_market: '盘后复盘',
  refine: '规则优化',
  interactive: '手动测试'
}

export const notificationEventsFromSnapshot = (snapshot: TradeMasterSnapshot | null): NotificationAuditEvent[] => {
  const audit = snapshot?.notificationAudit as { events?: Array<Record<string, unknown>> } | null
  const severities = new Set<NotificationAuditEvent['severity']>(['info', 'warning', 'critical', 'opportunity'])
  return (audit?.events || []).flatMap((event) => {
    const title = String(event.title || '').trim()
    const sentAt = String(event.sent_at || event.create_time || '')
    if (!title || !sentAt) return []
    const severity = String(event.severity || 'info') as NotificationAuditEvent['severity']
    const mode = String(event.mode || 'unknown')
    return [{
      id: String(event.message_id || event.fingerprint || `${sentAt}-${title}`),
      title,
      mode,
      modeLabel: notificationModeLabels[mode] || '其他任务',
      severity: severities.has(severity) ? severity : 'info',
      sentAt,
      delivered: Boolean(event.message_id)
    }]
  }).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
}

export const disciplineFromSnapshot = (snapshot: TradeMasterSnapshot | null): string => {
  const discipline = snapshot?.discipline as { state?: string } | null
  return discipline?.state || '未初始化'
}

const disciplineLabels: Record<string, string> = {
  NORMAL: '正常',
  CAUTION: '警戒',
  COOLDOWN: '冷静期',
  STOPPED: '已停手',
  UNKNOWN: '未知'
}

export const disciplineLabel = (state: string): string => {
  const normalizedState = state.toUpperCase()
  if (disciplineLabels[normalizedState]) return disciplineLabels[normalizedState]
  return /^[A-Z][A-Z_]*$/.test(state) ? '未知状态' : state
}

export const assetFromSnapshot = (snapshot: TradeMasterSnapshot | null): number | null => {
  if (snapshot?.household?.accounts?.length) {
    const values = snapshot.household.accounts.map((account) => account.totalAsset)
    if (values.every((value) => value != null)) return values.reduce<number>((sum, value) => sum + (value || 0), 0)
    return null
  }
  const portfolio = snapshot?.portfolio as { total_asset?: number; total_asset_estimate_before_unconfirmed_fees?: number } | null
  const goals = snapshot?.goals as { current_asset?: number } | null
  return portfolio?.total_asset ?? portfolio?.total_asset_estimate_before_unconfirmed_fees ?? goals?.current_asset ?? null
}

export const householdFromSnapshot = (snapshot: TradeMasterSnapshot | null): HouseholdSnapshot => snapshot?.household || { members: [], accounts: [], updatedAt: snapshot?.loadedAt || new Date().toISOString() }

export const feishuConfigFromSnapshot = (snapshot: TradeMasterSnapshot | null): FeishuConfigInput | null => {
  const notifications = snapshot?.notifications as {
    enabled?: boolean
    receiver?: { type?: string; id?: string; label?: string }
    identity?: string
    cli_path?: string
    duplicate_window_minutes?: number
  } | null
  const receiverType = notifications?.receiver?.type
  const receiverId = notifications?.receiver?.id?.trim()
  const receiverLabel = notifications?.receiver?.label?.trim()
  if (!notifications?.enabled || !receiverId || (receiverType !== 'user_id' && receiverType !== 'chat_id')) return null
  return {
    receiverType,
    receiverId,
    ...(receiverLabel ? { receiverLabel } : {}),
    identity: notifications.identity === 'user' ? 'user' : 'bot',
    cliPath: notifications.cli_path || undefined,
    duplicateWindowMinutes: Math.max(1, notifications.duplicate_window_minutes || 60)
  }
}

const strategyNames: Record<string, string> = {
  'etf.fast_move_pressure_and_hard_risk_override': 'ETF 快速涨跌应对',
  'etf.full_base_directional_t_with_staged_execution': 'ETF 分批做 T',
  'automation.required_recovery_event_delivery_audit': '检查盘中提醒是否恢复',
  'behavior.opening_lock_and_cash_buffer': '开盘不急买，保留备用资金',
  'behavior.stop_after_revenge_switch': '亏损后暂停追单'
}

const instrumentTypes = (value: string): InstrumentType[] => {
  if (value.includes('etf')) return ['etf']
  if (value.includes('cbond')) return ['cbond']
  if (value.includes('stock')) return ['stock']
  return ['stock', 'etf', 'cbond']
}

export const strategiesFromSnapshot = (snapshot: TradeMasterSnapshot | null): StrategyDefinition[] => {
  if (!snapshot) return []
  const active = snapshot.strategies as { version?: string; updated_at?: string; rules?: Array<Record<string, unknown>> } | null
  const candidates = Array.isArray(snapshot.strategyCandidates) ? snapshot.strategyCandidates as Array<Record<string, unknown>> : []
  const evolution = snapshot.evolution as { rules?: Array<Record<string, unknown>> } | null
  const paused = Array.isArray(snapshot.pausedStrategies) ? snapshot.pausedStrategies as Array<{ id?: string; paused_at?: string; rule?: Record<string, unknown> }> : []
  const activeStrategies: StrategyDefinition[] = (active?.rules || []).map((rule) => ({
    id: String(rule.id || 'active-rule'),
    name: rule.id === 'LR-20260710-001' ? '转债快速涨跌确认' : String(rule.id || '正在使用的规则'),
    family: '从历史交易中整理',
    instruments: instrumentTypes(String(rule.instrument_type || '')),
    status: 'active',
    version: active?.version || '1.0.0',
    description: '这条规则来自已经复盘确认的问题。安全设置不会跟着规则一起修改。',
    rules: [
      `预警周期：${String(rule.warning_period || '待确认')}`,
      `确认周期：${String(rule.confirmation_period || '待确认')}`,
      rule.require_closed_bar ? '等这根 K 线走完后再判断' : '是否要等 K 线走完，仍需确认'
    ],
    evidence: { history: 0, outOfSample: 0, shadowDays: 0 },
    performance: { winRate: 0, profitFactor: 0, maxDrawdown: 0 },
    updatedAt: active?.updated_at ? new Date(active.updated_at).toLocaleString('zh-CN') : '时间待确认',
    source: 'ai-evolved'
  }))
  const candidateStrategies: StrategyDefinition[] = candidates.filter((candidate) => String(candidate.status) !== 'superseded_by_user_case_preference').map((candidate) => {
    const target = String(candidate.target_rule || candidate.id || 'candidate')
    const evidence = candidate.evidence && typeof candidate.evidence === 'object' && !Array.isArray(candidate.evidence) ? candidate.evidence as Record<string, unknown> : {}
    const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
    return {
      id: String(candidate.id || target), name: strategyNames[target] || target, family: '等待验证', instruments: instrumentTypes(target), status: 'candidate', version: 'candidate',
      description: String(candidate.note || '还在验证，暂时不会正式使用。'), rules: [String(candidate.scope || candidate.case_scope || '还要验证适合哪些情况'), '用历史行情、新行情和模拟观察验证后才能使用'],
      evidence: { history: count(evidence.history_samples), outOfSample: count(evidence.out_of_sample_samples), shadowDays: count(evidence.shadow_days) }, performance: { winRate: 0, profitFactor: count(evidence.profit_factor), maxDrawdown: 0 }, updatedAt: String(candidate.migrated_at || '待验证'), source: 'user'
    }
  })
  const evolutionRules: StrategyDefinition[] = (evolution?.rules || []).map((rule) => ({
    id: String(rule.id || 'evolution-rule'), name: String(rule.title || rule.id || '交易习惯规则'), family: String(rule.category || '交易习惯'), instruments: ['stock', 'etf', 'cbond'], status: 'active', version: 'evolution',
    description: String(rule.description || '这是一条已经启用的低风险提醒规则。'), rules: [String(rule.target || '交易习惯'), '不会修改真实持仓、最多能亏多少或券商权限'], evidence: { history: 0, outOfSample: 0, shadowDays: 0 }, performance: { winRate: 0, profitFactor: 0, maxDrawdown: 0 }, updatedAt: String(rule.activated_at || '已启用'), source: 'ai-evolved'
  }))
  const pausedRules: StrategyDefinition[] = paused.filter((item) => item.rule).map((item) => ({
    id: String(item.id || item.rule?.id || 'paused-rule'), name: String(item.rule?.id || item.id || '已暂停的规则'), family: '从历史交易中整理', instruments: instrumentTypes(String(item.rule?.instrument_type || '')), status: 'paused', version: active?.version || 'paused',
    description: '这条规则已经暂停，需要时可以恢复。', rules: [`提醒周期：${String(item.rule?.warning_period || '待确认')}`, `确认周期：${String(item.rule?.confirmation_period || '待确认')}`], evidence: { history: 0, outOfSample: 0, shadowDays: 0 }, performance: { winRate: 0, profitFactor: 0, maxDrawdown: 0 }, updatedAt: item.paused_at ? new Date(item.paused_at).toLocaleString('zh-CN') : '时间待确认', source: 'ai-evolved'
  }))
  return [...activeStrategies, ...pausedRules, ...candidateStrategies, ...evolutionRules]
}
