import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { AiConfig, AppView, ChartPeriod, ChatSessionSummary, FeishuConnectionResult, HouseholdAccount, HouseholdAccountInput, HouseholdMember, HouseholdMemberInput, MarketBar, SetupProgress, TradeMasterSnapshot, TradeRecordInput, UserProfile, WatchItem } from '../../shared/types'
import { automationSessionId } from '../../shared/automation'
import { AutomationsView } from './components/AutomationsView'
import { ChatWorkspace } from './components/ChatWorkspace'
import { ContextPanel } from './components/ContextPanel'
import { Onboarding } from './components/Onboarding'
import { PaneResizeHandle } from './components/PaneResizeHandle'
import { PortfolioView } from './components/PortfolioView'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { StrategyLabView } from './components/StrategyLabView'
import { SetupView } from './components/SetupView'
import { Topbar } from './components/Topbar'
import { WatchlistView } from './components/WatchlistView'
import { VocMonitorView } from './components/VocMonitorView'
import { aggregate120MinuteBars } from './components/kline-chart-utils'
import { finishChatRun, hydrateChatRuns, setChatRun, startChatRun, type ChatRunMap } from './utils/chat-run'
import { assetFromSnapshot, automationsFromSnapshot, disciplineFromSnapshot, feishuConfigFromSnapshot, gatesFromSnapshot, householdFromSnapshot, notificationEventsFromSnapshot, positionsFromSnapshot, strategiesFromSnapshot, watchlistFromSnapshot } from './utils/snapshot'
import { shouldLoadMarketBars } from './utils/market-data'
import { clampPaneWidth, defaultPaneWidth, paneWidthFromPointer, PANE_LIMITS, type PaneSide } from './utils/pane-layout'

const initialAiConfig: AiConfig = { provider: 'codex-local', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' }
const fallbackProfile: UserProfile = { capital: 0, styles: ['波段'], experience: '1年以内', maxDrawdown: 8, targetReturn: 20, targetMonths: 12, instruments: ['stock'], tradingHabits: ['只看关键提醒'] }
const initialSetup: SetupProgress = { stage: 'checking', percent: 4, title: '正在准备韭菜盒子', detail: '检查核心组件与本地数据目录' }
const loadPaneWidths = () => {
  const viewportWidth = window.innerWidth
  const read = (side: PaneSide) => {
    const stored = Number(localStorage.getItem(`jiucai.layout.${side}PaneWidth`))
    return Number.isFinite(stored) && stored > 0 ? stored : defaultPaneWidth(side, viewportWidth)
  }
  const requestedRight = read('right')
  const left = clampPaneWidth('left', read('left'), viewportWidth, requestedRight)
  const right = clampPaneWidth('right', requestedRight, viewportWidth, left)
  return { left, right }
}
const loadUnreadSessionIds = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('jiucai.chat.unreadSessionIds') || '[]') as unknown
    if (Array.isArray(stored)) return new Set(stored.filter((id): id is string => typeof id === 'string'))
  } catch { /* ignore invalid local state */ }
  return new Set<string>()
}

