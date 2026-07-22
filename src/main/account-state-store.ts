import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ChatMessage, DailyAccountState } from '../shared/types'

interface ParsedAccountFacts {
  availableCash?: number
  frozenCash?: number
  activeOrders?: 'none' | 'present'
}

const home = () => process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
const statePath = () => join(home(), 'account-state/current.json')
let mutationQueue: Promise<void> = Promise.resolve()

const shanghaiDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date)

const atomicWrite = async (target: string, value: unknown) => {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
}

const amount = (value: string) => {
  if (!value.trim()) return undefined
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export const parseAccountStateConfirmation = (content: string): ParsedAccountFacts => {
  const normalized = content.replace(/，/g, ',').replace(/：/g, ':').replace(/\s+/g, ' ').trim()
  const beforeCash = normalized.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:元)?\s*(?:的)?\s*(?:资金|现金)(?:余额)?\s*(?:都)?(?:可用|到账)/)
  const afterCash = normalized.match(/(?:可用资金|可用现金|资金可用|现金可用|现金余额)\s*(?:为|是|有|[:])?\s*(\d[\d,]*(?:\.\d+)?)/)
  const availableCash = amount((beforeCash || afterCash)?.[1] || '')
  const frozenZero = /(?:没有|无)\s*冻结(?:资金|金额)?/.test(normalized) || /冻结(?:资金|金额)?\s*(?:为|是|[:])?\s*0(?:\.0+)?(?:元)?/.test(normalized)
  const frozenAmount = normalized.match(/冻结(?:资金|金额)?\s*(?:为|是|有|[:])?\s*(\d[\d,]*(?:\.\d+)?)/)
  const noOrders = /(?:没有|无)\s*(?:活动委托|未成交委托|在途委托|挂单)/.test(normalized)
  const hasOrders = /(?:有|存在)\s*(?:活动委托|未成交委托|在途委托|挂单)/.test(normalized)
  return {
    ...(availableCash == null ? {} : { availableCash }),
    ...(frozenZero ? { frozenCash: 0 } : frozenAmount ? { frozenCash: amount(frozenAmount[1]) } : {}),
    ...(noOrders ? { activeOrders: 'none' as const } : hasOrders ? { activeOrders: 'present' as const } : {})
  }
}

const emptyState = (date: string, now: string): DailyAccountState => ({
  schemaVersion: 1, tradingDate: date, accountId: 'primary-account', processedMessageIds: [], updatedAt: now
})

const readCurrent = async (): Promise<DailyAccountState | null> => {
  try { return JSON.parse(await readFile(statePath(), 'utf8')) as DailyAccountState }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return null }
}

const mergePrimaryPortfolio = async (facts: ParsedAccountFacts, confirmedAt: string) => {
  const target = join(home(), 'portfolio.json')
  let portfolio: Record<string, unknown> = { schema_version: 1, positions: [], pending_events: [], conflicts: [] }
  try { portfolio = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown> }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await atomicWrite(target, {
    ...portfolio,
    ...(facts.availableCash == null ? {} : { cash: facts.availableCash, cash_status: 'user_confirmed', cash_confirmed_at: confirmedAt }),
    ...(facts.frozenCash == null ? {} : { frozen_cash: facts.frozenCash, frozen_cash_status: 'user_confirmed', frozen_cash_confirmed_at: confirmedAt }),
    ...(facts.activeOrders == null ? {} : { active_orders_status: facts.activeOrders, active_orders_confirmed_at: confirmedAt }),
    as_of: confirmedAt
  })
}

export const recordAccountStateConfirmation = (message: ChatMessage, confirmedAt = new Date()): Promise<boolean> => {
  const operation = mutationQueue.then(async () => {
    if (message.role !== 'user') return false
    const facts = parseAccountStateConfirmation(message.content)
    if (!Object.keys(facts).length) return false
    const timestamp = confirmedAt.toISOString()
    const date = shanghaiDate(confirmedAt)
    const current = await readCurrent()
    const state = current?.tradingDate === date ? current : emptyState(date, timestamp)
    if (state.processedMessageIds.includes(message.id)) return false
    const confirmation = <T>(value: T) => ({ value, confirmedAt: timestamp, sourceMessageId: message.id, source: 'user_confirmed_via_jiucai_box' as const })
    const next: DailyAccountState = {
      ...state,
      ...(facts.availableCash == null ? {} : { availableCash: confirmation(facts.availableCash) }),
      ...(facts.frozenCash == null ? {} : { frozenCash: confirmation(facts.frozenCash) }),
      ...(facts.activeOrders == null ? {} : { activeOrders: confirmation(facts.activeOrders) }),
      processedMessageIds: [...state.processedMessageIds, message.id].slice(-100),
      updatedAt: timestamp
    }
    await atomicWrite(statePath(), next)
    await mergePrimaryPortfolio(facts, timestamp)
    return true
  }, async () => false)
  mutationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export const loadDailyAccountState = async (now = new Date()): Promise<DailyAccountState | null> => {
  const state = await readCurrent()
  return state?.tradingDate === shanghaiDate(now) ? state : null
}
