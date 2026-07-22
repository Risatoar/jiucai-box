import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { HouseholdAccountInput, HouseholdMemberInput, HouseholdRiskProfile, HouseholdSnapshot } from '../../../shared/types'

interface Props {
  mode: 'member' | 'account'
  household: HouseholdSnapshot
  selectedMemberId: string
  onClose: () => void
  onCreateMember: (input: HouseholdMemberInput) => Promise<{ ok: boolean; error?: string }>
  onCreateAccount: (input: HouseholdAccountInput) => Promise<{ ok: boolean; error?: string }>
}

export function HouseholdSetupPanel({ mode, household, selectedMemberId, onClose, onCreateMember, onCreateAccount }: Props) {
  const [name, setName] = useState('')
  const [relationship, setRelationship] = useState('家人')
  const [riskProfile, setRiskProfile] = useState<HouseholdRiskProfile>('balanced')
  const [memberId, setMemberId] = useState(selectedMemberId)
  const [broker, setBroker] = useState('')
  const [totalAsset, setTotalAsset] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim() || saving) return
    setSaving(true); setError('')
    const result = mode === 'member'
      ? await onCreateMember({ name, relationship, riskProfile })
      : await onCreateAccount({ memberId, name, broker: broker || undefined, totalAsset: totalAsset === '' ? undefined : Number(totalAsset) })
    setSaving(false)
    if (!result.ok) { setError(result.error || '保存失败'); return }
    onClose()
  }

  return <div className="household-setup-panel">
    <div className="trade-entry-head"><div><strong>{mode === 'member' ? '添加家庭成员' : '添加独立账户'}</strong><span>{mode === 'member' ? '每位成员可以有多个证券账户，并使用独立的风险偏好。' : '账户的持仓、成本和监控结论不会与其他账户合并。'}</span></div><button className="icon-button ghost" onClick={onClose} type="button"><X size={15} /></button></div>
    <div className="household-setup-form">
      {mode === 'account' && <label><span>归属成员</span><select value={memberId} onChange={(event) => setMemberId(event.target.value)}>{household.members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.relationship}</option>)}</select></label>}
      <label><span>{mode === 'member' ? '成员称呼' : '账户名称'}</span><input maxLength={40} placeholder={mode === 'member' ? '例如：妈妈' : '例如：华泰证券账户'} value={name} onChange={(event) => setName(event.target.value)} /></label>
      {mode === 'member' ? <>
        <label><span>与我的关系</span><input maxLength={20} placeholder="例如：配偶、父亲" value={relationship} onChange={(event) => setRelationship(event.target.value)} /></label>
        <label><span>风险偏好</span><select value={riskProfile} onChange={(event) => setRiskProfile(event.target.value as HouseholdRiskProfile)}><option value="conservative">稳健：先控制回撤</option><option value="balanced">平衡：风险收益兼顾</option><option value="active">进取：接受较大波动</option></select></label>
      </> : <>
        <label><span>券商（可以不填）</span><input maxLength={50} placeholder="例如：华泰证券" value={broker} onChange={(event) => setBroker(event.target.value)} /></label>
        <label><span>账户总资产（可以不填）</span><input min="0" step="0.01" type="number" placeholder="100000" value={totalAsset} onChange={(event) => setTotalAsset(event.target.value)} /></label>
      </>}
    </div>
    {error && <p className="form-error">{error}</p>}
    <button className="primary-button" disabled={!name.trim() || saving} onClick={() => void submit()} type="button"><Plus size={14} />{saving ? '保存中…' : mode === 'member' ? '添加成员' : '添加账户'}</button>
  </div>
}
