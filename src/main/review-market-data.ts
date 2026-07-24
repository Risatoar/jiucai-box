import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MarketBar } from '../shared/types'

const ETF_NAMES: Record<string, string> = {
  '518880': '黄金ETF', '512880': '证券ETF', '512400': '有色金属ETF', '513090': '港股通非银ETF',
  '159755': '新能源车ETF', '159368': '港科技30ETF', '512000': '券商ETF', '512660': '军工ETF',
  '512710': '国防军工ETF', '512800': '银行ETF', '513120': '港股通创新药ETF', '513130': '港股通科技ETF',
  '513180': '港股通红利ETF', '515290': '银行ETF', '515790': '光伏ETF', '516160': '新能源ETF',
  '516310': '港股通消费ETF', '517520': '红利低波ETF', '520500': '房地产ETF',
  '159227': '电池ETF', '159566': '储能ETF', '159570': '风电ETF', '159796': '光伏ETF',
  '513050': '中概互联网ETF', '159636': '港科技30ETF', '589720': '科创创新药ETF',
  '513750': '港股通非银ETF广发', '110092': '三房转债', '110101': '可转债ETF'
}

export const resolveInstrumentName = (code: string, fallback?: string) => {
  if (fallback && fallback !== code) return fallback
  return ETF_NAMES[code] || code
}

const tradeMasterHome = () => process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')

export const readBarsFromCache = (code: string, period: string, limit: number, start?: string): MarketBar[] => {
  try {
    const idxPath = join(tradeMasterHome(), 'market-cache', 'index.json')
    const idx = JSON.parse(readFileSync(idxPath, 'utf8')) as { entries?: Record<string, { key: string; file: string; updated_at?: string }> }
    const entries = idx.entries || {}
    let best: { file: string; updated_at: string } | null = null
    for (const e of Object.values(entries)) {
      if (!e.key || !e.file) continue
      const parts = e.key.split(':')
      if (parts.length < 5) continue
      if (parts[0] !== 'bars' || parts[2] !== code || parts[3] !== period) continue
      const updated = e.updated_at || ''
      if (!best || updated > best.updated_at) best = { file: e.file, updated_at: updated }
    }
    if (!best) return []
    const barsPath = join(tradeMasterHome(), 'market-cache', 'data', best.file)
    const bars = JSON.parse(readFileSync(barsPath, 'utf8')) as MarketBar[]
    if (!Array.isArray(bars)) return []
    const filtered = start ? bars.filter((b) => b.time >= start) : bars
    return filtered.slice(-limit)
  } catch { return [] }
}
