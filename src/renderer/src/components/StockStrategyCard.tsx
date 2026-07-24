import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, Clock3, Landmark, ShieldAlert, TrendingDown, TrendingUp, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { StockStrategyCardData, StockStrategyPoint } from '../../../shared/types'
import { buildMessagePresentation, type MessageEntityGroup } from '../utils/message-presentation'
import { handlingLabel, signalTradeSide } from '../utils/signal-handling'
import { MarkdownBlock } from './MarkdownBlock'
import { StockStrategyMarket } from './StockStrategyMarket'
import { SignalHistoryPanel } from './SignalHistoryPanel'

const typeLabel = (card: StockStrategyCardData) => card.instrumentType === 'cbond' ? '债' : card.instrumentType === 'stock' ? '股' : 'E'
const stanceTone = (stance: StockStrategyCardData['stance']) => stance === '可关注' ? 'ready' : stance === '暂不介入' ? 'stop' : stance === '持仓管理' ? 'manage' : 'wait'
const immediateExpired = (card: StockStrategyCardData) => card.signal?.startsWith('immediate_')
  && (!card.executionValidUntil || !Number.isFinite(Date.parse(card.executionValidUntil)) || Date.parse(card.executionValidUntil) <= Date.now())
const effectiveSignal = (card: StockStrategyCardData) => immediateExpired(card)
  ? card.signal === 'immediate_buy' ? 'strong_buy' : 'strong_sell'
  : card.signal
const signalMeta = (card: StockStrategyCardData) => {
  const signal = effectiveSignal(card)
  if (signal === 'immediate_buy') return { label: '立即买入', tone: 'buy', strength: 'immediate', priority: 4 } as const
  if (signal === 'immediate_sell') return { label: '立即卖出', tone: 'sell', strength: 'immediate', priority: 4 } as const
  if (signal === 'strong_buy') return { label: '推荐买入', tone: 'buy', strength: 'strong', priority: 3 } as const
  if (signal === 'strong_sell') return { label: '推荐卖出', tone: 'sell', strength: 'strong', priority: 3 } as const
  if (signal === 'prepare_buy') return { label: '准备买入', tone: 'buy', strength: 'prepare', priority: 2 } as const
  if (signal === 'prepare_sell') return { label: '准备卖出', tone: 'sell', strength: 'prepare', priority: 2 } as const
  return { label: '关注', tone: 'watch', strength: 'watch', priority: 1 } as const
}
const signalClass = (card: StockStrategyCardData) => {
  const meta = signalMeta(card)
  return meta.strength === 'watch' ? 'watch' : `${meta.strength}-${meta.tone}`
}
const executionLabel = (card: StockStrategyCardData) => immediateExpired(card)
  ? '当前点位已过期'
  : card.executionStatus === 'ready'
  ? '执行条件已通过'
  : card.executionStatus === 'blocked'
    ? '暂不可执行'
    : card.executionStatus === 'review'
      ? '等待执行复核'
      : ''
const signalDescription = (card: StockStrategyCardData) => {
  if (immediateExpired(card)) return '原立即信号已超过当前点位有效期，现降为推荐级；请刷新行情和账户状态后再决定。'
  const signal = effectiveSignal(card)
  if (signal === 'immediate_buy') return '当前点位、账户和执行条件均已通过，建议立即人工买入；最长5分钟有效，不会自动下单。'
  if (signal === 'immediate_sell') return '当前点位、持仓和执行条件均已通过，建议立即人工卖出；最长5分钟有效，不会自动下单。'
  if (signal === 'strong_buy') return '买入证据已经形成，建议优先人工复核；如仍有资金、数量或委托阻断，不要下单。'
  if (signal === 'strong_sell') return '卖出证据已经形成，建议优先人工复核减仓或清仓；仍需核对可用数量和委托。'
  if (signal === 'prepare_buy') return '已经进入买入准备阶段，但还缺少下一确认条件；继续等待，不要抢跑。'
  if (signal === 'prepare_sell') return '已经进入卖出准备阶段，但退出证据尚未完全确认；先准备方案，暂不执行。'
  return '当前证据不足，或走势仍在形成中；只观察，不进行买卖。'
}
const SIGNAL_LEVELS: Array<{ signal: NonNullable<StockStrategyCardData['signal']>; label: string; tone: 'buy' | 'sell' | 'watch'; advice: string }> = [
  { signal: 'immediate_buy', label: '立即买入', tone: 'buy', advice: '当前点位和执行条件已通过，可立即人工买入' },
  { signal: 'strong_buy', label: '推荐买入', tone: 'buy', advice: '买入证据已形成，建议优先人工复核' },
  { signal: 'prepare_buy', label: '准备买入', tone: 'buy', advice: '进入买入准备阶段，等待下一确认条件' },
  { signal: 'watch', label: '关注', tone: 'watch', advice: '证据不足或走势形成中，只观察不操作' },
  { signal: 'prepare_sell', label: '准备卖出', tone: 'sell', advice: '进入卖出准备阶段，先准备方案暂不执行' },
  { signal: 'strong_sell', label: '推荐卖出', tone: 'sell', advice: '卖出证据已形成，建议优先人工复核' },
  { signal: 'immediate_sell', label: '立即卖出', tone: 'sell', advice: '当前点位和执行条件已通过，可立即人工卖出' }
]

