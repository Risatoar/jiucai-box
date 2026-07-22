import type { AiConfig, AiMessageInput, AppUpdateStatus, AttachmentInput, AutomationRun, ChatAttachment, ChatRunChangedEvent, ChatRunSnapshot, ChatSession, ChatSessionSummary, DesktopIntegrationStatus, FeishuChatSearchResult, FeishuConnectionResult, FeishuConversationStatus, HouseholdAccount, HouseholdAccountInput, HouseholdMember, HouseholdMemberInput, Instrument, MarketAiInsight, MarketInsightRequest, MemoryInput, MemoryItem, MemorySettings, MemorySnapshot, SetupProgress, SetupResult, StrategyMutationResult, TradeMasterSnapshot, TradeRecordInput, UserProfile, VocSource, WatchItem } from './types'
import type { AutomationTaskInput } from './automation-schedule'
import type { PositionStrategyAnalysis, PositionStrategyRequest } from './position-strategy'

export interface DesktopApi {
  loadSnapshot: () => Promise<TradeMasterSnapshot>
  confirmNormalDiscipline: () => Promise<{ ok: boolean; discipline?: unknown; error?: string }>
  runTradeMaster: (command: string, args?: string[]) => Promise<{ ok: boolean; output: string; error?: string }>
  chat: (config: AiConfig, sessionId: string, messages: AiMessageInput[]) => Promise<{ ok: boolean; content: string; messageId?: string; cancelled?: boolean; error?: string }>
  listChatRuns: () => Promise<ChatRunSnapshot[]>
  cancelChat: (sessionId: string) => Promise<boolean>
  onChatRunChanged: (listener: (event: ChatRunChangedEvent) => void) => () => void
  extractMemories: (config: AiConfig, sessionId: string, messages: AiMessageInput[]) => Promise<{ ok: boolean; added?: number; error?: string }>
  analyzeMarketInsight: (request: MarketInsightRequest) => Promise<{ ok: boolean; insight?: MarketAiInsight; error?: string }>
  analyzePositionStrategy: (request: PositionStrategyRequest) => Promise<{ ok: boolean; analysis?: PositionStrategyAnalysis; cached?: boolean; stale?: boolean; warning?: string; error?: string }>
  pickAttachments: (sessionId: string) => Promise<{ ok: boolean; attachments?: ChatAttachment[]; error?: string }>
  saveClipboardAttachment: (sessionId: string, input: AttachmentInput) => Promise<{ ok: boolean; attachment?: ChatAttachment; error?: string }>
  discardAttachment: (storageKey: string) => Promise<boolean>
  loadAiConfig: () => Promise<AiConfig>
  saveAiConfig: (config: AiConfig) => Promise<AiConfig>
  listChatSessions: (archived?: boolean) => Promise<ChatSessionSummary[]>
  createChatSession: () => Promise<ChatSession>
  loadChatSession: (id: string) => Promise<ChatSession>
  saveChatSession: (session: ChatSession) => Promise<ChatSession>
  setChatSessionArchived: (id: string, archived: boolean) => Promise<ChatSession>
  onChatSessionChanged: (listener: (session: ChatSessionSummary) => void) => () => void
  loadMemories: () => Promise<MemorySnapshot>
  saveMemorySettings: (settings: MemorySettings) => Promise<MemorySettings>
  createMemory: (input: MemoryInput) => Promise<MemoryItem>
  updateMemory: (id: string, patch: Partial<MemoryInput>) => Promise<MemoryItem>
  deleteMemory: (id: string) => Promise<boolean>
  saveUserProfile: (profile: UserProfile) => Promise<UserProfile>
  prepareDependencies: (onProgress?: (progress: SetupProgress) => void) => Promise<SetupResult>
  searchWatchItems: (query: string) => Promise<{ ok: boolean; items?: Instrument[]; error?: string }>
  addWatchItem: (code: string) => Promise<{ ok: boolean; error?: string }>
  removeWatchItem: (code: string) => Promise<{ ok: boolean; error?: string }>
  scanWatchlist: (items?: WatchItem[]) => Promise<{ ok: boolean; added?: number; updated?: number; removed?: number; active?: number; reviewed?: number; analyzed?: number; scanned?: number; enriched?: number; durationMs?: number; aiDurationMs?: number; sources?: string[]; error?: string }>
  updateVocSource: (id: string, patch: Pick<VocSource, 'profileUrl' | 'enabled'>) => Promise<{ ok: boolean; source?: VocSource; error?: string }>
  openVocLogin: () => Promise<{ ok: boolean; error?: string }>
  recordTrade: (trade: TradeRecordInput) => Promise<{ ok: boolean; error?: string }>
  createHouseholdMember: (input: HouseholdMemberInput) => Promise<{ ok: boolean; member?: HouseholdMember; error?: string }>
  createHouseholdAccount: (input: HouseholdAccountInput) => Promise<{ ok: boolean; account?: HouseholdAccount; error?: string }>
  updateHouseholdMember: (id: string, patch: Partial<Pick<HouseholdMember, 'name' | 'relationship' | 'riskProfile' | 'monitoringEnabled'>>) => Promise<{ ok: boolean; member?: HouseholdMember; error?: string }>
  updateHouseholdAccount: (id: string, patch: Partial<Pick<HouseholdAccount, 'name' | 'broker' | 'totalAsset' | 'monitoringEnabled'>>) => Promise<{ ok: boolean; account?: HouseholdAccount; error?: string }>
  recordHouseholdTrade: (accountId: string, trade: TradeRecordInput) => Promise<{ ok: boolean; error?: string }>
  setStrategyStatus: (id: string, action: 'pause' | 'enable' | 'promote') => Promise<StrategyMutationResult>
  rollbackStrategies: () => Promise<{ ok: boolean; error?: string }>
  installAutomations: () => Promise<{ ok: boolean; error?: string }>
  restoreDefaultAutomations: () => Promise<{ ok: boolean; error?: string }>
  createAutomation: (input: AutomationTaskInput) => Promise<{ ok: boolean; id?: string; error?: string }>
  updateAutomation: (id: string, input: AutomationTaskInput) => Promise<{ ok: boolean; error?: string }>
  deleteAutomation: (id: string) => Promise<{ ok: boolean; error?: string }>
  setAutomationEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  runAutomation: (id: string) => Promise<{ ok: boolean; run?: AutomationRun; error?: string }>
  connectFeishu: () => Promise<FeishuConnectionResult>
  searchFeishuChats: (query: string) => Promise<FeishuChatSearchResult>
  configureFeishuGroup: (chatId: string, name: string) => Promise<FeishuConnectionResult>
  getFeishuConversationStatus: () => Promise<FeishuConversationStatus>
  restartFeishuConversation: () => Promise<FeishuConversationStatus>
  onFeishuConversationStatus: (listener: (status: FeishuConversationStatus) => void) => () => void
  completeFeishuAuthorization: (authorizationId: string) => Promise<FeishuConnectionResult>
  openFeishuAuthorization: (authorizationId: string) => Promise<boolean>
  cancelFeishuAuthorization: (authorizationId: string) => Promise<boolean>
  testFeishu: () => Promise<{ ok: boolean; error?: string }>
  desktopStatus: () => Promise<DesktopIntegrationStatus>
  installSwiftBar: () => Promise<{ ok: boolean; path?: string; error?: string }>
  getUpdateStatus: () => Promise<AppUpdateStatus>
  checkForUpdates: () => Promise<AppUpdateStatus>
  restartToUpdate: () => Promise<boolean>
  onUpdateStatus: (listener: (status: AppUpdateStatus) => void) => () => void
  createStrategyCandidate: (config: AiConfig, prompt: string) => Promise<{ ok: boolean; file?: string; candidate?: unknown; error?: string }>
  importStrategyCandidate: (raw: string) => Promise<{ ok: boolean; file?: string; candidate?: unknown; error?: string }>
  notify: (title: string, body: string) => Promise<boolean>
  openPath: (path: string) => Promise<string>
  openExternal: (url: string) => Promise<boolean>
  platform: string
}
