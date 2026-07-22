#!/usr/bin/env node

/**
 * SwiftBar 插件：每 5 分钟读取 ~/.trade-master，只展示只读事实和提醒。
 * 安装：将本文件链接或复制到 SwiftBar Plugin Folder，并赋予执行权限。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = process.env.TRADE_MASTER_HOME || path.join(os.homedir(), '.trade-master')
const read = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(home, file), 'utf8')) }
  catch { return fallback }
}

const portfolio = read('portfolio.json', { positions: [] })
const discipline = read('discipline.json', { state: 'UNKNOWN' })
const watchlist = read('watchlist.json', { instruments: [] })
const notificationAudit = read('notifications/audit.json', { events: [] })
const cacheIndex = read('market-cache/index.json', { entries: {} })
const activePositions = (portfolio.positions || []).filter((position) => Number(position.quantity) > 0 && position.status !== 'closed')
const activeWatch = (watchlist.instruments || []).filter((item) => !['closed_case', 'removed', 'archived'].includes(item.status))
const state = discipline.state || 'UNKNOWN'
const icon = state === 'STOPPED' ? '⛔️' : state === 'CAUTION' || state === 'COOLDOWN' ? '⚠️' : '🌱'
const spark = (values) => {
  if (!values.length) return ''
  const levels = '▁▂▃▄▅▆▇█'
  const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1
  return values.map((value) => levels[Math.round((value - min) / span * (levels.length - 1))]).join('')
}
const cachedBars = (code) => {
  const entries = Object.values(cacheIndex.entries || {}).filter((entry) => String(entry.key).includes(`:${code}:5m:`) && Number(entry.size) > 3).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
  if (!entries[0]) return []
  return read(`market-cache/data/${entries[0].file}`, [])
}

console.log(`${icon} ${activePositions.length}仓 | size=12`)
console.log('---')
console.log(`韭菜盒子 · ${state} | color=${state === 'STOPPED' ? '#c94942' : '#178453'}`)
console.log(`确认持仓 ${activePositions.length} 个 · 关注 ${activeWatch.length} 个`)
console.log('---')

if (activePositions.length === 0) {
  console.log('当前确认账本为空仓 | color=#73736d')
} else {
  for (const position of activePositions.slice(0, 6)) {
    const instrument = position.instrument || {}
    const cost = Number.isFinite(position.average_cost) ? `成本 ${position.average_cost}` : '成本待确认'
    const bars = cachedBars(instrument.code).filter((bar) => bar.closed !== false).slice(-8)
    const closes = bars.map((bar) => Number(bar.close)).filter(Number.isFinite)
    const kline = closes.length ? ` · 5m ${spark(closes)} ${closes.at(-1)}` : ' · 5m 待刷新'
    console.log(`${instrument.name || '未知标的'} ${instrument.code || ''} · ${position.quantity} · ${cost}${kline}`)
  }
}

const latestEvent = (notificationAudit.events || []).at(-1)
if (latestEvent) {
  console.log('---')
  console.log(`最新策略提醒 · ${latestEvent.title || latestEvent.mode || '通知'} | color=#a9670a`)
  console.log(`${latestEvent.sent_at || ''} · ${latestEvent.severity || 'info'} | size=10 color=#73736d`)
}

console.log('---')
console.log('打开韭菜盒子 | shell=open param1="jiucaibox://open" terminal=false')
console.log(`打开事实仓 | shell=open param1="${home}" terminal=false`)
console.log('刷新 | refresh=true')
console.log('---')
console.log('只读提醒，不会操作券商 | color=#9a9a93 size=10')
