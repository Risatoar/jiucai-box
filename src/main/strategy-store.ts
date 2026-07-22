import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

interface ActiveStrategies { version?: string; updated_at?: string; rules?: Array<Record<string, unknown>>; [key: string]: unknown }

interface RefinementEvidence {
  history_samples: number
  out_of_sample_samples: number
  shadow_days: number
  drawdown_delta: number
  profit_factor: number
  conflicts: number
}

export interface CandidatePromotionReadiness {
  file: string
  ready: boolean
  evidence: RefinementEvidence
  message: string
}

const home = () => process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
const activePath = () => join(home(), 'strategies/active.json')
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '-')
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

const writeJson = async (target: string, value: unknown) => {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
}

const loadActive = async () => JSON.parse(await readFile(activePath(), 'utf8')) as ActiveStrategies

const snapshotActive = async (active: ActiveStrategies, reason: string) => {
  await writeJson(join(home(), 'strategies/versions', `${stamp()}-${reason}.json`), {
    kind: 'active_snapshot', captured_at: new Date().toISOString(), reason, active
  })
}

export const setStrategyState = async (id: string, action: 'pause' | 'enable'): Promise<void> => {
  const active = await loadActive()
  const rules = active.rules || []
  if (action === 'pause') {
    const rule = rules.find((item) => item.id === id)
    if (!rule) throw new Error('正在使用的规则中没有找到这一条')
    await snapshotActive(active, `before-pause-${safe(id)}`)
    await writeJson(join(home(), 'strategies/paused', `${safe(id)}.json`), {
      id, status: 'paused', paused_at: new Date().toISOString(), rule
    })
    await writeJson(activePath(), { ...active, updated_at: new Date().toISOString(), rules: rules.filter((item) => item.id !== id) })
    return
  }
  const pausedPath = join(home(), 'strategies/paused', `${safe(id)}.json`)
  const paused = JSON.parse(await readFile(pausedPath, 'utf8')) as { rule?: Record<string, unknown> }
  if (!paused.rule) throw new Error('暂停记录缺少原始规则')
  if (rules.some((item) => item.id === id)) throw new Error('该策略已启用')
  await snapshotActive(active, `before-enable-${safe(id)}`)
  await writeJson(activePath(), { ...active, updated_at: new Date().toISOString(), rules: [...rules, paused.rule] })
  await mkdir(join(home(), 'strategies/versions'), { recursive: true })
  await rename(pausedPath, join(home(), 'strategies/versions', `${stamp()}-enabled-${safe(id)}.json`))
}

export const findCandidateFile = async (id: string): Promise<string> => {
  const root = join(home(), 'strategies/candidates')
  const files = (await readdir(root)).filter((file) => file.endsWith('.json'))
  for (const file of files) {
    const value = JSON.parse(await readFile(join(root, file), 'utf8')) as { id?: string; target_rule?: string }
    if (value.id === id || value.target_rule === id || basename(file, '.json') === id) return join(root, file)
  }
  throw new Error('没有找到这条待验证规则')
}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const numberOrZero = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

export const inspectCandidatePromotion = async (id: string): Promise<CandidatePromotionReadiness> => {
  const file = await findCandidateFile(id)
  const candidate = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  const rawEvidence = record(candidate.evidence)
  const evidence: RefinementEvidence = {
    history_samples: numberOrZero(rawEvidence?.history_samples),
    out_of_sample_samples: numberOrZero(rawEvidence?.out_of_sample_samples),
    shadow_days: numberOrZero(rawEvidence?.shadow_days),
    drawdown_delta: numberOrZero(rawEvidence?.drawdown_delta),
    profit_factor: numberOrZero(rawEvidence?.profit_factor),
    conflicts: numberOrZero(rawEvidence?.conflicts)
  }
  const evidenceFields = ['history_samples', 'out_of_sample_samples', 'shadow_days', 'drawdown_delta', 'profit_factor', 'conflicts']
  const evidenceComplete = Boolean(rawEvidence && evidenceFields.every((field) => typeof rawEvidence[field] === 'number' && Number.isFinite(rawEvidence[field])))
  const missing: string[] = []
  if (!record(candidate.rule)) missing.push('可以执行的规则内容')
  if (!String(candidate.description || '').trim()) missing.push('规则说明')
  if (!evidenceComplete) missing.push('完整验证数据')
  if (!missing.length) return { file, ready: true, evidence, message: '规则内容完整，可以开始检查是否达到启用条件。' }
  return {
    file,
    ready: false,
    evidence,
    message: `暂时不能启用：还缺少${missing.join('、')}；目前已完成历史行情测试 ${evidence.history_samples}/30、新行情测试 ${evidence.out_of_sample_samples}/10、模拟观察 ${evidence.shadow_days}/5 天。请继续完成验证，正在使用的规则没有变化。`
  }
}

export const rollbackStrategies = async (): Promise<void> => {
  const root = join(home(), 'strategies/versions')
  const files = (await readdir(root)).filter((file) => file.endsWith('.json')).sort().reverse()
  for (const file of files) {
    const value = JSON.parse(await readFile(join(root, file), 'utf8')) as { kind?: string; active?: ActiveStrategies }
    if (value.kind !== 'active_snapshot' || !value.active) continue
    const current = await loadActive()
    await snapshotActive(current, 'before-rollback')
    await writeJson(activePath(), { ...value.active, updated_at: new Date().toISOString(), rollback_file: file })
    return
  }
  throw new Error('还没有可以恢复的历史版本')
}
