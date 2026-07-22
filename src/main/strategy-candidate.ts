import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AiConfig } from '../shared/types'
import { sendAiMessage } from './ai-provider'

export interface CandidateDraft {
  title?: string
  problem?: string
  target_rule?: string
  risk_level?: 'L1' | 'L2' | 'L3'
  proposed_rules?: string[]
  acceptance_checks?: string[]
  rollback_plan?: string
}

interface PersistCandidateOptions {
  sourceKind?: 'jiucai-box-conversation' | 'jiucai-box-json-import'
  importedId?: string
}

const cleanJson = (value: string): string => value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'strategy-improvement'

const parseDraft = (content: string): CandidateDraft => {
  const draft = JSON.parse(cleanJson(content)) as CandidateDraft
  if (!draft.title || !draft.target_rule || !Array.isArray(draft.proposed_rules) || !Array.isArray(draft.acceptance_checks)) {
    throw new Error('AI 返回的交易规则缺少必要内容，本次没有保存')
  }
  return draft
}

export const persistStrategyCandidate = async (prompt: string, draft: CandidateDraft, options: PersistCandidateOptions = {}): Promise<{ file: string; candidate: Record<string, unknown> }> => {
  const riskLevel = ['L1', 'L2', 'L3'].includes(String(draft.risk_level)) ? draft.risk_level! : 'L2'
  const createdAt = new Date().toISOString()
  const id = `app-${createdAt.replace(/[:.]/g, '-')}-${slug(String(draft.target_rule))}`
  const candidate: Record<string, unknown> = {
    schema_version: 1,
    id,
    title: String(draft.title),
    problem: String(draft.problem || prompt),
    target_rule: String(draft.target_rule),
    risk_level: riskLevel,
    status: riskLevel === 'L3' ? 'protected_blocked' : riskLevel === 'L2' ? 'collecting_evidence' : 'draft_pending_checks',
    proposed_rules: draft.proposed_rules!.map(String),
    acceptance_checks: draft.acceptance_checks!.map(String),
    rollback_plan: String(draft.rollback_plan || '这条规则还没有启用，不需要恢复。'),
    source: { kind: options.sourceKind || 'jiucai-box-conversation', prompt, created_at: createdAt, ...(options.importedId ? { imported_id: options.importedId } : {}) },
    auto_promoted: false
  }
  const home = process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
  const directory = join(home, 'strategies/candidates')
  const file = join(directory, `${id}.json`)
  await mkdir(directory, { recursive: true })
  await writeFile(file, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { file, candidate }
}

const objectValue = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 顶层必须是一个策略对象')
  return value as Record<string, unknown>
}

const requiredText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少${label}`)
  return value.trim()
}

const ruleList = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length === 0) throw new Error('rules 必须是非空字符串数组')
  if (value.length > 50 || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 1000)) throw new Error('rules 最多 50 条，每条不能超过 1000 字')
  return value.map((item) => String(item).trim())
}

export const importStrategyCandidate = async (raw: string): Promise<{ file: string; candidate: Record<string, unknown> }> => {
  if (!raw.trim() || raw.length > 100_000) throw new Error('JSON 文件不能为空且不能超过 100 KB')
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { throw new Error('JSON 格式不正确，请检查逗号、引号和括号') }
  const envelope = objectValue(parsed)
  const strategy = objectValue(envelope.strategy || envelope)
  const id = requiredText(strategy.id || strategy.target_rule, '策略 ID')
  const title = requiredText(strategy.name || strategy.title, '策略名称')
  const rules = ruleList(strategy.rules || strategy.proposed_rules)
  const checks = Array.isArray(strategy.acceptance_checks)
    ? strategy.acceptance_checks.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
    : ['至少完成 30 个历史样本验证', '至少完成 10 个样本外验证', '至少模拟观察 5 天']
  if (!checks.length || checks.length > 30) throw new Error('acceptance_checks 必须包含 1 到 30 条检查项')
  const requestedRisk = String(strategy.risk_level || 'L2')
  const riskLevel: CandidateDraft['risk_level'] = requestedRisk === 'L1' || requestedRisk === 'L3' ? requestedRisk : 'L2'
  return persistStrategyCandidate(`从 JSON 导入：${title}`, {
    title,
    problem: typeof strategy.description === 'string' ? strategy.description : '从 JSON 导入，等待验证后再决定是否启用。',
    target_rule: id,
    risk_level: riskLevel,
    proposed_rules: rules,
    acceptance_checks: checks,
    rollback_plan: typeof strategy.rollback_plan === 'string' ? strategy.rollback_plan : '导入内容尚未启用，不需要恢复。'
  }, { sourceKind: 'jiucai-box-json-import', importedId: id })
}

export const createStrategyCandidate = async (config: AiConfig, prompt: string, factContext?: string): Promise<{ file: string; candidate: Record<string, unknown> }> => {
  const content = await sendAiMessage(config, [{ role: 'user', content: [
      '把下面的交易策略改进意图转换成一个 JSON 对象，不要输出 Markdown。',
      '字段必须包含 title、problem、target_rule、risk_level、proposed_rules、acceptance_checks、rollback_plan。',
      'risk_level 只能是 L1/L2/L3：交易信号和阈值属于 L2；持仓事实、风险上限、安全宪法、券商操作属于 L3。',
      factContext ? `用户当前确认过的交易记录：${factContext}` : '',
      `用户意图：${prompt}`
    ].filter(Boolean).join('\n') }])
  return persistStrategyCandidate(prompt, parseDraft(content))
}
