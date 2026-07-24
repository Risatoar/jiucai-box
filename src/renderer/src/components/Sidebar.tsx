import {
  Archive, ArchiveRestore, BarChart3, BellRing, BrainCircuit, ChevronDown, ChevronRight, Clock3, Ellipsis, Eye, History, ListPlus,
  LoaderCircle, Megaphone, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Settings, Star, WalletCards
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppView, ChatSession, ChatSessionSummary } from '../../../shared/types'
import { isAutomationSessionId } from '../../../shared/automation'
import appIcon from '../assets/app-icon.png'
import { disciplineLabel } from '../utils/snapshot'
import { ConversationPreview } from './ConversationPreview'

interface SidebarProps {
  collapsed: boolean
  onCollapsed: () => void
  activeView: AppView
  onNavigate: (view: AppView) => void
  discipline: string
  sessions: ChatSessionSummary[]
  archivedSessions: ChatSessionSummary[]
  busySessionIds: ReadonlySet<string>
  unreadSessionIds: ReadonlySet<string>
  activeSessionId: string | null
  onNewConversation: () => void
  onSelectConversation: (id: string) => void
  onArchiveConversation: (id: string) => Promise<void>
  onRestoreConversation: (id: string) => Promise<void>
  factConnected: boolean
  notificationConnected: boolean
  automationReady: boolean
}

const navItems = [
  { id: 'chat' as const, label: '新增对话', icon: MessageSquarePlus },
  { id: 'portfolio' as const, label: '家庭持仓', icon: WalletCards },
  { id: 'watchlist' as const, label: '我的关注', icon: Star },
  { id: 'review' as const, label: '交易复盘', icon: BarChart3 },
  { id: 'voc' as const, label: '场外情绪', icon: Megaphone },
  { id: 'strategies' as const, label: '交易规则', icon: BrainCircuit },
  { id: 'automations' as const, label: '定时任务', icon: Clock3 }
]

