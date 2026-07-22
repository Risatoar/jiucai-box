import { CheckCircle2, ChevronDown, ExternalLink, MessagesSquare, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FeishuConversationStatus } from '../../../shared/types'

interface FeishuConversationPanelProps {
  getStatus: () => Promise<FeishuConversationStatus>
  restart: () => Promise<FeishuConversationStatus>
  onStatus: (listener: (status: FeishuConversationStatus) => void) => () => void
  openExternal: (url: string) => Promise<boolean>
}

const statusLabel: Record<FeishuConversationStatus['state'], string> = {
  stopped: '未运行',
  starting: '连接中',
  running: '运行中',
  error: '需要处理'
}

const FEISHU_CONSOLE = 'https://open.feishu.cn/app'
const LONG_CONNECTION_DOC = 'https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case'

export function FeishuConversationPanel(props: FeishuConversationPanelProps) {
  const [status, setStatus] = useState<FeishuConversationStatus>({ state: 'starting', detail: '正在读取状态…', processedMessages: 0 })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void props.getStatus().then(setStatus)
    return props.onStatus(setStatus)
  }, [props.getStatus, props.onStatus])
  const restart = async () => {
    setBusy(true)
    try { setStatus(await props.restart()) }
    finally { setBusy(false) }
  }
  const open = (url: string) => void props.openExternal(url)

  return <div className="feishu-conversation-panel">
    <div className="feishu-conversation-status">
      <span className={`conversation-state-icon ${status.state}`}><MessagesSquare size={18} /></span>
      <div className="conversation-status-copy">
        <div><strong>飞书双向对话</strong><span className={`conversation-state ${status.state}`}>{statusLabel[status.state]}</span></div>
        <small>{status.detail}</small>
        {status.lastMessageAt && <small>最近处理：{new Date(status.lastMessageAt).toLocaleString('zh-CN')} · 累计 {status.processedMessages} 条</small>}
      </div>
      <button className="secondary-button" disabled={busy || status.state === 'starting'} onClick={() => void restart()} type="button"><RefreshCw className={busy ? 'spin' : ''} size={14} />{busy ? '重连中…' : '重新连接'}</button>
    </div>
    <div className="feishu-conversation-rules">
      <span><CheckCircle2 size={13} />私聊机器人，直接提问</span>
      <span><CheckCircle2 size={13} />群聊中 @机器人 后提问</span>
      <span><ShieldCheck size={13} />只分析和提醒，不执行交易</span>
    </div>
    <details className="feishu-setup-guide">
      <summary><span>飞书应用后台配置指南</span><small>首次接入或状态异常时查看</small><ChevronDown size={15} /></summary>
      <div className="feishu-guide-body">
        <ol>
          <li><strong>启用机器人</strong><span>打开飞书开发者后台，进入企业自建应用，在「应用能力」中启用机器人。</span></li>
          <li><strong>添加权限</strong><span>在「权限管理」中申请下面 4 项权限。</span><div className="permission-chips"><code>im:message.p2p_msg:readonly</code><code>im:message.group_at_msg:readonly</code><code>im:message:send_as_bot</code><code>im:chat:read</code></div></li>
          <li><strong>订阅消息事件</strong><span>进入「事件与回调 → 事件配置」，选择「使用长连接接收事件」，添加「接收消息」事件：</span><code className="event-code">im.message.receive_v1</code></li>
          <li><strong>设置可用范围</strong><span>把需要私聊机器人的成员加入应用可用范围，并将机器人加入需要对话的群聊。</span></li>
          <li><strong>发布生效</strong><span>创建应用版本并发布；如果企业开启了审核，需要管理员审批后权限和事件才会生效。</span></li>
          <li><strong>连接本应用</strong><span>回到本页连接飞书。运维首次配置凭证时，在本机执行 <code>lark-cli config init --new</code>，App ID 和 App Secret 可在「凭证与基础信息」中找到。</span></li>
        </ol>
        <div className="feishu-guide-actions">
          <button className="primary-button" onClick={() => open(FEISHU_CONSOLE)} type="button"><ExternalLink size={14} />打开飞书开发者后台</button>
          <button className="secondary-button" onClick={() => open(LONG_CONNECTION_DOC)} type="button"><ExternalLink size={14} />查看长连接文档</button>
        </div>
      </div>
    </details>
  </div>
}
