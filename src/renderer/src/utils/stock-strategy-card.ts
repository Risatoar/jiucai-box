import { normalizeStockStrategyCard } from '../../../shared/stock-strategy-card-normalizer'
import type { Instrument, StockStrategyCardData } from '../../../shared/types'

const COMPLETE_BLOCK = /<stock_strategy_cards>\s*([\s\S]*?)\s*<\/stock_strategy_cards>/gi
const FORWARD_LOOKING = /下一步|下一交易日|触发|失效|策略|止损|止盈|买入|卖出|减仓|加仓|等待|关注|观望|介入|放弃|不再|重新评估/
const SECURITY_ACTION = /买入|买回|卖出|清仓|持仓|开仓|减仓|加仓|做T|止损|止盈|退出|追高|介入|放弃|重新评估/
const ENTITY_PATTERN = /([A-Za-z\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5·*]{1,23})\s*[（(](\d{6})(?:\s*[·.\-]\s*(SH|SZ))?[）)]/gi

const inferInstrumentType = (name: string): StockStrategyCardData['instrumentType'] => {
  if (/转债/.test(name)) return 'cbond'
  if (/ETF/i.test(name)) return 'etf'
  return 'stock'
}

const inferExchange = (code: string, exchange?: string) => {
  if (exchange) return exchange.toUpperCase()
  return /^(5|6|9|11)/.test(code) ? 'SH' : 'SZ'
}

const uniqueLines = (lines: string[]) => [...new Set(lines.map((line) => line.replace(/^[-*]\s*/, '').trim()).filter(Boolean))]

const valueAfterLabel = (lines: string[], label: RegExp) => {
  const line = lines.find((item) => label.test(item))
  return line ? line.replace(label, '').replace(/^[:：\s-]+/, '').trim() : undefined
}

export const deriveStockStrategyCards = (content: string, instruments: Instrument[] = [], maxCards = 3): StockStrategyCardData[] => {
  if (!FORWARD_LOOKING.test(content)) return []
  const lines = content.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const entities = new Map<string, { code: string; name: string; exchange?: string; lines: string[] }>()
  for (const line of lines) {
    ENTITY_PATTERN.lastIndex = 0
    for (const match of line.matchAll(ENTITY_PATTERN)) {
      const existing = entities.get(match[2])
      if (existing) existing.lines.push(line)
      else entities.set(match[2], { name: match[1], code: match[2], exchange: match[3], lines: [line] })
    }
  }
  for (const instrument of instruments) {
    if (!/^\d{6}$/.test(instrument.code) || !instrument.name || !content.includes(instrument.name) || entities.has(instrument.code)) continue
    entities.set(instrument.code, {
      code: instrument.code,
      name: instrument.name,
      exchange: instrument.exchange,
      lines: lines.filter((line) => line.includes(instrument.name) || line.includes(instrument.code))
    })
  }
  if (!entities.size) return []

  const primaryCode = [...entities.values()]
    .sort((a, b) => content.split(b.name).length - content.split(a.name).length)[0]?.code
  const invalidation = valueAfterLabel(lines, /^[-*]?\s*失效(?:条件)?\s*[:：]/)
  const nextCheck = valueAfterLabel(lines, /^[-*]?\s*下一检查点\s*[:：]/)
  const costRisk = valueAfterLabel(lines, /^[-*]?\s*成本状态\s*[:：]/)

  return [...entities.values()].flatMap((entity) => {
    const entityLines = uniqueLines(lines.filter((line) => line.includes(entity.name) || line.includes(entity.code)))
    const actionLines = entityLines.filter((line) => SECURITY_ACTION.test(line))
    const isPrimaryPlan = entity.code === primaryCode && Boolean(invalidation || nextCheck)
    if (!actionLines.length && !isPrimaryPlan) return []
    const summary = actionLines[0] || entityLines[0]
    const strategy = actionLines.find((line) => /下一步|不再|等待|关注|观望|放弃|重新评估/.test(line))
    const paused = entityLines.some((line) => /持仓\s*0|0\s*[股份张]|已经结束|清仓|不再|放弃/.test(line))
    const holding = entityLines.some((line) => /当前持仓|继续持有|持仓管理/.test(line)) && !paused
    return [{
      code: entity.code,
      name: entity.name,
      exchange: inferExchange(entity.code, entity.exchange),
      instrumentType: inferInstrumentType(entity.name),
      signal: 'watch',
      stance: paused ? '暂不介入' : holding ? '持仓管理' : '等待确认',
      summary,
      strategy,
      buyPoints: [],
      sellPoints: [],
      invalidation: entity.code === primaryCode ? invalidation : undefined,
      risks: entity.code === primaryCode && costRisk ? [costRisk] : [],
      evidence: actionLines.slice(0, 2),
      nextCheck: entity.code === primaryCode ? nextCheck : undefined,
      confidence: '低'
    } satisfies StockStrategyCardData]
  }).slice(0, maxCards)
}

export const stripStockStrategyPayload = (content: string) => content
  .replace(COMPLETE_BLOCK, '')
  .replace(/\n?<stock_strategy_cards>[\s\S]*$/i, '')
  .replace(/\n?<stock_strategy_[a-z_]*$/i, '')
  .trimEnd()

export const parseStockStrategyCards = (content: string, instruments: Instrument[] = [], maxCards = 3) => {
  const cards: StockStrategyCardData[] = []
  for (const match of content.matchAll(COMPLETE_BLOCK)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown
      const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { cards?: unknown }).cards) ? (parsed as { cards: unknown[] }).cards : []
      for (const value of values) {
        const card = normalizeStockStrategyCard(value)
        if (card && !cards.some((item) => item.code === card.code && item.accountScope === card.accountScope)) cards.push(card)
        if (cards.length === maxCards) break
      }
    } catch { /* hide malformed machine payloads without inventing a card */ }
    if (cards.length === maxCards) break
  }
  return { content: stripStockStrategyPayload(content), cards: cards.length ? cards.slice(0, maxCards) : deriveStockStrategyCards(content, instruments, maxCards) }
}
