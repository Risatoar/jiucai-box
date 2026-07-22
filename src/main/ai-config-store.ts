import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AiConfig } from '../shared/types'
import { DEFAULT_AI_TIMEOUT_SECONDS, normalizeAiTimeoutSeconds } from '../shared/ai-config'

interface StoredAiConfig extends Omit<AiConfig, 'apiKey'> {
  encryptedApiKey?: string
}

const defaultConfig: AiConfig = {
  provider: 'codex-local',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5',
  timeoutSeconds: DEFAULT_AI_TIMEOUT_SECONDS
}

const configPath = () => join(app.getPath('userData'), 'ai-config.json')

export const loadAiConfig = async (): Promise<AiConfig> => {
  try {
    const stored = JSON.parse(await readFile(configPath(), 'utf8')) as StoredAiConfig
    const apiKey = stored.encryptedApiKey && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64'))
      : undefined
    const { encryptedApiKey: _encryptedApiKey, ...config } = stored
    return { ...defaultConfig, ...config, timeoutSeconds: normalizeAiTimeoutSeconds(config.timeoutSeconds), apiKey }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig
    throw error
  }
}

export const saveAiConfig = async (config: AiConfig): Promise<AiConfig> => {
  const current = await loadAiConfig()
  const apiKey = config.apiKey === undefined ? current.apiKey : config.apiKey.trim() || undefined
  if (apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，API Key 未保存')
  const stored: StoredAiConfig = {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutSeconds: normalizeAiTimeoutSeconds(config.timeoutSeconds),
    codexPath: config.codexPath,
    encryptedApiKey: apiKey ? safeStorage.encryptString(apiKey).toString('base64') : undefined
  }
  const target = configPath()
  await mkdir(dirname(target), { recursive: true })
  await writeFile(`${target}.tmp`, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  await rename(`${target}.tmp`, target)
  return { ...config, timeoutSeconds: stored.timeoutSeconds, apiKey }
}
