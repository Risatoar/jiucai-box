import { Notification } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAiConfig } from './ai-config-store'
import { buildAutomationNotificationPayload, shouldSendAutomationNotification } from './automation-notification'
import { sendAiMessage } from './ai-provider'
import { appendNamedSessionMessage } from './chat-store'
import { loadManifest, saveAutomationRun } from './automation-store'
import { loadTradeMasterSnapshot, runTradeMaster } from './trade-master'
import { automationSessionId, automationTaskTitle } from '../shared/automation'
import type { AutomationRun, ChatMessage, TradeMasterSnapshot } from '../shared/types'
import { parseStockStrategyPayload, stripStockStrategyPayload } from '../shared/stock-strategy-payload'
import { collectVocEvidence, saveVocRiskReport } from './voc-store'
import type { VocEvent } from '../shared/voc'
import { parseVocAnalysis, stripVocAnalysisPayload, VOC_ANALYSIS_OUTPUT_INSTRUCTION } from '../shared/voc-analysis'
import { rolloverAvailableQuantitiesBeforeOpen } from './position-session-rollover'
import { buildAutomationSystemPrompt, INTRADAY_SCOPE_INSTRUCTION } from './automation-prompt'
import { reviewSignalLedger } from './signal-ledger-store'
import { generateReviewReport } from './review-service'

const PUBLIC_ROLLING_BACKTEST_CODES = [
  '300438', '600519', '000858', '300750', '002594',
  '601318', '600036', '600030', '601398', '600900',
  '601088', '600150', '600111', '601899', '603993',
  '000333', '000651', '002415', '600276', '300059',
  '002475', '688981', '601012', '600887', '000725'
].join(',')

const modeCommand = (mode: string): [string, string[]] => {
  if (mode === 'automation_health' || mode === 'pre_open_refresh') return ['doctor', []]
  if (mode === 'refine') return ['refine', ['--latest']]
  return ['plan', ['today', '--save']]
}

const commandEvidence = async (label: string, command: string, args: string[]) => {
  try { return `${label}：\n${await runTradeMaster(command, args)}` }
  catch (error) { return `${label}失败：${error instanceof Error ? error.message : String(error)}` }
}

const candidateRefreshEvidence = async (label: string) => {
  try {
    const output = await runTradeMaster('candidate', ['refresh'])
    return `${label}：\n${output}`
  } catch (error) {
    return `${label}失败：${error instanceof Error ? error.message : String(error)}`
  }
}

const modeEvidence = async (mode: string) => {
  if (mode === 'candidate_refresh') return candidateRefreshEvidence('候选模型V2全市场扫描')
  if (mode === 'rolling_backtest') {
    return commandEvidence('公开固定25只标的近1个月多场景滚动回测', 'backtest', [
      'rolling', '--days', '30', '--limit', '25', '--horizon', '3',
      '--codes', PUBLIC_ROLLING_BACKTEST_CODES
    ])
  }
  if (mode === 'intraday') {
    const plan = await commandEvidence('本人及家庭持仓盘中策略检查', 'plan', ['today', '--save'])
    const watchlist = await commandEvidence('非持仓自选买点扫描（我的收藏 + AI 发现）', 'watchlist', ['monitor'])
    const candidates = await commandEvidence('AI 候选模型状态复核', 'candidate', ['monitor', '--limit', '12'])
    return `${plan}\n\n${watchlist}\n\n${candidates}`
  }
  if (mode === 'midday_review') {
    const plan = await commandEvidence('上午持仓与关注列表复盘', 'plan', ['today', '--save'])
    const market = await candidateRefreshEvidence('上午收盘全市场与候选池快照')
    return `${plan}\n\n${market}`
  }
  if (['formal_close', 'post_market', 'refine'].includes(mode)) {
    const [base, signalReview, rollingBacktest] = await Promise.all([
      mode === 'refine'
        ? commandEvidence('最新候选策略硬门槛验证', 'refine', ['--latest'])
        : commandEvidence('Trade Master 检查', 'plan', ['today', '--save']),
      reviewSignalLedger().then((review) => `历史买卖点准确性复盘：\n${JSON.stringify(review)}`)
        .catch((error) => `历史买卖点准确性复盘失败：${error instanceof Error ? error.message : String(error)}`),
      mode === 'formal_close'
        ? Promise.resolve('滚动回测将在正式收盘回填后独立运行。')
        : commandEvidence('最新20至30只标的滚动回测', 'backtest', ['status'])
    ])
    return `${base}\n\n${signalReview}\n\n${rollingBacktest}`
  }
  const [command, args] = modeCommand(mode)
  return commandEvidence('Trade Master 检查', command, args)
}

