import { ShieldAlert } from 'lucide-react'

export function DisclaimerBar() {
  return (
    <div className="disclaimer-bar" role="note">
      <ShieldAlert size={13} />
      <span>仅供学习研究和观察参考，不构成任何证券投资咨询服务或买卖建议。投资有风险，决策需谨慎。</span>
    </div>
  )
}
