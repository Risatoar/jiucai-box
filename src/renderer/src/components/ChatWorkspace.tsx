import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent } from 'react'
import { AlertCircle, ArrowUp, Brain, ChevronDown, MessageSquare, Paperclip, ShieldCheck, Sparkles, Square, Zap } from 'lucide-react'
import type { AiConfig, ChatAttachment, ChatMessage, ChatSession, Instrument, MemorySettings } from '../../../shared/types'
import type { ChatRunState } from '../utils/chat-run'
import { clearChatDraft, loadChatDraft, saveChatDraft } from '../utils/chat-draft'
import { automationQuickActions, chatQuickActions, emptyStateSuggestions } from '../utils/chat-prompts'
import { parseStockStrategyCards, stripStockStrategyPayload } from '../utils/stock-strategy-card'
import { parseConfirmedTrade } from '../utils/trade-proposal'
import { AttachmentStrip } from './AttachmentStrip'
import { buildConversationTurns, ConversationHistoryRail } from './ConversationHistoryRail'
import { RichMessageContent } from './RichMessageContent'
import { StockStrategyTags } from './StockStrategyCard'

interface ChatWorkspaceProps {
  aiConfig: AiConfig
  sessionId: string | null
  runState?: ChatRunState
  instruments: Instrument[]
  onSessionUpdated: () => Promise<void>
  onRunStart: (sessionId: string) => void
  onRunFinish: (sessionId: string) => void
  onOpenSettings: () => void
  factConnected: boolean
  onFactsUpdated: () => Promise<void>
}

