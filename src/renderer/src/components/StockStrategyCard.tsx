import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, Clock3, Landmark, ShieldAlert, TrendingDown, TrendingUp, X } from 'lucide-react'
import { useState } from 'react'
import type { StockStrategyCardData, StockStrategyPoint } from '../../../shared/types'
import { buildMessagePresentation, type MessageEntityGroup } from '../utils/message-presentation'
import { StockStrategyMarket } from './StockStrategyMarket'

const typeLabel = (card: StockStrategyCardData) => card.instrumentType === 'cbond' ? '债' : card.instrumentType === 'stock' ? '股' : 'E'
const stanceTone = (stance: StockStrategyCardData['stance']) => stance === '可关注' ? 'ready' : stance === '暂不介入' ? 'stop' : stance === '持仓管理' ? 'manage' : 'wait'
const signalTone = (card: StockStrategyCardData) => card.signal === 'strong_buy' ? 'buy' : card.signal === 'strong_sell' ? 'sell' : null
const cardKey = (card: StockStrategyCardData) => `${card.code}-${card.accountScope || 'watchlist'}`
const sourceLabel = (card: StockStrategyCardData) => card.source === 'holding' ? '持仓' : card.source === 'user' ? '我的收藏' : card.source === 'agent' ? 'AI发现' : ''
const accountFor = (scope?: string) => {
  if (!scope) return undefined
  const [member, name] = scope.split(/\s*(?:→|->)\s*/).map((item) => item.trim())
  return { member: member || scope, name: name || '' }
}

function AccountOverview({ group }: { group?: MessageEntityGroup }) {
  if (!group?.sections.length) return null
  return <div className="stock-account-overview">
    {group.sections.map((section) => <section key={section.id}>
      <strong>{section.title}</strong>
      <div>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.items.length > 0 && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}</div>
    </section>)}
  </div>
}

function StrongSignalCard({ card, onOpen }: { card: StockStrategyCardData; onOpen: () => void }) {
  const tone = signalTone(card)
  if (!tone) return null
  const buy = tone === 'buy'
  const Icon = buy ? TrendingUp : TrendingDown
  const point = (buy ? card.buyPoints : card.sellPoints)[0]
  return <button className={`stock-signal-highlight ${tone}`} onClick={onOpen} type="button" aria-label={`重点${buy ? '买入' : '卖出'}信号：${card.name}，点击查看详情`}>
    <span className="stock-signal-icon"><Icon size={17} /></span>
    <span className="stock-signal-main">
      <span className="stock-signal-title"><em>重点{buy ? '买入' : '卖出'}信号</em><strong>{card.name}</strong><small>{card.code}{sourceLabel(card) ? ` · ${sourceLabel(card)}` : ''}</small></span>
      <span className="stock-signal-summary">{card.summary}</span>
      {point && <span className="stock-signal-condition"><b>{point.label}{point.price ? ` · ${point.price}` : ''}</b>{point.condition}</span>}
    </span>
    <span className="stock-signal-side">
      {card.currentPrice && <strong>{card.currentPrice}</strong>}
      {card.changePercent && <small>{card.changePercent}</small>}
      <span>查看详情 <ChevronDown size={12} /></span>
    </span>
  </button>
}

function PointList({ title, points, side }: { title: string; points: StockStrategyPoint[]; side: 'buy' | 'sell' }) {
  const Icon = side === 'buy' ? ArrowDownToLine : ArrowUpFromLine
  return <section className={`strategy-point-group ${side}`}>
    <header><Icon size={13} /><strong>{title}</strong><span>{points.length || '无'}</span></header>
    {points.length ? <ul>{points.map((point, index) => <li key={`${point.label}-${index}`}><div><strong>{point.label}</strong>{point.price && <b>{point.price}</b>}</div><p>{point.condition}</p></li>)}</ul> : <p className="strategy-point-empty">本次回答没有给出可执行条件</p>}
  </section>
}

