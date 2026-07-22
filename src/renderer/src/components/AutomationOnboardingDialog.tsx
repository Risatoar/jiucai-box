import { BellRing, CalendarClock, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useEffect } from 'react'

interface AutomationOnboardingDialogProps {
  taskCount: number
  busy: boolean
  error?: string
  onEnable: () => void
  onDismiss: () => void
}

export function AutomationOnboardingDialog({ taskCount, busy, error, onEnable, onDismiss }: AutomationOnboardingDialogProps) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onDismiss() }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [busy, onDismiss])

  return <div className="automation-onboarding-backdrop">
    <section aria-describedby="automation-onboarding-description" aria-labelledby="automation-onboarding-title" aria-modal="true" className="automation-onboarding-dialog" role="dialog">
      <div className="automation-onboarding-icon"><CalendarClock size={22} /></div>
      <h2 id="automation-onboarding-title">要开启定时任务吗？</h2>
      <p id="automation-onboarding-description">开启后，韭菜盒子会在盘前、盘中和收盘后按计划检查，有值得关注的变化时再提醒你。</p>
      <div className="automation-onboarding-benefits">
        <div><CheckCircle2 size={16} /><span><strong>{taskCount ? `${taskCount} 个默认任务` : '默认任务已准备'}</strong><small>覆盖盘前策略、盘中盯盘和收盘复盘</small></span></div>
        <div><BellRing size={16} /><span><strong>自动留下结果</strong><small>没变化时保持安静，有变化时方便继续追问</small></span></div>
        <div><ShieldCheck size={16} /><span><strong>只检查和提醒</strong><small>不会下单、撤单，也不会修改券商账户</small></span></div>
      </div>
      {error && <p className="automation-onboarding-error" role="alert">{error}</p>}
      <footer><button className="secondary-button" disabled={busy} onClick={onDismiss} type="button">暂不开启</button><button autoFocus className="primary-button" disabled={busy} onClick={onEnable} type="button"><CalendarClock size={15} />{busy ? '正在开启…' : '一键开启定时任务'}</button></footer>
      <small className="automation-onboarding-footnote">以后可以随时在“定时任务”中修改或停用。</small>
    </section>
  </div>
}