const messageTime = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
const automationMessage = (content: string, status: ChatMessage['status'] = 'normal'): ChatMessage => ({
  id: crypto.randomUUID(), role: 'assistant', content, timestamp: messageTime(), status
})

const householdMarketEvidence = async (snapshot: TradeMasterSnapshot): Promise<string> => {
  const household = snapshot.household
  if (!household) return ''
  const members = new Map(household.members.map((member) => [member.id, member]))
  const tracked = household.accounts.flatMap((account) => {
    const member = members.get(account.memberId)
    if (!member?.monitoringEnabled || !account.monitoringEnabled) return []
    return account.positions.filter((position) => position.quantity > 0 && position.status !== 'closed').map((position) => ({
      code: position.instrument.code,
      member: member.name,
      account: account.name
    }))
  })
  const byCode = new Map<string, Array<{ member: string; account: string }>>()
  for (const item of tracked) byCode.set(item.code, [...(byCode.get(item.code) || []), { member: item.member, account: item.account }])
  if (!byCode.size) return ''
  const entries = [...byCode.entries()].slice(0, 20)
  try {
    const output = await runTradeMaster('market', ['quotes', '--codes', entries.map(([code]) => code).join(','), '--concurrency', '4'])
    const payload = JSON.parse(output) as { quotes?: Array<{ instrument?: { code?: string } }>; errors?: string[] }
    const accounts = Object.fromEntries(entries)
    const quotes = (payload.quotes || []).map((quote) => ({
      code: quote.instrument?.code,
      accounts: quote.instrument?.code ? accounts[quote.instrument.code] || [] : [],
      quote
    }))
    return `\n\n家庭持仓实时行情（仅包含已开启监控的成员和账户）：\n${JSON.stringify({ dataAsOf: new Date().toISOString(), quotes, errors: payload.errors || [] })}`
  } catch { /* old Trade Master runtimes do not have the batch quotes subcommand */ }
  const quotes: Array<{ code: string; accounts: Array<{ member: string; account: string }>; quote?: unknown; error?: string }> = []
  for (const [code, accounts] of entries) {
    try {
      const output = await runTradeMaster('market', ['quote', '--code', code])
      let quote: unknown = output
      try { quote = JSON.parse(output) } catch { quote = output.slice(0, 2000) }
      quotes.push({ code, accounts, quote })
    } catch (error) {
      quotes.push({ code, accounts, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return `\n\n家庭持仓实时行情（仅包含已开启监控的成员和账户）：\n${JSON.stringify({ dataAsOf: new Date().toISOString(), quotes })}`
}

const runAutomationTaskOnce = async (taskId: string, trigger: 'manual' | 'scheduled'): Promise<AutomationRun> => {
  const startedAt = new Date().toISOString()
  const manifest = await loadManifest()
  const task = (manifest.tasks || []).find((item) => item.id === taskId)
  if (!task) throw new Error('没有找到该自动化任务')
  if (task.enabled === false) throw new Error('任务已停用')
  const mode = String(task.mode || task.id)
  const title = String(task.title || automationTaskTitle(mode))
  const sessionId = automationSessionId(task.id)
  const sessionTitle = `${title} · 定时任务`
  try {
    await appendNamedSessionMessage(sessionId, sessionTitle, automationMessage(
      `定时任务「${title}」已开始${trigger === 'manual' ? '手动' : '按计划'}执行。\n\n模式：${mode}\n结果会自动更新到当前会话。`
    ))
    const quantityRollover = ['pre_market', 'pre_open_refresh'].includes(mode)
      ? await rolloverAvailableQuantitiesBeforeOpen()
      : null
    const [config, snapshot] = await Promise.all([loadAiConfig(), loadTradeMasterSnapshot()])
    let vocEvents: VocEvent[] = []
    let evidence: string
    if (mode === 'voc_monitor') {
      const voc = await collectVocEvidence()
      vocEvents = voc.newEvents
      evidence = `场外 VOC 增量：\n${JSON.stringify(voc)}`
    } else evidence = await modeEvidence(mode)
    if (quantityRollover) evidence = `盘前可用数量滚转：\n${JSON.stringify(quantityRollover)}\n\n${evidence}`
    if (!['candidate_refresh', 'voc_monitor', 'rolling_backtest'].includes(mode)) evidence += await householdMarketEvidence(snapshot)
    const scopeInstruction = mode === 'candidate_refresh'
      ? '本任务只输出市场候选机会。不得展示或提醒本人及家庭账户的持仓、资金、成本、可用数量和交易动作。成功结果固定10只且代码不重复，低波动稳健、3日内短线、中长线趋势、热门主线龙头、强势打板观察各2只；画像影响篮子内排序和执行门槛，但不能删掉其他篮子。任一篮子不足2只必须如实报告并保留原关注列表，不能降低标准凑数。buy_ready_candidates 单独展示买入条件已满足的候选；打板观察不是买点。盈利目标不能放宽回撤、仓位、追涨或交易频率。model.validation_status 不是 validated 时，禁止声称已验证高置信或高胜率。只有全市场数据不可用时才返回 NO_REPLY。'
      : mode === 'voc_monitor'
        ? `宿主采集器每轮都会回溯最近 24 小时，并按平台内容 ID 跳过已经处理或已确认无效的内容；本任务只处理本轮新增的 newEvents。只看股票、A股、证券、基金和市场交易相关内容；足球、篮球、竞彩、买球、娱乐和日常生活内容一律忽略，不得据此推测仓位。重点给出仓位管理的方向性结论：统一归纳为加仓、减仓、清仓或无明确动作。可以依据标题、口播、字幕、市场隐喻和上下文做保守推测，并标注中低置信度；不得虚构原文没有的动作。不要探究或反复提示持仓数量、成交价格、账户范围和精确仓位，这些字段未知不影响方向判断。区分“已经发生”和“计划/情绪表达”，逐条保留账号、发布时间、原始链接及支持方向判断的原句。自然语言先给整体方向结论，再补必要证据，不要逐条重复“实际持仓未确认”。反向指标只用于提高风险警惕，不能单独形成交易建议。newEvents 为空时必须只返回 NO_REPLY。\n${VOC_ANALYSIS_OUTPUT_INSTRUCTION}`
        : mode === 'rolling_backtest'
          ? '本任务只回测已授权的公开固定25只证券代码，不得用持仓、自选、成本、账户或候选池替换或补充回测池；只复盘历史模型信号和统计证据，不输出当前持仓买卖建议，不操作券商，不把训练样本结果冒充样本外表现；必须披露数据源失败、样本不足、场景缺失和未达到80%的指标。'
        : mode === 'intraday'
          ? INTRADAY_SCOPE_INSTRUCTION
          : '如果存在家庭持仓，必须按“成员 → 账户”分别给结论，结合每位成员的风险偏好，不得把不同人的仓位、成本或可用数量合并；monitoring_enabled=false 的成员或账户不做主动提醒。portfolio 是本人主账户的兼容视图，与 household_portfolios 中 source=primary 的账户是同一份数据，只能计算一次。'
    const result = await sendAiMessage(config, [
      { role: 'system', content: buildAutomationSystemPrompt(mode, scopeInstruction, snapshot) },
      { role: 'user', content: `${String(task.prompt || '')}\n\n宿主已经完成 Trade Master 调用，不要再次调用工具。\n\n本次工具证据：\n${evidence}` }
    ], { purpose: 'automation' })
    const noReply = result.trim() === 'NO_REPLY'
    const cards = noReply || mode === 'voc_monitor' ? [] : parseStockStrategyPayload(result, mode === 'candidate_refresh' ? 10 : 8, true)
    const vocAnalysis = noReply || mode !== 'voc_monitor' ? undefined : parseVocAnalysis(result, vocEvents)
    const visibleResult = noReply ? '' : stripVocAnalysisPayload(stripStockStrategyPayload(result))
    if (mode === 'voc_monitor' && vocEvents.length) {
      const summary = noReply ? `本批 ${vocEvents.length} 条股市内容已检查，未形成新的仓位或情绪结论。` : visibleResult
      await saveVocRiskReport(vocEvents, summary, vocAnalysis)
    }
    const message = automationMessage(noReply
      ? `定时任务「${title}」执行完成，本次没有材料变化（NO_REPLY）。`
      : `定时任务「${title}」执行完成。\n\n${visibleResult}`
    )
    message.stockStrategyCards = cards.length ? cards : undefined
    await appendNamedSessionMessage(sessionId, sessionTitle, message)
    if (!noReply && mode === 'intraday') await runTradeMaster('watchlist', ['ack']).catch(() => undefined)
    if (mode === 'post_market') {
      try { await generateReviewReport({ period: 'daily' }) } catch { /* review generation must not block the automation run */ }
      const clock = shanghaiClock(new Date())
      const isFriday = clock.weekday === 'Fri'
      const isLastTradingDayOfMonth = clock.day >= 26 && clock.weekday !== 'Sat' && clock.weekday !== 'Sun'
      if (isFriday) {
        try { await generateReviewReport({ period: 'weekly' }) } catch { /* weekly review generation must not block the automation run */ }
      }
      if (isLastTradingDayOfMonth) {
        try { await generateReviewReport({ period: 'monthly' }) } catch { /* monthly review generation must not block the automation run */ }
      }
    }
    if (!noReply && trigger === 'scheduled') {
      if (Notification.isSupported()) new Notification({ title: `韭菜盒子 · ${title}`, body: visibleResult.slice(0, 180) }).show()
      const notifications = snapshot.notifications as { enabled?: boolean; receiver?: unknown } | null
      if ((notifications?.enabled || notifications?.receiver) && shouldSendAutomationNotification(trigger, visibleResult)) {
        const notificationDir = await mkdtemp(join(tmpdir(), 'jiucai-notification-'))
        const payloadPath = join(notificationDir, 'payload.json')
        try {
          await writeFile(payloadPath, `${JSON.stringify(buildAutomationNotificationPayload(String(task.id), String(task.mode || task.id), visibleResult, new Date(), title), null, 2)}\n`, 'utf8')
          await runTradeMaster('notify', ['feishu', '--payload', payloadPath])
        } catch { /* local audit remains available if the external channel fails */ }
        finally { await rm(notificationDir, { recursive: true, force: true }) }
      }
    }
    return saveAutomationRun({ taskId, mode, trigger, startedAt, finishedAt: new Date().toISOString(), status: noReply ? 'no_reply' : 'success', summary: noReply ? '无材料变化' : visibleResult.slice(0, 500), sessionId })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    try { await appendNamedSessionMessage(sessionId, sessionTitle, automationMessage(`定时任务「${title}」执行失败：${errorMessage}`, 'error')) }
    catch { /* the JSON run audit still records failures when the session store is unavailable */ }
    return saveAutomationRun({ taskId, mode, trigger, startedAt, finishedAt: new Date().toISOString(), status: 'failed', summary: '执行失败', error: errorMessage, sessionId })
  }
}

const activeRuns = new Map<string, Promise<AutomationRun>>()
export const runAutomationTask = (taskId: string, trigger: 'manual' | 'scheduled' = 'manual'): Promise<AutomationRun> => {
  const existing = activeRuns.get(taskId)
  if (existing) return existing
  const running = runAutomationTaskOnce(taskId, trigger)
  activeRuns.set(taskId, running)
  void running.then(() => activeRuns.delete(taskId), () => activeRuns.delete(taskId))
  return running
}

interface ShanghaiClock { year: number; month: number; day: number; hour: number; minute: number; weekday: string }
const shanghaiClock = (date: Date): ShanghaiClock => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return { year: Number(pick('year')), month: Number(pick('month')), day: Number(pick('day')), hour: Number(pick('hour')), minute: Number(pick('minute')), weekday: pick('weekday') }
}
const sameShanghaiMinute = (left: Date, right: Date) => {
  const a = shanghaiClock(left); const b = shanghaiClock(right)
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute
}

export const isAutomationDue = (task: Record<string, unknown>, now: Date): boolean => {
  if (task.enabled === false) return false
  const last = typeof task.last_run_at === 'string' ? new Date(task.last_run_at) : null
  const schedule = task.schedule as { kind?: string; expression?: string; times?: string[]; interval_minutes?: number; windows?: string[] } | undefined
  const clock = shanghaiClock(now)
  if (!schedule) return false
  const weekend = clock.weekday === 'Sat' || clock.weekday === 'Sun'
  if (schedule.kind !== 'daily_window' && weekend) return false
  if (schedule.kind === 'market_window' || schedule.kind === 'daily_window') {
    const time = `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
    const inWindow = (schedule.windows || []).some((window) => { const [start, end] = window.split('-'); return time >= start && time <= end })
    return inWindow && (!last || now.getTime() - last.getTime() >= (schedule.interval_minutes || 3) * 60_000)
  }
  if (schedule.kind === 'cron') {
    const [minuteText, hourText] = String(schedule.expression || '').split(' ')
    const minutes = minuteText.split(',').map(Number)
    const hours = hourText.split(',').map(Number)
    const sameMinute = last && sameShanghaiMinute(last, now)
    const time = `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
    const scheduled = schedule.times?.length ? schedule.times.includes(time) : minutes.includes(clock.minute) && hours.includes(clock.hour)
    return scheduled && !sameMinute
  }
  return false
}

let scheduler: NodeJS.Timeout | null = null
let schedulerBusy = false
export const startAutomationScheduler = () => {
  if (scheduler) return
  scheduler = setInterval(async () => {
    if (schedulerBusy) return
    schedulerBusy = true
    try {
      const manifest = await loadManifest()
      if (manifest.install_status !== 'installed') return
      const now = new Date()
      for (const task of manifest.tasks || []) if (isAutomationDue(task, now)) await runAutomationTask(task.id, 'scheduled')
    } catch { /* a missing manifest is normal before initialization */ }
    finally { schedulerBusy = false }
  }, 30_000)
}

export const stopAutomationScheduler = () => {
  if (scheduler) clearInterval(scheduler)
  scheduler = null
}
