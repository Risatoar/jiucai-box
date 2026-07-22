import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

type DisciplineDocument = Record<string, unknown> & {
  schema_version?: number
  state?: string
  source_refs?: unknown
  migration?: unknown
  latest_recovery_review?: Record<string, unknown>
}

const home = () => process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
const disciplinePath = () => join(home(), 'discipline.json')

const atomicWrite = async (target: string, value: unknown) => {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
}

const historyName = (timestamp: string) => `${timestamp.replace(/[:.]/g, '-')}.json`

export const confirmNormalDiscipline = async (reason = '用户确认已完成当前账户与风险信息复核'): Promise<DisciplineDocument> => {
  const target = disciplinePath()
  const current = JSON.parse(await readFile(target, 'utf8')) as DisciplineDocument
  const previousState = String(current.state || 'UNKNOWN').toUpperCase()
  if (previousState === 'NORMAL') return current

  const timestamp = new Date().toISOString()
  const historyRelativePath = join('discipline/history', historyName(timestamp))
  await atomicWrite(join(home(), historyRelativePath), current)

  const priorReview = current.latest_recovery_review || {}
  const next: DisciplineDocument = {
    schema_version: current.schema_version || 1,
    state: 'NORMAL',
    previous_state: previousState,
    effective_from: timestamp,
    updated_at: timestamp,
    reasons: [reason],
    allowed_actions: ['仅在行情、账户、费用、交易状态和策略闸门全部通过后评估计划内交易'],
    prohibited_actions: ['任何未通过现有风险、账户、行情、费用或策略闸门的交易'],
    recovery: {
      confirmed_at: timestamp,
      confirmed_by: 'user',
      result: 'recover_to_normal'
    },
    latest_recovery_review: {
      ...priorReview,
      reviewed_at: timestamp,
      result: 'recover_to_normal',
      remaining_blockers: [],
      confirmation: reason
    },
    history_ref: historyRelativePath,
    ...(current.source_refs == null ? {} : { source_refs: current.source_refs }),
    ...(current.migration == null ? {} : { migration: current.migration })
  }
  await atomicWrite(target, next)
  return next
}