export default function App() {
  const skipOnboarding = new URLSearchParams(location.search).has('skipOnboarding')
  const [onboarded, setOnboarded] = useState(skipOnboarding)
  const [setupReady, setSetupReady] = useState(skipOnboarding)
  const [setupProgress, setSetupProgress] = useState(initialSetup)
  const [bootstrapped, setBootstrapped] = useState(skipOnboarding)
  const [bootstrapError, setBootstrapError] = useState('')
  const [view, setView] = useState<AppView>('chat')
  const [snapshot, setSnapshot] = useState<TradeMasterSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [watchlist, setWatchlist] = useState<WatchItem[]>([])
  const [selected, setSelected] = useState<WatchItem | null>(null)
  const [chartBars, setChartBars] = useState<MarketBar[]>([])
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('timeline')
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState('')
  const [chartRefreshedAt, setChartRefreshedAt] = useState('')
  const [aiConfig, setAiConfig] = useState<AiConfig>(initialAiConfig)
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [archivedSessions, setArchivedSessions] = useState<ChatSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [chatRuns, setChatRuns] = useState<ChatRunMap>({})
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(loadUnreadSessionIds)
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem('jiucai.layout.leftCollapsed') === 'true')
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem('jiucai.layout.rightCollapsed') === 'true')
  const [paneWidths, setPaneWidths] = useState(loadPaneWidths)
  const conversationsStarted = useRef(false)
  const viewRef = useRef(view)
  const activeSessionIdRef = useRef(activeSessionId)
  viewRef.current = view
  activeSessionIdRef.current = activeSessionId

  const refresh = useCallback(async () => {
    setRefreshing(true)
    if (window.desktopApi) {
      try {
        let loaded = await window.desktopApi.loadSnapshot()
        if (!loaded.automation) {
          const planned = await window.desktopApi.runTradeMaster('automation', ['plan', '--preset', 'standard'])
          if (planned.ok) loaded = await window.desktopApi.loadSnapshot()
        }
        setSnapshot(loaded)
        setBootstrapError('')
      } catch (error) { setSnapshot(null); setBootstrapError(error instanceof Error ? error.message : String(error)) }
      finally { setBootstrapped(true) }
    } else {
      setBootstrapError('桌面功能没有正常启动，暂时无法读取交易数据')
      setBootstrapped(true)
    }
    window.setTimeout(() => setRefreshing(false), 450)
  }, [])

  const prepare = useCallback(async () => {
    if (skipOnboarding) return
    if (!window.desktopApi) {
      setSetupProgress({ stage: 'error', percent: 100, title: '无法自动准备', detail: '桌面桥接未加载，请重启应用' })
      return
    }
    try {
      const result = await window.desktopApi.prepareDependencies(setSetupProgress)
      if (result.ok) setSetupReady(true)
    } catch (reason) {
      setSetupProgress({ stage: 'error', percent: 8, title: '无法自动准备', detail: reason instanceof Error ? reason.message : String(reason) })
    }
  }, [skipOnboarding])
  useEffect(() => { void prepare() }, [prepare])
  useEffect(() => { if (setupReady) void refresh() }, [refresh, setupReady])
  useEffect(() => { localStorage.setItem('jiucai.layout.leftCollapsed', String(leftCollapsed)) }, [leftCollapsed])
  useEffect(() => { localStorage.setItem('jiucai.layout.rightCollapsed', String(rightCollapsed)) }, [rightCollapsed])
  useEffect(() => { localStorage.setItem('jiucai.layout.leftPaneWidth', String(paneWidths.left)) }, [paneWidths.left])
  useEffect(() => { localStorage.setItem('jiucai.layout.rightPaneWidth', String(paneWidths.right)) }, [paneWidths.right])
  useEffect(() => {
    const fitPanesToWindow = () => setPaneWidths((current) => {
      const viewportWidth = window.innerWidth
      const left = clampPaneWidth('left', current.left, viewportWidth, current.right)
      const right = clampPaneWidth('right', current.right, viewportWidth, left)
      return left === current.left && right === current.right ? current : { left, right }
    })
    window.addEventListener('resize', fitPanesToWindow)
    return () => window.removeEventListener('resize', fitPanesToWindow)
  }, [])
  useEffect(() => { localStorage.setItem('jiucai.chat.unreadSessionIds', JSON.stringify([...unreadSessionIds])) }, [unreadSessionIds])
  useEffect(() => {
    const factTimer = window.setInterval(() => void refresh(), 60_000)
    return () => window.clearInterval(factTimer)
  }, [refresh])
  useEffect(() => {
    if (snapshot?.userProfile || (snapshot?.strategyProfile && snapshot?.goals)) setOnboarded(true)
  }, [snapshot])
  useEffect(() => {
    if (!window.desktopApi) return
    void window.desktopApi.loadAiConfig().then(setAiConfig).catch(() => setAiConfig(initialAiConfig))
  }, [])
  const refreshSessions = useCallback(async () => {
    if (!window.desktopApi) return
    const [recent, archived] = await Promise.all([
      window.desktopApi.listChatSessions(),
      window.desktopApi.listChatSessions(true)
    ])
    setSessions(recent)
    setArchivedSessions(archived)
  }, [])
  const markSessionRead = useCallback((sessionId: string) => {
    setUnreadSessionIds((current) => {
      if (!current.has(sessionId)) return current
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
  }, [])
  const beginChatRun = useCallback((sessionId: string) => setChatRuns((current) => startChatRun(current, sessionId)), [])
  const endChatRun = useCallback((sessionId: string) => {
    setChatRuns((current) => finishChatRun(current, sessionId))
    const visible = viewRef.current === 'chat'
      && activeSessionIdRef.current === sessionId
      && document.visibilityState === 'visible'
      && document.hasFocus()
    if (!visible) setUnreadSessionIds((current) => new Set(current).add(sessionId))
  }, [])
  useEffect(() => {
    if (!window.desktopApi) return
    let active = true
    void window.desktopApi.listChatRuns().then((runs) => { if (active) setChatRuns(hydrateChatRuns(runs)) }).catch(() => undefined)
    const unsubscribe = window.desktopApi.onChatRunChanged(({ sessionId, run }) => {
      if (run) setChatRuns((current) => setChatRun(current, run))
      else endChatRun(sessionId)
    })
    return () => { active = false; unsubscribe() }
  }, [endChatRun])
  useEffect(() => {
    if (view === 'chat' && activeSessionId && document.visibilityState === 'visible' && document.hasFocus()) markSessionRead(activeSessionId)
  }, [view, activeSessionId, markSessionRead])
  useEffect(() => {
    const readActiveSession = () => {
      if (viewRef.current === 'chat' && activeSessionIdRef.current) markSessionRead(activeSessionIdRef.current)
    }
    window.addEventListener('focus', readActiveSession)
    return () => window.removeEventListener('focus', readActiveSession)
  }, [markSessionRead])
  useEffect(() => {
    const sessionTimer = window.setInterval(() => void refreshSessions(), 60_000)
    return () => window.clearInterval(sessionTimer)
  }, [refreshSessions])
  useEffect(() => {
    if (typeof window.desktopApi?.onChatSessionChanged !== 'function') return
    return window.desktopApi.onChatSessionChanged((changed) => {
      void refreshSessions()
      const visible = viewRef.current === 'chat'
        && activeSessionIdRef.current === changed.id
        && document.visibilityState === 'visible'
        && document.hasFocus()
      if (changed.messageCount > 0 && !visible) setUnreadSessionIds((current) => new Set(current).add(changed.id))
    })
  }, [refreshSessions])
  useEffect(() => {
    if (conversationsStarted.current) return
    conversationsStarted.current = true
    if (!window.desktopApi) {
      setActiveSessionId('browser-preview')
      return
    }
    void (async () => {
      const [existing, archived] = await Promise.all([
        window.desktopApi!.listChatSessions(),
        window.desktopApi!.listChatSessions(true)
      ])
      setArchivedSessions(archived)
      if (existing.length) {
        setSessions(existing)
        setActiveSessionId(existing[0].id)
        return
      }
      const created = await window.desktopApi!.createChatSession()
      const { messages: _messages, ...summary } = created
      setSessions([summary])
      setActiveSessionId(created.id)
    })()
  }, [])
  useEffect(() => {
    if (!window.desktopApi || !snapshot) return
    const facts = watchlistFromSnapshot(snapshot)
    setWatchlist((current) => facts.map((fact) => {
      const quote = current.find((item) => item.code === fact.code)
      return quote ? { ...fact, latestPrice: quote.latestPrice, changePercent: quote.changePercent, volume: quote.volume, refreshedAt: quote.refreshedAt } : fact
    }))
    const refreshQuotes = async () => {
      const updates = new Map<string, { price: number; change: number; amount: string; time: string }>()
      await Promise.all(facts.map(async (item) => {
        const result = await window.desktopApi!.runTradeMaster('market', ['quote', '--code', item.code])
        if (!result.ok) return
        try {
          const payload = JSON.parse(result.output) as { quotes?: Array<{ price: number; changeRatio: number | null; amount: number | null; exchangeTime: string | null }> }
          const quote = payload.quotes?.[0]
          if (!quote) return
          const amount = quote.amount == null ? '--' : quote.amount >= 100_000_000 ? `${(quote.amount / 100_000_000).toFixed(2)}亿` : `${(quote.amount / 10_000).toFixed(0)}万`
          updates.set(item.code, { price: quote.price, change: (quote.changeRatio || 0) * 100, amount, time: quote.exchangeTime ? new Date(quote.exchangeTime).toLocaleTimeString('zh-CN', { hour12: false }) : new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
        } catch { /* retain the last verified quote */ }
      }))
      setWatchlist((current) => current.map((item) => { const update = updates.get(item.code); return update ? { ...item, latestPrice: update.price, changePercent: update.change, volume: update.amount, refreshedAt: update.time } : item }))
    }
    void refreshQuotes()
    const quoteTimer = window.setInterval(() => void refreshQuotes(), 30_000)
    return () => window.clearInterval(quoteTimer)
  }, [snapshot?.loadedAt])
  useEffect(() => {
    if (!shouldLoadMarketBars(Boolean(window.desktopApi), selected?.code, view) || !selected) {
      setChartBars([]); setChartError(''); setChartLoading(false); return
    }
    let active = true
    const refreshBars = async () => {
      setChartLoading(true)
      const requestPeriod = chartPeriod === 'timeline' ? '1m' : chartPeriod === '120m' ? '60m' : chartPeriod === 'five_day' ? '5m' : chartPeriod
      const limitByPeriod: Record<ChartPeriod, string> = {
        timeline: '300', '1m': '300', '5m': '300', '15m': '300', '30m': '240', '60m': '240', '120m': '240', five_day: '480', '1d': '220', '1w': '160', '1M': '120'
      }
      const result = await window.desktopApi!.runTradeMaster('market', ['bars', '--code', selected.code, '--period', requestPeriod, '--limit', limitByPeriod[chartPeriod]])
      if (!active) return
      if (!result.ok) { setChartError(result.error || 'K 线加载失败'); setChartBars([]); setChartLoading(false); return }
      try {
        const payload = JSON.parse(result.output) as { bars?: MarketBar[] }
        let bars = (payload.bars || [])
          .filter((bar) => [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite))
          .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
        if (chartPeriod === 'timeline' && bars.length) {
          const latestTradeDate = bars.at(-1)!.time.slice(0, 10)
          bars = bars.filter((bar) => bar.time.slice(0, 10) === latestTradeDate)
        }
        if (chartPeriod === '120m') bars = aggregate120MinuteBars(bars)
        setChartBars(bars)
        setChartError(bars.length ? '' : '行情源暂未返回该周期数据')
        setChartRefreshedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      } catch { setChartBars([]); setChartError('K 线数据格式异常') }
      finally { setChartLoading(false) }
    }
    setChartBars([]); setChartError('')
    void refreshBars()
    const barTimer = window.setInterval(() => void refreshBars(), 60_000)
    return () => { active = false; window.clearInterval(barTimer) }
  }, [selected?.code, chartPeriod, view])
  useEffect(() => {
    if (!watchlist.length) { setSelected(null); return }
    const candidate = selected ? watchlist.find((item) => item.code === selected.code) : null
    setSelected(candidate || watchlist[0])
  }, [watchlist, selected?.code])

  const positions = useMemo(() => positionsFromSnapshot(snapshot).map((position) => {
    const quote = watchlist.find((item) => item.code === position.instrument.code)
    if (!quote?.latestPrice) return position
    const pnl = position.averageCost == null ? 0 : (quote.latestPrice - position.averageCost) * position.quantity
    return { ...position, latestPrice: quote.latestPrice, changePercent: quote.changePercent, pnl, pnlPercent: position.averageCost ? (quote.latestPrice / position.averageCost - 1) * 100 : 0 }
  }), [snapshot, watchlist])
  const chatInstruments = useMemo(() => [...new Map([
    ...watchlist.map((item) => [item.code, { code: item.code, name: item.name, type: item.type, exchange: item.exchange }] as const),
    ...positions.map((position) => [position.instrument.code, position.instrument] as const)
  ]).values()], [watchlist, positions])
  const totalAsset = assetFromSnapshot(snapshot)
  const household = householdFromSnapshot(snapshot)
  const discipline = snapshot ? disciplineFromSnapshot(snapshot) : '未连接'
  const strategies = strategiesFromSnapshot(snapshot)
  const automations = automationsFromSnapshot(snapshot)
  const notifications = notificationEventsFromSnapshot(snapshot)
  const gates = gatesFromSnapshot(snapshot, selected)
  const factConnected = Boolean(snapshot && [snapshot.portfolio, snapshot.watchlist, snapshot.discipline, snapshot.strategies].some((value) => value !== null))
  const feishuConfig = useMemo(() => feishuConfigFromSnapshot(snapshot), [snapshot])
  const notificationConnected = Boolean(feishuConfig)
  const userProfile = useMemo(() => {
    const value = snapshot?.userProfile
    return value && typeof value === 'object' ? value as UserProfile : fallbackProfile
  }, [snapshot?.userProfile])
  const activeSession = [...sessions, ...archivedSessions].find((session) => session.id === activeSessionId) || null
  const activeChatRun = activeSessionId ? chatRuns[activeSessionId] : undefined
  const busySessionIds = useMemo(() => new Set(Object.keys(chatRuns)), [chatRuns])
  const automationSessionActive = view === 'chat' && activeSessionId?.startsWith('automation-')
  const updateAiConfig = async (next: AiConfig) => {
    const saved = window.desktopApi ? await window.desktopApi.saveAiConfig(next) : next
    setAiConfig(saved)
  }
  const createConversation = async () => {
    setView('chat')
    if (!window.desktopApi) { setActiveSessionId(`browser-${crypto.randomUUID()}`); return }
    const created = await window.desktopApi.createChatSession()
    await refreshSessions()
    setActiveSessionId(created.id)
  }
  const openConversation = (id: string) => { markSessionRead(id); setActiveSessionId(id); setView('chat') }
  const archiveConversation = async (id: string) => {
    if (chatRuns[id]) throw new Error('会话正在生成回复，完成后再归档')
    if (typeof window.desktopApi?.setChatSessionArchived !== 'function') throw new Error('归档能力已更新，请重启韭菜盒子后再试')
    await window.desktopApi.setChatSessionArchived(id, true)
    markSessionRead(id)
    if (activeSessionId === id) {
      const next = sessions.find((session) => session.id !== id)
      if (next) setActiveSessionId(next.id)
      else setActiveSessionId((await window.desktopApi.createChatSession()).id)
    }
    await refreshSessions()
  }
  const restoreConversation = async (id: string) => {
    if (typeof window.desktopApi?.setChatSessionArchived !== 'function') throw new Error('归档能力已更新，请重启韭菜盒子后再试')
    await window.desktopApi.setChatSessionArchived(id, false)
    await refreshSessions()
  }
  const completeOnboarding = async (profile: UserProfile) => {
    if (window.desktopApi) {
      await window.desktopApi.saveUserProfile(profile)
      await refresh()
    }
    setOnboarded(true)
  }
  const updateUserProfile = async (profile: UserProfile) => {
    if (!window.desktopApi) return
    await window.desktopApi.saveUserProfile(profile)
    await refresh()
  }
  const createCandidate = async (prompt: string): Promise<{ ok: boolean; error?: string }> => {
    if (!window.desktopApi) return { ok: true }
    const result = await window.desktopApi.createStrategyCandidate(aiConfig, prompt)
    if (result.ok) await refresh()
    return { ok: result.ok, error: result.error }
  }
  const searchWatchItems = async (query: string) => {
    if (!window.desktopApi) return { ok: false, items: [], error: '桌面桥接未连接' }
    return window.desktopApi.searchWatchItems(query)
  }
  const addWatchItem = async (code: string) => {
    if (!window.desktopApi) return { ok: false, error: '桌面桥接未连接' }
    const result = await window.desktopApi.addWatchItem(code)
    if (result.ok) await refresh()
    return result
  }
  const removeWatchItem = async (code: string) => {
    const result = await window.desktopApi!.removeWatchItem(code)
    if (result.ok) await refresh()
    return result
  }
  const scanWatchlist = async () => {
    const result = await window.desktopApi!.scanWatchlist(watchlist.filter((item) => item.source === 'agent'))
    if (result.ok) await refresh()
    return result
  }
  const recordHouseholdTrade = async (accountId: string, trade: TradeRecordInput) => {
    const result = await window.desktopApi!.recordHouseholdTrade(accountId, trade)
    if (result.ok) await refresh()
    return result
  }
  const createHouseholdMember = async (input: HouseholdMemberInput) => {
    const result = await window.desktopApi!.createHouseholdMember(input)
    if (result.ok) await refresh()
    return { ok: result.ok, error: result.error }
  }
  const createHouseholdAccount = async (input: HouseholdAccountInput) => {
    const result = await window.desktopApi!.createHouseholdAccount(input)
    if (result.ok) await refresh()
    return { ok: result.ok, error: result.error }
  }
  const updateHouseholdMember = async (id: string, patch: Partial<HouseholdMember>) => {
    const result = await window.desktopApi!.updateHouseholdMember(id, patch)
    if (result.ok) await refresh()
    return { ok: result.ok, error: result.error }
  }
  const updateHouseholdAccount = async (id: string, patch: Partial<HouseholdAccount>) => {
    const result = await window.desktopApi!.updateHouseholdAccount(id, patch)
    if (result.ok) await refresh()
    return { ok: result.ok, error: result.error }
  }
  const setStrategyStatus = async (id: string, action: 'pause' | 'enable' | 'promote') => {
    const result = await window.desktopApi!.setStrategyStatus(id, action)
    if (result.ok) await refresh()
    return result
  }
  const rollbackStrategy = async () => {
    const result = await window.desktopApi!.rollbackStrategies()
    if (result.ok) await refresh()
    return result
  }
  const runAutomation = async (id: string) => {
    const sessionId = automationSessionId(id)
    const running = window.desktopApi!.runAutomation(id)
    setActiveSessionId(sessionId)
    setView('chat')
    window.setTimeout(() => void refreshSessions(), 250)
    const result = await running
    await Promise.all([refresh(), refreshSessions()])
    return result
  }
  const refreshAfterFeishuConnection = async (result: FeishuConnectionResult) => {
    if (result.ok && result.status === 'connected') await refresh()
    return result
  }

  const oppositePaneWidth = (side: PaneSide, current: typeof paneWidths) => {
    if (side === 'left') return view === 'settings' ? 0 : rightCollapsed ? 42 : current.right
    return leftCollapsed ? 52 : current.left
  }
  const resizePaneFromPointer = (side: PaneSide, clientX: number) => {
    setPaneWidths((current) => ({
      ...current,
      [side]: paneWidthFromPointer(side, clientX, window.innerWidth, oppositePaneWidth(side, current))
    }))
  }
  const resizePaneBy = (side: PaneSide, delta: number) => {
    setPaneWidths((current) => ({
      ...current,
      [side]: clampPaneWidth(side, current[side] + delta, window.innerWidth, oppositePaneWidth(side, current))
    }))
  }
  const resetPaneWidth = (side: PaneSide) => {
    setPaneWidths((current) => ({
      ...current,
      [side]: clampPaneWidth(side, defaultPaneWidth(side, window.innerWidth), window.innerWidth, oppositePaneWidth(side, current))
    }))
  }

  if (!setupReady) return <SetupView progress={setupProgress} onRetry={() => void prepare()} />
  if (!bootstrapped) return <div className="app-loading"><span className="brand-mark">韭</span><strong>正在读取你的交易数据…</strong></div>
  if (!onboarded) return <Onboarding onComplete={completeOnboarding} connectionError={bootstrapError} />

  const content = (() => {
    if (view === 'chat') return <ChatWorkspace aiConfig={aiConfig} sessionId={activeSessionId} runState={activeChatRun} instruments={chatInstruments} onSessionUpdated={refreshSessions} onRunStart={beginChatRun} onRunFinish={endChatRun} onOpenSettings={() => setView('settings')} factConnected={factConnected} onFactsUpdated={refresh} />
    if (view === 'portfolio') return <PortfolioView household={household} positions={positions} totalAsset={totalAsset} onChat={() => setView('chat')} onRecordTrade={recordHouseholdTrade} onCreateMember={createHouseholdMember} onCreateAccount={createHouseholdAccount} onUpdateMember={updateHouseholdMember} onUpdateAccount={updateHouseholdAccount} />
    if (view === 'watchlist') return <WatchlistView items={watchlist} selected={selected} bars={chartBars} period={chartPeriod} chartLoading={chartLoading} chartError={chartError} chartRefreshedAt={chartRefreshedAt} onPeriod={setChartPeriod} onSelect={setSelected} onSearch={searchWatchItems} onAdd={addWatchItem} onRemove={removeWatchItem} onScan={scanWatchlist} />
    if (view === 'voc') return <VocMonitorView snapshot={snapshot?.voc} onUpdateSource={async (id, patch) => { const result = await window.desktopApi!.updateVocSource(id, patch); if (result.ok) await refresh(); return result }} onOpenExternal={(url) => window.desktopApi!.openExternal(url)} onOpenLogin={() => window.desktopApi!.openVocLogin()} />
    if (view === 'strategies') return <StrategyLabView strategies={strategies} onAskAi={() => setView('chat')} onCreateCandidate={createCandidate} onStatusChange={setStrategyStatus} onRollback={rollbackStrategy} versionCount={Array.isArray(snapshot?.strategyVersions) ? snapshot.strategyVersions.length : 0} />
    if (view === 'automations') return <AutomationsView tasks={automations} installStatus={(snapshot?.automation as { install_status?: string } | null)?.install_status} onRestoreDefaults={async () => { const result = await window.desktopApi!.restoreDefaultAutomations(); if (result.ok) await refresh(); return result }} onInstall={async () => { const result = await window.desktopApi!.installAutomations(); if (result.ok) await refresh(); return result }} onCreate={async (input) => { const result = await window.desktopApi!.createAutomation(input); if (result.ok) await refresh(); return result }} onUpdate={async (id, input) => { const result = await window.desktopApi!.updateAutomation(id, input); if (result.ok) await refresh(); return result }} onDelete={async (id) => { const result = await window.desktopApi!.deleteAutomation(id); if (result.ok) await refresh(); return result }} onToggle={async (id, enabled) => { const result = await window.desktopApi!.setAutomationEnabled(id, enabled); if (result.ok) await refresh(); return result }} onRun={runAutomation} />
    return <SettingsView userProfile={userProfile} onUserProfile={updateUserProfile} aiConfig={aiConfig} onAiConfig={updateAiConfig} tradeMasterHome={snapshot?.home} factConnected={factConnected} discipline={discipline} onConfirmNormalDiscipline={async () => { const result = await window.desktopApi!.confirmNormalDiscipline(); if (result.ok) await refresh(); return result }} notificationConfigured={notificationConnected} notificationConfig={feishuConfig} onRunDoctor={() => window.desktopApi?.runTradeMaster('doctor')} onConnectFeishu={async () => refreshAfterFeishuConnection(await window.desktopApi!.connectFeishu())} onSearchFeishuChats={(query) => window.desktopApi!.searchFeishuChats(query)} onConfigureFeishuGroup={async (chatId, name) => refreshAfterFeishuConnection(await window.desktopApi!.configureFeishuGroup(chatId, name))} onGetFeishuConversationStatus={() => window.desktopApi!.getFeishuConversationStatus()} onRestartFeishuConversation={() => window.desktopApi!.restartFeishuConversation()} onFeishuConversationStatus={(listener) => window.desktopApi!.onFeishuConversationStatus(listener)} onCompleteFeishuAuthorization={async (authorizationId) => refreshAfterFeishuConnection(await window.desktopApi!.completeFeishuAuthorization(authorizationId))} onOpenFeishuAuthorization={(authorizationId) => window.desktopApi!.openFeishuAuthorization(authorizationId)} onCancelFeishuAuthorization={(authorizationId) => window.desktopApi!.cancelFeishuAuthorization(authorizationId)} onTestFeishu={() => window.desktopApi!.testFeishu()} onDesktopStatus={() => window.desktopApi!.desktopStatus()} onInstallSwiftBar={() => window.desktopApi!.installSwiftBar()} onGetUpdateStatus={() => window.desktopApi!.getUpdateStatus()} onCheckForUpdates={() => window.desktopApi!.checkForUpdates()} onRestartToUpdate={() => window.desktopApi!.restartToUpdate()} onUpdateStatus={(listener) => window.desktopApi!.onUpdateStatus(listener)} onOpenExternal={(url) => window.desktopApi!.openExternal(url)} />
  })()

  return (
    <div className={`app-shell ${view === 'settings' ? 'settings-mode' : ''} ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`} style={{ '--left-pane-width': `${paneWidths.left}px`, '--right-pane-width': `${paneWidths.right}px` } as CSSProperties}>
      <Sidebar collapsed={leftCollapsed} onCollapsed={() => setLeftCollapsed((value) => !value)} activeView={view} onNavigate={setView} discipline={discipline} sessions={sessions} archivedSessions={archivedSessions} busySessionIds={busySessionIds} unreadSessionIds={unreadSessionIds} activeSessionId={activeSessionId} onNewConversation={() => void createConversation()} onSelectConversation={openConversation} onArchiveConversation={archiveConversation} onRestoreConversation={restoreConversation} factConnected={factConnected} notificationConnected={notificationConnected} automationReady={(snapshot?.automation as { install_status?: string } | null)?.install_status === 'installed'} />
      {!leftCollapsed && <PaneResizeHandle side="left" value={paneWidths.left} min={PANE_LIMITS.left.min} max={PANE_LIMITS.left.max} onPointerResize={(clientX) => resizePaneFromPointer('left', clientX)} onKeyboardResize={(delta) => resizePaneBy('left', delta)} onReset={() => resetPaneWidth('left')} />}
      <main className="main-column">
        <Topbar view={view} title={automationSessionActive ? activeSession?.title || '定时任务结果' : undefined} subtitle={automationSessionActive ? '系统自动检查，不会替你交易' : undefined} loadedAt={snapshot?.loadedAt ? new Date(snapshot.loadedAt).toLocaleTimeString('zh-CN', { hour12: false }) : undefined} refreshing={refreshing} onRefresh={() => void refresh()} factConnected={factConnected} marketConnected={watchlist.some((item) => item.latestPrice > 0)} notifications={notifications} />
        {content}
      </main>
      {view !== 'settings' && (rightCollapsed ? (
        <aside className="context-rail">
          <button className="icon-button ghost" title="展开右侧信息" aria-label="展开右侧信息" onClick={() => setRightCollapsed(false)} type="button"><PanelRightOpen size={16} /></button>
          <span>更多信息</span>
        </aside>
      ) : (
        <div className="context-panel-slot">
          <button className="context-collapse-button icon-button ghost" title="收起右侧信息" aria-label="收起右侧信息" onClick={() => setRightCollapsed(true)} type="button"><PanelRightClose size={16} /></button>
          <ContextPanel view={view} activeSession={activeSession} factConnected={factConnected} discipline={discipline} positions={positions} totalAsset={totalAsset} strategies={strategies} automations={automations} item={selected} watchlist={watchlist} bars={chartBars} chartLoading={chartLoading} chartError={chartError} gates={gates} period={chartPeriod} onPeriod={setChartPeriod} onSelectItem={setSelected} />
        </div>
      ))}
      {view !== 'settings' && !rightCollapsed && <PaneResizeHandle side="right" value={paneWidths.right} min={PANE_LIMITS.right.min} max={PANE_LIMITS.right.max} onPointerResize={(clientX) => resizePaneFromPointer('right', clientX)} onKeyboardResize={(delta) => resizePaneBy('right', delta)} onReset={() => resetPaneWidth('right')} />}
    </div>
  )
}
