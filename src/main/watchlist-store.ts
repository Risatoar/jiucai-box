import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Instrument } from '../shared/types'

interface StoredWatchlist {
  schema_version?: number
  updated_at?: string
  instruments?: Array<Record<string, unknown>>
}

export const addWatchItem = async (instrument: Instrument): Promise<void> => {
  const home = process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
  const target = join(home, 'watchlist.json')
  let stored: StoredWatchlist = { schema_version: 1, instruments: [] }
  try { stored = JSON.parse(await readFile(target, 'utf8')) as StoredWatchlist }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const instruments = [...(stored.instruments || [])]
  const index = instruments.findIndex((item) => item.code === instrument.code)
  const next = { ...instrument, status: 'active', source: 'user', added_at: new Date().toISOString() }
  if (index >= 0) instruments[index] = { ...instruments[index], ...next }
  else instruments.push(next)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, `${JSON.stringify({ ...stored, schema_version: 1, updated_at: new Date().toISOString(), instruments }, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
}

const updateWatchlist = async (updater: (items: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) => {
  const home = process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
  const target = join(home, 'watchlist.json')
  let stored: StoredWatchlist = { schema_version: 1, instruments: [] }
  try { stored = JSON.parse(await readFile(target, 'utf8')) as StoredWatchlist }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const next = { ...stored, schema_version: 1, updated_at: new Date().toISOString(), instruments: updater(stored.instruments || []) }
  await mkdir(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
}

export const removeWatchItem = async (code: string): Promise<void> => updateWatchlist((items) => {
  const index = items.findIndex((item) => item.code === code)
  if (index < 0) throw new Error('关注列表中没有这个品种')
  return items.map((item, itemIndex) => itemIndex === index
    ? { ...item, status: 'removed', removed_at: new Date().toISOString(), removed_by: 'user' }
    : item)
})

export const addAgentWatchItems = async (items: Array<Instrument & { score?: number; reasons?: unknown; signal?: string }>): Promise<number> => {
  let added = 0
  await updateWatchlist((stored) => {
    const next = [...stored]
    for (const item of items) {
      const index = next.findIndex((existing) => existing.code === item.code)
      const candidate = { ...item, status: 'active', source: 'agent', added_at: new Date().toISOString() }
      if (index >= 0) {
        if (next[index].status === 'removed' && next[index].removed_by === 'user') continue
        if (next[index].source === 'user' && next[index].status === 'active') continue
        next[index] = { ...next[index], ...candidate }
      } else {
        next.push(candidate)
        added += 1
      }
    }
    return next
  })
  return added
}

export const loadActiveAgentWatchItems = async (): Promise<Array<Instrument & { score?: number; reasons?: unknown; signal?: string }>> => {
  const target = join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'watchlist.json')
  try {
    const stored = JSON.parse(await readFile(target, 'utf8')) as StoredWatchlist
    return agentItems((stored.instruments || []).filter((item) => item.status === 'active'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const agentItems = (items: Array<Record<string, unknown>>): Array<Instrument & { score?: number; reasons?: unknown; signal?: string }> => items.flatMap((item) => {
      if (item.source !== 'agent' || !/^\d{6}$/.test(String(item.code))) return []
      if (!['stock', 'etf', 'cbond'].includes(String(item.type)) || !['SH', 'SZ', 'BJ'].includes(String(item.exchange))) return []
      return [{
        code: String(item.code), name: String(item.name || item.code), type: item.type as Instrument['type'], exchange: item.exchange as Instrument['exchange'],
        score: Number(item.score || 0), reasons: item.reasons, signal: String(item.signal || '观察')
      }]
    })

export const loadAgentWatchItemsForReview = async (): Promise<Array<Instrument & { score?: number; reasons?: unknown; signal?: string }>> => {
  const target = join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'watchlist.json')
  try {
    const stored = JSON.parse(await readFile(target, 'utf8')) as StoredWatchlist
    const instruments = stored.instruments || []
    const active = agentItems(instruments.filter((item) => item.status === 'active'))
    if (active.length) return active
    const automatedRemovals = instruments.filter((item) => item.source === 'agent' && item.status === 'removed' && item.removed_by === 'agent_refresh' && typeof item.removed_at === 'string')
    const latestRemoval = automatedRemovals.map((item) => String(item.removed_at)).sort().at(-1)
    return latestRemoval ? agentItems(automatedRemovals.filter((item) => item.removed_at === latestRemoval)) : []
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export const syncAgentWatchItems = async (items: Array<Instrument & { score?: number; reasons?: unknown; signal?: string }>) => {
  let added = 0; let updated = 0; let removed = 0
  const incoming = new Set(items.map((item) => item.code))
  await updateWatchlist((stored) => {
    const next = stored.map((item) => {
      if (item.source !== 'agent' || item.status !== 'active' || incoming.has(String(item.code))) return item
      removed += 1
      return { ...item, status: 'removed', removed_at: new Date().toISOString(), removed_by: 'agent_refresh' }
    })
    for (const item of items.slice(0, 10)) {
      const index = next.findIndex((existing) => existing.code === item.code)
      const candidate = { ...item, status: 'active', source: 'agent', recommended_at: new Date().toISOString() }
      if (index < 0) { next.push(candidate); added += 1; continue }
      if (next[index].status === 'removed' && next[index].removed_by === 'user') continue
      if (next[index].source === 'user' && next[index].status === 'active') continue
      next[index] = { ...next[index], ...candidate }; updated += 1
    }
    return next
  })
  return { added, updated, removed, active: Math.min(items.length, 10) }
}

export const loadRuntimeCandidates = async (): Promise<Array<Instrument & { score?: number; reasons?: unknown; signal?: string }>> => {
  const target = join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'runtime/candidate-pool.json')
  try {
    const raw = JSON.parse(await readFile(target, 'utf8')) as { candidates?: Array<Record<string, unknown>> | Record<string, { main?: Array<Record<string, unknown>>; reserve?: Array<Record<string, unknown>> }> }
    if (Array.isArray(raw.candidates)) return raw.candidates.slice(0, 20).flatMap((item) => {
      const instrument = item.instrument as Record<string, unknown> | undefined
      if (!instrument || !/^\d{6}$/.test(String(instrument.code)) || !['stock', 'etf', 'cbond'].includes(String(item.type)) || !['SH', 'SZ', 'BJ'].includes(String(instrument.exchange))) return []
      const signal = item.status === 'buy_ready' ? '模型买入条件已满足，等待人工复核' : '模型关注候选'
      return [{ code: String(instrument.code), name: String(instrument.name || instrument.code), type: item.type as Instrument['type'], exchange: instrument.exchange as Instrument['exchange'], score: Number(item.score || 0), reasons: item.reasons, signal }]
    })
    return Object.values(raw.candidates || {}).flatMap((group) => [...(group.main || []), ...(group.reserve || [])]).flatMap((item) => {
      if (!/^\d{6}$/.test(String(item.code)) || !['stock', 'etf', 'cbond'].includes(String(item.type)) || !['SH', 'SZ', 'BJ'].includes(String(item.exchange))) return []
      return [{ code: String(item.code), name: String(item.name || item.code), type: item.type as Instrument['type'], exchange: item.exchange as Instrument['exchange'], score: Number(item.score || 0), reasons: item.reason, signal: String(item.action || '观察') }]
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
