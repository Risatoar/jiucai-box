import { Clock3, LockKeyhole, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { AutomationTask } from '../../../shared/types'
import type { AutomationTaskInput } from '../../../shared/automation-schedule'

interface MutationResult { ok: boolean; error?: string }
interface AutomationTaskEditorProps {
  task: AutomationTask | null
  onClose: () => void
  onSave: (input: AutomationTaskInput) => Promise<MutationResult>
  onDelete: (id: string) => Promise<MutationResult>
}

interface Draft {
  title: string
  description: string
  prompt: string
  enabled: boolean
  kind: 'cron' | 'market_window' | 'daily_window'
  times: string[]
  interval: number
  windows: Array<{ start: string; end: string }>
}

const defaultPrompt = '读取最新持仓、关注标的、交易状态和交易规则，只在有重要变化时给出结论和下一步；没有变化返回 NO_REPLY。不得操作券商。'
const cronTimes = (task: AutomationTask | null) => {
  if (task?.scheduleConfig.times?.length) return task.scheduleConfig.times
  const [minuteText, hourText] = String(task?.scheduleConfig.expression || '').split(' ')
  const minutes = minuteText?.split(',').filter(Boolean) || []
  const hours = hourText?.split(',').filter(Boolean) || []
  const parsed = hours.flatMap((hour) => minutes.map((minute) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`))
  return parsed.length ? parsed : ['09:30']
}
const marketWindows = (task: AutomationTask | null) => {
  const parsed = (task?.scheduleConfig.windows || []).flatMap((window) => {
    const [start, end] = window.split('-')
    return start && end ? [{ start, end }] : []
  })
  return parsed.length ? parsed : [{ start: '09:30', end: '11:30' }, { start: '13:00', end: '14:57' }]
}
const initialDraft = (task: AutomationTask | null): Draft => ({
  title: task?.title || '',
  description: task?.description || '',
  prompt: task?.prompt || defaultPrompt,
  enabled: task?.enabled ?? true,
  kind: task?.scheduleConfig.kind === 'market_window' || task?.scheduleConfig.kind === 'daily_window' ? task.scheduleConfig.kind : 'cron',
  times: cronTimes(task),
  interval: task?.scheduleConfig.interval_minutes || 5,
  windows: marketWindows(task)
})

export function AutomationTaskEditor({ task, onClose, onSave, onDelete }: AutomationTaskEditorProps) {
  const [draft, setDraft] = useState(() => initialDraft(task))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const updateTime = (index: number, value: string) => setDraft((current) => ({ ...current, times: current.times.map((time, itemIndex) => itemIndex === index ? value : time) }))
  const updateWindow = (index: number, patch: Partial<{ start: string; end: string }>) => setDraft((current) => ({ ...current, windows: current.windows.map((window, itemIndex) => itemIndex === index ? { ...window, ...patch } : window) }))
  const save = async () => {
    setBusy(true); setError('')
    const input: AutomationTaskInput = {
      title: draft.title,
      description: draft.description,
      prompt: draft.prompt,
      enabled: draft.enabled,
      schedule: draft.kind === 'cron'
        ? { kind: 'cron', times: draft.times }
        : { kind: draft.kind, interval_minutes: draft.interval, windows: draft.windows.map((window) => `${window.start}-${window.end}`) }
    }
    const result = await onSave(input)
    if (!result.ok) setError(result.error || '保存失败')
    setBusy(false)
  }
  const remove = async () => {
    if (!task || task.isSystemDefault) return
    if (!confirmDelete) { setConfirmDelete(true); return }
    setBusy(true); setError('')
    const result = await onDelete(task.id)
    if (!result.ok) setError(result.error || '删除失败')
    setBusy(false)
  }
  return (
    <div className="automation-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section aria-labelledby="automation-editor-title" aria-modal="true" className="automation-editor" role="dialog">
        <header className="automation-editor-head"><div className="automation-editor-icon"><Clock3 size={18} /></div><div><h2 id="automation-editor-title">{task ? '查看和编辑任务' : '新建定时任务'}</h2><p>{task?.isSystemDefault ? '系统默认任务可以修改或停用，但不能删除。' : '设置任务内容和运行时间，保存后立即生效。'}</p></div><button aria-label="关闭" className="icon-button ghost" disabled={busy} onClick={onClose} type="button"><X size={16} /></button></header>
        <div className="automation-editor-body">
          <div className="automation-form-grid">
            <label><span>任务名称</span><input maxLength={40} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：午间持仓检查" value={draft.title} /></label>
            <label><span>简短说明</span><input maxLength={120} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="这项任务会做什么" value={draft.description} /></label>
            <label className="full"><span>具体任务内容</span><textarea maxLength={4000} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} rows={6} value={draft.prompt} /><small>系统会在运行时读取最新持仓和行情，不要在这里写死日期或价格。</small></label>
          </div>
          <div className="automation-schedule-editor">
            <div className="automation-field-heading"><div><strong>运行计划</strong><span>所有时间均为北京时间；全天循环可在周末运行。</span></div><select onChange={(event) => setDraft({ ...draft, kind: event.target.value as Draft['kind'] })} value={draft.kind}><option value="cron">工作日固定时间</option><option value="market_window">交易日循环检查</option><option value="daily_window">每天循环检查</option></select></div>
            {draft.kind === 'cron' ? <div className="automation-time-list">{draft.times.map((time, index) => <div key={`${index}-${time}`}><input aria-label={`运行时间 ${index + 1}`} onChange={(event) => updateTime(index, event.target.value)} type="time" value={time} /><button aria-label="删除该时间" className="icon-button ghost" disabled={draft.times.length === 1} onClick={() => setDraft({ ...draft, times: draft.times.filter((_, itemIndex) => itemIndex !== index) })} type="button"><X size={13} /></button></div>)}<button className="secondary-button" disabled={draft.times.length >= 6} onClick={() => setDraft({ ...draft, times: [...draft.times, '09:30'] })} type="button"><Plus size={13} />添加时间</button></div> : <div className="automation-window-editor"><label><span>每隔多少分钟检查</span><input max={120} min={1} onChange={(event) => setDraft({ ...draft, interval: Number(event.target.value) })} type="number" value={draft.interval} /></label><div className="automation-window-list">{draft.windows.map((window, index) => <div key={`${index}-${window.start}`}><input aria-label={`开始时间 ${index + 1}`} onChange={(event) => updateWindow(index, { start: event.target.value })} type="time" value={window.start} /><span>至</span><input aria-label={`结束时间 ${index + 1}`} onChange={(event) => updateWindow(index, { end: event.target.value })} type="time" value={window.end} /><button aria-label="删除该时段" className="icon-button ghost" disabled={draft.windows.length === 1} onClick={() => setDraft({ ...draft, windows: draft.windows.filter((_, itemIndex) => itemIndex !== index) })} type="button"><X size={13} /></button></div>)}</div><button className="secondary-button" disabled={draft.windows.length >= 4} onClick={() => setDraft({ ...draft, windows: [...draft.windows, { start: '09:30', end: '11:30' }] })} type="button"><Plus size={13} />添加时段</button></div>}
          </div>
          <label className="automation-enabled-row"><span><strong>启用这个任务</strong><small>停用后仍保留配置和历史记录。</small></span><button aria-pressed={draft.enabled} className={draft.enabled ? 'switch on' : 'switch'} onClick={() => setDraft({ ...draft, enabled: !draft.enabled })} type="button"><span /></button></label>
          {error && <p className="automation-editor-error" role="alert">{error}</p>}
        </div>
        <footer className="automation-editor-actions"><div>{task && <button className="automation-delete-button" disabled={busy || task.isSystemDefault} onClick={() => void remove()} title={task.isSystemDefault ? '系统默认任务不能删除' : '删除此任务'} type="button">{task.isSystemDefault ? <LockKeyhole size={14} /> : <Trash2 size={14} />}{task.isSystemDefault ? '系统任务不可删除' : confirmDelete ? '确认删除任务' : '删除任务'}</button>}</div><span><button className="secondary-button" disabled={busy} onClick={onClose} type="button">取消</button><button className="primary-button" disabled={busy || !draft.title.trim() || !draft.prompt.trim()} onClick={() => void save()} type="button">{busy ? '保存中…' : '保存任务'}</button></span></footer>
      </section>
    </div>
  )
}