function SignalLevelCard({ card }: { card: StockStrategyCardData }) {
  const current = effectiveSignal(card)
  const currentLevel = SIGNAL_LEVELS.find((item) => item.signal === current) || SIGNAL_LEVELS[3]
  const expired = immediateExpired(card)
  const currentIndex = SIGNAL_LEVELS.findIndex((item) => item.signal === current)
  return <div className="signal-level-card" role="tooltip">
    <div className="signal-level-card-head">
      <strong>{currentLevel.label}</strong>
      <span>{expired ? '当前点位已过期' : `当前层级 · ${currentIndex + 1} / ${SIGNAL_LEVELS.length}`}</span>
    </div>
    <div className="signal-level-card-bar">
      {SIGNAL_LEVELS.map((level) => <span
        key={level.signal}
        className={`signal-level-segment ${level.tone}${level.signal === current ? ' current' : ''}`}
        title={level.label}
      />)}
    </div>
    <div className="signal-level-card-legend">
      <span className="buy">买入方向</span>
      <span className="watch">观察</span>
      <span className="sell">卖出方向</span>
    </div>
    <div className="signal-level-card-advice">
      <b>操作意见</b>
      <p>{expired ? signalDescription(card) : currentLevel.advice}</p>
    </div>
  </div>
}

const cardKey = (card: StockStrategyCardData) => `${card.code}-${card.accountScope || 'watchlist'}`
const sourceLabel = (card: StockStrategyCardData) => card.source === 'holding' ? '持仓' : card.source === 'user' ? '我的收藏' : card.source === 'agent' ? 'AI发现' : ''
const accountFor = (scope?: string) => {
  if (!scope) return undefined
  const [member, name] = scope.split(/\s*(?:→|->)\s*/).map((item) => item.trim())
  return { member: member || scope, name: name || '' }
}

const instrumentAccountPreview = (group: MessageEntityGroup) => group.instruments.flatMap((instrument) => {
  const content = instrument.sections.flatMap((section) => [...section.paragraphs, ...section.items])
  const detail = content.find((item) => /持仓事实|持仓\s*[:：]|账户状态|现金\s*[:：]/.test(item)) || content[0]
  if (!detail) return []
  const identity = instrument.instrument
    ? `**${instrument.instrument.name} ${instrument.instrument.code}**`
    : `**${instrument.title}**`
  return [`${identity} · ${detail}`]
})

function AccountOverview({ group }: { group?: MessageEntityGroup }) {
  if (!group) return null
  const instrumentPreviews = group.sections.length ? [] : instrumentAccountPreview(group)
  if (!group.sections.length && !instrumentPreviews.length) return null
  return <div className="stock-account-overview">
    {group.sections.map((section) => <section key={section.id}>
      <strong>{section.title}</strong>
      <div>{section.paragraphs.map((paragraph) => <MarkdownBlock content={paragraph} key={paragraph} />)}{section.items.length > 0 && <ul>{section.items.map((item) => <li key={item}><MarkdownBlock content={item} /></li>)}</ul>}</div>
    </section>)}
    {instrumentPreviews.length > 0 && <section className="stock-account-holdings">
      <strong>持仓概览</strong>
      <ul>{instrumentPreviews.map((item) => <li key={item}><MarkdownBlock content={item} /></li>)}</ul>
    </section>}
  </div>
}

