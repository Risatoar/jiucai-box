import type { StockStrategyCardData, StockStrategyPoint, StockStrategyStance } from './types'

const COMPLETE_BLOCK = /<stock_strategy_cards>\s*([\s\S]*?)\s*<\/stock_strategy_cards>/gi
const stances: StockStrategyStance[] = ['持仓管理', '可关注', '等待确认', '暂不介入']
const confidences: StockStrategyCardData['confidence'][] = ['低', '中', '高']
const instrumentTypes: StockStrategyCardData['instrumentType'][] = ['stock', 'etf', 'cbond']
const signals: NonNullable<StockStrategyCardData['signal']>[] = ['strong_buy', 'strong_sell', 'none']

const cleanText = (value: unknown, max = 160) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : undefined
}

const cleanList = (value: unknown, maxItems = 4) => Array.isArray(value)
  ? value.map((item) => cleanText(item, 120)).filter((item): item is string => Boolean(item)).slice(0, maxItems)
  : []

const cleanPoints = (value: unknown): StockStrategyPoint[] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const point = item as Record<string, unknown>
    const label = cleanText(point.label, 30)
    const condition = cleanText(point.condition, 140)
    if (!label || !condition) return []
    return [{ label, condition, price: cleanText(point.price, 30) }]
  }).slice(0, 4)
  : []

const cleanCard = (value: unknown): StockStrategyCardData | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const code = cleanText(raw.code, 12)
  const name = cleanText(raw.name, 36)
  const summary = cleanText(raw.summary, 220)
  if (!code || !/^\d{6}$/.test(code) || !name || !summary) return null
  return {
    code, name,
    exchange: cleanText(raw.exchange, 8),
    instrumentType: instrumentTypes.includes(raw.instrumentType as StockStrategyCardData['instrumentType']) ? raw.instrumentType as StockStrategyCardData['instrumentType'] : undefined,
    accountScope: cleanText(raw.accountScope, 80),
    currentPrice: cleanText(raw.currentPrice, 30),
    changePercent: cleanText(raw.changePercent, 20),
    signal: signals.includes(raw.signal as NonNullable<StockStrategyCardData['signal']>) ? raw.signal as NonNullable<StockStrategyCardData['signal']> : 'none',
    stance: stances.includes(raw.stance as StockStrategyStance) ? raw.stance as StockStrategyStance : '等待确认',
    summary,
    strategy: cleanText(raw.strategy, 260),
    buyPoints: cleanPoints(raw.buyPoints),
    sellPoints: cleanPoints(raw.sellPoints),
    support: cleanText(raw.support, 30),
    resistance: cleanText(raw.resistance, 30),
    stopLoss: cleanText(raw.stopLoss, 30),
    invalidation: cleanText(raw.invalidation, 180),
    risks: cleanList(raw.risks),
    evidence: cleanList(raw.evidence),
    nextCheck: cleanText(raw.nextCheck, 120),
    confidence: confidences.includes(raw.confidence as StockStrategyCardData['confidence']) ? raw.confidence as StockStrategyCardData['confidence'] : '低',
    dataAsOf: cleanText(raw.dataAsOf, 40)
  }
}

export const stripStockStrategyPayload = (content: string) => content
  .replace(COMPLETE_BLOCK, '')
  .replace(/\n?<stock_strategy_cards>[\s\S]*$/i, '')
  .replace(/\n?<stock_strategy_[a-z_]*$/i, '')
  .trimEnd()

export const parseStockStrategyPayload = (content: string, maxCards = 3): StockStrategyCardData[] => {
  const cards: StockStrategyCardData[] = []
  for (const match of content.matchAll(COMPLETE_BLOCK)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown
      const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { cards?: unknown }).cards) ? (parsed as { cards: unknown[] }).cards : []
      for (const value of values) {
        const card = cleanCard(value)
        if (card && !cards.some((item) => item.code === card.code && item.accountScope === card.accountScope)) cards.push(card)
        if (cards.length === maxCards) return cards
      }
    } catch { /* malformed machine payload remains hidden */ }
  }
  return cards
}
