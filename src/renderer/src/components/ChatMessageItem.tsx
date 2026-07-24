import { memo, useMemo } from 'react'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import type { ChatMessage, Instrument, StockStrategyCardData } from '../../../shared/types'
import { parseStockStrategyCards } from '../utils/stock-strategy-card'
import { AttachmentStrip } from './AttachmentStrip'
import { RichMessageContent } from './RichMessageContent'
import { StockStrategyTags } from './StockStrategyCard'

interface ChatMessageItemProps {
  message: ChatMessage
  instruments: Instrument[]
  instrumentsKey: string
  automationSession: boolean
  turnAnchor: boolean
  disabled: boolean
  retrying: boolean
  registerNode: (messageId: string, node: HTMLElement | null) => void
  onHandleSignal: (messageId: string, card: StockStrategyCardData) => void
  onFollowUp: (prompt: string) => void
  onRetry: (message: ChatMessage) => void
  onOpenLink: (url: string) => void
  onOpenSettings: () => void
  onResolveTrade: (messageId: string, confirmed: boolean) => void
}

function ChatMessageItemComponent({
  message,
  instruments,
  automationSession,
  turnAnchor,
  disabled,
  retrying,
  registerNode,
  onHandleSignal,
  onFollowUp,
  onRetry,
  onOpenLink,
  onOpenSettings,
  onResolveTrade
}: ChatMessageItemProps) {
  const presentation = useMemo(
    () => parseStockStrategyCards(message.content, instruments, automationSession ? 8 : 3),
    [automationSession, instruments, message.content]
  )
  const cards = message.stockStrategyCards?.length ? message.stockStrategyCards : presentation.cards
  const coveredInstruments = useMemo(() => cards.map((card) => card.code), [cards])
  const coveredAccounts = useMemo(
    () => cards.flatMap((card) => card.accountScope ? [card.accountScope] : []),
    [cards]
  )

  return <article
    className={`message ${message.role} ${message.status || ''}`}
    data-message-id={message.id}
    data-turn-anchor={turnAnchor ? 'true' : undefined}
    ref={(node) => registerNode(message.id, node)}
  >
    {message.role === 'assistant' && <div className="assistant-avatar">韭</div>}
    <div className="message-body">
      <div className="message-meta">{message.role === 'user' ? '你' : '韭菜盒子'}<span>{message.timestamp}</span>{message.status === 'error' && <em><AlertCircle size={11} />{automationSession ? '执行失败' : '未发送成功'}</em>}</div>
      {message.role === 'assistant' && <StockStrategyTags cards={cards} content={presentation.content} onHandleSignal={(card) => onHandleSignal(message.id, card)} />}
      {message.role === 'assistant'
        ? <RichMessageContent
            content={presentation.content}
            status={message.status}
            coveredInstruments={coveredInstruments}
            coveredAccounts={coveredAccounts}
            disabled={disabled}
            retrying={retrying}
            onFollowUp={onFollowUp}
            onRetry={message.status === 'error' ? () => onRetry(message) : undefined}
            onOpenLink={onOpenLink}
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
      {message.tradeProposal && <div className="trade-confirm-card"><strong>{message.tradeProposal.side === 'buy' ? '买入' : '卖出'} {message.tradeProposal.code}</strong><span>{message.tradeProposal.quantity} 股/份/张 · 成交价 ¥{message.tradeProposal.price}</span>{message.tradeProposal.state === 'pending' ? <div><button className="primary-button" onClick={() => onResolveTrade(message.id, true)} type="button">确认已成交，更新持仓</button><button className="secondary-button" onClick={() => onResolveTrade(message.id, false)} type="button">这不是成交记录</button></div> : <em>{message.tradeProposal.state === 'recorded' ? '持仓已更新' : '已忽略，持仓没有变化'}</em>}</div>}
    </div>
  </article>
}

export const ChatMessageItem = memo(ChatMessageItemComponent, (previous, next) => (
  previous.message === next.message
  && previous.instrumentsKey === next.instrumentsKey
  && previous.automationSession === next.automationSession
  && previous.turnAnchor === next.turnAnchor
  && previous.disabled === next.disabled
  && previous.retrying === next.retrying
  && previous.registerNode === next.registerNode
  && previous.onHandleSignal === next.onHandleSignal
  && previous.onFollowUp === next.onFollowUp
  && previous.onRetry === next.onRetry
  && previous.onOpenLink === next.onOpenLink
  && previous.onOpenSettings === next.onOpenSettings
  && previous.onResolveTrade === next.onResolveTrade
))
