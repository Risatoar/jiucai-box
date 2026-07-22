import { Brain, Pin, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MemoryCategory, MemorySnapshot } from '../../../shared/types'

const categoryLabels: Record<MemoryCategory, string> = {
  preference: '偏好', goal: '长期目标', risk: '风险边界', habit: '习惯', lesson: '经验'
}

const emptySnapshot: MemorySnapshot = {
  settings: { useMemories: true, generateMemories: true },
  items: []
}

export function MemorySettingsPanel() {
  const [snapshot, setSnapshot] = useState<MemorySnapshot>(emptySnapshot)
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<MemoryCategory>('preference')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const refresh = async () => {
    if (!window.desktopApi) return
    setSnapshot(await window.desktopApi.loadMemories())
  }

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : String(error))).finally(() => setLoading(false))
  }, [])

  const toggle = async (key: 'useMemories' | 'generateMemories') => {
    const settings = { ...snapshot.settings, [key]: !snapshot.settings[key] }
    setSnapshot((current) => ({ ...current, settings }))
    try { await window.desktopApi?.saveMemorySettings(settings) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); await refresh() }
  }

  const add = async () => {
    if (!content.trim() || !window.desktopApi) return
    setMessage('')
    try {
      await window.desktopApi.createMemory({ content, category })
      setContent('')
      await refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }

  const togglePinned = async (id: string, pinned: boolean) => {
    if (!window.desktopApi) return
    await window.desktopApi.updateMemory(id, { pinned: !pinned })
    await refresh()
  }

  const remove = async (id: string) => {
    if (!window.desktopApi || !window.confirm('删除这条记忆？删除后无法恢复。')) return
    await window.desktopApi.deleteMemory(id)
    await refresh()
  }

  return <div className="setting-section memory-settings">
    <div className="setting-title"><Brain size={16} /><div><strong>记忆</strong><span>让 AI 在不同对话间记住稳定偏好和长期目标。当前持仓和实时行情不会写入这里。</span></div></div>
    <div className="memory-toggle-list">
      <div><span><strong>在回答中参考记忆</strong><small>只取与当前问题相关的记忆；当前消息和已确认交易记录优先。</small></span><button aria-pressed={snapshot.settings.useMemories} className={`switch ${snapshot.settings.useMemories ? 'on' : ''}`} onClick={() => void toggle('useMemories')} type="button"><span /></button></div>
      <div><span><strong>从对话中生成记忆</strong><small>仅沉淀明确、稳定且适合长期复用的信息。</small></span><button aria-pressed={snapshot.settings.generateMemories} className={`switch ${snapshot.settings.generateMemories ? 'on' : ''}`} onClick={() => void toggle('generateMemories')} type="button"><span /></button></div>
    </div>
    <div className="memory-add-form">
      <div><input maxLength={240} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void add() }} placeholder="手动添加一条长期记忆" value={content} /><select onChange={(event) => setCategory(event.target.value as MemoryCategory)} value={category}>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="primary-button" disabled={!content.trim()} onClick={() => void add()} type="button"><Plus size={14} />添加</button></div>
      {message && <small className="memory-error">{message}</small>}
    </div>
    <div className="memory-list-heading"><strong>已保存的记忆</strong><span>{snapshot.items.length} 条</span></div>
    <div className="memory-list">
      {!loading && snapshot.items.length === 0 && <div className="memory-empty"><Brain size={18} /><strong>还没有记忆</strong><span>你可以手动添加，也可以在对话后由 AI 自动沉淀。</span></div>}
      {snapshot.items.map((item) => <article key={item.id} className={item.pinned ? 'pinned' : ''}><div><span>{categoryLabels[item.category]}</span>{item.pinned && <em>已置顶</em>}</div><p>{item.content}</p><div className="memory-item-actions"><small>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small><button aria-label={item.pinned ? '取消置顶' : '置顶'} className={item.pinned ? 'active' : ''} onClick={() => void togglePinned(item.id, item.pinned)} title={item.pinned ? '取消置顶' : '置顶'} type="button"><Pin size={13} /></button><button aria-label="删除" onClick={() => void remove(item.id)} title="删除" type="button"><Trash2 size={13} /></button></div></article>)}
    </div>
  </div>
}
