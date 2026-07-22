import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, Building2, CalendarClock, CheckCircle2, CircleDollarSign, Clock3, RefreshCw, ShieldAlert, Sparkles, Target, TrendingUp, X } from 'lucide-react'
import type { HouseholdAccount, HouseholdMember, Position } from '../../../shared/types'
import { POSITION_STRATEGY_REFRESH_MS } from '../../../shared/position-strategy'
import type { PositionStrategyAnalysis, PositionStrategyFactor, PositionStrategyHorizon, PositionStrategyPlan } from '../../../shared/position-strategy'

interface PositionStrategyDialogProps {
  member: HouseholdMember
  account: HouseholdAccount
  position: Position
  onClose: () => void
}

const money = (value: number | null, digits = 2) => value == null ? '--' : `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: digits })}`
const price = (value: number | null) => value == null || value <= 0 ? '--' : value.toFixed(3)
const percent = (value: number | null) => value == null ? '--' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

function BulletList({ values, empty = '暂无可执行项' }: { values: string[]; empty?: string }) {
  if (!values.length) return <p className="position-strategy-empty-line">{empty}</p>
  return <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul>
}

function HorizonCard({ data, tone }: { data: PositionStrategyHorizon; tone: 'short' | 'medium' | 'long' }) {
  return <article className={`position-horizon-card ${tone}`}>
    <header><div><span>{data.horizon}</span><strong>{data.goal}</strong></div><em>{data.stance}</em></header>
    <section><small>怎么操作</small><BulletList values={data.actions} /></section>
    <div className="position-horizon-conditions">
      <section><small>触发后再做</small><BulletList values={data.triggers} empty="等待可靠触发" /></section>
      <section><small>计划何时失效</small><BulletList values={data.invalidation} empty="材料变化时重评" /></section>
    </div>
  </article>
}

function PlanBlock({ title, plan, tone }: { title: string; plan: PositionStrategyPlan; tone: 'recovery' | 'profit' }) {
  return <section className={`position-plan-block ${tone} ${plan.applicable ? '' : 'inactive'}`}>
    <div className="position-plan-title"><span>{tone === 'recovery' ? <Target size={14} /> : <TrendingUp size={14} />}{title}</span><em>{plan.applicable ? '当前适用' : '当前不适用'}</em></div>
    <p>{plan.summary}</p>
    {plan.applicable && <BulletList values={plan.steps} />}
  </section>
}

function FactorBlock({ title, factor }: { title: string; factor: PositionStrategyFactor }) {
  return <section className="position-factor-block">
    <div><strong>{title}</strong><span className={`factor-status ${factor.status}`}>{factor.status}</span></div>
    <p>{factor.summary}</p>
    <BulletList values={factor.evidence} empty="没有可核验材料" />
  </section>
}

