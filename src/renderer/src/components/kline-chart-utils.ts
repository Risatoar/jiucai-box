import type { MarketBar } from '../../../shared/types'

export const movingAverage = (bars: MarketBar[], period: number): Array<number | null> => bars.map((_, index) => {
  if (index < period - 1) return null
  const window = bars.slice(index - period + 1, index + 1)
  return window.reduce((sum, bar) => sum + bar.close, 0) / period
})

export const exponentialMovingAverage = (values: number[], period: number) => {
  const factor = 2 / (period + 1)
  return values.reduce<number[]>((result, value, index) => {
    result.push(index === 0 ? value : value * factor + result[index - 1] * (1 - factor))
    return result
  }, [])
}

export const bollingerBands = (bars: MarketBar[], period = 20, multiplier = 2) => bars.map((_, index) => {
  if (index < period - 1) return { middle: null, upper: null, lower: null }
  const closes = bars.slice(index - period + 1, index + 1).map((bar) => bar.close)
  const middle = closes.reduce((sum, value) => sum + value, 0) / period
  const deviation = Math.sqrt(closes.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period)
  return { middle, upper: middle + multiplier * deviation, lower: middle - multiplier * deviation }
})

export const calculateMacd = (bars: MarketBar[]) => {
  const closes = bars.map((bar) => bar.close)
  const fast = exponentialMovingAverage(closes, 12)
  const slow = exponentialMovingAverage(closes, 26)
  const dif = closes.map((_, index) => fast[index] - slow[index])
  const dea = exponentialMovingAverage(dif, 9)
  return dif.map((value, index) => ({ dif: value, dea: dea[index], histogram: (value - dea[index]) * 2 }))
}

export const calculateKdj = (bars: MarketBar[], period = 9) => {
  let k = 50
  let d = 50
  return bars.map((bar, index) => {
    const window = bars.slice(Math.max(0, index - period + 1), index + 1)
    const low = Math.min(...window.map((item) => item.low))
    const high = Math.max(...window.map((item) => item.high))
    const rsv = high === low ? 50 : (bar.close - low) / (high - low) * 100
    k = k * 2 / 3 + rsv / 3
    d = d * 2 / 3 + k / 3
    return { k, d, j: k * 3 - d * 2 }
  })
}

export const calculateRsi = (bars: MarketBar[], period = 14): Array<number | null> => bars.map((_, index) => {
  if (index < period) return null
  const changes = bars.slice(index - period, index + 1).slice(1).map((bar, offset) => bar.close - bars[index - period + offset].close)
  const gains = changes.reduce((sum, value) => sum + Math.max(0, value), 0) / period
  const losses = changes.reduce((sum, value) => sum + Math.max(0, -value), 0) / period
  return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses)
})

export const cumulativeAveragePrice = (bars: MarketBar[]) => {
  let amount = 0
  let volume = 0
  return bars.map((bar) => {
    amount += (bar.high + bar.low + bar.close) / 3 * bar.volume
    volume += bar.volume
    return volume > 0 ? amount / volume : bar.close
  })
}

export const aggregate120MinuteBars = (bars: MarketBar[]) => {
  const result: MarketBar[] = []
  let group: MarketBar[] = []
  const flush = () => {
    if (!group.length) return
    const amounts = group.map((bar) => bar.amount).filter((value): value is number => value != null)
    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group.at(-1)!.close,
      volume: group.reduce((sum, bar) => sum + bar.volume, 0),
      amount: amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null,
      closed: group.every((bar) => bar.closed !== false)
    })
    group = []
  }
  for (const bar of bars) {
    if (group.length && (bar.time.slice(0, 10) !== group[0].time.slice(0, 10) || group.length === 2)) flush()
    group.push(bar)
  }
  flush()
  return result
}

export const clampVisibleCount = (count: number, total: number) => {
  if (total <= 0) return 0
  const minimum = Math.min(24, total)
  return Math.min(total, Math.max(minimum, count))
}

export const nearestBarIndex = (pointerX: number, plotLeft: number, plotRight: number, count: number) => {
  if (count <= 1 || plotRight <= plotLeft) return 0
  const ratio = Math.max(0, Math.min(1, (pointerX - plotLeft) / (plotRight - plotLeft)))
  return Math.round(ratio * (count - 1))
}

export const formatBarTime = (value: string, daily: boolean) => {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return value.slice(daily ? 5 : 11, daily ? 10 : 16)
  return daily
    ? `${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
    : `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
}

export const formatVolume = (value: number) => value >= 100_000_000
  ? `${(value / 100_000_000).toFixed(1)}亿`
  : value >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : Math.round(value).toLocaleString('zh-CN')
