import { Bot, CheckCircle2, Clock3, History, Pencil, Play, Plus, Radio, RotateCcw, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { AutomationRun, AutomationTask } from '../../../shared/types'
import type { AutomationTaskInput } from '../../../shared/automation-schedule'
import { AutomationTaskEditor } from './AutomationTaskEditor'

interface MutationResult { ok: boolean; id?: string; error?: string }
interface RunResult extends MutationResult { run?: AutomationRun }
interface AutomationsViewProps {
  tasks: AutomationTask[]
  installStatus?: string
  onRestoreDefaults: () => Promise<MutationResult>
  onInstall: () => Promise<MutationResult>
  onCreate: (input: AutomationTaskInput) => Promise<MutationResult>
  onUpdate: (id: string, input: AutomationTaskInput) => Promise<MutationResult>
  onDelete: (id: string) => Promise<MutationResult>
  onToggle: (id: string, enabled: boolean) => Promise<MutationResult>
  onRun: (id: string) => Promise<RunResult>
}

export function AutomationsView({ tasks, installStatus, onRestoreDefaults, onInstall, onCreate, onUpdate, onDelete, onToggle, onRun }: AutomationsViewProps) {
  const [planning, setPlanning] = useState(false)
  const [busyTask, setBusyTask] = useState('')
  const [editingTask, setEditingTask] = useState<AutomationTask | null | undefined>(undefined)
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success')
  const installed = installStatus === 'installed'
  const report = (result: MutationResult, success: string) => {
    setMessageTone(result.ok ? 'success' : 'error')
    setMessage(result.ok ? success : result.error || '操作失败')
  }
  const restoreDefaults = async () => {
    setPlanning(true); setMessage('')
    try { report(await onRestoreDefaults(), '默认任务已恢复，自定义任务已保留') }
    catch (error) { report({ ok: false, error: error instanceof Error ? error.message : '恢复失败' }, '') }
    finally { setPlanning(false) }
  }
  const install = async () => {
    setPlanning(true); setMessage('')
    try { report(await onInstall(), '定时任务已开启，以后会按设定时间自动运行') }
    catch (error) { report({ ok: false, error: error instanceof Error ? error.message : '开启失败' }, '') }
    finally { setPlanning(false) }
  }
  const run = async (id: string) => {
    setBusyTask(id); setMessage('')
    try {
      const result = await onRun(id)
      if (!result.ok) report(result, '')
      else report(result, result.run?.status === 'no_reply' ? '任务完成，没有发现新变化' : '任务完成，结果已保存到对应对话')
    } catch (error) { report({ ok: false, error: error instanceof Error ? error.message : '执行失败' }, '') }
    finally { setBusyTask('') }
  }
  const toggle = async (task: AutomationTask) => {
    setBusyTask(task.id); setMessage('')
    try { report(await onToggle(task.id, !task.enabled), task.enabled ? '任务已停用' : '任务已启用') }
    catch (error) { report({ ok: false, error: error instanceof Error ? error.message : '修改失败' }, '') }
    finally { setBusyTask('') }
  }
  const saveTask = async (input: AutomationTaskInput) => {
    const result = editingTask ? await onUpdate(editingTask.id, input) : await onCreate(input)
    if (result.ok) { setEditingTask(undefined); report(result, editingTask ? '任务修改已保存' : '自定义任务已创建') }
    return result
  }
  const deleteTask = async (id: string) => {
    const result = await onDelete(id)
    if (result.ok) { setEditingTask(undefined); report(result, '自定义任务已删除') }
    return result
  }
  return (
    <section className="content-view automations-view">
      <div className="view-heading"><div><h1>定时任务</h1><p>查看和管理系统在盘前、盘中与收盘后的自动检查。{message && <span className={`inline-notice ${messageTone}`} role="status"> {message}</span>}</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => void restoreDefaults()} disabled={planning} type="button"><RotateCcw size={15} />{tasks.length ? '恢复默认任务' : '创建默认任务'}</button><button className={installed ? 'primary-button' : 'secondary-button'} onClick={() => setEditingTask(null)} disabled={planning} type="button"><Plus size={15} />新建任务</button>{tasks.length > 0 && !installed && <button className="primary-button" onClick={() => void install()} disabled={planning} type="button"><Radio size={15} />开启定时运行</button>}</div></div>
      <div className="automation-summary"><div><CheckCircle2 size={17} /><span><strong>{installed ? `${tasks.filter((task) => task.enabled).length} 个任务已开启` : `${tasks.length} 个任务待开启`}</strong><small>{installed ? '会按设定时间运行' : '确认后才会自动运行'}</small></span></div><div><Radio size={15} /><span><strong>{installed ? '定时运行已开启' : '定时运行还没开启'}</strong><small>每次运行都会留下时间和结果</small></span></div><div><History size={15} /><span><strong>系统任务受到保护</strong><small>可修改和停用，但不能删除</small></span></div></div>
      {tasks.length ? <div className="task-list">
        {tasks.map((task) => {
          const running = busyTask === task.id
          const stateText = running ? '处理中' : !task.enabled ? '已停用' : installed ? '已开启' : '待开启'
          return <article className={task.enabled ? 'task-row' : 'task-row disabled'} key={task.id}>
            <div className={`task-icon ${running ? 'running' : task.state}`}><Clock3 size={17} /></div>
            <div className="task-main"><div className="task-title"><strong>{task.title}</strong><span className={`task-state ${running ? 'running' : task.enabled ? task.state : 'idle'}`}>{stateText}</span><span className={task.isSystemDefault ? 'task-origin system' : 'task-origin custom'}>{task.isSystemDefault ? '系统默认' : '自定义'}</span></div><p>{task.description}</p><div className="task-meta"><span><Clock3 size={12} />{task.schedule}</span><span><Bot size={12} />{task.session}</span></div></div>
            <div className="task-timing"><span>上次 {task.lastRun}</span><span>下次 {task.nextRun}</span></div>
            <div className="task-actions"><button className="run-now-button" title={task.enabled ? '现在检查一次' : '请先启用任务'} disabled={!task.enabled || busyTask !== ''} onClick={() => void run(task.id)} type="button">{running ? <Radio className="spinning" size={14} /> : <Play size={14} fill="currentColor" />}<span>{running ? '处理中' : '现在检查'}</span></button><button className="task-edit-button" disabled={busyTask !== ''} onClick={() => setEditingTask(task)} type="button"><Pencil size={13} />查看 / 编辑</button></div>
            <button className={task.enabled ? 'switch on' : 'switch'} disabled={!installed || busyTask !== ''} title={task.enabled ? '停用任务' : '启用任务'} aria-label={task.enabled ? `停用${task.title}` : `启用${task.title}`} onClick={() => void toggle(task)} type="button"><span /></button>
          </article>
        })}
      </div> : <div className="empty-state"><div className="empty-icon"><Clock3 size={22} /></div><h2>还没有定时任务</h2><p>可以创建自己的任务，也可以一键恢复盘前、盘中和盘后等系统任务。</p><div className="heading-actions"><button className="secondary-button" onClick={() => setEditingTask(null)} type="button">新建任务</button><button className="primary-button" onClick={() => void restoreDefaults()} type="button">创建默认任务</button></div></div>}
      <div className="automation-safety"><TriangleAlert size={16} /><div><strong>定时任务不会替你交易</strong><span>它只检查和提醒，不会下单、撤单，也不会修改券商账户。</span></div></div>
      {editingTask !== undefined && <AutomationTaskEditor key={editingTask?.id || 'new'} task={editingTask} onClose={() => setEditingTask(undefined)} onSave={saveTask} onDelete={deleteTask} />}
    </section>
  )
}