export function PositionStrategyDialog({ member, account, position, onClose }: PositionStrategyDialogProps) {
  const [analysis, setAnalysis] = useState<PositionStrategyAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [cached, setCached] = useState(false)
  const [stale, setStale] = useState(false)
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')

  const request = useCallback(async (force: boolean) => {
    if (!window.desktopApi) { setError('桌面桥接未连接，请在韭菜盒子桌面应用中使用'); setLoading(false); return }
    setLoading(true); setError(''); setWarning('')
    try {
      const result = await window.desktopApi.analyzePositionStrategy({ memberId: member.id, accountId: account.id, code: position.instrument.code, force })
      if (!result.ok || !result.analysis) throw new Error(result.error || 'AI 暂时没有返回持仓策略')
      setAnalysis(result.analysis); setCached(Boolean(result.cached)); setStale(Boolean(result.stale)); setWarning(result.warning || '')
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : String(requestError)) }
    finally { setLoading(false) }
  }, [account.id, member.id, position.instrument.code])

  useEffect(() => {
    void request(false)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void request(false) }, POSITION_STRATEGY_REFRESH_MS + 500)
    return () => window.clearInterval(timer)
  }, [request])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [onClose])

  const snapshot = analysis?.positionSnapshot
  return <div className="position-strategy-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div aria-labelledby="position-strategy-title" aria-modal="true" className="position-strategy-dialog" role="dialog">
      <header className="position-strategy-head">
        <div className="position-strategy-icon"><Sparkles size={18} /></div>
        <div><div className="position-strategy-heading"><h2 id="position-strategy-title">{position.instrument.name} · 持仓策略</h2>{analysis && <span className={`strategy-confidence confidence-${analysis.confidence}`}>置信度 {analysis.confidence}</span>}</div><p>{member.name} · {account.name} · {position.instrument.code} · 不与其他家庭账户合并</p></div>
        <div className="position-strategy-head-actions"><button className="secondary-button" disabled={loading} onClick={() => void request(true)} title="忽略缓存，按最新数据重新分析" type="button"><RefreshCw className={loading ? 'spin' : ''} size={13} />{loading ? '分析中' : '主动更新'}</button><button autoFocus className="icon-button ghost" onClick={onClose} title="关闭" type="button"><X size={16} /></button></div>
      </header>

      <div className="position-strategy-scroll">
        {analysis && <div className={`position-strategy-freshness ${stale ? 'stale' : ''}`}><Clock3 size={12} /><span>{stale ? '最新更新失败，正在展示上次可用结果' : cached ? '已读取 5 分钟缓存' : '已按最新材料生成'} · 数据截至 {time(analysis.dataAsOf)}</span><em>下次自动更新 {time(analysis.expiresAt)}</em></div>}
        {warning && <div className="position-strategy-warning"><AlertTriangle size={13} />{warning}</div>}
        {loading && !analysis && <div className="position-strategy-loading"><Sparkles size={20} /><strong>正在读取持仓、行情和交易规则</strong><span>将分别生成短线、中线和长线计划</span><i><b /><b /><b /></i></div>}
        {error && !analysis && <div className="position-strategy-error"><ShieldAlert size={21} /><strong>暂时无法生成策略</strong><span>{error}</span><button className="secondary-button" onClick={() => void request(true)} type="button">重新分析</button></div>}

        {analysis && <>
          <section className="position-strategy-summary">
            <div className="position-verdict"><span>当前结论</span><strong>{analysis.verdict}</strong><p>{analysis.summary}</p></div>
            <div className="position-snapshot-grid">
              <div><span>持仓 / 可用</span><strong>{snapshot?.quantity.toLocaleString()} / {snapshot?.availableQuantity.toLocaleString()}</strong></div>
              <div><span>成本 / 现价</span><strong>{price(snapshot?.averageCost ?? null)} / {price(snapshot?.latestPrice ?? null)}</strong></div>
              <div><span>浮动盈亏</span><strong className={(snapshot?.pnl || 0) >= 0 ? 'up' : 'down'}>{money(snapshot?.pnl ?? null)} <small>{percent(snapshot?.pnlPercent ?? null)}</small></strong></div>
              <div><span>账户仓位</span><strong>{snapshot?.exposurePercent == null ? '待确认' : `${snapshot.exposurePercent.toFixed(1)}%`}</strong></div>
            </div>
          </section>

          <div className="position-plan-grid"><PlanBlock title="回本计划" plan={analysis.breakEvenPlan} tone="recovery" /><PlanBlock title="盈利保护计划" plan={analysis.profitPlan} tone="profit" /></div>

          <section className="position-strategy-section"><div className="position-strategy-section-title"><CalendarClock size={15} /><div><strong>分周期操作方案</strong><span>时间越长，越需要新的基本面材料持续确认</span></div></div><div className="position-horizon-grid"><HorizonCard data={analysis.timeframes.short} tone="short" /><HorizonCard data={analysis.timeframes.medium} tone="medium" /><HorizonCard data={analysis.timeframes.long} tone="long" /></div></section>

          <div className="position-strategy-two-column">
            <section className="position-strategy-section"><div className="position-strategy-section-title"><CircleDollarSign size={15} /><div><strong>仓位管理</strong><span>只基于 {account.name} 独立计算</span></div></div><p className="position-management-summary">{analysis.positionManagement.summary}</p><div className="position-list-block"><small>建议动作</small><BulletList values={analysis.positionManagement.actions} /></div><div className="position-list-block danger"><small>这些情况不要补仓</small><BulletList values={analysis.positionManagement.noAddConditions} empty="尚未形成可靠限制" /></div></section>
            <section className="position-strategy-section"><div className="position-strategy-section-title"><BarChart3 size={15} /><div><strong>影响因素</strong><span>没有真实来源的维度会明确标记材料不足</span></div></div><div className="position-factor-grid"><FactorBlock title="外围消息" factor={analysis.perspectives.macro} /><FactorBlock title="行业板块" factor={analysis.perspectives.sector} /><FactorBlock title="公司情况" factor={analysis.perspectives.company} /></div></section>
          </div>

          <div className="position-strategy-two-column compact">
            <section className="position-strategy-section"><div className="position-strategy-section-title"><ShieldAlert size={15} /><div><strong>风险与失效边界</strong><span>先定义什么情况下计划不能继续</span></div></div><BulletList values={analysis.riskControls} empty="缺少可靠风险边界" /></section>
            <section className="position-strategy-section"><div className="position-strategy-section-title"><CheckCircle2 size={15} /><div><strong>下一检查点</strong><span>材料变化时可提前主动更新</span></div></div><BulletList values={analysis.nextChecks} empty="5 分钟后自动更新" /></section>
          </div>

          {analysis.missingFacts.length > 0 && <section className="position-missing-facts"><AlertTriangle size={14} /><div><strong>当前欠缺的决策材料</strong><BulletList values={analysis.missingFacts} /></div></section>}
        </>}
      </div>
      <footer className="position-strategy-foot"><span>结果缓存 5 分钟；持仓变化会使旧缓存失效；弹窗打开时每 5 分钟自动检查。</span><span>AI 只做辅助分析，不会操作账户或保证回本。</span></footer>
    </div>
  </div>
}
