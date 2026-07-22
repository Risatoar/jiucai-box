import { ArrowLeft, ArrowRight, Check, CircleDollarSign, Goal, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { InstrumentType, UserProfile } from '../../../shared/types'
import { rateUserProfile } from '../../../shared/profile-rating'
import appIcon from '../assets/app-icon.png'

interface OnboardingProps { onComplete: (profile: UserProfile) => Promise<void>; connectionError?: string }

const initial: UserProfile = { capital: 0, styles: [], experience: '1年以内', maxDrawdown: 8, targetReturn: 20, targetMonths: 12, instruments: [], tradingHabits: [] }
const styleOptions = ['超短', '短线', '波段', '中长线']
const habitOptions = ['盘中可盯盘', '只看关键提醒', '容易追涨', '容易扛亏', '偏好低频']
const instrumentOptions: Array<{ id: InstrumentType; label: string }> = [{ id: 'stock', label: '股票' }, { id: 'etf', label: 'ETF' }, { id: 'cbond', label: '可转债' }]

export function Onboarding({ onComplete, connectionError }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const toggle = (field: 'styles' | 'tradingHabits', value: string) => setProfile((current) => ({ ...current, [field]: current[field].includes(value) ? current[field].filter((item) => item !== value) : [...current[field], value] }))
  const toggleInstrument = (value: InstrumentType) => setProfile((current) => ({ ...current, instruments: current.instruments.includes(value) ? current.instruments.filter((item) => item !== value) : [...current.instruments, value] }))
  const canContinue = step === 0 ? profile.capital > 0 : step === 1 ? profile.styles.length > 0 && profile.instruments.length > 0 : step === 2 ? Boolean(profile.experience) : true
  const rating = rateUserProfile(profile)
  const next = async () => {
    if (!canContinue || saving) return
    if (step < 3) { setStep(step + 1); return }
    setSaving(true)
    setError('')
    try { await onComplete(profile) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setSaving(false) }
  }
  return (
    <div className="onboarding-shell">
      <div className="onboarding-titlebar"><span className="brand-mark"><img src={appIcon} alt="" /></span><strong>韭菜盒子</strong><span>第一次使用</span></div>
      <main className="onboarding-card">
        <div className="onboarding-progress">{[0, 1, 2, 3].map((index) => <span key={index} className={index <= step ? 'active' : ''} />)}</div>
        {step === 0 && <div className="onboarding-step"><div className="step-icon"><CircleDollarSign size={22} /></div><h1>先说说你准备投入多少钱</h1><p>我们会按这个金额提醒你控制风险。</p><div className="onboarding-form"><label><span>计划投入的资金</span><div className="money-input"><span>¥</span><input type="number" value={profile.capital} onChange={(event) => setProfile({ ...profile, capital: Number(event.target.value) })} /></div></label><label><span>最多能接受亏损多少</span><div className="range-row"><input type="range" min="3" max="30" value={profile.maxDrawdown} onChange={(event) => setProfile({ ...profile, maxDrawdown: Number(event.target.value) })} /><strong>{profile.maxDrawdown}%</strong></div></label></div></div>}
        {step === 1 && <div className="onboarding-step"><div className="step-icon"><Sparkles size={22} /></div><h1>你平时怎么买卖？</h1><p>可以多选。我们会按你的习惯给建议。</p><div className="choice-grid">{styleOptions.map((item) => <button key={item} className={profile.styles.includes(item) ? 'choice selected' : 'choice'} onClick={() => toggle('styles', item)} type="button"><span>{item}</span>{profile.styles.includes(item) && <Check size={15} />}</button>)}</div><div className="sub-choice"><span>你会买什么</span><div>{instrumentOptions.map((item) => <button key={item.id} className={profile.instruments.includes(item.id) ? 'chip selected' : 'chip'} onClick={() => toggleInstrument(item.id)} type="button">{item.label}</button>)}</div></div></div>}
        {step === 2 && <div className="onboarding-step"><div className="step-icon"><ShieldCheck size={22} /></div><h1>哪些情况最像你？</h1><p>选得真实一些，提醒才不会太多或太晚。</p><div className="choice-grid habits">{habitOptions.map((item) => <button key={item} className={profile.tradingHabits.includes(item) ? 'choice selected' : 'choice'} onClick={() => toggle('tradingHabits', item)} type="button"><span>{item}</span>{profile.tradingHabits.includes(item) && <Check size={15} />}</button>)}</div><label className="select-label"><span>炒股多久了</span><select value={profile.experience} onChange={(event) => setProfile({ ...profile, experience: event.target.value })}><option>1年以内</option><option>1-3年</option><option>3-5年</option><option>5年以上</option></select></label></div>}
        {step === 3 && <div className="onboarding-step"><div className="step-icon"><Goal size={22} /></div><h1>你希望多久赚多少？</h1><p>这个目标只用来筛选机会，不会让系统建议你冒更大的风险。</p><div className="target-box"><div><span>希望赚到</span><strong>{profile.targetReturn}%</strong></div><input type="range" min="5" max="100" step="5" value={profile.targetReturn} onChange={(event) => setProfile({ ...profile, targetReturn: Number(event.target.value) })} /><div className="target-months"><span>希望用时</span><div>{[3, 6, 12, 24].map((month) => <button key={month} className={profile.targetMonths === month ? 'active' : ''} onClick={() => setProfile({ ...profile, targetMonths: month })} type="button">{month} 个月</button>)}</div></div></div><div className="onboarding-rating"><span>你的风险偏好</span><strong>{rating.rating}</strong><small>{rating.score} / 100 · 以后可以在设置里调整</small></div><div className="safety-note"><ShieldCheck size={15} />这个结果只影响提醒方式，不代表你一定能赚多少钱。</div></div>}
        {(error || connectionError) && <div className="onboarding-error">{error ? `保存失败：${error}` : `交易数据连接失败：${connectionError}`}</div>}
        <footer className="onboarding-actions"><button className="secondary-button" disabled={step === 0 || saving} onClick={() => setStep(step - 1)} type="button"><ArrowLeft size={15} />上一步</button><span>第 {step + 1} / 4 步</span><button className="primary-button" disabled={!canContinue || saving} onClick={() => void next()} type="button">{step === 3 ? saving ? '保存中…' : '进入韭菜盒子' : '下一步'}{step === 3 ? <Check size={15} /> : <ArrowRight size={15} />}</button></footer>
      </main>
    </div>
  )
}
