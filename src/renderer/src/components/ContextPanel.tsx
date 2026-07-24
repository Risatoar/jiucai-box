import {
  BarChart3, Bot, BrainCircuit, Check, CheckCircle2, CircleDollarSign, Clock3, Database,
  Landmark, MessageSquareText, PauseCircle, Plus, Radio, ShieldCheck, Star, TriangleAlert, X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AppView, AutomationTask, ChartPeriod, ChatSessionSummary, Gate, MarketBar, Position, StrategyDefinition, WatchItem
} from '../../../shared/types'
import { MarketInsightContent } from './InsightPanel'
import { disciplineLabel } from '../utils/snapshot'

type DockView = Exclude<AppView, 'settings' | 'voc'>
const dockViews: DockView[] = ['chat', 'portfolio', 'watchlist', 'review', 'strategies', 'automations']
const isDockView = (value: unknown): value is DockView => typeof value === 'string' && dockViews.includes(value as DockView)
const loadTabs = (fallback: DockView) => {
  try {
    const stored = JSON.parse(localStorage.getItem('jiucai.context.tabs') || '[]') as unknown
    if (Array.isArray(stored)) {
      const valid = [...new Set(stored.filter(isDockView))]
      if (valid.length) return valid
    }
  } catch { /* fall back to the linked module */ }
  return [fallback]
}

interface ContextPanelProps {
  view: AppView
  activeSession: ChatSessionSummary | null
  factConnected: boolean
  discipline: string
  positions: Position[]
  totalAsset: number | null
  strategies: StrategyDefinition[]
  automations: AutomationTask[]
  item: WatchItem | null
  watchlist: WatchItem[]
  gates: Gate[]
  bars: MarketBar[]
  chartLoading: boolean
  chartError: string
  period: ChartPeriod
  onPeriod: (period: ChartPeriod) => void
  onSelectItem: (item: WatchItem) => void
}

const money = (value: number | null) => value == null
  ? '待确认'
  : `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`