const nowLabel = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
export function ChatWorkspace({ aiConfig, sessionId, runState, instruments, onSessionUpdated, onRunStart, onRunFinish, onOpenSettings, factConnected, onFactsUpdated }: ChatWorkspaceProps) {
  const [session, setSession] = useState<ChatSession | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attaching, setAttaching] = useState(false)
  const [attachmentError, setAttachmentError] = useState('')
  const [stopping, setStopping] = useState(false)
  const [streamSeconds, setStreamSeconds] = useState(0)
  const [globalMemory, setGlobalMemory] = useState<MemorySettings>({ useMemories: true, generateMemories: true })
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef(new Map<string, HTMLElement>())
  const sessionIdRef = useRef(sessionId)
  const previousRunActiveRef = useRef(Boolean(runState))
  const locallyRunningIdsRef = useRef(new Set<string>())
  sessionIdRef.current = sessionId
  const sending = Boolean(runState)
  const streamContent = runState?.content || ''
  const streamStatus = runState?.status || ''
  const isAutomationSession = Boolean(sessionId?.startsWith('automation-'))
  const automationRunning = Boolean(isAutomationSession && session?.messages.at(-1)?.content.includes('已开始'))
  const quickActions = isAutomationSession ? automationQuickActions : chatQuickActions
  const canSend = (input.trim().length > 0 || attachments.length > 0) && !sending && !attaching && !automationRunning && Boolean(sessionId)
  const contextLabel = useMemo(() => {
    if (aiConfig.provider === 'codex-local') return '本机 AI · 已读取交易记录'
    return `${aiConfig.model} · 已读取交易记录`
  }, [aiConfig])

  const attachmentBridgeReady = () => Boolean(
    window.desktopApi
    && typeof window.desktopApi.pickAttachments === 'function'
    && typeof window.desktopApi.saveClipboardAttachment === 'function'
    && typeof window.desktopApi.discardAttachment === 'function'
  )

  const requireAttachmentBridge = () => {
    if (attachmentBridgeReady()) return true
    setAttachmentError('附件能力刚刚更新，请重启韭菜盒子后再试；当前内容不会丢失。')
    return false
  }

  useEffect(() => {
    let cancelled = false
    setInput(loadChatDraft(sessionId))
    setAttachments((current) => {
      if (typeof window.desktopApi?.discardAttachment === 'function') {
        for (const attachment of current) void window.desktopApi.discardAttachment(attachment.storageKey)
      }
      return []
    })
    if (!sessionId) { setSession(null); return }
    if (!window.desktopApi) {
      const now = new Date().toISOString()
      setSession({ id: sessionId, title: '新对话', createdAt: now, updatedAt: now, messageCount: 0, messages: [] })
      return
    }
    setLoading(true)
    void window.desktopApi.loadChatSession(sessionId)
      .then((loaded) => { if (!cancelled) setSession(loaded) })
      .catch(() => { if (!cancelled) setSession(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  useEffect(() => {
    if (typeof window.desktopApi?.loadMemories !== 'function') return
    void window.desktopApi.loadMemories().then((snapshot) => setGlobalMemory(snapshot.settings)).catch(() => undefined)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId?.startsWith('automation-') || !window.desktopApi) return
    let cancelled = false
    let timer = 0
    let attempts = 0
    const syncRun = async () => {
      attempts += 1
      try {
        const loaded = await window.desktopApi!.loadChatSession(sessionId)
        if (cancelled) return
        setSession(loaded)
        const latest = loaded.messages.at(-1)?.content || ''
        if (latest.includes('已开始') && attempts < 600) timer = window.setTimeout(() => void syncRun(), 1000)
      } catch {
        if (!cancelled && attempts < 10) timer = window.setTimeout(() => void syncRun(), 200)
      }
    }
    timer = window.setTimeout(() => void syncRun(), 100)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [sessionId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [session?.messages.length, sending, streamContent, streamStatus])

  useEffect(() => {
    if (!runState) { setStreamSeconds(0); return }
    const updateSeconds = () => setStreamSeconds(Math.floor((Date.now() - runState.startedAt) / 1000))
    updateSeconds()
    const timer = window.setInterval(updateSeconds, 1000)
    return () => window.clearInterval(timer)
  }, [runState?.startedAt])

  useEffect(() => { if (!runState) setStopping(false) }, [runState])

  useEffect(() => {
    const wasRunning = previousRunActiveRef.current
    previousRunActiveRef.current = Boolean(runState)
    if (!wasRunning || runState || !sessionId || !window.desktopApi) return
    let cancelled = false
    void window.desktopApi.loadChatSession(sessionId)
      .then((loaded) => { if (!cancelled) setSession(loaded) })
      .then(() => { if (!cancelled) return onSessionUpdated() })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [runState, sessionId, onSessionUpdated])

  const persist = async (next: ChatSession) => {
    if (!window.desktopApi) { if (sessionIdRef.current === next.id) setSession(next); return next }
    const saved = await window.desktopApi.saveChatSession(next)
    if (sessionIdRef.current === saved.id) setSession(saved)
    await onSessionUpdated()
    return saved
  }

  const toggleMemory = async (key: 'useMemories' | 'generateMemories') => {
    if (!session) return
    const current = session.memories || { useMemories: true, generateMemories: true }
    await persist({ ...session, memories: { ...current, [key]: !current[key] } })
  }

  const send = async (preset?: string) => {
    const content = (preset ?? input).trim() || '请分析附件内容。'
    if (!content || sending || !session || locallyRunningIdsRef.current.has(session.id)) return
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content, timestamp: nowLabel(), attachments: attachments.length ? attachments : undefined }
    const withUser = { ...session, messages: [...session.messages, userMessage], messageCount: session.messages.length + 1 }
    setSession(withUser)
    setInput('')
    clearChatDraft(session.id)
    setAttachments([])
    const targetSessionId = session.id
    locallyRunningIdsRef.current.add(targetSessionId)
    onRunStart(targetSessionId)
    let savedWithUser = withUser
    try { savedWithUser = await persist(withUser) }
    catch { /* sending still works; the final save will retry */ }

    if (!window.desktopApi) {
      const assistant: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '当前只是页面预览，暂时不能使用 AI。请打开韭菜盒子桌面应用后再试。', timestamp: nowLabel(), status: 'error' }
      await persist({ ...savedWithUser, messages: [...savedWithUser.messages, assistant], messageCount: savedWithUser.messages.length + 1 })
    } else {
      try {
        const result = await window.desktopApi.chat(
          aiConfig,
          targetSessionId,
          savedWithUser.messages.map(({ role, content: messageContent, attachments: messageAttachments }) => ({ role, content: messageContent, attachments: messageAttachments }))
        )
        let completed = await window.desktopApi.loadChatSession(targetSessionId)
        const presentation = result.ok ? parseStockStrategyCards(result.content) : null
        const proposal = result.ok ? parseConfirmedTrade(content) : null
        if (result.messageId && (presentation || proposal)) {
          completed = {
            ...completed,
            messages: completed.messages.map((message) => message.id === result.messageId ? {
              ...message,
              content: presentation?.content || message.content,
              stockStrategyCards: presentation?.cards.length ? presentation.cards : undefined,
              tradeProposal: proposal ? { ...proposal, state: 'pending' as const } : undefined
            } : message)
          }
          completed = await persist(completed)
        } else {
          if (sessionIdRef.current === completed.id) setSession(completed)
          await onSessionUpdated()
        }
        if (result.ok && typeof window.desktopApi.extractMemories === 'function' && completed.memories?.generateMemories !== false) {
          const memoryMessages = completed.messages.map(({ role, content: messageContent }) => ({ role, content: messageContent }))
          void window.desktopApi.extractMemories(aiConfig, targetSessionId, memoryMessages)
        }
      } catch (error) {
        setAttachmentError(`AI 执行异常：${error instanceof Error ? error.message : String(error)}`)
        const loaded = await window.desktopApi.loadChatSession(targetSessionId).catch(() => null)
        if (loaded && sessionIdRef.current === loaded.id) setSession(loaded)
      }
    }
    locallyRunningIdsRef.current.delete(targetSessionId)
    onRunFinish(targetSessionId)
  }

  const stop = async () => {
    if (!sessionId || !sending || stopping || !window.desktopApi) return
    setStopping(true)
    setAttachmentError('')
    try {
      const stopped = await window.desktopApi.cancelChat(sessionId)
      if (!stopped) setAttachmentError('当前执行已经结束，无需停止')
    } catch (error) {
      setStopping(false)
      setAttachmentError(`停止失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const appendAttachments = (next: ChatAttachment[]) => {
    setAttachments((current) => {
      const merged = [...current, ...next.filter((item) => !current.some((existing) => existing.storageKey === item.storageKey))]
      if (merged.length > 5) setAttachmentError('每条消息最多添加 5 个附件')
      return merged.slice(0, 5)
    })
  }

  const pickAttachments = async () => {
    if (!sessionId || attaching || !requireAttachmentBridge()) return
    setAttaching(true); setAttachmentError('')
    const result = await window.desktopApi!.pickAttachments(sessionId)
    setAttaching(false)
    if (!result.ok) { setAttachmentError(result.error || '附件添加失败'); return }
    appendAttachments(result.attachments || [])
  }

  const attachFiles = async (files: File[]) => {
    if (!sessionId || !files.length || attaching || !requireAttachmentBridge()) return
    setAttaching(true); setAttachmentError('')
    try {
      const saved: ChatAttachment[] = []
      for (const file of files.slice(0, 5)) {
        const result = await window.desktopApi!.saveClipboardAttachment(sessionId, { name: file.name || `粘贴图片-${Date.now()}.png`, mimeType: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) })
        if (!result.ok || !result.attachment) throw new Error(result.error || '附件保存失败')
        saved.push(result.attachment)
      }
      appendAttachments(saved)
    } catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)) }
    finally { setAttaching(false) }
  }

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (!files.length) return
    event.preventDefault()
    void attachFiles(files)
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    void attachFiles(Array.from(event.dataTransfer.files))
  }

  const removeDraftAttachment = (attachment: ChatAttachment) => {
    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    if (typeof window.desktopApi?.discardAttachment === 'function') void window.desktopApi.discardAttachment(attachment.storageKey)
  }

  const resolveTrade = async (messageId: string, confirm: boolean) => {
    if (!session) return
    const target = session.messages.find((message) => message.id === messageId)?.tradeProposal
    if (!target || target.state !== 'pending') return
    if (confirm && window.desktopApi) {
      const result = await window.desktopApi.recordTrade(target)
      if (!result.ok) {
        const next = { ...session, messages: session.messages.map((message) => message.id === messageId ? { ...message, content: `${message.content}\n\n写入失败：${result.error || '未知错误'}` } : message) }
        await persist(next)
        return
      }
      await onFactsUpdated()
    }
    const next = { ...session, messages: session.messages.map((message) => message.id === messageId && message.tradeProposal ? { ...message, tradeProposal: { ...message.tradeProposal, state: confirm ? 'recorded' as const : 'rejected' as const } } : message) }
    await persist(next)
  }

  const messages = session?.messages || []
  const turns = useMemo(() => buildConversationTurns(messages), [messages])
  const turnAnchorIds = useMemo(() => new Set(turns.map((turn) => turn.targetMessageId)), [turns])
  const visibleStreamContent = stripStockStrategyPayload(streamContent)

  useEffect(() => {
    setActiveTurnId(turns.at(-1)?.id || null)
  }, [sessionId, turns.length])

  const syncActiveTurn = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll || turns.length === 0) return
    const checkpoint = scroll.scrollTop + 110
    let active = turns[0]
    for (const turn of turns) {
      const node = messageRefs.current.get(turn.targetMessageId)
      if (node && node.offsetTop <= checkpoint) active = turn
      else if (node) break
    }
    setActiveTurnId(active.id)
  }, [turns])

  const jumpToTurn = useCallback((turn: (typeof turns)[number]) => {
    const scroll = scrollRef.current
    const target = messageRefs.current.get(turn.targetMessageId)
    if (!scroll || !target) return
    setActiveTurnId(turn.id)
    scroll.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: 'smooth' })
  }, [])

  return (
    <section className="chat-workspace">
      <ConversationHistoryRail turns={turns} activeTurnId={activeTurnId} onJump={jumpToTurn} />
      <div className="chat-scroll" ref={scrollRef} onScroll={syncActiveTurn}>
        <div className="session-context">
          <div className="session-context-copy"><div><Sparkles size={14} /><strong>交易记录{factConnected ? '已读取' : '未连接'}</strong></div><span>{factConnected ? 'AI 会参考你的持仓、目标和交易习惯来回答' : 'AI 看不到你的持仓，只会回答一般问题'}</span></div>
          <div className="chat-memory-controls" aria-label="本对话记忆设置">
            <Brain size={13} />
            <button className={globalMemory.useMemories && session?.memories?.useMemories !== false ? 'active' : ''} disabled={!globalMemory.useMemories} onClick={() => void toggleMemory('useMemories')} title={globalMemory.useMemories ? '切换本对话是否参考长期记忆' : '已在设置中全局关闭'} type="button">参考记忆</button>
            <button className={globalMemory.generateMemories && session?.memories?.generateMemories !== false ? 'active' : ''} disabled={!globalMemory.generateMemories} onClick={() => void toggleMemory('generateMemories')} title={globalMemory.generateMemories ? '切换本对话是否生成长期记忆' : '已在设置中全局关闭'} type="button">沉淀记忆</button>
          </div>
        </div>
        {!loading && messages.length === 0 && (
          <div className="chat-empty-state">
            <div className="chat-empty-icon"><MessageSquare size={18} /></div>
            <h2>今天想看什么？</h2>
            <p>你可以直接问持仓、行情或买卖计划。对话保存在这台电脑上。</p>
            <div className="chat-suggestions">{emptyStateSuggestions.map((suggestion) => <button key={suggestion.label} type="button" onClick={() => void send(suggestion.prompt)}>{suggestion.label}</button>)}</div>
          </div>
        )}
        {messages.map((message) => {
          const presentation = parseStockStrategyCards(message.content, instruments, sessionId?.startsWith('automation-') ? 8 : 3)
          const cards = message.stockStrategyCards?.length ? message.stockStrategyCards : presentation.cards
          return (
          <article
            key={message.id}
            className={`message ${message.role} ${message.status || ''}`}
            data-message-id={message.id}
            data-turn-anchor={turnAnchorIds.has(message.id) ? 'true' : undefined}
            ref={(node) => { if (node) messageRefs.current.set(message.id, node); else messageRefs.current.delete(message.id) }}
          >
            {message.role === 'assistant' && <div className="assistant-avatar">韭</div>}
            <div className="message-body">
              <div className="message-meta">{message.role === 'user' ? '你' : '韭菜盒子'}<span>{message.timestamp}</span>{message.status === 'error' && <em><AlertCircle size={11} />{sessionId?.startsWith('automation-') ? '执行失败' : '未发送成功'}</em>}</div>
              {message.role === 'assistant' && <StockStrategyTags cards={cards} />}
              {message.role === 'assistant'
                ? <RichMessageContent
                    content={presentation.content}
                    status={message.status}
                    disabled={sending || attaching || automationRunning}
                    onFollowUp={(prompt) => void send(prompt)}
                    onOpenLink={(url) => void window.desktopApi?.openExternal(url)}
                  />
                : <div className="message-content">{presentation.content}</div>}
              <AttachmentStrip attachments={message.attachments || []} />
              {message.status === 'notice' && /AI|模型|配置/.test(message.content) && <button className="inline-settings" type="button" onClick={onOpenSettings}>打开 AI 设置</button>}
              {message.action && (
                <div className={`action-card ${message.action.level}`}>
                  <div className="action-title"><ShieldCheck size={15} />{message.action.title}<span>5 项下单前检查已完成</span></div>
                  <dl><div><dt>什么情况可以行动</dt><dd>{message.action.trigger}</dd></div><div><dt>什么情况要放弃</dt><dd>{message.action.invalidation}</dd></div><div><dt>什么时候再看</dt><dd>{message.action.nextCheck}</dd></div></dl>
                </div>
              )}
              {message.tradeProposal && <div className="trade-confirm-card"><strong>{message.tradeProposal.side === 'buy' ? '买入' : '卖出'} {message.tradeProposal.code}</strong><span>{message.tradeProposal.quantity} 股/份/张 · 成交价 ¥{message.tradeProposal.price}</span>{message.tradeProposal.state === 'pending' ? <div><button className="primary-button" onClick={() => void resolveTrade(message.id, true)} type="button">确认已成交，更新持仓</button><button className="secondary-button" onClick={() => void resolveTrade(message.id, false)} type="button">这不是成交记录</button></div> : <em>{message.tradeProposal.state === 'recorded' ? '持仓已更新' : '已忽略，持仓没有变化'}</em>}</div>}
            </div>
          </article>
          )
        })}
        {automationRunning && <div className="thinking"><span /><span /><span />正在执行定时任务，结果会自动更新</div>}
        {sending && (
          <article className="message assistant streaming-message" aria-live="polite">
            <div className="assistant-avatar">韭</div>
            <div className="message-body">
              <div className="message-meta">韭菜盒子<span>执行中 · {streamSeconds}s</span></div>
              {visibleStreamContent
                ? <div className="message-content streaming-content">{visibleStreamContent}<i className="stream-caret" /></div>
                : <div className="stream-status"><span /><span /><span />{streamStatus || `正在调用 ${contextLabel}`}</div>}
              {visibleStreamContent && <div className="stream-foot"><span className="stream-pulse" />{streamStatus || '正在继续生成'}</div>}
            </div>
          </article>
        )}
      </div>
      <div className="composer-wrap">
        {messages.length > 0 && (
          <div className="composer-shortcuts" aria-label={isAutomationSession ? '任务追问' : '快捷提问'}>
            <span className="composer-shortcuts-label"><Zap size={12} />{isAutomationSession ? '任务追问' : '快捷提问'}</span>
            <div className="composer-shortcuts-list">
              {quickActions.map((action) => (
                <button key={action.label} disabled={sending || attaching || automationRunning} onClick={() => void send(action.prompt)} title={action.prompt} type="button">{action.label}</button>
              ))}
            </div>
          </div>
        )}
        <div className={attaching ? 'composer attaching' : 'composer'} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
          <AttachmentStrip attachments={attachments} onRemove={(id) => { const attachment = attachments.find((item) => item.id === id); if (attachment) removeDraftAttachment(attachment) }} />
          <textarea value={input} onPaste={paste} onChange={(event) => { setInput(event.target.value); saveChatDraft(sessionId, event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder="比如：帮我看看这只股票，或把截图拖进来…" rows={1} />
          <div className="composer-toolbar"><div className="composer-tools"><button className="icon-button ghost" disabled={attaching} title="添加图片或文件" onClick={() => void pickAttachments()} type="button"><Paperclip size={16} /></button><button className="model-selector" type="button" onClick={onOpenSettings}><Sparkles size={13} />{contextLabel}<ChevronDown size={12} /></button></div>{sending ? <button className="send-button stop-button" disabled={stopping} onClick={() => void stop()} title={stopping ? '正在停止' : '停止生成'} type="button"><Square size={14} /></button> : <button className="send-button" disabled={!canSend} onClick={() => void send()} title="发送" type="button"><ArrowUp size={16} /></button>}</div>
        </div>
        {attachmentError && <p className="attachment-error"><AlertCircle size={11} />{attachmentError}</p>}
        <p className="composer-hint">AI 只帮你分析，不会替你下单，也不能保证赚钱。</p>
      </div>
    </section>
  )
}
