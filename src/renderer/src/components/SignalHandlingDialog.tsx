import { CheckCircle2, Eye, ReceiptText, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { HouseholdSnapshot, StockSignalHandlingStatus, StockStrategyCardData, TradeRecordInput } from '../../../shared/types'
import { handlingLabel, priceFromSignal, resolveSignalAccountId, signalLabel, signalTradeSide } from '../utils/signal-handling'

export interface SignalHandlingInput {
  status: StockSignalHandlingStatus
  accountId?: string
  trade?: TradeRecordInput
}

interface SignalHandlingDialogProps {
  card: StockStrategyCardData
  household: HouseholdSnapshot
  onClose: () => void
  onSave: (input: SignalHandlingInput) => Promise<{ ok: boolean; error?: string; tradeRecorded?: boolean }>
}

export function SignalHandlingDialog({ card, household, onClose, onSave }: SignalHandlingDialogProps) {
  const side = signalTradeSide(card)
  const [status, setStatus] = useState<StockSignalHandlingStatus>(card.handling?.status || 'executed')
  const [accountId, setAccountId] = useState(card.handling?.accountId || resolveSignalAccountId(card, household))
  const [quantity, setQuantity] = useState(card.handling?.trade?.quantity ? String(card.handling.trade.quantity) : '')
  const [price, setPrice] = useState(card.handling?.trade?.price ? String(card.handling.trade.price) : priceFromSignal(card.currentPrice))
  const [fee, setFee] = useState(card.handling?.trade?.fee != null ? String(card.handling.trade.fee) : '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const members = useMemo(() => new Map(household.members.map((member) => [member.id, member.name])), [household.members])
  const executed = status === 'executed'
  const quantityValue = Number(quantity)
  const priceValue = Number(price)
  const feeValue = fee === '' ? undefined : Number(fee)
  const validTrade = Boolean(side && accountId && Number.isInteger(quantityValue) && quantityValue > 0 && priceValue > 0 && (feeValue == null || feeValue >= 0))

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [onClose, saving])

  const submit = async () => {
    if (saving || locked || (executed && !validTrade)) return
    setSaving(true); setError('')
    const trade = executed && side ? {
      code: card.code,
      side,
      quantity: quantityValue,
      price: priceValue,
      fee: feeValue,
      note: `信号确认：${signalLabel(card)}${note.trim() ? `；${note.trim()}` : ''}`
    } satisfies TradeRecordInput : undefined
    const result = await onSave({ status, accountId: executed ? accountId : undefined, trade })
    setSaving(false)
    if (result.tradeRecorded) setLocked(true)
    if (!result.ok) { setError(result.error || '保存失败'); return }
    onClose()
  }

  return <div className="signal-handling-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <section aria-labelledby="signal-handling-title" aria-modal="true" className="signal-handling-dialog" role="dialog">
      <header><div className={`signal-handling-icon ${side || 'watch'}`}>{side === 'sell' ? <ReceiptText size={18} /> : <CheckCircle2 size={18} />}</div><div><h2 id="signal-handling-title">登记信号处理结果</h2><p>{card.name} · {card.code} · {signalLabel(card)}{card.accountScope ? ` · ${card.accountScope}` : ''}</p></div><button aria-label="关闭" className="icon-button ghost" disabled={saving} onClick={onClose} type="button"><X size={16} /></button></header>
      <div className="signal-handling-body">
        <div className="signal-outcome-options" aria-label="信号处理结果">
          <button className={status === 'executed' ? 'active executed' : ''} onClick={() => setStatus('executed')} type="button"><CheckCircle2 size={15} /><span><strong>{side === 'sell' ? '已卖出' : '已买入'}</strong><small>写入已确认成交</small></span></button>
          <button className={status === 'watching' ? 'active' : ''} onClick={() => setStatus('watching')} type="button"><Eye size={15} /><span><strong>继续观察</strong><small>保留信号，暂不交易</small></span></button>
          <button className={status === 'ignored' ? 'active' : ''} onClick={() => setStatus('ignored')} type="button"><X size={15} /><span><strong>暂不处理</strong><small>本次不跟随信号</small></span></button>
        </div>
        {executed && <div className="signal-trade-form">
          <div className="signal-trade-notice"><ReceiptText size={13} /><span><strong>只登记券商已经成交的结果</strong><small>这里不会发起下单；数量和成交价请以券商回报为准。</small></span></div>
          <div className="signal-trade-grid">
            <label className="full"><span>记到哪个账户</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">请选择账户</option>{household.accounts.map((account) => <option key={account.id} value={account.id}>{members.get(account.memberId) || '家人'} · {account.name}</option>)}</select>{card.accountScope && !resolveSignalAccountId(card, household) && <small>未能自动匹配“{card.accountScope}”，请手动确认。</small>}</label>
            <label><span>成交方向</span><input disabled value={side === 'sell' ? '卖出' : '买入'} /></label>
            <label><span>成交数量</span><input min="1" onChange={(event) => setQuantity(event.target.value)} placeholder="例如 300" step="1" type="number" value={quantity} /></label>
            <label><span>成交价格</span><input min="0.001" onChange={(event) => setPrice(event.target.value)} placeholder="以成交回报为准" step="0.001" type="number" value={price} /></label>
            <label><span>手续费（可不填）</span><input min="0" onChange={(event) => setFee(event.target.value)} placeholder="0.00" step="0.01" type="number" value={fee} /></label>
            <label className="full"><span>备注（可不填）</span><input maxLength={100} onChange={(event) => setNote(event.target.value)} placeholder="例如：分两批成交的第一批" value={note} /></label>
          </div>
        </div>}
        {error && <p className="signal-handling-error" role="alert">{error}</p>}
      </div>
      <footer><span>{executed ? '确认后会立即更新该账户持仓。' : `本次信号将标记为“${handlingLabel(status, side)}”。`}</span><div><button className="secondary-button" disabled={saving} onClick={onClose} type="button">取消</button><button className="primary-button" disabled={saving || locked || (executed && !validTrade)} onClick={() => void submit()} type="button">{saving ? '正在登记…' : executed ? '确认已成交并登记' : '保存处理结果'}</button></div></footer>
    </section>
  </div>
}