function ChatContext({ session, factConnected, discipline }: {
  session: ChatSessionSummary | null
  factConnected: boolean
  discipline: string
}) {
  return (
    <div className="context-tool-body">
      <section className="context-focus">
        <span>正在对话</span>
        <strong title={session?.title}>{session?.title || '新对话'}</strong>
        <small>{session ? `${session.messageCount} 条消息 · 最近更新 ${new Date(session.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '等待第一条消息'}</small>
      </section>
      <section className="context-section">
        <div className="context-section-title">AI 回答时会参考</div>
        <div className="context-status-list">
          <div><Database size={14} /><span><strong>家庭交易记录</strong><small>{factConnected ? '已读取，可以按成员和账户核对成交' : '未连接，AI 不会猜测家庭持仓'}</small></span><em className={factConnected ? 'pass' : 'warn'}>{factConnected ? '可用' : '受限'}</em></div>
          <div><ShieldCheck size={14} /><span><strong>当前交易状态</strong><small>AI 会按你现在的风险状态给建议</small></span><em className={discipline.toLowerCase() === 'stopped' ? 'blocked' : 'warn'}>{disciplineLabel(discipline)}</em></div>
          <div><Bot size={14} /><span><strong>AI 能做什么</strong><small>只分析和提醒，不会自动下单</small></span><em className="pass">已限制</em></div>
        </div>
      </section>
      <div className="context-note"><TriangleAlert size={14} /><p>你问到某个品种时，AI 还会参考它的行情、持仓和交易规则。</p></div>
    </div>
  )
}

function PortfolioContext({ positions, totalAsset }: { positions: Position[]; totalAsset: number | null }) {
  const active = positions.filter((position) => position.quantity > 0 && position.status !== 'closed')
  const quoted = active.filter((position) => position.latestPrice > 0)
  const marketValue = quoted.length === active.length
    ? quoted.reduce((sum, position) => sum + position.latestPrice * position.quantity, 0)
    : null
  const totalPnl = quoted.length === active.length
    ? quoted.reduce((sum, position) => sum + position.pnl, 0)
    : null
  const exposure = totalAsset && marketValue != null ? Math.round(marketValue / totalAsset * 100) : null

  return (
    <div className="context-tool-body">
      <div className="context-metrics">
        <div><span>总资产</span><strong>{money(totalAsset)}</strong></div>
        <div><span>持仓市值</span><strong>{money(marketValue)}</strong></div>
        <div><span>浮动盈亏</span><strong className={totalPnl == null ? '' : totalPnl >= 0 ? 'up' : 'down'}>{totalPnl == null ? '待行情' : `${totalPnl >= 0 ? '+' : ''}${money(totalPnl)}`}</strong></div>
        <div><span>资金占用</span><strong>{exposure == null ? '--' : `${exposure}%`}</strong></div>
      </div>
      <section className="context-section">
        <div className="context-section-title"><span>现在持有</span><small>{active.length} 个</small></div>
        {active.length ? <div className="context-position-list">{active.slice(0, 5).map((position) => (
          <div key={`${position.accountId || 'primary'}-${position.instrument.code}`}>
            <span className="asset-badge">{position.instrument.type === 'cbond' ? '债' : position.instrument.type === 'etf' ? 'E' : '股'}</span>
            <span><strong>{position.instrument.name}</strong><small>{position.memberName || '我'} · {position.accountName || '主账户'} · {position.quantity.toLocaleString()} 份</small></span>
            <em className={position.latestPrice > 0 ? position.pnl >= 0 ? 'up' : 'down' : ''}>{position.latestPrice > 0 ? `${position.pnl >= 0 ? '+' : ''}¥${position.pnl.toFixed(2)}` : '--'}</em>
          </div>
        ))}</div> : <div className="context-empty"><CircleDollarSign size={18} /><strong>现在是空仓</strong><span>没有已经确认的持仓。</span></div>}
      </section>
      <div className="context-note"><ShieldCheck size={14} /><p>家庭账户彼此独立。只有券商确认成交的买卖才会算进对应账户持仓。</p></div>
    </div>
  )
}

function StrategyContext({ strategies }: { strategies: StrategyDefinition[] }) {
  const active = strategies.filter((strategy) => strategy.status === 'active')
  return (
    <div className="context-tool-body">
      <div className="context-metrics compact">
        <div><span>正在使用</span><strong>{active.length}</strong></div>
        <div><span>已暂停</span><strong>{strategies.filter((strategy) => strategy.status === 'paused').length}</strong></div>
      </div>
      <section className="context-section">
        <div className="context-section-title"><span>交易规则</span><small>{active.length} 条</small></div>
        {active.length ? <div className="context-strategy-list">{active.slice(0, 6).map((strategy) => (
          <div key={strategy.id}><span className="strategy-status-dot active" /><span><strong>{strategy.name}</strong><small>{strategy.source === 'ai-evolved' ? 'AI 整理' : '已启用'}</small></span><em className="pass">使用中</em></div>
        ))}</div> : <div className="context-empty"><BrainCircuit size={18} /><strong>还没有交易规则</strong><span>告诉 AI 你想解决的问题，它会帮你整理成规则。</span></div>}
      </section>
      <div className="context-note"><ShieldCheck size={14} /><p>AI 只分析和提醒，不会自动下单，也不会修改你的持仓。</p></div>
    </div>
  )
}

function AutomationContext({ tasks }: { tasks: AutomationTask[] }) {
  const enabled = tasks.filter((task) => task.enabled)
  const issues = tasks.filter((task) => task.state === 'warning')
  return (
    <div className="context-tool-body">
      <div className="context-metrics compact">
        <div><span>任务总数</span><strong>{tasks.length}</strong></div>
        <div><span>已启用</span><strong>{enabled.length}</strong></div>
        <div><span>运行中</span><strong>{tasks.filter((task) => task.state === 'running').length}</strong></div>
        <div><span>需关注</span><strong className={issues.length ? 'down' : ''}>{issues.length}</strong></div>
      </div>
      <section className="context-section">
        <div className="context-section-title"><span>任务安排</span><small>按时间顺序</small></div>
        {tasks.length ? <div className="context-task-list">{tasks.slice(0, 6).map((task) => (
          <div key={task.id}><span className={`context-task-icon ${task.enabled ? task.state : 'idle'}`}>{task.enabled ? <Radio size={13} /> : <PauseCircle size={13} />}</span><span><strong>{task.title}</strong><small>{task.schedule} · 下次 {task.nextRun}</small></span><em className={task.state === 'warning' ? 'blocked' : task.enabled ? 'pass' : ''}>{task.state === 'warning' ? '异常' : task.enabled ? '启用' : '停用'}</em></div>
        ))}</div> : <div className="context-empty"><Clock3 size={18} /><strong>还没有定时任务</strong><span>创建后会在这里显示。</span></div>}
      </section>
      <div className="context-note"><CheckCircle2 size={14} /><p>没有新变化时不会重复打扰你，但运行记录会保留下来。</p></div>
    </div>
  )
}

export function ContextPanel(props: ContextPanelProps) {
  const linkedView: DockView = props.view === 'settings' || props.view === 'voc' ? 'automations' : props.view
  const [tabs, setTabs] = useState<DockView[]>(() => loadTabs(linkedView))
  const [activeTool, setActiveTool] = useState<DockView | null>(() => {
    const stored = localStorage.getItem('jiucai.context.activeTool')
    return isDockView(stored) ? stored : linkedView
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setTabs((current) => current.includes(linkedView) ? current : [...current, linkedView])
    setActiveTool(linkedView)
  }, [linkedView])
  useEffect(() => { localStorage.setItem('jiucai.context.tabs', JSON.stringify(tabs)) }, [tabs])
  useEffect(() => {
    if (activeTool) localStorage.setItem('jiucai.context.activeTool', activeTool)
    else localStorage.removeItem('jiucai.context.activeTool')
  }, [activeTool])
  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])
  const activePositions = props.positions.filter((position) => position.quantity > 0 && position.status !== 'closed').length
  const tools: Array<{ view: DockView; tab: string; title: string; description: string; icon: typeof MessageSquareText; content: ReactNode }> = [
    { view: 'chat', tab: '会话', title: '本次对话', description: props.activeSession?.title || 'AI 回答时会参考的信息', icon: MessageSquareText, content: <ChatContext session={props.activeSession} factConnected={props.factConnected} discipline={props.discipline} /> },
    { view: 'portfolio', tab: '账户', title: '家庭账户概览', description: `现在持有 ${activePositions} 笔账户持仓`, icon: Landmark, content: <PortfolioContext positions={props.positions} totalAsset={props.totalAsset} /> },
    { view: 'watchlist', tab: '行情', title: '行情详情', description: props.item ? `${props.item.name} · ${props.item.code}` : '行情、K 线和下单前检查', icon: Star, content: <div className="context-tool-body market-tool-body"><MarketInsightContent item={props.item} watchlist={props.watchlist} bars={props.bars} chartLoading={props.chartLoading} chartError={props.chartError} gates={props.gates} period={props.period} onPeriod={props.onPeriod} onSelectItem={props.onSelectItem} positions={props.positions} strategies={props.strategies} discipline={props.discipline} /></div> },
    { view: 'strategies', tab: '规则', title: '交易规则', description: `${props.strategies.filter((strategy) => strategy.status === 'active').length} 条正在使用`, icon: BrainCircuit, content: <StrategyContext strategies={props.strategies} /> },
    { view: 'automations', tab: '任务', title: '定时任务', description: `${props.automations.filter((task) => task.enabled).length} 个已开启`, icon: Clock3, content: <AutomationContext tasks={props.automations} /> },
    { view: 'review', tab: '复盘', title: '交易复盘', description: '市场评估、热门板块与 AI 推荐复核', icon: BarChart3, content: <div className="context-tool-body"><div className="context-note"><BarChart3 size={14} /><p>复盘报告按日报、周报、月报缓存。切换日期或周期后会自动重新生成，AI 模型不可用时会保留错误提示而不是崩溃。</p></div></div> }
  ]
  const toolByView = (view: DockView) => tools.find((tool) => tool.view === view)!
  const openTool = (view: DockView) => {
    setTabs((current) => current.includes(view) ? current : [...current, view])
    setActiveTool(view)
    setMenuOpen(false)
  }
  const closeTool = (view: DockView) => {
    const index = tabs.indexOf(view)
    const next = tabs.filter((tab) => tab !== view)
    setTabs(next)
    if (activeTool === view) setActiveTool(next[Math.min(index, next.length - 1)] || null)
  }
  const active = activeTool ? toolByView(activeTool) : null
  useEffect(() => {
    const selectByShortcut = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return
      const view = dockViews[Number(event.key) - 1]
      if (!view) return
      event.preventDefault()
      setTabs((current) => current.includes(view) ? current : [...current, view])
      setActiveTool(view)
      setMenuOpen(false)
    }
    window.addEventListener('keydown', selectByShortcut)
    return () => window.removeEventListener('keydown', selectByShortcut)
  }, [])

  return (
    <aside className="insight-panel context-workspace">
      <header className="context-tabbar">
        <div className="context-tabs" role="tablist" aria-label="右侧工具">
          {tabs.map((view) => {
            const tool = toolByView(view)
            const Icon = tool.icon
            return <div className={activeTool === view ? 'context-tab active' : 'context-tab'} key={view}>
              <button className="context-tab-select" role="tab" aria-selected={activeTool === view} title={tool.title} onClick={() => setActiveTool(view)} type="button"><Icon size={13} /><span>{tool.tab}</span></button>
              <button className="context-tab-close" aria-label={`关闭${tool.title}`} title={`关闭${tool.title}`} onClick={() => closeTool(view)} type="button"><X size={11} /></button>
            </div>
          })}
        </div>
        <div className="context-add-tool" ref={menuRef}>
          <button className={menuOpen ? 'icon-button context-add-button active' : 'icon-button context-add-button'} aria-label="打开工具" aria-expanded={menuOpen} title="打开工具" onClick={() => setMenuOpen((value) => !value)} type="button"><Plus size={16} /></button>
          {menuOpen && <div className="context-tool-menu" role="menu">
            <div className="context-tool-menu-title">打开工具</div>
            {dockViews.map((view, index) => {
              const tool = toolByView(view)
              const Icon = tool.icon
              const opened = tabs.includes(view)
              return <button key={view} role="menuitem" onClick={() => openTool(view)} type="button"><Icon size={15} /><span><strong>{tool.title}</strong><small>{tool.description}</small></span>{opened ? <Check size={13} /> : <kbd>⌘{index + 1}</kbd>}</button>
            })}
          </div>}
        </div>
      </header>
      <div className="context-tool-canvas">
        {active ? <><div className="context-tool-heading"><span className="context-tool-heading-icon"><active.icon size={16} /></span><div><strong>{active.title}</strong><small>{active.description}</small></div></div>{active.content}</> : <div className="context-new-tab"><Plus size={21} /><strong>打开一个工具</strong><span>点上方“＋”，选择账户、行情、规则或任务。</span><button className="secondary-button" onClick={() => setMenuOpen(true)} type="button">选择工具</button></div>}
      </div>
    </aside>
  )
}
