import { Check, ChevronDown, CircleCheck, CircleDashed, CircleX, Clipboard, Info, Landmark, ListChecks, ShieldAlert, Sparkles } from 'lucide-react'
import { Fragment, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import { buildMessagePresentation, type MessageResultState, type MessageSection } from '../utils/message-presentation'

interface RichMessageContentProps {
  content: string
  status?: ChatMessage['status']
  disabled?: boolean
  onFollowUp?: (prompt: string) => void
  onOpenLink?: (url: string) => void
}

const resultLabel: Record<MessageResultState, string> = {
  success: '已完成', no_change: '无变化', error: '失败', running: '执行中', notice: '提示'
}

const ResultIcon = ({ state }: { state: MessageResultState }) => state === 'success'
  ? <CircleCheck size={15} />
  : state === 'error' ? <CircleX size={15} /> : state === 'running' ? <CircleDashed size={15} /> : <Info size={15} />

function InlineText({ text, onOpenLink }: { text: string; onOpenLink?: (url: string) => void }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s]+)/g).filter(Boolean)
  return <>{tokens.map((token, index) => {
    if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>
    if (token.startsWith('`') && token.endsWith('`')) return <code key={index}>{token.slice(1, -1)}</code>
    if (/^https?:\/\//.test(token)) return <button className="message-inline-link" key={index} onClick={() => onOpenLink?.(token)} title={token} type="button">打开链接</button>
    return <Fragment key={index}>{token}</Fragment>
  })}</>
}

function SectionContent({ section, onOpenLink }: { section: MessageSection; onOpenLink?: (url: string) => void }) {
  const List = section.ordered ? 'ol' : 'ul'
  return <div className="message-module-section-body">
    {section.paragraphs.map((paragraph, index) => <p key={index}><InlineText text={paragraph} onOpenLink={onOpenLink} /></p>)}
    {section.items.length > 0 && <List>{section.items.map((item, index) => <li key={index}><InlineText text={item} onOpenLink={onOpenLink} /></li>)}</List>}
  </div>
}

function MessageSectionModule({ section, onOpenLink }: { section: MessageSection; onOpenLink?: (url: string) => void }) {
  const title = section.account
    ? <span className="message-account-title"><Landmark size={14} /><span><strong>{section.account.member || section.account.name}</strong>{section.account.member && <small>{section.account.name}</small>}</span><em>独立账户</em></span>
    : section.title
  if (!section.collapsible) return <section className={`message-module-section ${section.tone} ${section.kind}`}>
    <header>{title}</header><SectionContent section={section} onOpenLink={onOpenLink} />
  </section>
  return <details className={`message-module-section ${section.tone} ${section.kind}`} open>
    <summary>{title}<small>{section.items.length || section.paragraphs.length} 项</small><ChevronDown size={12} /></summary>
    <SectionContent section={section} onOpenLink={onOpenLink} />
  </details>
}

const followUps = (state?: MessageResultState) => state === 'error'
  ? [
      { label: '解释原因', icon: Info, prompt: '请解释上一条失败的直接原因、影响范围和当前还能做什么。' },
      { label: '给修复方案', icon: ListChecks, prompt: '请基于上一条失败结果给出最小可执行修复方案，并列出验证步骤。' }
    ]
  : state
    ? [
        { label: '提取下一步', icon: ListChecks, prompt: '请基于上一条任务结果，列出我现在最该关注和执行的三件事。' },
        { label: '复核风险', icon: ShieldAlert, prompt: '请复核上一条任务结果中的风险、证据不足和可能误判。' }
      ]
    : [
        { label: '转成清单', icon: ListChecks, prompt: '请把上一条回答整理成不超过五项的可执行清单。' },
        { label: '复核风险', icon: ShieldAlert, prompt: '请复核上一条回答中的风险、证据不足和可能误判。' }
      ]

export function RichMessageContent({ content, status, disabled, onFollowUp, onOpenLink }: RichMessageContentProps) {
  const [copied, setCopied] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const presentation = buildMessagePresentation(content, status)
  if (!content.trim()) return null
  const copy = async () => {
    await navigator.clipboard?.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  return <div className="rich-message-content">
    {presentation.result && <div className={`message-result-banner ${presentation.result.state}`}>
      <span><ResultIcon state={presentation.result.state} /></span>
      <div><strong>{presentation.result.title}</strong><small>{presentation.result.detail}</small></div>
      <em>{resultLabel[presentation.result.state]}</em>
    </div>}
    {presentation.lead && <div className={`message-lead ${presentation.structured ? 'structured' : ''}`}>
      {presentation.structured && <Sparkles size={13} />}<p><InlineText text={presentation.lead} onOpenLink={onOpenLink} /></p>
    </div>}
    {presentation.paragraphs.length > 0 && <div className="message-paragraphs">
      {presentation.paragraphs.map((paragraph, index) => <p key={index}><InlineText text={paragraph} onOpenLink={onOpenLink} /></p>)}
    </div>}
    {presentation.sections.length > 0 && <div className={`message-module-sections ${presentation.sections.length === 1 ? 'single' : ''}`}>
      {presentation.sections.map((section) => <MessageSectionModule key={section.id} section={section} onOpenLink={onOpenLink} />)}
    </div>}
    {showRaw && <pre className="message-raw-content">{content}</pre>}
    <div className="message-interactions" aria-label="消息操作">
      <button onClick={() => void copy()} title="复制完整回答" type="button">{copied ? <Check size={12} /> : <Clipboard size={12} />}{copied ? '已复制' : '复制'}</button>
      {presentation.structured && <button onClick={() => setShowRaw((value) => !value)} title="查看未经模块化的原始回答" type="button"><ChevronDown className={showRaw ? 'open' : ''} size={12} />{showRaw ? '收起原文' : '查看原文'}</button>}
      {onFollowUp && followUps(presentation.result?.state).map((action) => {
        const ActionIcon = action.icon
        return <button disabled={disabled} key={action.label} onClick={() => onFollowUp(action.prompt)} title={action.prompt} type="button"><ActionIcon size={12} />{action.label}</button>
      })}
    </div>
  </div>
}
