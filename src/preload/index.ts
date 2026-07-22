import { contextBridge, ipcRenderer } from 'electron'
import { randomUUID } from 'node:crypto'
import type { DesktopApi } from '../shared/api'
import type { AppUpdateStatus, ChatRunChangedEvent, FeishuConversationStatus, SetupProgress } from '../shared/types'

const api: DesktopApi = {
  loadSnapshot: () => ipcRenderer.invoke('trade-master:load'),
  confirmNormalDiscipline: () => ipcRenderer.invoke('discipline:confirm-normal'),
  runTradeMaster: (command, args) => ipcRenderer.invoke('trade-master:run', command, args),
  chat: async (config, sessionId, messages) => {
    const requestId = randomUUID()
    return ipcRenderer.invoke('ai:chat', requestId, config, sessionId, messages)
  },
  listChatRuns: () => ipcRenderer.invoke('ai:chat:list-runs'),
  cancelChat: (sessionId) => ipcRenderer.invoke('ai:chat:cancel', sessionId),
  onChatRunChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ChatRunChangedEvent) => listener(payload)
    ipcRenderer.on('ai:chat:run-changed', handler)
    return () => ipcRenderer.removeListener('ai:chat:run-changed', handler)
  },
  extractMemories: (config, sessionId, messages) => ipcRenderer.invoke('memories:extract', config, sessionId, messages),
  analyzeMarketInsight: (request) => ipcRenderer.invoke('ai:market-insight', request),
  analyzePositionStrategy: (request) => ipcRenderer.invoke('ai:position-strategy', request),
  pickAttachments: (sessionId) => ipcRenderer.invoke('attachments:pick', sessionId),
  saveClipboardAttachment: (sessionId, input) => ipcRenderer.invoke('attachments:clipboard', sessionId, input),
  discardAttachment: (storageKey) => ipcRenderer.invoke('attachments:discard', storageKey),
  loadAiConfig: () => ipcRenderer.invoke('ai:config:load'),
  saveAiConfig: (config) => ipcRenderer.invoke('ai:config:save', config),
  listChatSessions: (archived = false) => ipcRenderer.invoke('chat-sessions:list', archived),
  createChatSession: () => ipcRenderer.invoke('chat-sessions:create'),
  loadChatSession: (id) => ipcRenderer.invoke('chat-sessions:load', id),
  saveChatSession: (session) => ipcRenderer.invoke('chat-sessions:save', session),
  setChatSessionArchived: (id, archived) => ipcRenderer.invoke('chat-sessions:set-archived', id, archived),
  loadMemories: () => ipcRenderer.invoke('memories:load'),
  saveMemorySettings: (settings) => ipcRenderer.invoke('memories:save-settings', settings),
  createMemory: (input) => ipcRenderer.invoke('memories:create', input),
  updateMemory: (id, patch) => ipcRenderer.invoke('memories:update', id, patch),
  deleteMemory: (id) => ipcRenderer.invoke('memories:delete', id),
  saveUserProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  prepareDependencies: async (onProgress) => {
    const requestId = randomUUID()
    const listener = (_event: Electron.IpcRendererEvent, payload: { requestId: string; progress: SetupProgress }) => {
      if (payload.requestId === requestId) onProgress?.(payload.progress)
    }
    ipcRenderer.on('setup:progress', listener)
    try { return await ipcRenderer.invoke('setup:prepare', requestId) }
    finally { ipcRenderer.removeListener('setup:progress', listener) }
  },
  searchWatchItems: (query) => ipcRenderer.invoke('watchlist:search', query),
  addWatchItem: (code) => ipcRenderer.invoke('watchlist:add', code),
  removeWatchItem: (code) => ipcRenderer.invoke('watchlist:remove', code),
  scanWatchlist: (items) => ipcRenderer.invoke('watchlist:scan', items),
  updateVocSource: (id, patch) => ipcRenderer.invoke('voc:source:update', id, patch),
  openVocLogin: () => ipcRenderer.invoke('voc:browser:login'),
  recordTrade: (trade) => ipcRenderer.invoke('portfolio:record', trade),
  createHouseholdMember: (input) => ipcRenderer.invoke('household:member:create', input),
  createHouseholdAccount: (input) => ipcRenderer.invoke('household:account:create', input),
  updateHouseholdMember: (id, patch) => ipcRenderer.invoke('household:member:update', id, patch),
  updateHouseholdAccount: (id, patch) => ipcRenderer.invoke('household:account:update', id, patch),
  recordHouseholdTrade: (accountId, trade) => ipcRenderer.invoke('household:trade:record', accountId, trade),
  setStrategyStatus: (id, action) => ipcRenderer.invoke('strategy:set-status', id, action),
  rollbackStrategies: () => ipcRenderer.invoke('strategy:rollback'),
  installAutomations: () => ipcRenderer.invoke('automation:install'),
  restoreDefaultAutomations: () => ipcRenderer.invoke('automation:restore-defaults'),
  createAutomation: (input) => ipcRenderer.invoke('automation:create', input),
  updateAutomation: (id, input) => ipcRenderer.invoke('automation:update', id, input),
  deleteAutomation: (id) => ipcRenderer.invoke('automation:delete', id),
  setAutomationEnabled: (id, enabled) => ipcRenderer.invoke('automation:enabled', id, enabled),
  runAutomation: (id) => ipcRenderer.invoke('automation:run', id),
  connectFeishu: () => ipcRenderer.invoke('notifications:connect-feishu'),
  searchFeishuChats: (query) => ipcRenderer.invoke('notifications:search-feishu-chats', query),
  configureFeishuGroup: (chatId, name) => ipcRenderer.invoke('notifications:configure-feishu-group', chatId, name),
  getFeishuConversationStatus: () => ipcRenderer.invoke('notifications:conversation-status'),
  restartFeishuConversation: () => ipcRenderer.invoke('notifications:conversation-restart'),
  onFeishuConversationStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: FeishuConversationStatus) => listener(status)
    ipcRenderer.on('notifications:conversation-status-changed', handler)
    return () => ipcRenderer.removeListener('notifications:conversation-status-changed', handler)
  },
  completeFeishuAuthorization: (authorizationId) => ipcRenderer.invoke('notifications:complete-feishu-authorization', authorizationId),
  openFeishuAuthorization: (authorizationId) => ipcRenderer.invoke('notifications:open-feishu-authorization', authorizationId),
  cancelFeishuAuthorization: (authorizationId) => ipcRenderer.invoke('notifications:cancel-feishu-authorization', authorizationId),
  testFeishu: () => ipcRenderer.invoke('notifications:test-feishu'),
  desktopStatus: () => ipcRenderer.invoke('desktop:status'),
  installSwiftBar: () => ipcRenderer.invoke('desktop:install-swiftbar'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:status'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  restartToUpdate: () => ipcRenderer.invoke('updates:restart'),
  onUpdateStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AppUpdateStatus) => listener(status)
    ipcRenderer.on('updates:status-changed', handler)
    return () => ipcRenderer.removeListener('updates:status-changed', handler)
  },
  createStrategyCandidate: (config, prompt) => ipcRenderer.invoke('strategy:create-candidate', config, prompt),
  notify: (title, body) => ipcRenderer.invoke('system:notify', title, body),
  openPath: (path) => ipcRenderer.invoke('system:open-path', path),
  openExternal: (url) => ipcRenderer.invoke('system:open-external', url),
  platform: process.platform
}

contextBridge.exposeInMainWorld('desktopApi', api)