function ActionSignalCard({ card, onOpen, onHandle }: { card: StockStrategyCardData; onOpen: () => void; onHandle?: () => void }) {
  const signal = signalMeta(card)
  const [hovered, setHovered] = useState(false)
  if (signal.strength === 'watch') return null
  const buy = signal.tone === 'buy'
  const Icon = buy ? TrendingUp : TrendingDown
  const point = (buy ? card.buyPoints : card.sellPoints)[0]
  const handled = card.handling ? handlingLabel(card.handling.status, signalTradeSide(card)) : ''
  const description = signalDescription(card)
  return <div className={`stock-signal-highlight-wrap ${hovered ? 'hovered' : ''}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}>
    {hovered && <SignalLevelCard card={card} />}
    <div className={`stock-signal-highlight ${signal.tone} ${signal.strength}`} data-signal-description={description}>
    <button className="stock-signal-open" onClick={onOpen} type="button" aria-label={`${signal.label}信号：${card.name}。${card.actionPurpose ? `动作目的：${card.actionPurpose}。` : ''}${description} 点击查看详情`}>
      <span className="stock-signal-icon"><Icon size={17} /></span>
      <span className="stock-signal-main">
        <span className="stock-signal-title"><em>{signal.label}</em>{executionLabel(card) && <i className={`stock-execution-badge ${immediateExpired(card) ? 'expired' : card.executionStatus}`}>{executionLabel(card)}</i>}<strong title={card.name}>{card.name}</strong><small>{card.code}{sourceLabel(card) ? ` · ${sourceLabel(card)}` : ''}</small></span>
        {card.actionPurpose && <span className="stock-action-purpose" title={`动作目的：${card.actionPurpose}`}>要做什么 · {card.actionPurpose}</span>}
        <span className="stock-signal-summary" title={card.summary}>{card.summary}</span>
        {point && <span className="stock-signal-condition" title={`${point.label}${point.price ? ` · ${point.price}` : ''}：${point.condition}`}><b>{point.label}{point.price ? ` · ${point.price}` : ''}</b>{point.condition}</span>}
      </span>
    </button>
    <span className="stock-signal-side">
      {card.currentPrice && <strong>{card.currentPrice}</strong>}
      {card.changePercent && <small>{card.changePercent}</small>}
      <button onClick={onOpen} type="button">查看详情 <ChevronDown size={12} /></button>
      {onHandle && (card.handling?.status === 'executed'
        ? <em className="stock-signal-handled">{handled}</em>
        : <button className={card.handling ? 'stock-signal-handle handled' : 'stock-signal-handle'} onClick={onHandle} type="button">{handled || '登记处理'}</button>)}
    </span>
  </div>
  </div>
}

function PointList({ title, points, side }: { title: string; points: StockStrategyPoint[]; side: 'buy' | 'sell' }) {
  const Icon = side === 'buy' ? ArrowDownToLine : ArrowUpFromLine
  return <section className={`strategy-point-group ${side}`}>
    <header><Icon size={13} /><strong>{title}</strong><span>{points.length || '无'}</span></header>
    {points.length ? <ul>{points.map((point, index) => <li key={`${point.label}-${index}`}><div><strong title={point.label}>{point.label}</strong>{point.price && <b title={point.price}>{point.price}</b>}</div><p title={point.condition}>{point.condition}</p></li>)}</ul> : <p className="strategy-point-empty">本次回答没有给出可执行条件</p>}
  </section>
}

export function StockStrategyDetails({ card, onClose }: { card: StockStrategyCardData; onClose: () => void }) {
  const levels = [
    card.support && ['支撑参考', card.support],
    card.resistance && ['压力参考', card.resistance],
    card.stopLoss && ['失效参考', card.stopLoss]
  ].filter((item): item is string[] => Boolean(item))

  return <section className="stock-strategy-details" aria-label={`${card.name}策略详情`}>
    <header className="stock-details-head">
      <span className="stock-card-identity"><span className="asset-badge">{typeLabel(card)}</span><span><strong title={card.name}>{card.name}</strong><small title={`${card.code}${card.exchange ? ` · ${card.exchange}` : ''}${sourceLabel(card) ? ` · ${sourceLabel(card)}` : ''}`}>{card.code}{card.exchange ? ` · ${card.exchange}` : ''}{sourceLabel(card) ? ` · ${sourceLabel(card)}` : ''}</small></span></span>
      <span className="stock-card-market">{card.currentPrice && <strong>{card.currentPrice}</strong>}{card.changePercent && <small className={card.changePercent.trim().startsWith('-') ? 'down' : 'up'}>{card.changePercent}</small>}</span>
      <span className="stock-details-status"><span className={`stock-card-signal ${signalClass(card)}`} title={signalDescription(card)}>{signalMeta(card).label}</span><span className={`stock-card-stance ${stanceTone(card.stance)}`}>{card.stance}</span></span>
      <button className="stock-details-close" aria-label={`收起${card.name}策略详情`} onClick={onClose} title="收起详情" type="button"><X size={14} /></button>
    </header>
    <StockStrategyMarket card={card} />
    <div className="stock-card-summary"><span>AI 策略摘要</span><p title={card.summary}>{card.summary}</p><div className="stock-card-meta">{card.actionPurpose && <span className="purpose" title={`本次动作目的：${card.actionPurpose}`}>要做什么 · {card.actionPurpose}</span>}<span>买点 {card.buyPoints.length}</span><span>卖点 {card.sellPoints.length}</span><span>判断把握 {card.confidence}</span>{executionLabel(card) && <span className={`execution ${immediateExpired(card) ? 'expired' : card.executionStatus}`}>{executionLabel(card)}</span>}{card.dataAsOf && <span title={`数据 ${card.dataAsOf}`}>数据 {card.dataAsOf}</span>}</div></div>
    {levels.length > 0 && <div className={`stock-levels count-${levels.length}`}>{levels.map(([label, value]) => <div key={label}><span>{label}</span><strong title={value}>{value}</strong></div>)}</div>}
    {card.strategy && <section className="stock-card-strategy"><span>当前方案</span><p title={card.strategy}>{card.strategy}</p></section>}
    <div className="strategy-point-grid"><PointList title="条件买点" points={card.buyPoints} side="buy" /><PointList title="止盈 / 卖点" points={card.sellPoints} side="sell" /></div>
    {(card.invalidation || card.risks.length > 0 || card.executionBlockers?.length) && <section className="stock-card-risk"><header><ShieldAlert size={13} /><strong>失效与风险</strong></header>{card.invalidation && <p title={card.invalidation}>{card.invalidation}</p>}{card.executionBlockers?.length ? <ul>{card.executionBlockers.map((blocker) => <li key={`execution-${blocker}`} title={blocker}>执行阻断：{blocker}</li>)}</ul> : null}{card.risks.length > 0 && <ul>{card.risks.map((risk) => <li key={risk} title={risk}>{risk}</li>)}</ul>}</section>}
    {card.evidence.length > 0 && <section className="stock-card-evidence"><span>判断依据</span><ul>{card.evidence.map((evidence) => <li key={evidence} title={evidence}>{evidence}</li>)}</ul></section>}
    <SignalHistoryPanel code={card.code} name={card.name} />
    {card.nextCheck && <footer title={`下次检查：${card.nextCheck}`}><Clock3 size={12} /><span>下次检查：{card.nextCheck}</span></footer>}
  </section>
}


function WatchTagCard({ card, expanded, onToggle }: { card: StockStrategyCardData; expanded: boolean; onToggle: () => void }) {
  const [hovered, setHovered] = useState(false)
  const description = signalDescription(card)
  return <div className={`stock-strategy-tag-wrap ${hovered ? 'hovered' : ''}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}>
    {hovered && <SignalLevelCard card={card} />}
    <button className={`stock-strategy-tag ${stanceTone(card.stance)} ${expanded ? 'active' : ''}`} aria-expanded={expanded} data-signal-description={description} onClick={onToggle} title={`${card.name}${card.accountScope ? ` · ${card.accountScope}` : ''} · ${card.stance}。${description} 点击${expanded ? '收起' : '查看'}详情`} type="button">
      <span className="stock-tag-type">{typeLabel(card)}</span><strong>{card.name}</strong><small>{card.code}</small>{sourceLabel(card) && <span className={`stock-card-source ${card.source}`}>{sourceLabel(card)}</span>}<span className={`stock-card-signal ${signalClass(card)}`}>{signalMeta(card).label}</span>{card.actionPurpose && card.actionPurpose !== '仅观察' && <span className="stock-tag-purpose">{card.actionPurpose}</span>}<ChevronDown size={12} />
    </button>
  </div>
}

