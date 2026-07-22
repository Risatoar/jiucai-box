import { FileText, Image as ImageIcon, Minus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatAttachment, ChatMessage } from '../../../shared/types'

export interface ConversationTurn {
  id: string
  targetMessageId: string
  title: string
  excerpt: string
  timestamp: string
  attachments: ChatAttachment[]
}

interface ConversationHistoryRailProps {
  turns: ConversationTurn[]
  activeTurnId: string | null
  onJump: (turn: ConversationTurn) => void
}

const cleanContent = (content: string) => content.replace(/[#>*_`~]+/g, '').replace(/\s+/g, ' ').trim()

const uniqueAttachments = (messages: ChatMessage[]) => {
  const attachments = messages.flatMap((message) => message.attachments || [])
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()]
}

export const buildConversationTurns = (messages: ChatMessage[]): ConversationTurn[] => {
  const groups: ChatMessage[][] = []
  for (const message of messages) {
    if (message.role === 'user' || groups.length === 0) groups.push([message])
    else groups.at(-1)!.push(message)
  }

  return groups.map((group, index) => {
    const userMessage = group.find((message) => message.role === 'user')
    const assistantMessage = [...group].reverse().find((message) => message.role === 'assistant')
    const firstMessage = group[0]
    return {
      id: `turn-${firstMessage.id}`,
      targetMessageId: firstMessage.id,
      title: cleanContent(userMessage?.content || firstMessage.content) || `第 ${index + 1} 轮对话`,
      excerpt: cleanContent(assistantMessage?.content || userMessage?.content || firstMessage.content) || '暂无内容',
      timestamp: firstMessage.timestamp,
      attachments: uniqueAttachments(group)
    }
  })
}

const previewPosition = (rect: DOMRect) => ({
  left: Math.min(rect.right + 8, window.innerWidth - 326),
  top: Math.max(12, Math.min(rect.top - 52, window.innerHeight - 150))
})

function TurnPreview({ turn, anchor, onEnter, onLeave, onJump }: {
  turn: ConversationTurn
  anchor: { left: number; top: number }
  onEnter: () => void
  onLeave: () => void
  onJump: () => void
}) {
  if (typeof document === 'undefined') return null
  const visibleAttachments = turn.attachments.slice(0, 2)
  return createPortal(
    <aside className="conversation-history-preview" style={anchor} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onJump} role="dialog" aria-label={`${turn.title}预览`}>
      <strong title={turn.title}>{turn.title}</strong>
      <p>{turn.excerpt}</p>
      {visibleAttachments.length > 0 && <div className="conversation-history-preview-files">
        {visibleAttachments.map((attachment) => <span key={attachment.id} title={attachment.name}>
          {attachment.kind === 'image' ? <ImageIcon size={13} /> : <FileText size={13} />}
          <em>{attachment.name}</em>
        </span>)}
        {turn.attachments.length > visibleAttachments.length && <small>+{turn.attachments.length - visibleAttachments.length}</small>}
      </div>}
    </aside>,
    document.body
  )
}

export function ConversationHistoryRail({ turns, activeTurnId, onJump }: ConversationHistoryRailProps) {
  const [preview, setPreview] = useState<{ turn: ConversationTurn; index: number; anchor: { left: number; top: number } } | null>(null)
  const closeTimer = useRef<number | null>(null)

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const openPreview = (turn: ConversationTurn, index: number, target: HTMLElement) => {
    cancelClose()
    setPreview({ turn, index, anchor: previewPosition(target.getBoundingClientRect()) })
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setPreview(null), 110)
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => { window.removeEventListener('keydown', closeOnEscape); cancelClose() }
  }, [])

  if (turns.length < 2) return null
  return <>
    <nav className="conversation-history-rail" aria-label="本次对话回溯">
      {turns.map((turn, index) => {
        const active = turn.id === activeTurnId
        const distance = preview ? Math.abs(preview.index - index) : Number.POSITIVE_INFINITY
        const selected = distance === 0
        const iconWidth = selected ? 34 : distance === 1 ? 22 : distance === 2 ? 14 : 8
        return <button
          key={turn.id}
          className={`${active ? 'active ' : ''}${selected ? 'selected' : ''}`.trim()}
          type="button"
          aria-label={`回到第 ${index + 1} 轮：${turn.title}`}
          aria-current={active ? 'step' : undefined}
          data-history-turn-index={index}
          onMouseEnter={(event) => openPreview(turn, index, event.currentTarget)}
          onMouseLeave={scheduleClose}
          onFocus={(event) => openPreview(turn, index, event.currentTarget)}
          onBlur={scheduleClose}
          onClick={() => { setPreview(null); onJump(turn) }}
        ><Minus width={iconWidth} height={12} strokeWidth={selected ? 2.2 : 1.9} /></button>
      })}
    </nav>
    {preview && <TurnPreview turn={preview.turn} anchor={preview.anchor} onEnter={cancelClose} onLeave={scheduleClose} onJump={() => { setPreview(null); onJump(preview.turn) }} />}
  </>
}
