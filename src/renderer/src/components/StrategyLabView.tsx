import { useMemo, useRef, useState } from 'react'
import { Beaker, Bot, Check, CheckCircle2, ChevronRight, Clipboard, Code2, Download, GitBranch, History, Pause, Play, Plus, RotateCcw, ShieldCheck, Sparkles, Upload } from 'lucide-react'
import type { StrategyDefinition, StrategyMutationResult } from '../../../shared/types'
import { buildStrategyTransferJson, strategyExportFilename } from '../utils/strategy-transfer'

interface StrategyLabViewProps {
  strategies: StrategyDefinition[]
  onAskAi: () => void
  onCreateCandidate: (prompt: string) => Promise<{ ok: boolean; error?: string }>
  onImportCandidate: (raw: string) => Promise<{ ok: boolean; error?: string }>
  onStatusChange: (id: string, action: 'pause' | 'enable' | 'promote') => Promise<StrategyMutationResult>
  onRollback: () => Promise<StrategyMutationResult>
  versionCount: number
}

const statusText = { active: '正在使用', shadow: '模拟观察中', candidate: '等待验证', paused: '已暂停' }

export function StrategyLabView({ strategies, onAskAi, onCreateCandidate, onImportCandidate, onStatusChange, onRollback, versionCount }: StrategyLabViewProps) {
  const [selectedId, setSelectedId] = useState(strategies[0]?.id || '')
  const [prompt, setPrompt] = useState('')
  const [candidateCreated, setCandidateCreated] = useState(false)
  const [candidateError, setCandidateError] = useState('')
  const [creating, setCreating] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [mutationMessage, setMutationMessage] = useState('')
  const [mutationTone, setMutationTone] = useState<'success' | 'warning' | 'error'>('success')
  const [transferMessage, setTransferMessage] = useState('')
  const [transferTone, setTransferTone] = useState<'success' | 'error'>('success')
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const jsonDetailsRef = useRef<HTMLDetailsElement>(null)
  const selected = useMemo(() => strategies.find((item) => item.id === selectedId) || strategies[0] || null, [selectedId, strategies])
  const progress = selected ? Math.min(100, Math.round((selected.evidence.history / 30 + selected.evidence.outOfSample / 10 + selected.evidence.shadowDays / 5) / 3 * 100)) : 0
  const jsonPreview = selected ? buildStrategyTransferJson(selected) : ''

  const createCandidate = async () => {
    if (!prompt.trim() || creating) return
    setCreating(true)
    setCandidateError('')
    const result = await onCreateCandidate(prompt.trim())
    setCreating(false)
    if (!result.ok) { setCandidateError(result.error || '待验证规则生成失败'); return }
    setCandidateCreated(true)
    window.setTimeout(() => setCandidateCreated(false), 2500)
    setPrompt('')
  }
  const mutate = async (action: 'pause' | 'enable' | 'promote' | 'rollback') => {
    if (mutating || !selected) return
    setMutating(true); setMutationMessage(''); setMutationTone('success')
    const result = action === 'rollback' ? await onRollback() : await onStatusChange(selected.id, action)
    setMutating(false)
    setMutationTone(!result.ok ? 'error' : result.changed === false ? 'warning' : 'success')
    setMutationMessage(result.ok ? result.message || '修改已保存，需要时可以恢复上一版' : result.error || '修改失败')
  }
  const showTransferMessage = (message: string, tone: 'success' | 'error' = 'success') => {
    setTransferMessage(message); setTransferTone(tone)
  }
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonPreview)
      setCopied(true); showTransferMessage('JSON 已复制到剪贴板')
      window.setTimeout(() => setCopied(false), 1800)
    } catch { showTransferMessage('复制失败，请检查系统剪贴板权限', 'error') }
  }
  const exportJson = () => {
    if (!selected) return
    const url = URL.createObjectURL(new Blob([`${jsonPreview}\n`], { type: 'application/json;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = strategyExportFilename(selected); anchor.click()
    URL.revokeObjectURL(url); showTransferMessage('JSON 文件已导出')
  }
  const importJson = async (file: File | undefined) => {
    if (!file || importing) return
    setImporting(true); setTransferMessage('')
    try {
      const result = await onImportCandidate(await file.text())
      showTransferMessage(result.ok ? '已导入为待验证规则，不会直接覆盖当前规则' : result.error || '导入失败', result.ok ? 'success' : 'error')
    } catch (error) { showTransferMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error') }
    finally { setImporting(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  if (!selected) return (
    <section className="content-view strategy-lab">
      <div className="view-heading"><div><h1>交易规则</h1><p>这里记录系统在什么情况下提醒你、什么时候建议停手。每次修改都有记录，也可以恢复上一版。</p></div><button className="primary-button" onClick={onAskAi} type="button"><Sparkles size={15} />和 AI 商量规则</button></div>
      <div className="empty-state"><div className="empty-icon"><Beaker size={22} /></div><h2>还没有交易规则</h2><p>告诉 AI 你想解决的问题，它会先生成一份待验证的规则，不会马上使用。</p></div>
      <div className={candidateError ? 'ai-strategy-composer error' : 'ai-strategy-composer'}><div className="ai-composer-icon"><Sparkles size={17} /></div><div className="ai-composer-copy"><strong>{candidateError || '创建第一条交易规则'}</strong><span>AI 生成失败时不会保存任何内容。</span></div><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createCandidate()} placeholder="例如：连续亏两次后提醒我今天停手" /><button className="primary-button" disabled={!prompt.trim() || creating} onClick={() => void createCandidate()} type="button"><GitBranch size={14} />{creating ? '生成中…' : '生成待验证规则'}</button></div>
    </section>
  )

  return (
    <section className="content-view strategy-lab">
      <div className="view-heading"><div><h1>交易规则</h1><p>每条规则都要先验证，确认有用后才会正式使用。改错了也能恢复上一版。</p></div><button className="primary-button" onClick={onAskAi} type="button"><Sparkles size={15} />和 AI 商量规则</button></div>
      <div className="strategy-summary">
        <div><span className="summary-icon"><Play size={14} /></span><strong>{strategies.filter((item) => item.status === 'active').length}</strong><small>正在使用</small></div>
        <div><span className="summary-icon amber"><Beaker size={14} /></span><strong>{strategies.filter((item) => item.status === 'shadow').length}</strong><small>模拟观察中</small></div>
        <div><span className="summary-icon blue"><Bot size={14} /></span><strong>{strategies.filter((item) => item.source === 'ai-evolved').length}</strong><small>AI 帮你整理</small></div>
        <div><span className="summary-icon"><History size={14} /></span><strong>{versionCount}</strong><small>历史版本</small></div>
      </div>

      <div className="strategy-workbench">
        <div className="strategy-list-panel">
          <div className="strategy-list-title"><span>规则列表</span><button title="让 AI 新建规则" onClick={onAskAi} type="button"><Plus size={14} /></button></div>
          {strategies.map((strategy) => (
            <button className={strategy.id === selected.id ? 'strategy-list-item active' : 'strategy-list-item'} key={strategy.id} onClick={() => setSelectedId(strategy.id)} type="button">
              <span className={`strategy-status-dot ${strategy.status}`} />
              <div><strong>{strategy.name}</strong><small>{strategy.family} · v{strategy.version}</small></div>
              <ChevronRight size={13} />
            </button>
          ))}
        </div>

        <div className="strategy-detail">
          <div className="strategy-detail-head"><div><div className="strategy-name-row"><h2>{selected.name}</h2><span className={`strategy-status ${selected.status}`}>{statusText[selected.status]}</span>{selected.source === 'ai-evolved' && <span className="ai-evolved"><Bot size={11} />AI 整理</span>}</div><p>{selected.description}</p>{mutationMessage && <small className={`mutation-message ${mutationTone}`}>{mutationMessage}</small>}</div><div className="strategy-actions"><button className="secondary-button" disabled={mutating || versionCount === 0} onClick={() => void mutate('rollback')} type="button"><RotateCcw size={13} />恢复上一版</button>{selected.status === 'candidate' ? <button className="secondary-button" disabled={mutating} onClick={() => void mutate('promote')} type="button"><Play size={13} />{mutating ? '校验中…' : '开始验证'}</button> : <button className="secondary-button" disabled={mutating} onClick={() => void mutate(selected.status === 'active' ? 'pause' : 'enable')} type="button">{selected.status === 'active' ? <Pause size={13} /> : <Play size={13} />}{selected.status === 'active' ? '暂停' : '启用'}</button>}</div></div>
          <div className="strategy-tabs"><button className="active" type="button">规则内容和验证结果</button></div>
          <div className="strategy-detail-grid">
            <section className="rule-section"><div className="strategy-section-title"><span>当前规则</span><button onClick={() => { if (jsonDetailsRef.current) jsonDetailsRef.current.open = true; jsonDetailsRef.current?.scrollIntoView({ block: 'nearest' }) }} type="button"><Code2 size={12} />技术详情</button></div><ol>{selected.rules.map((rule, index) => <li key={rule}><span>{index + 1}</span><p>{rule}</p></li>)}</ol><div className="protected-layer"><ShieldCheck size={14} /><div><strong>这些安全设置不能被 AI 修改</strong><span>包括真实持仓、最多能亏多少、数据使用顺序和券商操作权限。</span></div></div></section>
            <section className="evidence-section"><div className="strategy-section-title"><span>验证进度</span><span>{progress}%</span></div><div className="evidence-progress"><span style={{ width: `${progress}%` }} /></div><div className="evidence-rows"><div><span>历史行情测试</span><strong>{selected.evidence.history} / 30</strong>{selected.evidence.history >= 30 ? <CheckCircle2 size={13} /> : <Beaker size={13} />}</div><div><span>新行情测试</span><strong>{selected.evidence.outOfSample} / 10</strong>{selected.evidence.outOfSample >= 10 ? <CheckCircle2 size={13} /> : <Beaker size={13} />}</div><div><span>模拟观察</span><strong>{selected.evidence.shadowDays} / 5 天</strong>{selected.evidence.shadowDays >= 5 ? <CheckCircle2 size={13} /> : <Beaker size={13} />}</div></div><div className="performance-grid"><div><span>判断正确率</span><strong>{selected.performance.winRate || '--'}{selected.performance.winRate ? '%' : ''}</strong></div><div><span>总赚 / 总亏</span><strong>{selected.performance.profitFactor || '--'}</strong></div><div><span>最大亏损幅度</span><strong>{selected.performance.maxDrawdown || '--'}{selected.performance.maxDrawdown ? '%' : ''}</strong></div></div></section>
          </div>
          <details className="json-contract" ref={jsonDetailsRef}><summary><Code2 size={13} />技术详情（JSON）<span>支持复制、导入和导出</span></summary><div className="json-contract-toolbar"><div><button onClick={() => void copyJson()} type="button">{copied ? <Check size={13} /> : <Clipboard size={13} />}{copied ? '已复制' : '复制'}</button><button onClick={exportJson} type="button"><Download size={13} />导出 JSON</button><button disabled={importing} onClick={() => fileInputRef.current?.click()} type="button"><Upload size={13} />{importing ? '导入中…' : '导入 JSON'}</button><input accept="application/json,.json" aria-label="选择要导入的策略 JSON" hidden onChange={(event) => void importJson(event.target.files?.[0])} ref={fileInputRef} type="file" /></div><small>导入内容只会进入待验证区，不会直接启用。</small></div>{transferMessage && <p aria-live="polite" className={`json-transfer-message ${transferTone}`}>{transferMessage}</p>}<pre>{jsonPreview}</pre></details>
        </div>
      </div>

      <div className={candidateError ? 'ai-strategy-composer error' : 'ai-strategy-composer'}><div className="ai-composer-icon"><Sparkles size={17} /></div><div className="ai-composer-copy"><strong>{candidateError || '告诉 AI 你想改什么'}</strong><span>{candidateError ? '正在使用的规则没有变化，请检查 AI 设置后重试。' : 'AI 会先生成一份待验证规则，不会直接改动正在使用的规则。'}</span></div><input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void createCandidate()} placeholder="例如：可转债快速下跌时，等 5 分钟会不会太慢？" /><button className="primary-button" disabled={!prompt.trim() || creating} onClick={() => void createCandidate()} type="button">{candidateCreated ? <CheckCircle2 size={14} /> : <GitBranch size={14} />}{candidateCreated ? '待验证规则已生成' : creating ? '生成中…' : '生成待验证规则'}</button></div>
    </section>
  )
}
