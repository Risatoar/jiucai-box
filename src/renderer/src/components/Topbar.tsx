import { Bell, CheckCircle2, CircleHelp, Cloud, Database, Inbox, RefreshCw } from 'lucide-react'
import type { AppView, NotificationAuditEvent } from '../../../shared/types'
import { useState } from 'react'

const titles: Record<AppView, { title: string; subtitle: string }> = {
  chat: { title: '问问韭菜盒子', subtitle: '帮你看行情、持仓和风险' },
  portfolio: { title: '家庭持仓', subtitle: '按成员和账户独立记录已确认成交' },
  watchlist: { title: '我的关注', subtitle: '收藏的品种和 AI 发现的机会' },
  voc: { title: '场外情绪', subtitle: '重点博主的反向情绪风险因子' },
  strategies: { title: '交易规则', subtitle: '查看哪些规则正在使用' },
  automations: { title: '定时任务', subtitle: '盘前、盘中、盘后自动运行' },
  settings: { title: '设置', subtitle: '个人情况、提醒和数据' }
}

interface TopbarProps {
  view: AppView
  title?: string
  subtitle?: string
  loadedAt?: string
  refreshing: boolean
  onRefresh: () => void
  factConnected: boolean
  marketConnected: boolean
  notifications: NotificationAuditEvent[]
}

const notificationTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function Topbar({ view, title, subtitle, loadedAt, refreshing, onRefresh, factConnected, marketConnected, notifications }: TopbarProps) {
  const item = title ? { title, subtitle: subtitle || '' } : titles[view]
  const [panel, setPanel] = useState<'notifications' | 'help' | null>(null)
  const notificationCount = notifications.length
  return (
    <header className="topbar">
      <div className="topbar-title"><strong>{item.title}</strong><span>{item.subtitle}</span></div>
      <div className="topbar-status">
        <span className={factConnected ? 'source-chip verified' : 'source-chip'}><Database size={12} />{factConnected ? '交易记录已读取' : '交易记录未连接'}</span>
        <span className={marketConnected ? 'source-chip verified' : 'source-chip'}><Cloud size={12} />{marketConnected ? '行情已刷新' : '行情待刷新'}</span>
        <button className="icon-button refresh-button" title={loadedAt ? `上次刷新 ${loadedAt}` : '刷新数据'} onClick={onRefresh} type="button">
          <RefreshCw size={15} className={refreshing ? 'spinning' : ''} />
        </button>
        <button className="icon-button" aria-expanded={panel === 'notifications'} title="通知中心" onClick={() => setPanel(panel === 'notifications' ? null : 'notifications')} type="button"><Bell size={15} />{notificationCount > 0 && <i className="notification-count">{notificationCount > 99 ? '99+' : notificationCount}</i>}</button>
        <button className="icon-button" title="使用说明" onClick={() => setPanel(panel === 'help' ? null : 'help')} type="button"><CircleHelp size={15} /></button>
        {panel && <div className={`topbar-popover ${panel === 'notifications' ? 'notification-popover' : ''}`}>{panel === 'notifications' ? <>
          <div className="notification-header"><div><strong>通知中心</strong><span>{notificationCount} 条通知记录</span></div><small>最新优先</small></div>
          {notifications.length ? <div className="notification-list">{notifications.map((notification) => (
            <div className="notification-item" key={notification.id}>
              <span className={`notification-severity ${notification.severity}`} />
              <div><strong>{notification.title}</strong><span>{notificationTime(notification.sentAt)} · {notification.modeLabel}</span></div>
              <em className={notification.delivered ? 'delivered' : 'unconfirmed'} title={notification.delivered ? '飞书已收到' : '暂未确认飞书是否收到'}>{notification.delivered ? <><CheckCircle2 size={11} />已送达</> : '待确认'}</em>
            </div>
          ))}</div> : <div className="notification-empty"><Inbox size={22} /><strong>暂无通知</strong><span>出现需要你关注的变化后，这里会留下记录。</span></div>}
          <p className="notification-footnote">完整通知内容请到飞书查看。</p>
        </> : <><strong>请放心使用</strong><p>韭菜盒子只提供分析和提醒，不会替你操作券商。只有你确认成交后，持仓才会更新。</p></>}</div>}
      </div>
    </header>
  )
}