const conversationMeta = (session: ChatSessionSummary) => {
  const updated = new Date(session.updatedAt)
  const today = new Date()
  const day = updated.toDateString() === today.toDateString() ? updated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : updated.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${day} · ${session.messageCount} 条`
}

const groupExpanded = (key: string) => typeof localStorage === 'undefined' || localStorage.getItem(key) !== 'false'

export function Sidebar({ collapsed, onCollapsed, activeView, onNavigate, discipline, sessions, archivedSessions, busySessionIds, unreadSessionIds, activeSessionId, onNewConversation, onSelectConversation, onArchiveConversation, onRestoreConversation, factConnected, notificationConnected, automationReady }: SidebarProps) {
  const [preview, setPreview] = useState<{ summary: ChatSessionSummary; session: ChatSession | null; loading: boolean; anchor: { left: number; top: number } } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [recentExpanded, setRecentExpanded] = useState(() => groupExpanded('jiucai.sidebar.recentExpanded'))
  const [automationExpanded, setAutomationExpanded] = useState(() => groupExpanded('jiucai.sidebar.automationExpanded'))
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [mutatingSessionId, setMutatingSessionId] = useState<string | null>(null)
  const [conversationError, setConversationError] = useState('')
  const openTimer = useRef(0)
  const closeTimer = useRef(0)
  const previewId = useRef<string | null>(null)
  const activeSessionInitialized = useRef(false)
  const cache = useRef(new Map<string, ChatSession>())
  const visibleSessions = showArchived ? archivedSessions : sessions
  const recentSessions = visibleSessions.filter((session) => !isAutomationSessionId(session.id))
  const automationSessions = visibleSessions.filter((session) => isAutomationSessionId(session.id))
  const cancelOpen = () => window.clearTimeout(openTimer.current)
  const cancelClose = () => window.clearTimeout(closeTimer.current)
  const closePreview = () => {
    cancelOpen()
    closeTimer.current = window.setTimeout(() => { previewId.current = null; setPreview(null) }, 120)
  }
  const showPreview = (summary: ChatSessionSummary, target: HTMLElement, delay = 260) => {
    cancelOpen(); cancelClose()
    const rect = target.getBoundingClientRect()
    openTimer.current = window.setTimeout(() => {
      const anchor = { left: rect.right + 10, top: Math.max(44, Math.min(rect.top - 18, window.innerHeight - 220)) }
      const cached = busySessionIds.has(summary.id) ? null : cache.current.get(summary.id) || null
      previewId.current = summary.id
      setPreview({ summary, session: cached, loading: Boolean(window.desktopApi && !cached), anchor })
      if (!window.desktopApi || cached) return
      void window.desktopApi.loadChatSession(summary.id)
        .then((session) => {
          cache.current.set(summary.id, session)
          if (previewId.current === summary.id) setPreview({ summary, session, loading: false, anchor })
        })
        .catch(() => { if (previewId.current === summary.id) setPreview({ summary, session: null, loading: false, anchor }) })
    }, delay)
  }
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { previewId.current = null; setPreview(null) } }
    const closeMenu = () => setMenuSessionId(null)
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('click', closeMenu)
    return () => { cancelOpen(); cancelClose(); window.removeEventListener('keydown', closeOnEscape); document.removeEventListener('click', closeMenu) }
  }, [])
  useEffect(() => { if (collapsed) { previewId.current = null; setPreview(null); setMenuSessionId(null) } }, [collapsed])
  useEffect(() => { localStorage.setItem('jiucai.sidebar.recentExpanded', String(recentExpanded)) }, [recentExpanded])
  useEffect(() => { localStorage.setItem('jiucai.sidebar.automationExpanded', String(automationExpanded)) }, [automationExpanded])
  useEffect(() => {
    if (!activeSessionId) return
    if (!activeSessionInitialized.current) { activeSessionInitialized.current = true; return }
    if (isAutomationSessionId(activeSessionId)) setAutomationExpanded(true)
    else setRecentExpanded(true)
  }, [activeSessionId])

  const mutateConversation = async (id: string) => {
    setMutatingSessionId(id)
    setConversationError('')
    try {
      if (showArchived) await onRestoreConversation(id)
      else await onArchiveConversation(id)
      setMenuSessionId(null)
    } catch (error) {
      setConversationError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutatingSessionId(null)
    }
  }

  const conversationRows = (items: ChatSessionSummary[], emptyText: string) => <div className="conversation-list">
    {items.map((item) => (
      <div key={item.id} className={`conversation-row ${menuSessionId === item.id ? 'menu-open' : ''}`}>
        <button className={activeView === 'chat' && activeSessionId === item.id ? 'conversation active' : 'conversation'} aria-describedby={preview?.summary.id === item.id ? `conversation-preview-${item.id}` : undefined} data-preview-session-id={item.id} onMouseEnter={(event) => showPreview(item, event.currentTarget)} onMouseLeave={closePreview} onFocus={(event) => showPreview(item, event.currentTarget, 0)} onBlur={closePreview} onClick={() => { previewId.current = null; setPreview(null); onSelectConversation(item.id) }} type="button">
          <span className="conversation-title-row"><span className="conversation-title">{item.title}</span>{busySessionIds.has(item.id) ? <span className="conversation-loading" role="status" aria-label="正在思考" title="正在思考"><LoaderCircle className="spinning" size={12} /></span> : unreadSessionIds.has(item.id) ? <span className="conversation-unread" role="status" aria-label="有未读回复" title="有未读回复" /> : null}</span>
          <span className="conversation-meta">{conversationMeta(item)}</span>
        </button>
        {!busySessionIds.has(item.id) && <button className="conversation-more" title="更多会话操作" aria-label={`打开“${item.title}”的更多操作`} aria-expanded={menuSessionId === item.id} onClick={(event) => { event.stopPropagation(); previewId.current = null; setPreview(null); setMenuSessionId((current) => current === item.id ? null : item.id); setConversationError('') }} type="button"><Ellipsis size={14} /></button>}
        {menuSessionId === item.id && <div className="conversation-menu" role="menu" onClick={(event) => event.stopPropagation()}><button role="menuitem" disabled={mutatingSessionId === item.id} onClick={() => void mutateConversation(item.id)} type="button">{showArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}<span>{mutatingSessionId === item.id ? '处理中…' : showArchived ? '恢复到最近对话' : '归档会话'}</span></button></div>}
      </div>
    ))}
    {!items.length && <div className="conversation-empty">{emptyText}</div>}
  </div>

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sidebar-drag-region"><button className="sidebar-collapse-button icon-button ghost" title={collapsed ? '展开左侧导航' : '收起左侧导航'} aria-label={collapsed ? '展开左侧导航' : '收起左侧导航'} onClick={onCollapsed} type="button">{collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button></div>
      <button className="account-switcher" onClick={() => onNavigate('settings')} title="打开账户与配置" type="button">
        <span className="brand-mark"><img src={appIcon} alt="" /></span>
        <span className="account-copy"><strong>韭菜盒子</strong><small>安心交易助手</small></span>
        <ChevronDown size={14} />
      </button>

      <nav className="primary-nav" aria-label="主导航">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} title={collapsed ? label : undefined} className={activeView === id && id !== 'chat' ? 'nav-item active' : 'nav-item'} onClick={() => id === 'chat' ? onNewConversation() : onNavigate(id)} type="button">
            <Icon size={16} /><span>{label}</span>
            {id === 'automations' && automationReady && <span className="nav-dot" title="任务已安装" />}
          </button>
        ))}
      </nav>

      <div className="conversation-groups">
        <section className="conversation-group">
          <div className="sidebar-section-header">
            <button className="conversation-group-toggle" aria-controls="recent-conversations" aria-expanded={recentExpanded} onClick={() => { setRecentExpanded((value) => !value); setMenuSessionId(null) }} type="button"><ChevronRight className={recentExpanded ? 'expanded' : ''} size={13} /><span>{showArchived ? '已归档对话' : '最近对话'}</span><small>{recentSessions.length}</small></button>
            <button className="conversation-view-toggle" title={showArchived ? '返回最近对话' : '查看已归档会话'} aria-label={showArchived ? '返回最近对话' : '查看已归档会话'} onClick={() => { setShowArchived((value) => !value); setMenuSessionId(null); setConversationError('') }} type="button">{showArchived ? <History size={13} /> : <Archive size={13} />}</button>
          </div>
          {recentExpanded && <div id="recent-conversations">{conversationRows(recentSessions, showArchived ? '没有已归档对话' : '还没有历史对话')}</div>}
        </section>
        <section className="conversation-group automation-conversation-group">
          <div className="sidebar-section-header">
            <button className="conversation-group-toggle" aria-controls="automation-conversations" aria-expanded={automationExpanded} onClick={() => { setAutomationExpanded((value) => !value); setMenuSessionId(null) }} type="button"><ChevronRight className={automationExpanded ? 'expanded' : ''} size={13} /><span>{showArchived ? '已归档任务' : '定时任务'}</span><small>{automationSessions.length}</small></button>
          </div>
          {automationExpanded && <div id="automation-conversations">{conversationRows(automationSessions, showArchived ? '没有已归档任务' : '还没有任务会话')}</div>}
        </section>
        {conversationError && <div className="conversation-action-error" role="alert">{conversationError}</div>}
      </div>

      <div className="sidebar-spacer" />
      <div className="agent-status">
        <div className="status-heading"><span className={factConnected ? 'live-dot' : 'status-dot'} />交易助手{factConnected ? '已就绪' : '待连接'}</div>
        <div className="status-row"><Eye size={13} />正在更新你关注的行情</div>
        <div className="status-row"><BellRing size={13} />飞书通知{notificationConnected ? '已配置' : '未配置'}</div>
        <div className={`discipline-pill ${discipline.toLowerCase()}`}>交易状态 · {disciplineLabel(discipline)}</div>
      </div>
      <button title={collapsed ? '设置' : undefined} className={activeView === 'settings' ? 'nav-item active footer-settings' : 'nav-item footer-settings'} onClick={() => onNavigate('settings')} type="button">
        <Settings size={16} /><span>设置</span>
      </button>
      <div className="sidebar-version"><ListPlus size={11} />本机交易数据{factConnected ? '已读取' : '未读取'}</div>
      {preview && <ConversationPreview summary={preview.summary} session={preview.session} loading={preview.loading} busy={busySessionIds.has(preview.summary.id)} unread={unreadSessionIds.has(preview.summary.id)} anchor={preview.anchor} onEnter={cancelClose} onLeave={closePreview} onOpen={() => { previewId.current = null; setPreview(null); onSelectConversation(preview.summary.id) }} />}
    </aside>
  )
}
