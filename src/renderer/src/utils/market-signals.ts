import type { ChartPeriod, MarketBar, MarketSignal } from '../../../shared/types'

const periods: ChartPeriod[] = ['timeline', '1m', '5m', '15m', '30m', '60m', '120m', 'five_day', '1d', '1w', '1M']
const levels: MarketSignal['level'][] = ['watch', 'confirm', 'actionable']
const kStates: MarketSignal['kState'][] = ['forming', 'closed']
const strategyNames: Record<string, string> = {
  stage_support_rebound: '阶段支撑反弹', macd_weakening: 'MACD 动能转弱', support_break: '支撑破位',
  support_break_retest: '破位反抽失败', td_sequential_9: '九转序列', breakout: '突破确认'
}

const cleanText = (value: unknown, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const marketTimestamp = (value: string) => {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(' ', 'T')}+08:00` : value
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : Number.NaN
}

export const parseMarketSignals = (content: string): MarketSignal[] => {
  let raw: { instruments?: unknown[] }
  try { raw = JSON.parse(content) as { instruments?: unknown[] } }
  catch { return [] }
  if (!Array.isArray(raw.instruments)) return []
  return raw.instruments.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const instrumentEntry = entry as { instrument?: { code?: unknown }; latest_signals?: unknown[] }
    const code = cleanText(instrumentEntry.instrument?.code, 12)
    if (!/^\d{6}$/.test(code) || !Array.isArray(instrumentEntry.latest_signals)) return []
    return instrumentEntry.latest_signals.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const signal = value as Record<string, unknown>
      const id = cleanText(signal.id, 100)
      const strategy = cleanText(signal.strategy, 60)
      const side = signal.side === 'buy' || signal.side === 'sell' ? signal.side : null
      const level = levels.includes(signal.level as MarketSignal['level']) ? signal.level as MarketSignal['level'] : null
      const period = periods.includes(signal.period as ChartPeriod) ? signal.period as ChartPeriod : null
      const kState = kStates.includes(signal.kState as MarketSignal['kState']) ? signal.kState as MarketSignal['kState'] : null
      const time = cleanText(signal.time, 40)
      const price = Number(signal.price)
      if (!id || !strategy || !side || !level || !period || !kState || !time || !Number.isFinite(marketTimestamp(time)) || !Number.isFinite(price)) return []
      return [{
        id, code, strategy, side, level, period, kState, time, price,
        confidence: Number.isFinite(Number(signal.confidence)) ? Number(signal.confidence) : null,
        reasons: Array.isArray(signal.reasons) ? signal.reasons.map((reason) => cleanText(reason)).filter(Boolean).slice(0, 4) : [],
        invalidation: cleanText(signal.invalidation, 160) || undefined
      } satisfies MarketSignal]
    })
  })
}

export const signalMatchesPeriod = (signalPeriod: ChartPeriod, chartPeriod: ChartPeriod) => {
  if (chartPeriod === 'timeline' || chartPeriod === 'five_day') return ['1m', '5m', '15m', '30m', '60m', '120m'].includes(signalPeriod)
  return signalPeriod === chartPeriod
}

export const nearestSignalBarIndex = (bars: MarketBar[], time: string) => {
  const target = marketTimestamp(time)
  if (!bars.length || !Number.isFinite(target)) return -1
  let bestIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  bars.forEach((bar, index) => {
    const timestamp = marketTimestamp(bar.time)
    const distance = Math.abs(timestamp - target)
    if (Number.isFinite(distance) && distance < bestDistance) { bestDistance = distance; bestIndex = index }
  })
  return bestIndex
}

const signalRank = (signal: MarketSignal) => ({ watch: 1, confirm: 2, actionable: 3 })[signal.level] * 10 + (signal.confidence || 0)

export const signalsForChart = (signals: MarketSignal[], bars: MarketBar[], period: ChartPeriod) => {
  const points = new Map<number, MarketSignal>()
  for (const signal of signals.filter((entry) => signalMatchesPeriod(entry.period, period))) {
    const barIndex = nearestSignalBarIndex(bars, signal.time)
    if (barIndex < 0) continue
    const existing = points.get(barIndex)
    if (!existing || signalRank(signal) > signalRank(existing)) points.set(barIndex, signal)
  }
  return [...points].map(([barIndex, signal]) => ({ barIndex, signal })).slice(-12)
}

export const latestMarketSignal = (signals: MarketSignal[]) => [...signals].sort((a, b) => marketTimestamp(b.time) - marketTimestamp(a.time))[0] || null
export const marketSignalTitle = (signal: MarketSignal) => `${signal.side === 'buy' ? '买入' : '卖出'} · ${strategyNames[signal.strategy] || signal.strategy}`
export const marketSignalLevel = (signal: MarketSignal) => signal.level === 'actionable' ? '动作确认' : signal.level === 'confirm' ? '信号确认' : '观察预警'