export function StockStrategyTags({ cards, content = '', onHandleSignal }: { cards: StockStrategyCardData[]; content?: string; onHandleSignal?: (card: StockStrategyCardData) => void }) {
  const orderedCards = useMemo(() => [...cards].sort((left, right) => signalMeta(right).priority - signalMeta(left).priority), [cards])
  const [pushExpanded, setPushExpanded] = useState(true)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const expandedCard = orderedCards.find((card) => cardKey(card) === expandedKey)
  const accountGroups = useMemo(() => new Map<string, MessageEntityGroup>(buildMessagePresentation(content).groups.flatMap((group) => group.account
    ? [[`${group.account.member} → ${group.account.name}`, group] as const]
    : [])), [content])
  if (!cards.length) return null
  const groupedCards = Array.from(orderedCards.reduce((groups, card) => {
    const scope = card.accountScope || 'watchlist'
    const current = groups.get(scope) || []
    current.push(card)
    groups.set(scope, current)
    return groups
  }, new Map<string, StockStrategyCardData[]>()))
  const accountCount = groupedCards.filter(([scope]) => scope !== 'watchlist').length
  const signalSummary = [
    ['immediate_buy', '立即买入'], ['immediate_sell', '立即卖出'], ['strong_buy', '推荐买入'], ['strong_sell', '推荐卖出'], ['prepare_buy', '准备买入'], ['prepare_sell', '准备卖出']
  ].flatMap(([signal, label]) => {
    const count = orderedCards.filter((card) => effectiveSignal(card) === signal).length
    return count ? [`${label} ${count}`] : []
  })
  const watchCount = orderedCards.filter((card) => signalMeta(card).strength === 'watch').length
  if (watchCount) signalSummary.push(`关注 ${watchCount}`)
  const pushMeta = [accountCount ? `${accountCount} 个账户` : '', `${orderedCards.length} 个标的`, ...signalSummary].filter(Boolean).join(' · ')

  return <details className="stock-strategy-disclosure" open={pushExpanded} onToggle={(event) => setPushExpanded(event.currentTarget.open)}>
    <summary><span><strong>本次策略推送</strong><small title={pushMeta}>{pushMeta}</small></span><ChevronDown size={13} /></summary>
    <div className="stock-strategy-tags" aria-label="本次回答涉及的标的">
    {groupedCards.map(([scope, groupCards]) => {
      const account = accountFor(scope === 'watchlist' ? undefined : scope)
      const actionCards = groupCards.filter((card) => signalMeta(card).strength !== 'watch')
      const normalCards = groupCards.filter((card) => signalMeta(card).strength === 'watch')
      return <section className={`stock-strategy-group ${account ? 'account' : 'watchlist'}`} key={scope}>
        <header>{account
          ? <><Landmark size={13} /><strong title={account.member}>{account.member}</strong>{account.name && <small title={account.name}>{account.name}</small>}<em>独立账户</em></>
          : <><strong>关注标的</strong><small>按单个标的聚合</small></>}
          <span>{groupCards.length} 个标的</span>
        </header>
        <div className="stock-strategy-group-body">
          {account && <AccountOverview group={accountGroups.get(scope)} />}
          {actionCards.length > 0 && <div className="stock-signal-highlights" aria-label="买卖信号等级">
            {actionCards.map((card) => <ActionSignalCard card={card} key={`signal-${cardKey(card)}`} onHandle={onHandleSignal ? () => onHandleSignal(card) : undefined} onOpen={() => setExpandedKey(cardKey(card))} />)}
          </div>}
          {normalCards.length > 0 && <div className="stock-tag-list">
            {normalCards.map((card) => {
              const key = cardKey(card)
              return <WatchTagCard card={card} key={key} expanded={key === expandedKey} onToggle={() => setExpandedKey(key === expandedKey ? null : key)} />
            })}
          </div>}
          {expandedCard && groupCards.some((card) => cardKey(card) === expandedKey) && <StockStrategyDetails card={expandedCard} onClose={() => setExpandedKey(null)} />}
        </div>
      </section>
    })}
    </div>
  </details>
}
