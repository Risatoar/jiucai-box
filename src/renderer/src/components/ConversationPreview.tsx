import { FileText, Image as ImageIcon, LoaderCircle, MessageSquareText } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { ChatAttachment, ChatSession, ChatSessionSummary } from '../../../shared/types'

interface ConversationPreviewProps {
  summary: ChatSessionSummary
  session: ChatSession | null
  loading: boolean
  busy: boolean
  unread: boolean
  anchor: { left: number; top: number }
  onEnter: () => void
  onLeave: () => void
  onOpen: () => void
}

const assetUrl = (storageKey: string) => `jiucai-asset://local/${storageKey.split('/').map(encodeURIComponent).join('/')}`

export const conversationPreviewExcerpt = (session: ChatSession | null) => {
  const content = session?.messages.at(-1)?.content
  if (!content) return '还没有消息内容。'
  return content.replace(/[#>*_`~]+/g, '').replace(/\s+/g, ' ').trim()
}

export const conversationPreviewAttachments = (session: ChatSession | null): ChatAttachment[] => {
  const attachments = session?.messages.flatMap((message) => message.attachments || []) || []
  return [...new Map(attachments.map((attachment) => [attachment.id, attachment])).values()].reverse()
}

const updateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function ConversationPreview({ summary, session, loading, busy, unread, anchor, onEnter, onLeave, onOpen }: ConversationPreviewProps) {
  if (typeof document === 'undefined') return null
  const attachments = conversationPreviewAttachments(session)
  const visibleAttachments = attachments.slice(0, 2)
  const stateLabel = busy ? '正在分析' : unread ? '有新回复' : '已完成'

  return createPortal(
    <aside
      id={`conversation-preview-${summary.id}`}
      className="conversation-preview-card"
      style={{ left: anchor.left, top: anchor.top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onOpen}
      role="dialog"
      aria-label={`${summary.title}预览`}
    >
      <header>
        <span className="conversation-preview-icon"><MessageSquareText size={15} /></span>
        <strong title={summary.title}>{summary.title}</strong>
      </header>
      {loading ? (
        <div className="conversation-preview-loading"><LoaderCircle className="spinning" size={15} />正在读取最近内容…</div>
      ) : (
        <>
          <div className="conversation-preview-meta"><span className={busy ? 'busy' : unread ? 'unread' : ''}>{stateLabel}</span><span>{summary.messageCount} 条消息</span><span>{updateTime(summary.updatedAt)}</span></div>
          <p>{conversationPreviewExcerpt(session)}</p>
          {attachments.length > 0 && <div className="conversation-preview-attachments">
            {visibleAttachments.map((attachment) => <span className="conversation-preview-attachment" key={attachment.id} title={attachment.name}>
              {attachment.kind === 'image' ? <img src={assetUrl(attachment.storageKey)} alt="" /> : <FileText size={14} />}
              <span>{attachment.kind === 'image' ? <ImageIcon size={12} /> : null}{attachment.name}</span>
            </span>)}
            {attachments.length > visibleAttachments.length && <em>+{attachments.length - visibleAttachments.length}</em>}
          </div>}
        </>
      )}
    </aside>,
    document.body
  )
}
