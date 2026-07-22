import type { AutomationSchedule } from './automation-schedule'

export interface AutomationTask {
  id: string
  title: string
  description: string
  schedule: string
  session: string
  mode: string
  enabled: boolean
  state: 'healthy' | 'running' | 'warning' | 'idle'
  lastRun: string
  nextRun: string
  prompt: string
  isSystemDefault: boolean
  scheduleConfig: AutomationSchedule
}

export interface AutomationRun {
  id: string
  taskId: string
  mode: string
  startedAt: string
  finishedAt: string
  status: 'success' | 'failed' | 'no_reply'
  trigger?: 'manual' | 'scheduled'
  summary: string
  sessionId?: string
  error?: string
}

export interface FeishuConfigInput {
  receiverType: 'user_id' | 'chat_id'
  receiverId: string
  receiverLabel?: string
  identity: 'bot' | 'user'
  cliPath?: string
  duplicateWindowMinutes: number
}

export interface FeishuChat {
  chatId: string
  name: string
  description?: string
  external: boolean
}

export interface FeishuChatSearchResult {
  ok: boolean
  chats?: FeishuChat[]
  error?: string
}

export interface FeishuConversationStatus {
  state: 'stopped' | 'starting' | 'running' | 'error'
  detail: string
  lastMessageAt?: string
  processedMessages: number
}

export interface FeishuConnectionResult {
  ok: boolean
  status?: 'connected' | 'authorization_required'
  displayName?: string
  authorizationId?: string
  verificationUrl?: string
  qrDataUrl?: string
  error?: string
}

export interface DesktopIntegrationStatus {
  trayAvailable: boolean
  notificationsAvailable: boolean
  swiftBarInstalled: boolean
  swiftBarPluginPath: string
}
