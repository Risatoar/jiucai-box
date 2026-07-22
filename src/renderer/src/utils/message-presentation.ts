import type { ChatMessage } from '../../../shared/types'

export type MessageModuleTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'action'
export type MessageResultState = 'success' | 'no_change' | 'error' | 'running' | 'notice'

export interface MessageSection {
  id: string
  title: string
  tone: MessageModuleTone
  paragraphs: string[]
  items: string[]
  ordered: boolean
  collapsible: boolean
  kind: 'standard' | 'account'
  account?: { member: string; name: string }
}

export interface MessagePresentation {
  result?: { title: string; detail: string; state: MessageResultState }
  lead?: string
  paragraphs: string[]
  sections: MessageSection[]
  structured: boolean
  long: boolean
}

const AUTOMATION = /^定时任务「([^」]+)」(已开始|执行完成|执行失败)(?:[。，,；:：]?\s*(.*))?$/
const HEADING = /^#{1,6}\s+(.+)$/
const BULLET = /^[-*•]\s+(.+)$/
const ORDERED = /^\d+[.)、]\s+(.+)$/
const LABEL = /^(结论|核心结论|当前结论|下一步|下一检查点|操作建议|下午操作建议|触发条件|失效条件|撤销条件|风险|主要风险|风险与下一检查点|判断依据|证据|数据时间|数据状态|阻断条件|执行结论|上午结论|市场走势与异动|内外围消息影响|持仓与候选|当前状态|需要确认)(?:\s*[:：]\s*(.*))?$/

const clean = (value: string) => value.replace(/^\s+|\s+$/g, '').replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1')

const toneFor = (title: string): MessageModuleTone => {
  if (/失败|错误|失效|撤销|卖出|减仓|清仓/.test(title)) return 'danger'
  if (/风险|阻断|注意|确认/.test(title)) return 'warning'
  if (/触发|机会|买入|满足/.test(title)) return 'positive'
  if (/下一步|建议|检查点|操作/.test(title)) return 'action'
  return 'neutral'
}

const accountFor = (title: string) => {
  const parts = title.split(/\s*(?:→|->)\s*/).map(clean).filter(Boolean)
  if (parts.length === 2 && /账户/.test(parts[1])) return { member: parts[0], name: parts[1] }
  if (/账户/.test(title)) return { member: '', name: title.replace(/^[【[]|[】\]]$/g, '') }
  return undefined
}

const resultFrom = (line: string, status?: ChatMessage['status']) => {
  const match = AUTOMATION.exec(line)
  if (!match && status !== 'error' && status !== 'notice') return undefined
  if (!match) return {
    title: status === 'error' ? '本条消息执行失败' : '系统提示',
    detail: line,
    state: status === 'error' ? 'error' as const : 'notice' as const
  }
  const state: MessageResultState = match[2] === '执行失败'
    ? 'error'
    : match[2] === '已开始'
      ? 'running'
      : /没有材料变化|NO_REPLY/.test(match[3] || '') ? 'no_change' : 'success'
  return { title: match[1], detail: match[3] || match[2], state }
}

const section = (title: string, index: number): MessageSection => {
  const account = accountFor(title)
  return {
    id: `${index}-${title}`,
    title,
    tone: toneFor(title),
    paragraphs: [],
    items: [],
    ordered: false,
    collapsible: false,
    kind: account ? 'account' : 'standard',
    account
  }
}

const meaningfulLines = (content: string) => content.replace(/\r\n/g, '\n').split('\n').map(clean)

export const buildMessagePresentation = (content: string, status?: ChatMessage['status']): MessagePresentation => {
  const lines = meaningfulLines(content)
  const firstContentIndex = lines.findIndex(Boolean)
  const firstLine = firstContentIndex >= 0 ? lines[firstContentIndex] : ''
  const result = resultFrom(firstLine, status)
  if (result && firstContentIndex >= 0) lines.splice(firstContentIndex, 1)

  const sections: MessageSection[] = []
  const paragraphs: string[] = []
  let current: MessageSection | null = null
  let loose: string[] = []

  const flushLoose = () => {
    if (!loose.length) return
    const text = loose.join(' ').trim()
    if (text) (current ? current.paragraphs : paragraphs).push(text)
    loose = []
  }

  for (const raw of lines) {
    if (!raw) { flushLoose(); continue }
    const heading = HEADING.exec(raw)
    const labeled = LABEL.exec(raw.replace(/^[-*]\s*/, ''))
    if (heading || labeled) {
      flushLoose()
      const title = clean(heading?.[1] || labeled?.[1] || '')
      current = section(title, sections.length)
      sections.push(current)
      const inline = clean(labeled?.[2] || '')
      if (inline) current.paragraphs.push(inline)
      continue
    }
    const bullet = BULLET.exec(raw)
    const ordered = ORDERED.exec(raw)
    if (bullet || ordered) {
      flushLoose()
      if (!current) { current = section('要点', sections.length); sections.push(current) }
      current.items.push(clean(bullet?.[1] || ordered?.[1] || ''))
      current.ordered ||= Boolean(ordered)
      continue
    }
    loose.push(raw)
  }
  flushLoose()

  const conclusionIndex = sections.findIndex((item) => /结论/.test(item.title) && item.paragraphs.length > 0)
  const lead = conclusionIndex >= 0 ? sections[conclusionIndex].paragraphs.shift() : paragraphs.shift()
  for (const item of sections) {
    const length = item.paragraphs.join('').length + item.items.join('').length
    item.collapsible = item.items.length > 4 || length > 280
  }
  const structured = Boolean(result || sections.length || (lead && /结论|建议|提醒|注意|可以|不要|等待/.test(lead)))
  return {
    result,
    lead,
    paragraphs,
    sections: sections.filter((item) => item.paragraphs.length || item.items.length),
    structured,
    long: content.length > 900 || sections.length > 5
  }
}
