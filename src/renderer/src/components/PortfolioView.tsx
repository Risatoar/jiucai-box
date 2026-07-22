import { Building2, CircleDollarSign, Landmark, MessageCircle, Plus, Radio, ShieldAlert, TrendingUp, UserPlus, UsersRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { HouseholdAccount, HouseholdAccountInput, HouseholdMember, HouseholdMemberInput, HouseholdSnapshot, Position, TradeRecordInput } from '../../../shared/types'
import { HouseholdSetupPanel } from './HouseholdSetupPanel'
import { PositionStrategyDialog } from './PositionStrategyDialog'

interface PortfolioViewProps {
  household: HouseholdSnapshot
  positions: Position[]
  totalAsset: number | null
  onChat: () => void
  onRecordTrade: (accountId: string, trade: TradeRecordInput) => Promise<{ ok: boolean; error?: string }>
  onCreateMember: (input: HouseholdMemberInput) => Promise<{ ok: boolean; error?: string }>
  onCreateAccount: (input: HouseholdAccountInput) => Promise<{ ok: boolean; error?: string }>
  onUpdateMember: (id: string, patch: Partial<HouseholdMember>) => Promise<{ ok: boolean; error?: string }>
  onUpdateAccount: (id: string, patch: Partial<HouseholdAccount>) => Promise<{ ok: boolean; error?: string }>
}

const riskLabels = { conservative: '稳健', balanced: '平衡', active: '进取' } as const
interface TradeDraft { code: string; side: 'buy' | 'sell'; quantity: string; price: string; fee: string; note: string }
const blankTrade: TradeDraft = { code: '', side: 'buy', quantity: '', price: '', fee: '', note: '' }

export function PortfolioView(props: PortfolioViewProps) {
  const [selectedMemberId, setSelectedMemberId] = useState(props.household.members[0]?.id || '')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [setupMode, setSetupMode] = useState<'member' | 'account' | null>(null)
  const [recording, setRecording] = useState(false)
  const [trade, setTrade] = useState(blankTrade)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [strategyPosition, setStrategyPosition] = useState<Position | null>(null)
  const member = props.household.members.find((item) => item.id === selectedMemberId) || props.household.members[0]
  const memberAccounts = useMemo(() => props.household.accounts.filter((account) => account.memberId === member?.id), [props.household.accounts, member?.id])
  const account = memberAccounts.find((item) => item.id === selectedAccountId) || memberAccounts[0]

  useEffect(() => {
    if (!props.household.members.some((item) => item.id === selectedMemberId)) setSelectedMemberId(props.household.members[0]?.id || '')
  }, [props.household.members, selectedMemberId])
  useEffect(() => { setSelectedAccountId(memberAccounts[0]?.id || '') }, [member?.id])

  const active = props.positions.filter((position) => position.accountId === account?.id && position.quantity > 0 && position.status !== 'closed')
  const quotesReady = active.every((position) => position.latestPrice > 0)
  const totalPnl = quotesReady ? active.reduce((sum, position) => sum + position.pnl, 0) : null
  const marketValue = quotesReady ? active.reduce((sum, position) => sum + position.latestPrice * position.quantity, 0) : null
  const monitoredMembers = props.household.members.filter((item) => item.monitoringEnabled).length
  const monitoredAccounts = props.household.accounts.filter((item) => item.monitoringEnabled).length

  const submit = async () => {
    if (!confirmed || saving || !account) return
    setSaving(true); setError('')
    const input: TradeRecordInput = { code: trade.code, side: trade.side, quantity: Number(trade.quantity), price: Number(trade.price), fee: trade.fee === '' ? undefined : Number(trade.fee), note: trade.note || undefined }
    const result = await props.onRecordTrade(account.id, input)
    setSaving(false)
    if (!result.ok) { setError(result.error || '写入失败'); return }
    setTrade(blankTrade); setConfirmed(false); setRecording(false)
  }

  return <section className="content-view household-portfolio-view">
    <div className="view-heading"><div><h1>家庭持仓</h1><p>按家庭成员和独立账户管理持仓，成本、可用数量和策略互不混用。</p></div><div className="heading-actions"><button className="secondary-button" onClick={props.onChat} type="button"><MessageCircle size={15} />让 AI 看家庭持仓</button><button className="secondary-button" onClick={() => setSetupMode('member')} type="button"><UserPlus size={15} />添加成员</button><button className="primary-button" onClick={() => setSetupMode('account')} type="button"><Plus size={15} />添加账户</button></div></div>

    <div className="household-summary-bar"><span><UsersRound size={14} /><strong>{props.household.members.length}</strong> 位成员</span><span><Building2 size={14} /><strong>{props.household.accounts.length}</strong> 个账户</span><span><Radio size={14} /><strong>{monitoredMembers}/{monitoredAccounts}</strong> 成员/账户盯盘中</span><span><CircleDollarSign size={14} />家庭总资产 <strong>{props.totalAsset == null ? '待补充' : `¥${props.totalAsset.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`}</strong></span></div>

    <div className="household-member-tabs">{props.household.members.map((item) => <button className={item.id === member?.id ? 'active' : ''} key={item.id} onClick={() => { setSelectedMemberId(item.id); setRecording(false); setStrategyPosition(null) }} type="button"><span className="household-avatar">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.relationship} · {riskLabels[item.riskProfile]}</small></span>{item.monitoringEnabled && <i />}</button>)}</div>

    {setupMode && <HouseholdSetupPanel mode={setupMode} household={props.household} selectedMemberId={member?.id || ''} onClose={() => setSetupMode(null)} onCreateMember={props.onCreateMember} onCreateAccount={props.onCreateAccount} />}

    {member && <div className="household-control-row"><div><strong>{member.name}的账户</strong><span>{riskLabels[member.riskProfile]}型策略 · {member.monitoringEnabled ? '已纳入家庭监控' : '已暂停家庭监控'}</span></div><button aria-pressed={member.monitoringEnabled} className={`switch ${member.monitoringEnabled ? 'on' : ''}`} onClick={() => void props.onUpdateMember(member.id, { monitoringEnabled: !member.monitoringEnabled })} title="切换该成员的家庭监控" type="button"><span /></button></div>}

    <div className="household-account-tabs">{memberAccounts.map((item) => <button className={item.id === account?.id ? 'active' : ''} key={item.id} onClick={() => { setSelectedAccountId(item.id); setRecording(false); setStrategyPosition(null) }} type="button"><Building2 size={14} /><span><strong>{item.name}</strong><small>{item.source === 'primary' ? 'Trade Master 主账户' : item.broker || '独立托管账户'}</small></span><em>{item.positions.filter((position) => position.quantity > 0 && position.status !== 'closed').length} 个持仓</em></button>)}{!memberAccounts.length && <button className="add-account-inline" onClick={() => setSetupMode('account')} type="button"><Plus size={14} />为 {member?.name} 添加账户</button>}</div>

    {account && <>
      <div className="account-action-row"><div><span className={member?.monitoringEnabled && account.monitoringEnabled ? 'status-dot ok' : 'status-dot'} /><span><strong>{account.name}</strong><small>{account.monitoringEnabled ? '账户盯盘已开启' : '账户盯盘已暂停'} · 更新于 {new Date(account.updatedAt).toLocaleString('zh-CN')}</small></span></div><div><button aria-pressed={account.monitoringEnabled} className={`switch ${account.monitoringEnabled ? 'on' : ''}`} onClick={() => void props.onUpdateAccount(account.id, { monitoringEnabled: !account.monitoringEnabled })} title="切换该账户盯盘" type="button"><span /></button><button className="primary-button" onClick={() => setRecording(true)} type="button"><Plus size={14} />记一笔成交</button></div></div>
      {recording && <div className="trade-entry-panel"><div className="trade-entry-head"><div><strong>记录 {member?.name} · {account.name} 的已成交买卖</strong><span>只会更新这个账户，不会改动其他家庭成员的持仓。</span></div><button className="icon-button ghost" onClick={() => setRecording(false)} type="button"><X size={15} /></button></div><div className="trade-form"><label><span>证券代码</span><input value={trade.code} maxLength={6} onChange={(event) => setTrade({ ...trade, code: event.target.value.replace(/\D/g, '') })} placeholder="510300" /></label><label><span>买还是卖</span><select value={trade.side} onChange={(event) => setTrade({ ...trade, side: event.target.value as 'buy' | 'sell' })}><option value="buy">买入</option><option value="sell">卖出</option></select></label><label><span>成交数量</span><input type="number" min="1" value={trade.quantity} onChange={(event) => setTrade({ ...trade, quantity: event.target.value })} /></label><label><span>成交价格</span><input type="number" min="0" step="0.001" value={trade.price} onChange={(event) => setTrade({ ...trade, price: event.target.value })} /></label><label><span>手续费（可不填）</span><input type="number" min="0" step="0.01" value={trade.fee} onChange={(event) => setTrade({ ...trade, fee: event.target.value })} /></label><label><span>备注（可不填）</span><input value={trade.note} onChange={(event) => setTrade({ ...trade, note: event.target.value })} /></label></div><label className="confirm-write"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我确认这笔买卖已经成交，可以更新 {member?.name} 的 {account.name}</span></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={!confirmed || trade.code.length !== 6 || !trade.quantity || !trade.price || saving} onClick={() => void submit()} type="button">{saving ? '正在核对…' : '确认并更新这个账户'}</button></div>}
      <div className="metric-strip"><div><span><CircleDollarSign size={14} />账户总资产</span><strong>{account.totalAsset == null ? '待确认' : `¥${account.totalAsset.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`}</strong><small>只统计当前账户</small></div><div><span><Landmark size={14} />持仓市值</span><strong>{marketValue == null ? '待行情' : `¥${marketValue.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`}</strong><small>目前持有 {active.length} 个品种</small></div><div><span><TrendingUp size={14} />浮动盈亏</span><strong className={totalPnl == null ? '' : totalPnl >= 0 ? 'up' : 'down'}>{totalPnl == null ? '待行情' : `${totalPnl >= 0 ? '+' : ''}¥${totalPnl.toFixed(2)}`}</strong><small>按该账户成本计算</small></div><div><span><ShieldAlert size={14} />资金占用</span><strong>{account.totalAsset && marketValue != null ? `${Math.round(marketValue / account.totalAsset * 100)}%` : '--'}</strong><small>不会与其他账户合并</small></div></div>
      {active.length === 0 ? <div className="empty-state compact"><div className="empty-icon"><Landmark size={22} /></div><h2>{account.name} 还没有持仓</h2><p>录入券商已经确认的成交后，系统会单独监控这个账户。</p><button className="primary-button" onClick={() => setRecording(true)} type="button">记一笔已成交买卖</button></div> : <div className="position-grid">{active.map((position) => <article className="position-card" key={`${account.id}-${position.instrument.code}`}><div className="position-card-head"><div className="instrument-cell"><span className="asset-badge">{position.instrument.type === 'cbond' ? '债' : position.instrument.type === 'etf' ? 'E' : '股'}</span><div><strong>{position.instrument.name}</strong><small>{position.instrument.code} · {member?.name} · {account.name}</small></div></div><button className="text-button" onClick={() => setStrategyPosition(position)} type="button">分析策略</button></div><div className="position-values"><div><span>持仓 / 可用</span><strong>{position.quantity.toLocaleString()} / {position.availableQuantity.toLocaleString()}</strong></div><div><span>成本 / 现价</span><strong>{position.averageCost?.toFixed(3) || '--'} / {position.latestPrice > 0 ? position.latestPrice.toFixed(3) : '--'}</strong></div><div><span>浮动盈亏</span><strong className={position.latestPrice > 0 ? position.pnl >= 0 ? 'up' : 'down' : ''}>{position.latestPrice > 0 ? `${position.pnl >= 0 ? '+' : ''}¥${position.pnl.toFixed(2)}` : '--'}</strong></div></div></article>)}</div>}
    </>}
    <div className="fact-notice"><ShieldAlert size={15} /><div><strong>家庭持仓边界</strong><span>每位成员、每个账户独立核算。AI 和定时任务会分别给建议，但仍不会替任何人下单。</span></div></div>
    {strategyPosition && member && account && <PositionStrategyDialog member={member} account={account} position={strategyPosition} onClose={() => setStrategyPosition(null)} />}
  </section>
}
