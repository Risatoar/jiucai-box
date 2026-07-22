import { BellRing, Bot, Brain, Check, ChevronRight, Database, Download, ExternalLink, KeyRound, MessageCircle, Monitor, RefreshCw, Save, Search, Send, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AiConfig, AppUpdateStatus, DesktopIntegrationStatus, FeishuChat, FeishuChatSearchResult, FeishuConfigInput, FeishuConnectionResult, FeishuConversationStatus, UserProfile } from '../../../shared/types'
import { DEFAULT_AI_TIMEOUT_SECONDS, MAX_AI_TIMEOUT_SECONDS, MIN_AI_TIMEOUT_SECONDS, normalizeAiTimeoutSeconds } from '../../../shared/ai-config'
import { ProfileSettingsPanel } from './ProfileSettingsPanel'
import { MemorySettingsPanel } from './MemorySettingsPanel'
import { FeishuConversationPanel } from './FeishuConversationPanel'

type Tab = 'profile' | 'memory' | 'ai' | 'data' | 'notify' | 'desktop' | 'updates' | 'risk'
interface SettingsViewProps {
  initialTab?: Tab
  userProfile: UserProfile
  onUserProfile: (profile: UserProfile) => Promise<void>
  aiConfig: AiConfig
  onAiConfig: (config: AiConfig) => Promise<void>
  tradeMasterHome?: string
  factConnected: boolean
  discipline: string
  onConfirmNormalDiscipline: () => Promise<{ ok: boolean; error?: string }>
  notificationConfigured: boolean
  notificationConfig: FeishuConfigInput | null
  onRunDoctor: () => Promise<{ ok: boolean; output: string; error?: string }> | undefined
  onConnectFeishu: () => Promise<FeishuConnectionResult>
  onSearchFeishuChats: (query: string) => Promise<FeishuChatSearchResult>
  onConfigureFeishuGroup: (chatId: string, name: string) => Promise<FeishuConnectionResult>
  onGetFeishuConversationStatus: () => Promise<FeishuConversationStatus>
  onRestartFeishuConversation: () => Promise<FeishuConversationStatus>
  onFeishuConversationStatus: (listener: (status: FeishuConversationStatus) => void) => () => void
  onCompleteFeishuAuthorization: (authorizationId: string) => Promise<FeishuConnectionResult>
  onOpenFeishuAuthorization: (authorizationId: string) => Promise<boolean>
  onCancelFeishuAuthorization: (authorizationId: string) => Promise<boolean>
  onTestFeishu: () => Promise<{ ok: boolean; error?: string }>
  onDesktopStatus: () => Promise<DesktopIntegrationStatus>
  onInstallSwiftBar: () => Promise<{ ok: boolean; path?: string; error?: string }>
  onGetUpdateStatus: () => Promise<AppUpdateStatus>
  onCheckForUpdates: () => Promise<AppUpdateStatus>
  onRestartToUpdate: () => Promise<boolean>
  onUpdateStatus: (listener: (status: AppUpdateStatus) => void) => () => void
  onOpenExternal: (url: string) => Promise<boolean>
}

const nav = [
  { id: 'profile', label: '我的情况', icon: UserRound },
  { id: 'memory', label: '记忆', icon: Brain },
  { id: 'ai', label: 'AI 设置', icon: Bot }, { id: 'data', label: '交易数据', icon: Database },
  { id: 'notify', label: '飞书提醒', icon: BellRing }, { id: 'desktop', label: '电脑菜单栏', icon: Monitor },
  { id: 'updates', label: '应用更新', icon: RefreshCw },
  { id: 'risk', label: '风险与隐私', icon: ShieldCheck }
] as const

const maskedReceiver = (value: string) => value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value

