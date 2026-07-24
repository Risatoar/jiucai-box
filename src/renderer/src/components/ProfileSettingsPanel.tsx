import { Check, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { rateUserProfile } from '../../../shared/profile-rating'
import type { InstrumentType, StockBoard, UserProfile } from '../../../shared/types'

interface ProfileSettingsPanelProps {
  profile: UserProfile
  onSave: (profile: UserProfile) => Promise<void>
}

const styles = ['超短', '短线', '波段', '中长线']
const habits = ['盘中可盯盘', '只看关键提醒', '容易追涨', '容易扛亏', '偏好低频']
const instruments: Array<{ id: InstrumentType; label: string }> = [
  { id: 'stock', label: '股票' }, { id: 'etf', label: 'ETF' }, { id: 'cbond', label: '可转债' }
]
const boards: Array<{ id: StockBoard; label: string; hint: string }> = [
  { id: 'main_sh', label: '沪市主板', hint: '600/601/603/605' },
  { id: 'main_sz', label: '深市主板', hint: '000/001/002/003' },
  { id: 'chinext', label: '创业板', hint: '300/301' },
  { id: 'star', label: '科创板', hint: '688/689' },
]

export function ProfileSettingsPanel({ profile, onSave }: ProfileSettingsPanelProps) {
  const [draft, setDraft] = useState(profile)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const rating = useMemo(() => rateUserProfile(draft), [draft])
  useEffect(() => setDraft(profile), [profile])

  const toggle = (field: 'styles' | 'tradingHabits', value: string) => setDraft((current) => ({
    ...current,
    [field]: current[field].includes(value) ? current[field].filter((item) => item !== value) : [...current[field], value]
  }))
  const toggleInstrument = (value: InstrumentType) => setDraft((current) => ({
    ...current,
    instruments: current.instruments.includes(value) ? current.instruments.filter((item) => item !== value) : [...current.instruments, value]
  }))
  const toggleBoard = (value: StockBoard) => setDraft((current) => ({
    ...current,
    stockBoards: current.stockBoards?.includes(value) ? current.stockBoards.filter((item) => item !== value) : [...(current.stockBoards ?? []), value]
  }))
  const save = async () => {
    setSaving(true); setMessage('')
    try { await onSave(draft); setMessage('你的情况和风险偏好已更新') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }

  return <div className="setting-section profile-settings">
    <div className="profile-rating-summary">
      <div className="rating-icon"><ShieldCheck size={19} /></div>
      <div><span>当前风险偏好</span><strong>{rating.rating}</strong><small>{rating.score} / 100 · 会影响候选范围、周期权重和波动偏好，不代表投资能力</small></div>
    </div>
    <div className="rating-reasons">{rating.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
    <div className="profile-form-grid">
      <label><span>计划投入的资金</span><input type="number" min="1" value={draft.capital} onChange={(event) => setDraft({ ...draft, capital: Number(event.target.value) })} /></label>
      <label><span>炒股多久了</span><select value={draft.experience} onChange={(event) => setDraft({ ...draft, experience: event.target.value })}><option>1年以内</option><option>1-3年</option><option>3-5年</option><option>5年以上</option></select></label>
      <label><span>最多能接受亏损多少</span><div className="profile-range"><input type="range" min="3" max="30" value={draft.maxDrawdown} onChange={(event) => setDraft({ ...draft, maxDrawdown: Number(event.target.value) })} /><strong>{draft.maxDrawdown}%</strong></div></label>
      <label><span>希望多久赚多少</span><div className="inline-inputs"><input type="number" min="1" max="200" value={draft.targetReturn} onChange={(event) => setDraft({ ...draft, targetReturn: Number(event.target.value) })} /><em>%</em><input type="number" min="1" max="60" value={draft.targetMonths} onChange={(event) => setDraft({ ...draft, targetMonths: Number(event.target.value) })} /><em>个月</em></div></label>
    </div>
    <div className="profile-choice-group"><span>平时多久买卖一次</span><div>{styles.map((item) => <button key={item} className={draft.styles.includes(item) ? 'chip selected' : 'chip'} onClick={() => toggle('styles', item)} type="button">{item}</button>)}</div></div>
    <div className="profile-choice-group"><span>会买什么</span><div>{instruments.map((item) => <button key={item.id} className={draft.instruments.includes(item.id) ? 'chip selected' : 'chip'} onClick={() => toggleInstrument(item.id)} type="button">{item.label}</button>)}</div></div>
    {draft.instruments.includes('stock') && <div className="profile-choice-group"><span>可操作的 A 股板块</span><div>{boards.map((item) => <button key={item.id} className={draft.stockBoards?.includes(item.id) ? 'chip selected' : 'chip'} onClick={() => toggleBoard(item.id)} type="button"><span>{item.label}</span><small>{item.hint}</small></button>)}</div><small className="profile-hint">不选的板块不会推荐对应股票，例如没选创业板就不推 300/301 开头的票</small></div>}
    <div className="profile-choice-group"><span>交易习惯</span><div>{habits.map((item) => <button key={item} className={draft.tradingHabits.includes(item) ? 'chip selected' : 'chip'} onClick={() => toggle('tradingHabits', item)} type="button">{item}</button>)}</div></div>
    <div className="profile-save-row"><span className="settings-message success">{message}</span><button className="primary-button" disabled={saving || draft.capital <= 0 || !draft.styles.length || !draft.instruments.length} onClick={() => void save()} type="button"><Check size={15} />{saving ? '保存中…' : '保存我的情况'}</button></div>
  </div>
}
