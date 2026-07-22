import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { runTradeMaster } from './trade-master'
import type { FeishuChat, FeishuChatSearchResult, FeishuConnectionResult } from '../shared/types'

interface LarkIdentity {
  status?: string
  available?: boolean
  verified?: boolean
  openId?: string
  userName?: string
  tokenStatus?: string
}

interface LarkAuthStatus {
  verified?: boolean
  identities?: { user?: LarkIdentity; bot?: LarkIdentity }
}

interface PendingAuthorization {
  cliPath: string
  deviceCode: string
  verificationUrl: string
  expiresAt: number
}

const pendingAuthorizations = new Map<string, PendingAuthorization>()
const notifierEnv = {
  LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
  LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1'
}

const notificationsPath = () => join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'notifications.json')

const jsonFromOutput = <T>(output: string): T => {
  try { return JSON.parse(output) as T }
  catch { throw new Error('飞书返回了无法识别的结果，请稍后重试') }
}

const errorFromOutput = (output: string, fallback: string): Error => {
  try {
    const parsed = JSON.parse(output) as { error?: { message?: string; hint?: string } }
    return new Error(parsed.error?.message || parsed.error?.hint || fallback)
  } catch { return new Error(output.trim() || fallback) }
}

const runCli = (cliPath: string, args: string[], cwd?: string): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn(cliPath, args, {
    cwd,
    env: { ...process.env, PATH: [dirname(cliPath), process.env.PATH].filter(Boolean).join(delimiter), ...notifierEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (value) => { stdout += String(value) })
  child.stderr.on('data', (value) => { stderr += String(value) })
  child.on('error', (error) => reject(new Error(`无法启动飞书连接组件：${error.message}`)))
  child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(errorFromOutput(stderr || stdout, `飞书连接组件退出码 ${code}`)))
})

const candidateCliPaths = async (): Promise<string[]> => {
  const candidates = [process.env.LARK_CLI_PATH, join(process.resourcesPath || '', 'lark-cli')]
  try {
    const raw = JSON.parse(await readFile(notificationsPath(), 'utf8')) as { cli_path?: string }
    candidates.unshift(raw.cli_path)
  } catch { /* not configured yet */ }
  try {
    const root = join(homedir(), '.nvm/versions/node')
    const versions = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => Number(right.startsWith('v20')) - Number(left.startsWith('v20')) || right.localeCompare(left, undefined, { numeric: true }))
    candidates.push(...versions.map((version) => join(root, version, 'bin/lark-cli')))
  } catch { /* nvm is optional */ }
  candidates.push('lark-cli')
  return [...new Set(candidates.filter((value): value is string => Boolean(value)))]
}

export const locateLarkCli = async (): Promise<string> => {
  for (const candidate of await candidateCliPaths()) {
    if (basename(candidate) === candidate) {
      try { await runCli(candidate, ['--version']); return candidate } catch { continue }
    }
    try { await access(candidate); return candidate } catch { /* try next */ }
  }
  throw new Error('未找到飞书连接组件，请先完成应用初始化')
}

export const authorizedUserFromStatus = (status: LarkAuthStatus): { openId: string; userName: string } | null => {
  const user = status.identities?.user
  if (!status.verified || user?.status !== 'ready' || user.tokenStatus !== 'valid' || !user.openId) return null
  return { openId: user.openId, userName: user.userName || '当前飞书用户' }
}

export const authorizationFromResponse = (response: unknown): { deviceCode: string; verificationUrl: string } => {
  const envelope = response as { device_code?: string; verification_url?: string; data?: { device_code?: string; verification_url?: string } }
  const source = envelope.data || envelope
  if (!source.device_code || !source.verification_url) throw new Error('未取得飞书授权信息，请稍后重试')
  return { deviceCode: source.device_code, verificationUrl: source.verification_url }
}

export const chatsFromResponse = (response: unknown): FeishuChat[] => {
  const envelope = response as { chats?: unknown; data?: { chats?: unknown } }
  const chats = envelope.data?.chats ?? envelope.chats
  if (!Array.isArray(chats)) return []
  return chats.flatMap((item) => {
    const chat = item as { chat_id?: unknown; name?: unknown; description?: unknown; external?: unknown; chat_status?: unknown }
    if (typeof chat.chat_id !== 'string' || !chat.chat_id.startsWith('oc_') || typeof chat.name !== 'string') return []
    if (chat.chat_status && chat.chat_status !== 'normal') return []
    return [{
      chatId: chat.chat_id,
      name: chat.name.trim() || '未命名群聊',
      description: typeof chat.description === 'string' && chat.description.trim() ? chat.description.trim() : undefined,
      external: chat.external === true
    }]
  })
}