export function SettingsView(props: SettingsViewProps) {
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'profile')
  const [draft, setDraft] = useState(props.aiConfig)
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState<'progress' | 'success' | 'error'>('progress')
  const [doctorState, setDoctorState] = useState('未运行')
  const [feishuAuthorization, setFeishuAuthorization] = useState<FeishuConnectionResult | null>(null)
  const [feishuBusy, setFeishuBusy] = useState<'connect' | 'complete' | 'search' | 'group' | 'test' | null>(null)
  const [feishuTarget, setFeishuTarget] = useState<'personal' | 'group'>(props.notificationConfig?.receiverType === 'chat_id' ? 'group' : 'personal')
  const [chatQuery, setChatQuery] = useState('')
  const [chatResults, setChatResults] = useState<FeishuChat[]>([])
  const [desktop, setDesktop] = useState<DesktopIntegrationStatus | null>(null)
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [disciplineBusy, setDisciplineBusy] = useState(false)
  const save = async () => {
    setMessage('')
    const normalized = { ...draft, timeoutSeconds: normalizeAiTimeoutSeconds(draft.timeoutSeconds) }
    setDraft(normalized)
    try { await props.onAiConfig(normalized); setSaved(true); window.setTimeout(() => setSaved(false), 1500) }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)) }
  }
  const runDoctor = async () => {
    setDoctorState('检查中…')
    const result = await props.onRunDoctor()
    setDoctorState(result?.ok ? '检查通过' : `检查失败：${result?.error || '桌面通道未连接'}`)
  }
  const applyFeishuConnectionResult = (result: FeishuConnectionResult, target: 'personal' | 'group' = 'personal') => {
    if (result.ok && result.status === 'connected') {
      setFeishuAuthorization(null)
      setMessageKind('success')
      setMessage(target === 'group' ? `提醒将发送到群聊「${result.displayName || '已选群聊'}」` : result.displayName ? `提醒将私聊发送给 ${result.displayName}` : '飞书个人提醒已连接')
      return
    }
    if (result.ok && result.status === 'authorization_required') {
      setFeishuAuthorization(result)
      setMessageKind('progress')
      setMessage('请使用飞书扫码完成授权')
      return
    }
    setMessageKind('error')
    setMessage(result.error || '连接飞书失败')
  }
  const connectFeishu = async () => {
    setFeishuTarget('personal')
    setFeishuBusy('connect')
    setMessageKind('progress')
    setMessage('正在连接飞书…')
    try {
      applyFeishuConnectionResult(await props.onConnectFeishu())
    } finally { setFeishuBusy(null) }
  }
  const searchChats = async () => {
    setFeishuBusy('search')
    setMessageKind('progress')
    setMessage('正在搜索机器人可发送的群聊…')
    try {
      const result = await props.onSearchFeishuChats(chatQuery)
      setChatResults(result.chats || [])
      setMessageKind(result.ok ? 'success' : 'error')
      setMessage(result.ok ? result.chats?.length ? `找到 ${result.chats.length} 个群聊，请选择接收提醒的群` : '没有找到匹配群聊，请换个群名，或确认机器人已加入该群' : result.error || '搜索群聊失败')
    } finally { setFeishuBusy(null) }
  }
  const configureGroup = async (chat: FeishuChat) => {
    setFeishuBusy('group')
    setMessageKind('progress')
    setMessage(`正在连接群聊「${chat.name}」…`)
    try { applyFeishuConnectionResult(await props.onConfigureFeishuGroup(chat.chatId, chat.name), 'group') }
    finally { setFeishuBusy(null) }
  }
  const completeFeishuAuthorization = async () => {
    const authorizationId = feishuAuthorization?.authorizationId
    if (!authorizationId) return
    setFeishuBusy('complete')
    setMessageKind('progress')
    setMessage('正在确认飞书授权…')
    try { applyFeishuConnectionResult(await props.onCompleteFeishuAuthorization(authorizationId)) }
    finally { setFeishuBusy(null) }
  }
  const cancelFeishuAuthorization = async () => {
    const authorizationId = feishuAuthorization?.authorizationId
    if (authorizationId) await props.onCancelFeishuAuthorization(authorizationId)
    setFeishuAuthorization(null)
    setMessage('')
  }
  const testFeishu = async () => {
    setFeishuBusy('test')
    setMessageKind('progress')
    setMessage('正在发送真实测试消息…')
    try {
      const result = await props.onTestFeishu()
      setMessageKind(result.ok ? 'success' : 'error')
      setMessage(result.ok ? '测试消息已发送，请在飞书中查看' : result.error || '测试失败')
    } finally { setFeishuBusy(null) }
  }
  const refreshDesktop = async () => setDesktop(await props.onDesktopStatus())
  useEffect(() => { if (tab === 'desktop') void refreshDesktop() }, [tab])
  useEffect(() => { setFeishuTarget(props.notificationConfig?.receiverType === 'chat_id' ? 'group' : 'personal') }, [props.notificationConfig?.receiverType])
  useEffect(() => {
    void props.onGetUpdateStatus().then(setUpdateStatus)
    return props.onUpdateStatus(setUpdateStatus)
  }, [])
  const checkUpdates = async () => {
    setUpdateBusy(true)
    try { setUpdateStatus(await props.onCheckForUpdates()) }
    finally { setUpdateBusy(false) }
  }
  const installBar = async () => {
    setMessage('正在安装 SwiftBar 脚本…')
    const result = await props.onInstallSwiftBar()
    setMessageKind(result.ok ? 'success' : 'error')
    setMessage(result.ok ? `已安装到 ${result.path}` : result.error || '安装失败')
    await refreshDesktop()
  }
  const confirmNormal = async () => {
    if (!window.confirm('确认你已经核对当前持仓、现金、冻结资金和活动委托，并恢复为正常交易状态？')) return
    setDisciplineBusy(true)
    setMessageKind('progress')
    setMessage('正在更新交易状态…')
    try {
      const result = await props.onConfirmNormalDiscipline()
      setMessageKind(result.ok ? 'success' : 'error')
      setMessage(result.ok ? '交易状态已恢复正常，原警戒记录已归档' : result.error || '交易状态更新失败')
    } finally { setDisciplineBusy(false) }
  }

  return <section className="content-view settings-view">
    <div className="view-heading"><div><h1>设置</h1><p>在这里修改个人情况、AI、交易数据和提醒方式。{message && <span className={`settings-message ${messageKind}`}> {message}</span>}</p></div>{tab === 'ai' && <button className="primary-button" onClick={() => void save()} type="button">{saved ? <Check size={15} /> : <Save size={15} />}{saved ? '已保存' : '保存 AI 设置'}</button>}</div>
    <div className="settings-layout">
      <div className="settings-nav">{nav.map((item) => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setMessage('') }} type="button"><Icon size={15} />{item.label}<ChevronRight size={14} /></button> })}</div>
      <div className="settings-content">
        {tab === 'profile' && <ProfileSettingsPanel profile={props.userProfile} onSave={props.onUserProfile} />}
        {tab === 'memory' && <MemorySettingsPanel />}
        {tab === 'ai' && <div className="setting-section">
          <div className="setting-title"><Bot size={16} /><div><strong>AI 连接方式</strong><span>大多数人使用默认设置即可。只有熟悉 AI 配置时才需要修改。</span></div></div>
          <div className="provider-options">{[{ id: 'codex-local', title: '使用本机 AI', desc: '使用这台电脑上已经登录的 Codex' }, { id: 'openai-compatible', title: '连接其他 AI 服务', desc: '适合已经有 API 地址和密钥的用户' }].map((provider) => <button key={provider.id} className={draft.provider === provider.id ? 'provider-card selected' : 'provider-card'} onClick={() => setDraft({ ...draft, provider: provider.id as AiConfig['provider'] })} type="button"><span className="radio-dot" /><div><strong>{provider.title}</strong><small>{provider.desc}</small></div></button>)}</div>
          {draft.provider === 'codex-local'
            ? <div className="form-grid"><label className="full"><span>Codex 程序位置（一般不用填）</span><input placeholder="留空即可自动查找" value={draft.codexPath || ''} onChange={(event) => setDraft({ ...draft, codexPath: event.target.value || undefined })} /></label></div>
            : <div className="form-grid"><label><span>服务地址（Base URL）</span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label><label><span>模型名称</span><input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label><label className="full"><span>访问密钥（API Key）</span><div className="input-with-icon"><KeyRound size={14} /><input type="password" value={draft.apiKey || ''} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} /></div></label></div>}
          <div className="form-grid ai-timeout-settings">
            <label>
              <span>模型响应超时（秒）</span>
              <input
                aria-describedby="ai-timeout-help"
                max={MAX_AI_TIMEOUT_SECONDS}
                min={MIN_AI_TIMEOUT_SECONDS}
                step={10}
                type="number"
                value={draft.timeoutSeconds ?? DEFAULT_AI_TIMEOUT_SECONDS}
                onChange={(event) => setDraft({ ...draft, timeoutSeconds: Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : undefined })}
              />
            </label>
            <small id="ai-timeout-help">超过该时间会停止本次 AI 任务。可设置 {MIN_AI_TIMEOUT_SECONDS}–{MAX_AI_TIMEOUT_SECONDS} 秒，默认 {DEFAULT_AI_TIMEOUT_SECONDS} 秒。</small>
          </div>
        </div>}
        {tab === 'data' && <div className="setting-section"><div className="setting-title"><Database size={16} /><div><strong>我的交易数据</strong><span>持仓、关注和交易规则都保存在这台电脑上。</span></div></div><div className="path-field"><code>{props.tradeMasterHome || '~/.trade-master'}</code><button onClick={() => props.tradeMasterHome && window.desktopApi?.openPath(props.tradeMasterHome)} type="button"><ExternalLink size={14} /></button></div><div className="connection-row"><span className={props.factConnected ? 'status-dot ok' : 'status-dot'} /><div><strong>{props.factConnected ? '已读取' : '未连接'}</strong><small>{doctorState}</small></div><button className="secondary-button" onClick={() => void runDoctor()} type="button">检查数据</button></div><div className="connection-row discipline-setting-row"><span className={`status-dot ${props.discipline === 'NORMAL' ? 'ok' : 'warning'}`} /><div><strong>交易状态 · {props.discipline === 'NORMAL' ? '正常' : props.discipline === 'CAUTION' ? '警戒' : props.discipline === 'COOLDOWN' ? '冷静期' : props.discipline === 'STOPPED' ? '已停手' : props.discipline}</strong><small>{props.discipline === 'NORMAL' ? '继续执行现有风险和策略闸门' : '复核账户信息后可由你明确恢复，历史记录会保留'}</small></div>{props.discipline !== 'NORMAL' && <button className="secondary-button" disabled={disciplineBusy} onClick={() => void confirmNormal()} type="button">{disciplineBusy ? '更新中…' : '复核后恢复正常'}</button>}</div></div>}
        {tab === 'notify' && <div className="setting-section">
          <div className="setting-title"><BellRing size={16} /><div><strong>飞书提醒</strong><span>有买卖机会、风险或任务故障时发送提醒。收到提醒不代表已经成交。</span></div></div>
          <div className={`feishu-connection ${props.notificationConfigured ? 'connected' : ''}`}>
            <div className="feishu-channel-icon">{props.notificationConfig?.receiverType === 'chat_id' ? <UsersRound size={18} /> : <MessageCircle size={18} />}</div>
            <div className="feishu-connection-copy">
              <div><strong>{props.notificationConfigured ? props.notificationConfig?.receiverType === 'chat_id' ? '飞书群聊提醒已连接' : '飞书个人提醒已连接' : '连接飞书接收提醒'}</strong>{props.notificationConfigured && <span className="connected-badge">已连接</span>}</div>
              <small>{props.notificationConfigured && props.notificationConfig ? `机器人发送 · ${props.notificationConfig.receiverType === 'chat_id' ? `群聊「${props.notificationConfig.receiverLabel || maskedReceiver(props.notificationConfig.receiverId)}」` : `发给我（${props.notificationConfig.receiverLabel || maskedReceiver(props.notificationConfig.receiverId)}）`}` : '选择发给自己或群聊，不需要填写 Open ID、Chat ID 等技术参数。'}</small>
            </div>
            <div className="heading-actions">
              {props.notificationConfigured
                ? <button className="primary-button" disabled={feishuBusy !== null} onClick={() => void testFeishu()} type="button"><Send size={14} />{feishuBusy === 'test' ? '发送中…' : '发送测试消息'}</button>
                : <button className="primary-button" disabled={feishuBusy !== null} onClick={() => void connectFeishu()} type="button"><MessageCircle size={14} />{feishuBusy === 'connect' ? '连接中…' : '连接飞书'}</button>}
              {props.notificationConfigured && props.notificationConfig?.receiverType !== 'chat_id' && <button className="secondary-button" disabled={feishuBusy !== null} onClick={() => void connectFeishu()} type="button"><RefreshCw size={14} />重新连接</button>}
            </div>
          </div>
          <div className="feishu-target-picker">
            <span>提醒发到哪里</span>
            <div className="feishu-target-options">
              <button className={feishuTarget === 'personal' ? 'selected' : ''} disabled={feishuBusy !== null} onClick={() => props.notificationConfig?.receiverType === 'user_id' ? setFeishuTarget('personal') : void connectFeishu()} type="button"><MessageCircle size={17} /><div><strong>发给我</strong><small>机器人私聊提醒当前飞书账号</small></div>{feishuTarget === 'personal' && <Check size={15} />}</button>
              <button className={feishuTarget === 'group' ? 'selected' : ''} disabled={feishuBusy !== null} onClick={() => setFeishuTarget('group')} type="button"><UsersRound size={17} /><div><strong>发到群聊</strong><small>搜索并选择机器人所在的群</small></div>{feishuTarget === 'group' && <Check size={15} />}</button>
            </div>
            {feishuTarget === 'group' && <div className="feishu-group-picker">
              <div className="feishu-group-search"><Search size={15} /><input aria-label="搜索飞书群聊" maxLength={64} placeholder="输入群聊名称，例如：交易提醒" value={chatQuery} onChange={(event) => setChatQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && chatQuery.trim()) void searchChats() }} /><button className="secondary-button" disabled={!chatQuery.trim() || feishuBusy !== null} onClick={() => void searchChats()} type="button">{feishuBusy === 'search' ? '搜索中…' : '搜索群聊'}</button></div>
              {chatResults.length > 0 && <div className="feishu-group-results">{chatResults.map((chat) => <button key={chat.chatId} disabled={feishuBusy !== null} onClick={() => void configureGroup(chat)} type="button"><span className="group-avatar"><UsersRound size={15} /></span><div><strong>{chat.name}</strong><small>{chat.description || (chat.external ? '外部群聊' : '飞书群聊')}</small></div><ChevronRight size={15} /></button>)}</div>}
              <small className="feishu-group-tip">仅展示机器人可见的群聊；如果搜不到，请先把机器人加入目标群。</small>
            </div>}
          </div>
          <FeishuConversationPanel getStatus={props.onGetFeishuConversationStatus} restart={props.onRestartFeishuConversation} onStatus={props.onFeishuConversationStatus} openExternal={props.onOpenExternal} />
          {feishuAuthorization?.status === 'authorization_required' && feishuAuthorization.authorizationId && <div className="feishu-authorization">
            <div className="feishu-qr">
              {feishuAuthorization.qrDataUrl ? <img alt="飞书授权二维码" src={feishuAuthorization.qrDataUrl} /> : <MessageCircle size={32} />}
            </div>
            <div className="feishu-auth-copy">
              <strong>用飞书扫码授权</strong>
              <span>授权后会自动识别当前账号，并把提醒发送到你的飞书私聊。</span>
              <div className="feishu-auth-actions">
                <button className="secondary-button" disabled={feishuBusy !== null} onClick={() => void props.onOpenFeishuAuthorization(feishuAuthorization.authorizationId!)} type="button"><ExternalLink size={14} />在浏览器打开</button>
                <button className="primary-button" disabled={feishuBusy !== null} onClick={() => void completeFeishuAuthorization()} type="button">{feishuBusy === 'complete' ? '确认中…' : '我已完成授权'}</button>
                <button className="text-button" disabled={feishuBusy !== null} onClick={() => void cancelFeishuAuthorization()} type="button">取消</button>
              </div>
            </div>
          </div>}
        </div>}
        {tab === 'desktop' && <div className="setting-section"><div className="setting-title"><Monitor size={16} /><div><strong>电脑菜单栏</strong><span>不用打开主窗口，也能快速查看行情和提醒。</span></div></div><div className="connection-row"><span className={desktop?.trayAvailable ? 'status-dot ok' : 'status-dot'} /><div><strong>韭菜盒子菜单</strong><small>{desktop?.trayAvailable ? '已随应用启动' : '当前不可用'}</small></div></div><div className="connection-row"><span className={desktop?.swiftBarInstalled ? 'status-dot ok' : 'status-dot'} /><div><strong>菜单栏行情</strong><small>{desktop?.swiftBarInstalled ? desktop.swiftBarPluginPath : '还没有安装菜单栏行情组件'}</small></div><button className="secondary-button" disabled={desktop?.swiftBarInstalled} onClick={() => void installBar()} type="button">{desktop?.swiftBarInstalled ? '已安装' : '安装'}</button></div></div>}
        {tab === 'updates' && <div className="setting-section update-settings"><div className="setting-title"><RefreshCw size={16} /><div><strong>应用更新</strong><span>启动后静默检查，新版本在后台准备完成后再提示重启。</span></div></div><div className="update-version-row"><div><span>当前版本</span><strong>v{updateStatus?.currentVersion || '—'}</strong></div>{updateStatus?.availableVersion && <div><span>可用版本</span><strong>v{updateStatus.availableVersion}</strong></div>}<span className={`update-state ${updateStatus?.state || 'idle'}`}>{updateStatus?.message || '正在读取版本信息'}</span></div><div className="update-actions">{updateStatus?.state === 'downloaded' ? <button className="primary-button" onClick={() => void props.onRestartToUpdate()} type="button"><Download size={15} />重启并完成更新</button> : <button className="secondary-button" disabled={updateBusy || updateStatus?.state === 'checking'} onClick={() => void checkUpdates()} type="button"><RefreshCw className={updateBusy ? 'spin' : ''} size={15} />{updateBusy ? '检查中…' : '检查更新'}</button>}<small>更新不会覆盖 ~/.trade-master 中的交易事实和设置。</small></div></div>}
        {tab === 'risk' && <div className="setting-section"><div className="setting-title"><ShieldCheck size={16} /><div><strong>安全规则</strong><span>这些规则不能被 AI 或定时任务修改。</span></div></div><ul className="risk-list"><li>不会连接券商帮你下单、撤单或改单。</li><li>AI 的建议不算成交，只有你确认后才会更新持仓。</li><li>交易记录对不上时，不会给出具体买卖数量。</li><li>新交易规则要先验证，修改前后的版本都会保留。</li><li>API Key 只保存在这台电脑上，不会写进对话或运行记录。</li></ul></div>}
      </div>
    </div>
  </section>
}
