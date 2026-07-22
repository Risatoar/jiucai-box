import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AiConfig } from '../shared/types'
import { sendAiMessage } from './ai-provider'

interface CandidateDraft {
  title?: string
  problem?: string
  target_rule?: string
  risk_level?: 'L1' | 'L2' | 'L3'
  proposed_rules?: string[]
  acceptance_checks?: string[]
  rollback_plan?: string
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

export const persistStrategyCandidate = async (prompt: string, draft: CandidateDraft): Promise<{ file: string; candidate: Record<string, unknown> }> => {
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
    source: { kind: 'jiucai-box-conversation', prompt, created_at: createdAt },
    auto_promoted: false
  }
  const home = process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
  const directory = join(home, 'strategies/candidates')
  const file = join(directory, `${id}.json`)
  await mkdir(directory, { recursive: true })
  await writeFile(file, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { file, candidate }
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
