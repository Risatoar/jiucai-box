import { AlertCircle, Check, LoaderCircle, RotateCw } from 'lucide-react'
import type { SetupProgress } from '../../../shared/types'
import appIcon from '../assets/app-icon.png'

interface SetupViewProps { progress: SetupProgress; onRetry: () => void }

export function SetupView({ progress, onRetry }: SetupViewProps) {
  const failed = progress.stage === 'error'
  return <div className="onboarding-shell setup-shell">
    <div className="onboarding-titlebar"><span className="brand-mark"><img src={appIcon} alt="" /></span><strong>韭菜盒子</strong><span>首次启动准备</span></div>
    <main className="setup-card">
      <div className={failed ? 'setup-hero error' : 'setup-hero'}>{failed ? <AlertCircle size={24} /> : progress.stage === 'complete' ? <Check size={24} /> : <LoaderCircle className="spin" size={24} />}</div>
      <h1>{progress.title}</h1><p>{progress.detail}</p>
      <div className="setup-progress-track"><span style={{ width: `${progress.percent}%` }} /></div>
      <div className="setup-progress-meta"><span>{failed ? '需要处理' : '正在自动准备'}</span><strong>{progress.percent}%</strong></div>
      <ul className="setup-checklist"><li className={progress.percent >= 8 ? 'done' : ''}>检查应用能否正常运行</li><li className={progress.percent >= 36 ? 'done' : ''}>准备交易分析功能</li><li className={progress.percent >= 64 ? 'done' : ''}>创建本机交易数据</li><li className={progress.stage === 'complete' ? 'done' : ''}>完成安全检查</li></ul>
      {failed && <button className="primary-button" onClick={onRetry} type="button"><RotateCw size={15} />重试自动准备</button>}
      <small className="setup-footnote">准备过程不会修改券商账户，也不会帮你下单。</small>
    </main>
  </div>
}
