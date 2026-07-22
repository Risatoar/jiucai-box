import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AutomationRun } from '../shared/types'
import type { AutomationSchedule, AutomationTaskInput } from '../shared/automation-schedule'
import { isSystemAutomationTask } from '../shared/automation'

interface Task { id: string; mode?: string; title?: string; description?: string; prompt?: string; enabled?: boolean; system_default?: boolean; schedule?: AutomationSchedule; last_run_at?: string; next_run_at?: string; last_status?: string; [key: string]: unknown }
interface Manifest { install_status?: string; tasks?: Task[]; [key: string]: unknown }
const home = () => process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
const manifestPath = () => join(home(), 'automation/manifest.json')
const writeJson = async (target: string, value: unknown) => {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
}
export const loadManifest = async () => JSON.parse(await readFile(manifestPath(), 'utf8')) as Manifest
const cleanText = (value: string, label: string, maxLength: number, required = true) => {
  const cleaned = String(value || '').trim()
  if (required && !cleaned) throw new Error(`${label}不能为空`)
  if (cleaned.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`)
  return cleaned
}
const validTime = (value: string) => {
  const matched = /^(\d{2}):(\d{2})$/.exec(value)
  return Boolean(matched && Number(matched[1]) <= 23 && Number(matched[2]) <= 59)
}
const normalizeSchedule = (schedule: AutomationSchedule): AutomationSchedule => {
  if (schedule.kind === 'cron') {
    const times = [...new Set((schedule.times || []).map(String))].filter(validTime).sort()
    if (times.length) return { kind: 'cron', times }
    const expression = String(schedule.expression || '').trim()
    if (!/^[\d,]+\s+[\d,]+\s+\*\s+\*\s+1-5$/.test(expression)) throw new Error('请至少设置一个有效运行时间')
    return { kind: 'cron', expression }
  }
  if (schedule.kind === 'market_window' || schedule.kind === 'daily_window') {
    const windows = [...new Set((schedule.windows || []).map(String))]
    if (!windows.length || windows.some((window) => {
      const matched = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window)
      return !matched || !validTime(`${matched[1]}:${matched[2]}`) || !validTime(`${matched[3]}:${matched[4]}`) || `${matched[1]}:${matched[2]}` >= `${matched[3]}:${matched[4]}`
    })) throw new Error('请设置有效的交易时间段')
    const interval = Number(schedule.interval_minutes)
    if (!Number.isInteger(interval) || interval < 1 || interval > 120) throw new Error('检查间隔需为 1 到 120 分钟')
    return { kind: schedule.kind, interval_minutes: interval, windows }
  }
  throw new Error('请选择任务运行方式')
}
const normalizeTaskInput = (input: AutomationTaskInput) => ({
  title: cleanText(input.title, '任务名称', 40),
  description: cleanText(input.description, '任务说明', 120, false) || '按设定时间自动检查并提醒',
  prompt: cleanText(input.prompt, '任务内容', 4000),
  enabled: input.enabled !== false,
  schedule: normalizeSchedule(input.schedule)
})
export const installAutomations = async () => {
  const manifest = await loadManifest()
  await writeJson(manifestPath(), { ...manifest, install_status: 'installed', installed_at: new Date().toISOString(), tasks: (manifest.tasks || []).map((task) => ({ ...task, enabled: true })) })
}
export const setAutomationEnabled = async (id: string, enabled: boolean) => {
  const manifest = await loadManifest()
  if (!(manifest.tasks || []).some((task) => task.id === id)) throw new Error('没有找到该任务')
  await writeJson(manifestPath(), { ...manifest, tasks: (manifest.tasks || []).map((task) => task.id === id ? { ...task, enabled } : task) })
}
export const createAutomationTask = async (input: AutomationTaskInput) => {
  const manifest = await loadManifest()
  const task: Task = {
    id: `custom-${randomUUID()}`,
    mode: 'custom',
    system_default: false,
    ...normalizeTaskInput(input),
    created_at: new Date().toISOString()
  }
  await writeJson(manifestPath(), { ...manifest, updated_at: new Date().toISOString(), tasks: [...(manifest.tasks || []), task] })
  return task
}
export const updateAutomationTask = async (id: string, input: AutomationTaskInput) => {
  const manifest = await loadManifest()
  const current = (manifest.tasks || []).find((task) => task.id === id)
  if (!current) throw new Error('没有找到该任务')
  const updated = {
    ...current,
    ...normalizeTaskInput(input),
    system_default: current.system_default === true || isSystemAutomationTask(id),
    next_run_at: undefined,
    updated_at: new Date().toISOString()
  }
  await writeJson(manifestPath(), { ...manifest, updated_at: new Date().toISOString(), tasks: (manifest.tasks || []).map((task) => task.id === id ? updated : task) })
  return updated
}
export const deleteAutomationTask = async (id: string) => {
  const manifest = await loadManifest()
  const current = (manifest.tasks || []).find((task) => task.id === id)
  if (!current) throw new Error('没有找到该任务')
  if (current.system_default === true || isSystemAutomationTask(id)) throw new Error('系统默认任务不能删除，可以停用或修改')
  await writeJson(manifestPath(), { ...manifest, updated_at: new Date().toISOString(), tasks: (manifest.tasks || []).filter((task) => task.id !== id) })
  return true
}
export const preserveCustomAutomations = async (operation: () => Promise<unknown>) => {
  let customTasks: Task[] = []
  try {
    const current = await loadManifest()
    customTasks = (current.tasks || []).filter((task) => task.system_default === false || !isSystemAutomationTask(task.id))
  } catch { /* the first default plan may run before a manifest exists */ }
  await operation()
  if (!customTasks.length) return
  const planned = await loadManifest()
  const defaults = (planned.tasks || []).filter((task) => isSystemAutomationTask(task.id)).map((task) => ({ ...task, system_default: true }))
  await writeJson(manifestPath(), { ...planned, tasks: [...defaults, ...customTasks], updated_at: new Date().toISOString() })
}
export const updateTaskRun = async (taskId: string, status: AutomationRun['status']) => {
  const manifest = await loadManifest()
  await writeJson(manifestPath(), { ...manifest, tasks: (manifest.tasks || []).map((task) => task.id === taskId ? { ...task, last_run_at: new Date().toISOString(), last_status: status } : task) })
}
export const saveAutomationRun = async (input: Omit<AutomationRun, 'id'>): Promise<AutomationRun> => {
  const run = { ...input, id: randomUUID() }
  await writeJson(join(home(), 'automation/runs', `${run.startedAt.replace(/[:.]/g, '-')}-${run.taskId}.json`), run)
  await updateTaskRun(run.taskId, run.status)
  return run
}
