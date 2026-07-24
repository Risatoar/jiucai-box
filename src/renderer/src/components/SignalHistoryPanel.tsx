import { AlertTriangle, CheckCircle2, History, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SignalHistorySnapshot, SignalLedgerRecord, SignalOutcome } from '../../../shared/types'

const signalLabel: Record<SignalLedgerRecord['signal'], string> = {
  immediate_buy: '立即买',
  immediate_sell: '立即卖',
  strong_buy: '推荐买',
  strong_sell: '推荐卖',
  prepare_buy: '准备买',
  prepare_sell: '准备卖',
  watch: '观察',
  none: '无动作'
}

const caseLabel: Record<SignalLedgerRecord['caseKind'], string> = {
  goodcase: '有效案例',
  badcase: '待反思',
  neutral: '暂不显著',
  pending: '待回填'
}

const formatPercent = (value?: number) => value == null ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
const formatPrice = (value: number | null) => value == null ? '--' : value.toFixed(value < 10 ? 3 : 2)
const formatDateTime = (value: string) => new Date(value).toLocaleString('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
})

function OutcomeCell({ outcome }: { outcome: SignalOutcome }) {
  if (outcome.status === 'pending') return <span className="signal-outcome pending">待回填</span>
  const value = outcome.directionalReturnPercent
  return <span className={`signal-outcome ${(value || 0) >= 0 ? 'positive' : 'negative'}`} title={`标的实际涨跌 ${formatPercent(outcome.underlyingReturnPercent)} · 最大有利 ${formatPercent(outcome.maxFavorablePercent)} · 最大不利 ${formatPercent(outcome.maxAdversePercent)}`}>
    {formatPercent(value)}
    <small>{outcome.tradingDate?.slice(5)}</small>
  </span>
}

export function SignalHistoryPanel({ code, name }: { code: string; name: string }) {
  const [history, setHistory] = useState<SignalHistorySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!window.desktopApi?.loadSignalHistory) {
      setError('信号账本能力刚更新，请重启应用后查看')
      setLoading(false)
      return
    }
    setLoading(true); setError('')
    const result = await window.desktopApi.loadSignalHistory(code)
    if (result.ok && result.history) setHistory(result.history)
    else setError(result.error || '历史信号读取失败')
    setLoading(false)
  }, [code])

  useEffect(() => { setHistory(null); void load() }, [load])

  const summary = history?.summary
  return <section className="signal-history" aria-label={`${name}历史买卖点回溯`}>
    <header className="signal-history-head">
      <div><History size={15} /><span><strong>历史买卖点回溯</strong><small>按后续交易日收盘检验，不使用自然日</small></span></div>
      <button className="icon-button ghost" disabled={loading} onClick={() => void load()} title="刷新收益回填" aria-label="刷新历史买卖点收益" type="button"><RefreshCw className={loading ? 'spin' : ''} size={13} /></button>
    </header>
    {loading && !history ? <div className="signal-history-state"><span className="kline-loader" /><span>正在回填 1 / 3 / 7 / 15 日结果…</span></div>
      : error && !history ? <div className="signal-history-state error"><AlertTriangle size={14} /><span>{error}</span></div>
        : !history?.records.length ? <div className="signal-history-state"><History size={15} /><span>这个标的还没有结构化买卖点记录；后续提示会自动进入账本。</span></div>
          : <>
            <div className="signal-accuracy-strip">
              <div><strong>{summary?.total || 0}</strong><span>历史提示</span></div>
              <div><strong>{summary?.evaluated || 0}</strong><span>已评估</span></div>
              <div><strong>{summary?.directionalAccuracyPercent == null ? '--' : `${summary.directionalAccuracyPercent}%`}</strong><span>方向准确</span></div>
              <div className="good"><strong>{summary?.goodcases || 0}</strong><span>goodcase</span></div>
              <div className="bad"><strong>{summary?.badcases || 0}</strong><span>badcase</span></div>
            </div>
            <div className="signal-history-table-wrap">
              <table className="signal-history-table">
                <thead><tr><th>提示</th><th>基准</th><th>1日</th><th>3日</th><th>7日</th><th>15日</th><th>归因</th></tr></thead>
                <tbody>{history.records.map((record) => <tr key={record.id}>
                  <td><div className={`signal-side ${record.side}`}>
                    {record.side === 'buy' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    <span><strong>{record.side === 'buy' ? '买入' : '卖出'} · {signalLabel[record.signal]}</strong><small title={`${formatDateTime(record.recordedAt)}${record.accountScope ? ` · ${record.accountScope}` : ''}`}>{formatDateTime(record.recordedAt)}{record.accountScope ? ` · ${record.accountScope}` : ''}</small></span>
                  </div><p title={record.summary}>{record.summary}</p></td>
                  <td><strong>{formatPrice(record.referencePrice)}</strong><small>{record.referencePriceSource === 'current_price' ? '提示时价' : record.referencePriceSource === 'point_price' ? '条件中间价' : '待补价格'}</small></td>
                  {[1, 3, 7, 15].map((horizon) => <td key={horizon}><OutcomeCell outcome={record.outcomes.find((item) => item.horizon === horizon) || { horizon: horizon as 1 | 3 | 7 | 15, status: 'pending' }} /></td>)}
                  <td><span className={`signal-case ${record.caseKind}`}>{record.caseKind === 'goodcase' ? <CheckCircle2 size={11} /> : record.caseKind === 'badcase' ? <AlertTriangle size={11} /> : null}{caseLabel[record.caseKind]}</span><small title={record.caseReason}>{record.caseReason}</small></td>
                </tr>)}</tbody>
              </table>
            </div>
            <footer className="signal-history-foot"><span>方向收益：买入后上涨为正；卖出后下跌为正。</span>{history.refreshError && <span className="error" title={`部分行情未更新：${history.refreshError}`}>部分行情未更新：{history.refreshError}</span>}</footer>
          </>}
  </section>
}
