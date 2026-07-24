import { useState } from 'react'
import { Beaker, BrainCircuit, ChevronRight, GitBranch, ShieldCheck, Sparkles } from 'lucide-react'
import type { StrategyDefinition } from '../../../shared/types'

interface StrategyLabViewProps {
  strategies: StrategyDefinition[]
  onAskAi: () => void
  onCreateCandidate: (prompt: string) => Promise<{ ok: boolean; error?: string }>
  versionCount: number
}

const familyLabels: Record<string, string> = {
  '从历史交易中整理': '从历史交易中整理',
  '等待验证': '待验证',
  '交易习惯': '交易习惯',
  'automation': '自动化任务',
  'monitoring': '盘中监控',
  'data_quality': '数据质量',
  'output': '输出约束',
  'workflow': '工作流',
  'evolution': '交易习惯'
}

const labelFamily = (family: string): string => familyLabels[family] || family

const safetyRules = [
  '不会连接券商帮你下单、撤单或改单',
  'AI 的建议不算成交，只有你确认后才会更新持仓',
  '交易记录对不上时，不会给出具体买卖数量',
  'API Key 只保存在这台电脑上，不会写进对话或运行记录'
]

export function StrategyLabView({ strategies, onAskAi, onCreateCandidate, versionCount }: StrategyLabViewProps) {
  const active = strategies.filter((item) => item.status === 'active')
  const [selectedId, setSelectedId] = useState(active[0]?.id || '')
  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)
  const [candidateError, setCandidateError] = useState('')
  const [candidateCreated, setCandidateCreated] = useState(false)
  const selected = active.find((item) => item.id === selectedId) || active[0] || null

  const createCandidate = async () => {
    if (!prompt.trim() || creating) return
    setCreating(true)
    setCandidateError('')
    const result = await onCreateCandidate(prompt.trim())
    setCreating(false)
    if (!result.ok) { setCandidateError(result.error || '规则生成失败'); return }
    setCandidateCreated(true)
    window.setTimeout(() => setCandidateCreated(false), 2500)
    setPrompt('')
  }

  if (!active.length) return (
    <section className="content-view strategy-lab">
      <div className="view-heading"><div><h1>交易规则</h1><p>这里记录 AI 在什么情况下提醒你、什么时候建议停手。</p></div><button className="primary-button" onClick={onAskAi} type="button"><Sparkles size={15} />和 AI 商量规则</button></div>
      <div className="empty-state"><div className="empty-icon"><Beaker size={22} /></div><h2>还没有交易规则</h2><p>告诉 AI 你想解决的问题，它会帮你整理成一条规则。</p></div>
      <div className={candidateError ? 'ai-strategy-composer error' : 'ai-strategy-composer'}><div className="ai-composer-icon"><Sparkles size={17} /></div><div className="ai-composer-copy"><strong>{candidateError || '创建第一条交易规则'}</strong><span>AI 生成失败时不会保存任何内容。</span></div><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createCandidate()} placeholder="例如：连续亏两次后提醒我今天停手" /><button className="primary-button" disabled={!prompt.trim() || creating} onClick={() => void createCandidate()} type="button"><GitBranch size={14} />{creating ? '生成中…' : '生成规则'}</button></div>
    </section>
  )

  return (
    <section className="content-view strategy-lab">
      <div className="view-heading"><div><h1>交易规则</h1><p>AI 会遵守这些规则来给你建议，不会自动交易。</p></div><button className="primary-button" onClick={onAskAi} type="button"><Sparkles size={15} />和 AI 商量规则</button></div>

      <div className="strategy-safety-card">
        <div className="strategy-safety-header">
          <span className="strategy-safety-icon"><ShieldCheck size={18} /></span>
          <div className="strategy-safety-title">
            <strong>AI 安全承诺</strong>
            <span>这些底线任何规则都不能修改</span>
          </div>
        </div>
        <ul className="strategy-safety-list">
          {safetyRules.map((rule) => <li key={rule}><span className="strategy-safety-bullet" />{rule}</li>)}
        </ul>
      </div>

      <div className="strategy-stats">
        <div className="strategy-stat">
          <span className="strategy-stat-icon"><BrainCircuit size={15} /></span>
          <div className="strategy-stat-copy"><strong>{active.length}</strong><small>条规则正在使用</small></div>
        </div>
        <div className="strategy-stat">
          <span className="strategy-stat-icon amber"><ShieldCheck size={15} /></span>
          <div className="strategy-stat-copy"><strong>{versionCount}</strong><small>个历史版本可恢复</small></div>
        </div>
      </div>

      <div className="strategy-workbench">
        <div className="strategy-list-panel">
          <div className="strategy-list-title"><span>正在使用的规则</span></div>
          <div className="strategy-list-scroll">
            {active.map((strategy) => (
              <button className={strategy.id === selected?.id ? 'strategy-list-item active' : 'strategy-list-item'} key={strategy.id} onClick={() => setSelectedId(strategy.id)} type="button">
                <span className="strategy-status-dot active" />
                <div className="strategy-list-copy"><strong>{strategy.name}</strong><small>{labelFamily(strategy.family)}</small></div>
                <ChevronRight size={13} className="strategy-list-chevron" />
              </button>
            ))}
          </div>
        </div>

        {selected && <div className="strategy-detail">
          <div className="strategy-detail-head">
            <div className="strategy-detail-title">
              <div className="strategy-name-row">
                <h2>{selected.name}</h2>
                <span className="strategy-status active">正在使用</span>
                {selected.source === 'ai-evolved' && <span className="ai-evolved"><Beaker size={11} />AI 整理</span>}
              </div>
              <p>{selected.description}</p>
            </div>
          </div>

          <div className="strategy-detail-grid">
            <section className="rule-section">
              <div className="strategy-section-title"><span>规则内容</span></div>
              <ol className="rule-list">
                {selected.rules.map((rule, index) => (
                  <li key={rule}><span className="rule-index">{index + 1}</span><p>{rule}</p></li>
                ))}
              </ol>
              <div className="protected-layer">
                <ShieldCheck size={14} />
                <div><strong>安全设置不会被 AI 修改</strong><span>包括真实持仓、最多能亏多少、数据使用顺序和券商操作权限。</span></div>
              </div>
            </section>
          </div>
        </div>}
      </div>

      <div className={candidateError ? 'ai-strategy-composer error' : 'ai-strategy-composer'}>
        <div className="ai-composer-icon"><Sparkles size={17} /></div>
        <div className="ai-composer-copy">
          <strong>{candidateError || '告诉 AI 你想改什么'}</strong>
          <span>{candidateError ? '正在使用的规则没有变化，请检查 AI 设置后重试。' : 'AI 会先帮你整理，不会直接改动正在使用的规则。'}</span>
        </div>
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createCandidate()} placeholder="例如：可转债快速下跌时，等 5 分钟会不会太慢？" />
        <button className="primary-button" disabled={!prompt.trim() || creating} onClick={() => void createCandidate()} type="button">{candidateCreated ? '✓ 已生成' : creating ? '生成中…' : '生成规则'}</button>
      </div>
    </section>
  )
}