const saveReceiverLabel = async (label: string): Promise<void> => {
  const path = notificationsPath()
  const config = JSON.parse(await readFile(path, 'utf8')) as { receiver?: { label?: string } }
  if (!config.receiver) return
  config.receiver.label = label.trim().slice(0, 100)
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

const connectAuthorizedUser = async (cliPath: string, status: LarkAuthStatus): Promise<FeishuConnectionResult> => {
  const user = authorizedUserFromStatus(status)
  if (!user) throw new Error('飞书授权尚未完成')
  const bot = status.identities?.bot
  if (bot?.status !== 'ready' || bot.available === false || bot.verified === false) throw new Error('飞书通知服务尚未就绪，请联系应用管理员')
  await runTradeMaster('notify', [
    'configure-feishu', '--user-id', user.openId, '--identity', 'bot',
    '--cli-path', cliPath, '--duplicate-window-minutes', '60'
  ])
  await saveReceiverLabel(user.userName)
  return { ok: true, status: 'connected', displayName: user.userName }
}

export const searchFeishuChats = async (query: string): Promise<FeishuChatSearchResult> => {
  const keyword = typeof query === 'string' ? query.trim() : ''
  if (!keyword) return { ok: false, error: '请输入群聊名称' }
  if (keyword.length > 64) return { ok: false, error: '群聊名称不能超过 64 个字符' }
  try {
    const cliPath = await locateLarkCli()
    const raw = await runCli(cliPath, [
      'im', '+chat-search', '--query', keyword,
      '--search-types', 'private,public_joined,external',
      '--chat-modes', 'group,topic', '--disable-search-by-user',
      '--page-size', '10', '--as', 'bot', '--format', 'json'
    ])
    return { ok: true, chats: chatsFromResponse(jsonFromOutput<unknown>(raw)) }
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
}

export const configureFeishuGroup = async (chatId: string, name: string): Promise<FeishuConnectionResult> => {
  const normalizedId = typeof chatId === 'string' ? chatId.trim() : ''
  const label = typeof name === 'string' && name.trim() ? name.trim() : '飞书群聊'
  if (!/^oc_[A-Za-z0-9_-]+$/.test(normalizedId)) return { ok: false, error: '群聊信息无效，请重新搜索并选择' }
  try {
    const cliPath = await locateLarkCli()
    await runTradeMaster('notify', [
      'configure-feishu', '--chat-id', normalizedId, '--identity', 'bot',
      '--cli-path', cliPath, '--duplicate-window-minutes', '60'
    ])
    await saveReceiverLabel(label)
    return { ok: true, status: 'connected', displayName: label }
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
}

const createQrDataUrl = async (cliPath: string, verificationUrl: string): Promise<string | undefined> => {
  const directory = await mkdtemp(join(tmpdir(), 'jiucai-feishu-'))
  try {
    const fileName = 'authorization.png'
    await runCli(cliPath, ['auth', 'qrcode', verificationUrl, '--output', fileName, '--size', '240'], directory)
    return `data:image/png;base64,${(await readFile(join(directory, fileName))).toString('base64')}`
  } catch { return undefined }
  finally { await rm(directory, { recursive: true, force: true }) }
}

const beginAuthorization = async (cliPath: string): Promise<FeishuConnectionResult> => {
  const raw = await runCli(cliPath, ['auth', 'login', '--scope', 'auth:user.id:read', '--no-wait', '--json'])
  const authorization = authorizationFromResponse(jsonFromOutput<unknown>(raw))
  const authorizationId = randomUUID()
  const expiresAt = Date.now() + 10 * 60_000
  for (const [id, item] of pendingAuthorizations) if (item.expiresAt < Date.now()) pendingAuthorizations.delete(id)
  pendingAuthorizations.set(authorizationId, { cliPath, ...authorization, expiresAt })
  return {
    ok: true,
    status: 'authorization_required',
    authorizationId,
    verificationUrl: authorization.verificationUrl,
    qrDataUrl: await createQrDataUrl(cliPath, authorization.verificationUrl)
  }
}

export const connectFeishu = async (): Promise<FeishuConnectionResult> => {
  try {
    const cliPath = await locateLarkCli()
    const status = jsonFromOutput<LarkAuthStatus>(await runCli(cliPath, ['auth', 'status', '--json', '--verify']))
    return authorizedUserFromStatus(status) ? await connectAuthorizedUser(cliPath, status) : await beginAuthorization(cliPath)
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
}

export const completeFeishuAuthorization = async (authorizationId: string): Promise<FeishuConnectionResult> => {
  const pending = pendingAuthorizations.get(authorizationId)
  if (!pending || pending.expiresAt < Date.now()) return { ok: false, error: '授权已过期，请重新连接飞书' }
  try {
    await runCli(pending.cliPath, ['auth', 'login', '--device-code', pending.deviceCode])
    const status = jsonFromOutput<LarkAuthStatus>(await runCli(pending.cliPath, ['auth', 'status', '--json', '--verify']))
    const result = await connectAuthorizedUser(pending.cliPath, status)
    pendingAuthorizations.delete(authorizationId)
    return result
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
}

export const getFeishuAuthorizationUrl = (authorizationId: string): string | null => {
  const pending = pendingAuthorizations.get(authorizationId)
  return pending && pending.expiresAt >= Date.now() ? pending.verificationUrl : null
}

export const cancelFeishuAuthorization = (authorizationId: string): void => {
  pendingAuthorizations.delete(authorizationId)
}
