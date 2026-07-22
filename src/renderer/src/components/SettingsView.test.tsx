import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AiConfig, AppUpdateStatus, UserProfile } from '../../../shared/types'
import { SettingsView } from './SettingsView'

const profile: UserProfile = {
  capital: 10000,
  styles: ['波段'],
  experience: '1年以内',
  maxDrawdown: 8,
  targetReturn: 20,
  targetMonths: 12,
  instruments: ['stock'],
  tradingHabits: ['只看关键提醒']
}

const updateStatus: AppUpdateStatus = { state: 'idle', currentVersion: '0.1.0', message: '已是最新版本' }
const noop = async () => undefined

const renderSettings = (configured: boolean, group = false, initialTab: 'notify' | 'data' | 'ai' = 'notify', aiConfig: AiConfig = { provider: 'codex-local', baseUrl: '', model: '', timeoutSeconds: 120 }) => renderToStaticMarkup(<SettingsView
  initialTab={initialTab}
  userProfile={profile}
  onUserProfile={async () => undefined}
  aiConfig={aiConfig}
  onAiConfig={noop}
  factConnected
  discipline="CAUTION"
  onConfirmNormalDiscipline={async () => ({ ok: true })}
  notificationConfigured={configured}
  notificationConfig={configured ? group ? { receiverType: 'chat_id', receiverId: 'oc_trading', receiverLabel: '交易提醒群', identity: 'bot', duplicateWindowMinutes: 60 } : { receiverType: 'user_id', receiverId: 'ou_current_user', identity: 'bot', duplicateWindowMinutes: 60 } : null}
  onRunDoctor={() => Promise.resolve({ ok: true, output: '' })}
  onConnectFeishu={async () => ({ ok: true, status: 'connected' })}
  onSearchFeishuChats={async () => ({ ok: true, chats: [] })}
  onConfigureFeishuGroup={async () => ({ ok: true, status: 'connected' })}
  onGetFeishuConversationStatus={async () => ({ state: 'running', detail: '私聊直接回答；群聊仅在 @机器人 时回答', processedMessages: 0 })}
  onRestartFeishuConversation={async () => ({ state: 'running', detail: '已连接', processedMessages: 0 })}
  onFeishuConversationStatus={() => () => undefined}
  onCompleteFeishuAuthorization={async () => ({ ok: true, status: 'connected' })}
  onOpenFeishuAuthorization={async () => true}
  onCancelFeishuAuthorization={async () => true}
  onTestFeishu={async () => ({ ok: true })}
  onDesktopStatus={async () => ({ trayAvailable: true, notificationsAvailable: true, swiftBarInstalled: false, swiftBarPluginPath: '' })}
  onInstallSwiftBar={async () => ({ ok: true })}
  onGetUpdateStatus={async () => updateStatus}
  onCheckForUpdates={async () => updateStatus}
  onRestartToUpdate={async () => true}
  onUpdateStatus={() => () => undefined}
  onOpenExternal={async () => true}
/>)

describe('SettingsView 飞书连接', () => {
  it('keeps technical notification fields out of the non-technical flow', () => {
    const html = renderSettings(false)
    expect(html).not.toContain('用户 Open ID')
    expect(html).not.toContain('lark-cli 路径')
    expect(html).not.toContain('相同内容去重')
    expect(html).toContain('发给我')
    expect(html).toContain('发到群聊')
    expect(html).toContain('飞书双向对话')
    expect(html).toContain('群聊中 @机器人 后提问')
    expect(html).toContain('飞书应用后台配置指南')
    expect(html).toContain('im.message.receive_v1')
  })

  it('shows the configured group and a searchable group picker', () => {
    const html = renderSettings(true, true)
    expect(html).toContain('飞书群聊提醒已连接')
    expect(html).toContain('交易提醒群')
    expect(html).toContain('输入群聊名称')
    expect(html).not.toContain('Chat ID')
  })
})

describe('SettingsView 交易状态', () => {
  it('shows an explicit recovery action for a caution state', () => {
    const html = renderSettings(false, false, 'data')
    expect(html).toContain('交易状态 · 警戒')
    expect(html).toContain('复核后恢复正常')
    expect(html).toContain('历史记录会保留')
  })
})

describe('SettingsView AI 设置', () => {
  it('shows a configurable model timeout with the 120 second default', () => {
    const html = renderSettings(false, false, 'ai')
    expect(html).toContain('模型响应超时（秒）')
    expect(html).toContain('value="120"')
    expect(html).toContain('默认 120 秒')
  })
})
