import type { TradeRecordInput } from '../../../shared/types'

export const parseConfirmedTrade = (content: string): TradeRecordInput | null => {
  if (!/(已|刚刚|刚才|成交|确认)/.test(content)) return null
  const sideMatch = content.match(/(买入|卖出)/)
  const codeMatch = content.match(/\b(\d{6})\b/)
  const quantityMatch = content.match(/(\d+)\s*(股|份|张)/)
  const priceMatch = content.match(/(?:成交价|价格|均价|以|@)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/i)
  if (!sideMatch || !codeMatch || !quantityMatch || !priceMatch) return null
  return { code: codeMatch[1], side: sideMatch[1] === '买入' ? 'buy' : 'sell', quantity: Number(quantityMatch[1]), price: Number(priceMatch[1]), note: '由对话识别，用户再次确认后写入' }
}
