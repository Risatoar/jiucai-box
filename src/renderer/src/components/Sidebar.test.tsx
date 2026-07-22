import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatSessionSummary } from '../../../shared/types'
import { Sidebar } from './Sidebar'

const sessions: ChatSessionSummary[] = [
  { id: 'busy-session', title: '正在生成的会话', createdAt: '2026-07-20T10:00:00.000Z', updatedAt: '2026-07-20T10:01:00.000Z', messageCount: 2 },
  { id: 'automation-intraday', title: '盘中盯盘 · 定时任务', createdAt: '2026-07-20T09:30:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z', messageCount: 12 },
  { id: 'idle-session', title: '普通会话', createdAt: '2026-07-20T09:00:00.000Z', updatedAt: '2026-07-20T09:01:00.000Z', messageCount: 4 }
]

describe('Sidebar conversation status', () => {
  it('只为正在生成的会话展示 loading 图标', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        collapsed={false}
        onCollapsed={() => undefined}
        activeView="chat"
        onNavigate={() => undefined}
        discipline="CAUTION"
        sessions={sessions}
        archivedSessions={[]}
        busySessionIds={new Set(['busy-session'])}
        unreadSessionIds={new Set(['busy-session', 'idle-session'])}
        activeSessionId="idle-session"
        onNewConversation={() => undefined}
        onSelectConversation={() => undefined}
        onArchiveConversation={async () => undefined}
        onRestoreConversation={async () => undefined}
        factConnected
        notificationConnected={false}
        automationReady={false}
      />
    )

    expect(html.match(/conversation-loading/g)).toHaveLength(1)
    expect(html.match(/conversation-unread/g)).toHaveLength(1)
    expect(html).toContain('aria-label="正在思考"')
    expect(html).toContain('aria-label="有未读回复"')
    expect(html.indexOf('正在生成的会话')).toBeLessThan(html.indexOf('conversation-loading'))
    expect(html.indexOf('conversation-loading')).toBeLessThan(html.indexOf('普通会话'))
    expect(html.indexOf('普通会话')).toBeLessThan(html.indexOf('盘中盯盘 · 定时任务'))
    expect(html).toContain('aria-controls="recent-conversations"')
    expect(html).toContain('aria-controls="automation-conversations"')
    expect(html).toContain('最近对话')
    expect(html).toContain('定时任务')
    expect(html).toContain('data-preview-session-id="busy-session"')
    expect(html).toContain('data-preview-session-id="idle-session"')
    expect(html).toContain('aria-label="查看已归档会话"')
    expect(html.match(/conversation-more/g)).toHaveLength(2)
  })
})
