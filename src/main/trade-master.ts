import { access, readFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { TradeMasterSnapshot } from '../shared/types'
import { loadHousehold } from './household-store'
import { loadDailyAccountState } from './account-state-store'
import { loadVocSnapshot } from './voc-store'

const FACT_FILES = {
  userProfile: 'profile.json',
  portfolio: 'portfolio.json',
  watchlist: 'watchlist.json',
  goals: 'goals.json',
  discipline: 'discipline.json',
  strategyProfile: 'strategy-profile.json',
  evolution: 'evolution/active.json',
  notifications: 'notifications.json',
  automation: 'automation/manifest.json',
  strategies: 'strategies/active.json'
} as const

const DEFAULT_SKILL_CANDIDATES = [
  process.env.TRADE_MASTER_SKILL_PATH,
  join(process.resourcesPath || '', 'trade-master'),
  join(process.cwd(), 'resources/trade-master')
].filter((candidate): candidate is string => Boolean(candidate))

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))

export const loadTradeMasterSnapshot = async (): Promise<TradeMasterSnapshot> => {
  const home = process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
  const snapshot: TradeMasterSnapshot = {
    home,
    userProfile: null,
    portfolio: null,
    household: null,
    accountState: null,
    watchlist: null,
    goals: null,
    discipline: null,
    strategyProfile: null,
    evolution: null,
    notifications: null,
    automation: null,
    strategies: null,
    strategyCandidates: [],
    strategyVersions: [],
    pausedStrategies: [],
    automationRuns: [],
    notificationAudit: null,
    voc: null,
    loadedAt: new Date().toISOString(),
    errors: []
  }
  await Promise.all(Object.entries(FACT_FILES).map(async ([key, file]) => {
    try {
      snapshot[key as keyof typeof FACT_FILES] = await readJson(join(home, file)) as never
    } catch (error) {
      snapshot.errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }))
  try { snapshot.accountState = await loadDailyAccountState() }
  catch (error) { snapshot.errors.push(`account-state/current.json: ${error instanceof Error ? error.message : String(error)}`) }
  try { snapshot.household = await loadHousehold(snapshot.portfolio, snapshot.accountState) }
  catch (error) { snapshot.errors.push(`household/portfolio.json: ${error instanceof Error ? error.message : String(error)}`) }
  try { snapshot.voc = await loadVocSnapshot() }
  catch (error) { snapshot.errors.push(`voc: ${error instanceof Error ? error.message : String(error)}`) }
  try {
    const candidateRoot = join(home, 'strategies/candidates')
    const files = (await readdir(candidateRoot)).filter((file) => file.endsWith('.json')).sort()
    snapshot.strategyCandidates = await Promise.all(files.map((file) => readJson(join(candidateRoot, file))))
  } catch (error) {
    snapshot.errors.push(`strategies/candidates: ${error instanceof Error ? error.message : String(error)}`)
  }
  const readDirectory = async (relative: string, limit?: number) => {
    try {
      const root = join(home, relative)
      const files = (await readdir(root)).filter((file) => file.endsWith('.json')).sort().reverse()
      const selectedFiles = limit == null ? files : files.slice(0, limit)
      return await Promise.all(selectedFiles.map((file) => readJson(join(root, file))))
    } catch { return [] }
  }
  snapshot.strategyVersions = await readDirectory('strategies/versions')
  snapshot.pausedStrategies = await readDirectory('strategies/paused')
  snapshot.automationRuns = await readDirectory('automation/runs', 50)
  try { snapshot.notificationAudit = await readJson(join(home, 'notifications/audit.json')) }
  catch { snapshot.notificationAudit = null }
  return snapshot
}

export const locateTradeMasterSkill = async (): Promise<string> => {
  for (const candidate of DEFAULT_SKILL_CANDIDATES) {
    try {
      await access(join(candidate, 'scripts/dist/cli.js'), constants.R_OK)
      return candidate
    } catch { /* try next */ }
  }
  throw new Error('未找到 trade-master skill，请在设置中安装或配置路径')
}

const ALLOWED_COMMANDS = new Set([
  'init', 'doctor', 'market', 'cache', 'plan', 'replay', 'screen', 'portfolio',
  'candidate', 'watchlist', 'goal', 'analyze', 'automation', 'notify', 'refine', 'evolve'
])
const MAX_CONCURRENT_COMMANDS = 4
const MAX_COMMAND_OUTPUT_BYTES = 32 * 1024 * 1024
const commandQueue: Array<() => void> = []
const sharedMarketCommands = new Map<string, Promise<string>>()
let activeCommands = 0

const withCommandSlot = <T>(task: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
  const start = () => {
    activeCommands += 1
    void task().then(resolve, reject).finally(() => {
      activeCommands -= 1
      commandQueue.shift()?.()
    })
  }
  if (activeCommands < MAX_CONCURRENT_COMMANDS) start()
  else commandQueue.push(start)
})

const stopTradeMasterChild = (child: ReturnType<typeof spawn>) => {
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid!, 'SIGTERM')
  } catch { child.kill('SIGTERM') }
}

const commandTimeoutMs = (command: string, args: string[]) =>
  command === 'candidate' && args[0] === 'refresh' ? 4 * 60_000
    : ['replay', 'screen'].includes(command) ? 3 * 60_000
      : 2 * 60_000

const executeTradeMaster = async (command: string, args: string[]): Promise<string> => {
  const skill = await locateTradeMasterSkill()
  const cli = join(skill, 'scripts/dist/cli.js')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, command, ...args], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        TRADE_MASTER_HOME: process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const appendOutput = (target: 'stdout' | 'stderr', data: Buffer) => {
      outputBytes += data.byteLength
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        stopTradeMasterChild(child)
        finish(() => reject(new Error('Trade Master 输出超过安全上限，已停止本次任务')))
        return
      }
      if (target === 'stdout') stdout += String(data)
      else stderr += String(data)
    }
    const timer = setTimeout(() => {
      stopTradeMasterChild(child)
      finish(() => reject(new Error(`Trade Master 执行超过 ${Math.round(commandTimeoutMs(command, args) / 1000)} 秒，已停止本次任务`)))
    }, commandTimeoutMs(command, args))
    child.stdout.on('data', (data: Buffer) => appendOutput('stdout', data))
    child.stderr.on('data', (data: Buffer) => appendOutput('stderr', data))
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => finish(() => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `Trade Master 退出码 ${code}`))))
  })
}

export const runTradeMaster = async (command: string, args: string[] = []): Promise<string> => {
  if (!ALLOWED_COMMANDS.has(command)) throw new Error(`不允许执行命令：${command}`)
  if (args.some((arg) => arg.includes('\0') || arg.length > 500)) throw new Error('参数不合法')
  const sharedKey = command === 'market' ? JSON.stringify([command, args]) : ''
  if (sharedKey) {
    const existing = sharedMarketCommands.get(sharedKey)
    if (existing) return existing
  }
  const running = withCommandSlot(() => executeTradeMaster(command, args))
  if (sharedKey) {
    sharedMarketCommands.set(sharedKey, running)
    void running.then(() => sharedMarketCommands.delete(sharedKey), () => sharedMarketCommands.delete(sharedKey))
  }
  return running
}
