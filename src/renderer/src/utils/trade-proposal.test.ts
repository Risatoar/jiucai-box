import { describe, expect, it } from 'vitest'
import { parseConfirmedTrade } from './trade-proposal'

describe('parseConfirmedTrade', () => {
  it('only extracts an explicit completed trade', () => {
    expect(parseConfirmedTrade('我刚刚已买入 510300 1000份，成交价 3.82')).toMatchObject({ code: '510300', side: 'buy', quantity: 1000, price: 3.82 })
    expect(parseConfirmedTrade('建议买入 510300 1000份，价格 3.82')).toBeNull()
  })
})
