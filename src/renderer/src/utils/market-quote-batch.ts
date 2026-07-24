interface QuotePayload {
  instrument?: { code?: string }
  price?: number
  changeRatio?: number | null
  amount?: number | null
  exchangeTime?: string | null
}

export interface MarketQuoteUpdate {
  price: number
  change: number
  amount: string
  time: string
}

type TradeMasterRunner = (command: string, args?: string[]) => Promise<{ ok: boolean; output: string; error?: string }>

export const parseMarketQuoteBatch = (output: string, fallbackTime = new Date()): Map<string, MarketQuoteUpdate> => {
  const payload = JSON.parse(output) as { quotes?: QuotePayload[] }
  const updates = new Map<string, MarketQuoteUpdate>()
  for (const quote of payload.quotes || []) {
    const code = quote.instrument?.code
    if (!code || !Number.isFinite(quote.price)) continue
    const amount = quote.amount == null
      ? '--'
      : quote.amount >= 100_000_000 ? `${(quote.amount / 100_000_000).toFixed(2)}亿` : `${(quote.amount / 10_000).toFixed(0)}万`
    updates.set(code, {
      price: quote.price!,
      change: (quote.changeRatio || 0) * 100,
      amount,
      time: quote.exchangeTime
        ? new Date(quote.exchangeTime).toLocaleTimeString('zh-CN', { hour12: false })
        : fallbackTime.toLocaleTimeString('zh-CN', { hour12: false })
    })
  }
  return updates
}

export const loadMarketQuoteUpdates = async (
  runTradeMaster: TradeMasterRunner,
  codes: string[]
): Promise<Map<string, MarketQuoteUpdate>> => {
  const uniqueCodes = [...new Set(codes.filter(Boolean))]
  if (!uniqueCodes.length) return new Map()
  const batch = await runTradeMaster('market', ['quotes', '--codes', uniqueCodes.join(','), '--concurrency', '6'])
  if (batch.ok) {
    try { return parseMarketQuoteBatch(batch.output) }
    catch { /* fall through for older or malformed runtimes */ }
  }
  const updates = new Map<string, MarketQuoteUpdate>()
  let cursor = 0
  const worker = async () => {
    while (cursor < uniqueCodes.length) {
      const code = uniqueCodes[cursor++]
      const result = await runTradeMaster('market', ['quote', '--code', code])
      if (!result.ok) continue
      try {
        for (const [quoteCode, quote] of parseMarketQuoteBatch(result.output)) updates.set(quoteCode, quote)
      } catch { /* retain the last verified quote */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, uniqueCodes.length) }, worker))
  return updates
}
