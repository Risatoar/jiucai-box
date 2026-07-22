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
import { buildAutomationSystemPrompt } from './automation-prompt'

const modeCommand = (mode: string): [string, string[]] => {
  if (mode === 'automation_health' || mode === 'pre_open_refresh') return ['doctor', []]
  if (mode === 'refine') return ['evolve', ['status']]
  return ['plan', ['today', '--save']]
}

const INTRADAY_SCOPE_INSTRUCTION = '盘中必须分成两条独立通道。第一条“持仓策略”覆盖本人及已开启监控的家庭账户持仓，分别给买入、持有、减仓或卖出策略；只有闭合K线和独立证据形成强烈买入或卖出信号时才提醒。第二条“自选买点”覆盖非持仓关注列表中的 source=user（我的收藏）和 source=agent（AI发现），只判断是否出现高质量买点，不输出卖出策略；必须以 watchlist monitor 的 new_buy_signals 和 invalidated_buy_signals 为提醒依据，重复的 buy_ready 不得再次提醒。形成中的K线只能预览，不能触发提醒。两条通道都没有材料变化时必须只返回 NO_REPLY。如果存在家庭持仓，必须按“成员 → 账户”分别给结论，结合每位成员的风险偏好，不得把不同人的仓位、成本或可用数量合并；monitoring_enabled=false 的成员或账户不做主动提醒。portfolio 是本人主账户的兼容视图，与 household_portfolios 中 source=primary 的账户是同一份数据，只能计算一次。'

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
  if (mode === 'intraday') {
    const [plan, watchlist, candidates] = await Promise.all([
      commandEvidence('本人及家庭持仓盘中策略检查', 'plan', ['today', '--save']),
      commandEvidence('非持仓自选买点扫描（我的收藏 + AI 发现）', 'watchlist', ['monitor']),
      commandEvidence('AI 候选模型状态复核', 'candidate', ['monitor', '--limit', '12'])
    ])
    return `${plan}\n\n${watchlist}\n\n${candidates}`
  }
  if (mode === 'midday_review') {
    const [plan, market] = await Promise.all([
      commandEvidence('上午持仓与关注列表复盘', 'plan', ['today', '--save']),
      candidateRefreshEvidence('上午收盘全市场与候选池快照')
    ])
    return `${plan}\n\n${market}`
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
  const quotes = await Promise.all([...byCode.entries()].slice(0, 20).map(async ([code, accounts]) => {
    try {
      const output = await runTradeMaster('market', ['quote', '--code', code])
      let quote: unknown = output
      try { quote = JSON.parse(output) } catch { quote = output.slice(0, 2000) }
      return { code, accounts, quote }
    } catch (error) {
      return { code, accounts, error: error instanceof Error ? error.message : String(error) }
    }
  }))
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
    if (!['candidate_refresh', 'voc_monitor'].includes(mode)) evidence += await householdMarketEvidence(snapshot)
    const scopeInstruction = mode === 'candidate_refresh'
      ? '本任务只输出市场候选机会。不得展示或提醒本人及家庭账户的持仓、资金、成本、可用数量和交易动作。必须读取用户设置中的盈利目标、期限、资金暴露、交易成本和最大回撤；candidates 只展示0至5个通过目标覆盖率、绝对分数与成本效率门槛的模型关注候选，buy_ready_candidates 单独展示其中买入条件已满足的候选；任一列表为空都必须如实说明，不能凑数或把关注候选写成买点。盈利目标只能提高候选质量，不能放宽回撤、仓位、追涨或交易频率。model.validation_status 不是 validated 时，禁止声称已验证高置信或高胜率。只有全市场数据不可用时才返回 NO_REPLY。'
      : mode === 'voc_monitor'
        ? `宿主采集器每轮都会回溯最近 24 小时，并按平台内容 ID 跳过已经处理或已确认无效的内容；本任务只处理本轮新增的 newEvents。只看股票、A股、证券、基金和市场交易相关内容；足球、篮球、竞彩、买球、娱乐和日常生活内容一律忽略，不得据此推测仓位。重点给出仓位管理的方向性结论：统一归纳为加仓、减仓、清仓或无明确动作。可以依据标题、口播、字幕、市场隐喻和上下文做保守推测，并标注中低置信度；不得虚构原文没有的动作。不要探究或反复提示持仓数量、成交价格、账户范围和精确仓位，这些字段未知不影响方向判断。区分“已经发生”和“计划/情绪表达”，逐条保留账号、发布时间、原始链接及支持方向判断的原句。自然语言先给整体方向结论，再补必要证据，不要逐条重复“实际持仓未确认”。反向指标只用于提高风险警惕，不能单独形成交易建议。newEvents 为空时必须只返回 NO_REPLY。\n${VOC_ANALYSIS_OUTPUT_INSTRUCTION}`
        : mode === 'intraday'
          ? INTRADAY_SCOPE_INSTRUCTION
          : '如果存在家庭持仓，必须按“成员 → 账户”分别给结论，结合每位成员的风险偏好，不得把不同人的仓位、成本或可用数量合并；monitoring_enabled=false 的成员或账户不做主动提醒。portfolio 是本人主账户的兼容视图，与 household_portfolios 中 source=primary 的账户是同一份数据，只能计算一次。'
    const result = await sendAiMessage(config, [
      { role: 'system', content: buildAutomationSystemPrompt(mode, scopeInstruction, snapshot) },
      { role: 'user', content: `${String(task.prompt || '')}\n\n宿主已经完成 Trade Master 调用，不要再次调用工具。\n\n本次工具证据：\n${evidence}` }
    ], { purpose: 'automation' })
    const noReply = result.trim() === 'NO_REPLY'
    const cards = noReply || mode === 'voc_monitor' ? [] : parseStockStrategyPayload(result, mode === 'candidate_refresh' ? 5 : 8)
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