function StockStrategyDetails({ card, onClose }: { card: StockStrategyCardData; onClose: () => void }) {
  const levels = [
    card.support && ['支撑参考', card.support],
    card.resistance && ['压力参考', card.resistance],
    card.stopLoss && ['失效参考', card.stopLoss]
  ].filter((item): item is string[] => Boolean(item))

  return <section className="stock-strategy-details" aria-label={`${card.name}策略详情`}>
    <header className="stock-details-head">
      <span className="stock-card-identity"><span className="asset-badge">{typeLabel(card)}</span><span><strong>{card.name}</strong><small>{card.code}{card.exchange ? ` · ${card.exchange}` : ''}{sourceLabel(card) ? ` · ${sourceLabel(card)}` : ''}</small></span></span>
      <span className="stock-card-market">{card.currentPrice && <strong>{card.currentPrice}</strong>}{card.changePercent && <small className={card.changePercent.trim().startsWith('-') ? 'down' : 'up'}>{card.changePercent}</small>}</span>
      <span className={`stock-card-stance ${stanceTone(card.stance)}`}>{card.stance}</span>
      <button className="stock-details-close" aria-label={`收起${card.name}策略详情`} onClick={onClose} title="收起详情" type="button"><X size={14} /></button>
    </header>
    <StockStrategyMarket card={card} />
    <div className="stock-card-summary"><span>AI 策略摘要</span><p>{card.summary}</p><div className="stock-card-meta"><span>买点 {card.buyPoints.length}</span><span>卖点 {card.sellPoints.length}</span><span>判断把握 {card.confidence}</span>{card.dataAsOf && <span>数据 {card.dataAsOf}</span>}</div></div>
    {levels.length > 0 && <div className="stock-levels">{levels.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>}
    {card.strategy && <section className="stock-card-strategy"><span>当前方案</span><p>{card.strategy}</p></section>}
    <div className="strategy-point-grid"><PointList title="条件买点" points={card.buyPoints} side="buy" /><PointList title="止盈 / 卖点" points={card.sellPoints} side="sell" /></div>
    {(card.invalidation || card.risks.length > 0) && <section className="stock-card-risk"><header><ShieldAlert size={13} /><strong>失效与风险</strong></header>{card.invalidation && <p>{card.invalidation}</p>}{card.risks.length > 0 && <ul>{card.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>}</section>}
    {card.evidence.length > 0 && <section className="stock-card-evidence"><span>判断依据</span><ul>{card.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul></section>}
    {card.nextCheck && <footer><Clock3 size={12} /><span>下次检查：{card.nextCheck}</span></footer>}
  </section>
}

export function StockStrategyTags({ cards, content = '' }: { cards: StockStrategyCardData[]; content?: string }) {
  const orderedCards = [...cards].sort((left, right) => Number(Boolean(signalTone(right))) - Number(Boolean(signalTone(left))))
  const defaultCard = orderedCards.find((card) => signalTone(card)) || (orderedCards.length === 1 ? orderedCards[0] : undefined)
  const [expandedKey, setExpandedKey] = useState<string | null>(defaultCard ? cardKey(defaultCard) : null)
  const expandedCard = orderedCards.find((card) => cardKey(card) === expandedKey)
  if (!cards.length) return null
  const groupedCards = Array.from(orderedCards.reduce((groups, card) => {
    const scope = card.accountScope || 'watchlist'
    const current = groups.get(scope) || []
    current.push(card)
    groups.set(scope, current)
    return groups
  }, new Map<string, StockStrategyCardData[]>()))
  const accountGroups = new Map<string, MessageEntityGroup>(buildMessagePresentation(content).groups.flatMap((group) => group.account
    ? [[`${group.account.member} → ${group.account.name}`, group] as const]
    : []))

  return <div className="stock-strategy-tags" aria-label="本次回答涉及的标的">
    {groupedCards.map(([scope, groupCards]) => {
      const account = accountFor(scope === 'watchlist' ? undefined : scope)
      const strongCards = groupCards.filter((card) => signalTone(card))
      const normalCards = groupCards.filter((card) => !signalTone(card))
      return <section className={`stock-strategy-group ${account ? 'account' : 'watchlist'}`} key={scope}>
        <header>{account
          ? <><Landmark size={13} /><strong>{account.member}</strong>{account.name && <small>{account.name}</small>}<em>独立账户</em></>
          : <><strong>关注标的</strong><small>按单个标的聚合</small></>}
          <span>{groupCards.length} 个标的</span>
        </header>
        <div className="stock-strategy-group-body">
          {account && <AccountOverview group={accountGroups.get(scope)} />}
          {strongCards.length > 0 && <div className="stock-signal-highlights" aria-label="明确买卖信号">
            {strongCards.map((card) => <StrongSignalCard card={card} key={`signal-${cardKey(card)}`} onOpen={() => setExpandedKey(cardKey(card))} />)}
          </div>}
          {normalCards.length > 0 && <div className="stock-tag-list">
            {normalCards.map((card) => {
              const key = cardKey(card)
              const expanded = key === expandedKey
              return <button className={`stock-strategy-tag ${stanceTone(card.stance)} ${expanded ? 'active' : ''}`} aria-expanded={expanded} key={key} onClick={() => setExpandedKey(expanded ? null : key)} title={`${card.name}${card.accountScope ? ` · ${card.accountScope}` : ''} · ${card.stance}，点击${expanded ? '收起' : '查看'}详情`} type="button">
                <span className="stock-tag-type">{typeLabel(card)}</span><strong>{card.name}</strong><small>{card.code}</small>{sourceLabel(card) && <span className={`stock-card-source ${card.source}`}>{sourceLabel(card)}</span>}<span className="stock-tag-stance">{card.stance}</span><ChevronDown size={12} />
              </button>
            })}
          </div>}
          {expandedCard && groupCards.some((card) => cardKey(card) === expandedKey) && <StockStrategyDetails card={expandedCard} onClose={() => setExpandedKey(null)} />}
        </div>
      </section>
    })}
  </div>
}
