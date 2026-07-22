import type { MarketBar, StockStrategyCardData } from '../../../shared/types'

export interface StockLiveQuote {
  price: number
  open: number | null
  high: number | null
  low: number | null
  previousClose: number | null
  changePercent: number | null
  volume: number | null
  amount: number | null
  exchangeTime: string | null
  source: string
}

const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

export const parseStockLiveQuote = (output: string): StockLiveQuote | null => {
  try {
    const payload = JSON.parse(output) as { quotes?: Array<Record<string, unknown>> }
    const quote = payload.quotes?.find((item) => numberOrNull(item.price) != null)
    const price = quote ? numberOrNull(quote.price) : null
    if (!quote || price == null) return null
    const changeRatio = numberOrNull(quote.changeRatio)
    return {
      price,
      open: numberOrNull(quote.open),
      high: numberOrNull(quote.high),
      low: numberOrNull(quote.low),
      previousClose: numberOrNull(quote.previousClose),
      changePercent: changeRatio == null ? null : changeRatio * 100,
      volume: numberOrNull(quote.volume),
      amount: numberOrNull(quote.amount),
      exchangeTime: typeof quote.exchangeTime === 'string' ? quote.exchangeTime : null,
      source: typeof quote.source === 'string' ? quote.source : '实时行情'
    }
  } catch { return null }
}

export const parseStockBars = (output: string): MarketBar[] => {
  try {
    const payload = JSON.parse(output) as { bars?: MarketBar[] }
    return (payload.bars || [])
      .filter((bar) => typeof bar.time === 'string' && [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite))
      .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
  } catch { return [] }
}

export const cardFallbackPrice = (card: StockStrategyCardData): number | null => {
  const value = Number(card.currentPrice)
  return Number.isFinite(value) && value > 0 ? value : null
}
