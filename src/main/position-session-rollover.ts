import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

interface RolloverResult {
  status: 'updated' | 'already_current' | 'outside_preopen'
  tradingDate: string
  primaryPositions: number
  managedPositions: number
}

const home = () => process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')

const shanghaiClock = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return {
    tradingDate: `${pick('year')}-${pick('month')}-${pick('day')}`,
    minutes: Number(pick('hour')) * 60 + Number(pick('minute')),
    weekday: pick('weekday')
  }
}

const readJson = async (target: string): Promise<Record<string, unknown> | null> => {
  try { return JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown> }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const atomicWrite = async (target: string, value: unknown) => {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
}

const quantity = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

const rolloverPrimary = async (tradingDate: string, updatedAt: string) => {
  const target = join(home(), 'portfolio.json')
  const portfolio = await readJson(target)
  if (!portfolio) return 0
  const markedCurrent = portfolio.available_quantity_trading_date === tradingDate
  const positions = Array.isArray(portfolio.positions) ? portfolio.positions as Array<Record<string, unknown>> : []
  let changed = 0
  const nextPositions = positions.map((position) => {
    const holding = quantity(position.quantity)
    if (Number(position.available_quantity || 0) !== holding) changed += 1
    return {
      ...position,
      available_quantity: holding,
      available_quantity_status: 'session_open_rollover_from_confirmed_position',
      available_quantity_trading_date: tradingDate,
      available_quantity_updated_at: updatedAt
    }
  })
  if (markedCurrent && changed === 0) return 0
  await atomicWrite(target, {
    ...portfolio,
    positions: nextPositions,
    available_quantity_trading_date: tradingDate,
    available_quantity_updated_at: updatedAt,
    available_quantity_rollover_status: 'derived_from_confirmed_positions'
  })
  return changed
}

const rolloverManaged = async (tradingDate: string, updatedAt: string) => {
  const target = join(home(), 'household/portfolio.json')
  const household = await readJson(target)
  if (!household) return 0
  const markedCurrent = household.availableQuantityTradingDate === tradingDate
  const accounts = Array.isArray(household.accounts) ? household.accounts as Array<Record<string, unknown>> : []
  let changed = 0
  const nextAccounts = accounts.map((account) => {
    if (account.source !== 'managed') return account
    const positions = Array.isArray(account.positions) ? account.positions as Array<Record<string, unknown>> : []
    return {
      ...account,
      positions: positions.map((position) => {
        const holding = quantity(position.quantity)
        if (Number(position.availableQuantity || 0) !== holding) changed += 1
        return { ...position, availableQuantity: holding, availableQuantityStatus: 'session_open_rollover_from_confirmed_position', availableQuantityTradingDate: tradingDate, availableQuantityUpdatedAt: updatedAt }
      }),
      updatedAt
    }
  })
  if (markedCurrent && changed === 0) return 0
  await atomicWrite(target, { ...household, accounts: nextAccounts, availableQuantityTradingDate: tradingDate, availableQuantityUpdatedAt: updatedAt, updatedAt })
  return changed
}

export const rolloverAvailableQuantitiesBeforeOpen = async (now = new Date()): Promise<RolloverResult> => {
  const clock = shanghaiClock(now)
  if (['Sat', 'Sun'].includes(clock.weekday) || clock.minutes >= 9 * 60 + 30) {
    return { status: 'outside_preopen', tradingDate: clock.tradingDate, primaryPositions: 0, managedPositions: 0 }
  }
  const updatedAt = now.toISOString()
  const [primaryPositions, managedPositions] = await Promise.all([
    rolloverPrimary(clock.tradingDate, updatedAt),
    rolloverManaged(clock.tradingDate, updatedAt)
  ])
  return {
    status: primaryPositions || managedPositions ? 'updated' : 'already_current',
    tradingDate: clock.tradingDate,
    primaryPositions,
    managedPositions
  }
}
