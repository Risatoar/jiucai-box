import { useEffect, useState } from 'react'
import type { MarketSignal } from '../../../shared/types'
import { parseMarketSignals } from '../utils/market-signals'

export function useMarketSignals(codes: string[]) {
  const [signals, setSignals] = useState<MarketSignal[]>([])
  const codesKey = [...codes].sort().join(',')
  useEffect(() => {
    if (!window.desktopApi || !codesKey) { setSignals([]); return }
    let active = true
    const refresh = async () => {
      const result = await window.desktopApi!.runTradeMaster('plan', ['today'])
      if (!active || !result.ok) return
      const next = parseMarketSignals(result.output).filter((signal) => codesKey.split(',').includes(signal.code))
      setSignals(next)
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [codesKey])
  return signals
}
