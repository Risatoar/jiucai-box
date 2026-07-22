import { describe, expect, it } from 'vitest'
import { shouldLoadMarketBars } from './market-data'

describe('market data loading', () => {
  it('keeps the right-side market tool live outside the watchlist page', () => {
    expect(shouldLoadMarketBars(true, '159516', 'chat')).toBe(true)
    expect(shouldLoadMarketBars(true, '159516', 'portfolio')).toBe(true)
    expect(shouldLoadMarketBars(true, '159516', 'watchlist')).toBe(true)
  })

  it('does not load without a desktop bridge, selected instrument, or visible context panel', () => {
    expect(shouldLoadMarketBars(false, '159516', 'chat')).toBe(false)
    expect(shouldLoadMarketBars(true, undefined, 'chat')).toBe(false)
    expect(shouldLoadMarketBars(true, '159516', 'settings')).toBe(false)
  })
})
