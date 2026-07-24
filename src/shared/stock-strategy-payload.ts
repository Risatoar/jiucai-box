import type { StockStrategyCardData } from './types'
import { normalizeStockStrategyCard } from './stock-strategy-card-normalizer'
import { enforceUnifiedAutomationCard } from './stock-strategy-automation-policy'

const COMPLETE_BLOCK = /<stock_strategy_cards>\s*([\s\S]*?)\s*<\/stock_strategy_cards>/gi

export const stripStockStrategyPayload = (content: string) => content
  .replace(COMPLETE_BLOCK, '')
  .replace(/\n?<stock_strategy_cards>[\s\S]*$/i, '')
  .replace(/\n?<stock_strategy_[a-z_]*$/i, '')
  .trimEnd()

export const parseStockStrategyPayload = (content: string, maxCards = 3, enforceUnifiedModel = false): StockStrategyCardData[] => {
  const cards: StockStrategyCardData[] = []
  for (const match of content.matchAll(COMPLETE_BLOCK)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown
      const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { cards?: unknown }).cards) ? (parsed as { cards: unknown[] }).cards : []
      for (const value of values) {
        const normalized = normalizeStockStrategyCard(value)
        const card = normalized && enforceUnifiedModel ? enforceUnifiedAutomationCard(normalized) : normalized
        if (card && !cards.some((item) => item.code === card.code && item.accountScope === card.accountScope)) cards.push(card)
        if (cards.length === maxCards) return cards
      }
    } catch { /* malformed machine payload remains hidden */ }
  }
  return cards
}
