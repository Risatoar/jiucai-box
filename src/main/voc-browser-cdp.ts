import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const DEBUG_PORT = 19223
const DEBUG_BASE = `http://127.0.0.1:${DEBUG_PORT}`
const profileHome = () => join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'voc', 'chrome-profile')
const cleanupChromeCaches = async () => {
  await Promise.all([
    join(profileHome(), 'Default', 'Cache'),
    join(profileHome(), 'Default', 'Code Cache'),
    join(profileHome(), 'Default', 'GPUCache')
  ].map((path) => rm(path, { recursive: true, force: true })))
}

interface ChromeTarget { id: string; webSocketDebuggerUrl: string }
interface PendingCall { resolve: (value: unknown) => void; reject: (error: Error) => void }

class CdpPage {
  private socket: WebSocket
  private nextId = 1
  private pending = new Map<number, PendingCall>()

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as { id?: number; result?: unknown; error?: { message?: string } }
      if (!message.id) return
      const call = this.pending.get(message.id)
      if (!call) return
      this.pending.delete(message.id)
      if (message.error) call.reject(new Error(message.error.message || 'Chrome 调试调用失败'))
      else call.resolve(message.result)
    })
    socket.on('close', () => {
      for (const call of this.pending.values()) call.reject(new Error('Chrome 页面已关闭'))
      this.pending.clear()
    })
  }

  static connect(url: string): Promise<CdpPage> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.once('open', () => resolve(new CdpPage(socket)))
      socket.once('error', reject)
    })
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async waitUntilReady(expectedUrl: string, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs
    const expected = new URL(expectedUrl)
    while (Date.now() < deadline) {
      const page = await this.evaluate<{ state: string; href: string }>('({ state: document.readyState, href: location.href })').catch(() => ({ state: '', href: '' }))
      let atExpectedPage = false
      try {
        const current = new URL(page.href)
        atExpectedPage = current.hostname === expected.hostname && current.pathname === expected.pathname
      } catch { /* keep waiting */ }
      if (atExpectedPage && (page.state === 'complete' || page.state === 'interactive')) return
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('页面加载超时')
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }) as {
      result?: { value?: T }; exceptionDetails?: { text?: string }
    }
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || '页面内容读取失败')
    return response.result?.value as T
  }

  close() { this.socket.close() }
}

const chromeCandidates = () => process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
  : process.platform === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']

const resolveChrome = async () => {
  for (const candidate of chromeCandidates()) {
    try { await access(candidate); return candidate }
    catch { /* try next */ }
  }
  throw new Error('没有找到 Google Chrome，请先安装 Chrome')
}

const waitForDebugPort = async (timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${DEBUG_BASE}/json/version`)
      if (response.ok) return
    } catch { /* Chrome is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error('采集浏览器启动超时')
}

let browserProcess: ChildProcess | null = null
let browserMode: 'headless' | 'visible' | null = null

const stopManagedBrowser = async () => {
  if (!browserProcess || browserProcess.killed) return
  browserProcess.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 800))
  browserProcess = null
  browserMode = null
}

export const ensureVocBrowser = async (mode: 'headless' | 'visible' = 'headless', initialUrl = 'about:blank') => {
  if (mode === 'headless' && browserProcess && !browserProcess.killed && browserMode === 'visible') {
    throw new Error('登录窗口仍打开；完成登录后请关闭该 Chrome 窗口')
  }
  if (browserProcess && !browserProcess.killed && browserMode === mode) {
    try { await waitForDebugPort(1_000); return }
    catch { browserProcess = null; browserMode = null }
  }
  if (!browserProcess && mode === 'headless') {
    try { await waitForDebugPort(1_000); return }
    catch { /* no reusable collector browser */ }
  }
  if (browserProcess) await stopManagedBrowser()
  await mkdir(profileHome(), { recursive: true })
  await cleanupChromeCaches()
  const chrome = await resolveChrome()
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileHome()}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-application-cache',
    '--disk-cache-size=1048576', '--media-cache-size=1048576',
    ...(mode === 'headless' ? ['--headless=new', '--disable-gpu'] : []),
    initialUrl
  ]
  browserProcess = spawn(chrome, args, { stdio: 'ignore' })
  browserMode = mode
  browserProcess.once('exit', () => { browserProcess = null; browserMode = null })
  await waitForDebugPort()
}

const createTarget = async (url: string): Promise<ChromeTarget> => {
  const response = await fetch(`${DEBUG_BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!response.ok) throw new Error(`无法打开采集页面：${response.status}`)
  return response.json() as Promise<ChromeTarget>
}

export const withVocPage = async <T>(url: string, task: (page: CdpPage) => Promise<T>, options: { referer?: string; warmupUrl?: string } = {}): Promise<T> => {
  await ensureVocBrowser('headless')
  const target = await createTarget('about:blank')
  const page = await CdpPage.connect(target.webSocketDebuggerUrl)
  try {
    await page.call('Runtime.enable')
    await page.call('Page.enable')
    await page.call('Network.enable')
    if (options.warmupUrl) {
      await page.call('Page.navigate', { url: options.warmupUrl })
      await page.waitUntilReady(options.warmupUrl)
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
    if (options.referer) await page.call('Network.setExtraHTTPHeaders', { headers: { Referer: options.referer } })
    await page.call('Page.navigate', { url, referrer: options.referer })
    await page.waitUntilReady(url)
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    return await task(page)
  } finally {
    page.close()
    await fetch(`${DEBUG_BASE}/json/close/${target.id}`).catch(() => undefined)
  }
}

export const openVocLoginBrowser = async () => {
  await ensureVocBrowser('visible', 'https://weibo.com/')
  await createTarget('https://www.douyin.com/')
  return true
}

export const stopVocBrowser = () => { void stopManagedBrowser() }
