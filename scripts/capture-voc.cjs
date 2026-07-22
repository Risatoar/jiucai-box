const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const projectRoot = join(__dirname, '..')
const outputRoot = process.env.JIUCAI_CAPTURE_HOME || '/tmp/jiucai-voc-captures'
const now = new Date().toISOString()
const olderAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
const sources = [
  { id: 'weibo-fengge', platform: 'weibo', displayName: '峰哥亡命天涯', handle: '峰哥亡命天涯', enabled: true, inverseWeight: .8, status: 'ready', profileUrl: 'https://weibo.com/u/example', lastCheckedAt: now },
  { id: 'douyin-wangxiaoyu', platform: 'douyin', displayName: '王小雨', handle: '王小雨', enabled: true, inverseWeight: .8, status: 'needs_binding' },
  { id: 'douyin-dazengzi', platform: 'douyin', displayName: '大曾子', handle: '大曾子', enabled: true, inverseWeight: .8, status: 'needs_binding' },
  { id: 'douyin-xianxian', platform: 'douyin', displayName: '闲闲', handle: '闲闲', enabled: true, inverseWeight: .8, status: 'needs_binding' },
  { id: 'douyin-xianxian-husband', platform: 'douyin', displayName: '闲闲老公', handle: '闲闲老公', enabled: true, inverseWeight: .8, status: 'needs_connector', profileUrl: 'https://www.douyin.com/user/example-husband' }
]
const report = {
  id: 'report-1', generatedAt: now, sourceIds: ['douyin-xianxian', 'douyin-xianxian-husband'], eventIds: ['event-1', 'event-2'],
  summary: '闲闲今天明确降低仓位并表示卖飞，闲闲老公则表示早上已经全清。反向情绪风险：短线情绪从恐慌卖出转向踏空焦虑，需要结合板块位置和量价确认。',
  trendSummary: { today: '闲闲从重仓降到轻仓后出现卖飞焦虑，闲闲老公早上清仓；其余账号今天没有明确仓位动作。', recent: '近7日闲闲先加仓后减仓，并从乐观转为踏空焦虑；闲闲老公最新清仓，整体出现追涨杀跌特征。' },
  positionActions: [
    { sourceId: 'douyin-xianxian', contentId: 'event-1', action: '减仓', positionAfter: '轻仓', occurredAt: now, sector: '科技', evidence: '今天割肉减仓了一半，现在只剩轻仓', confidence: '高' },
    { sourceId: 'douyin-xianxian', contentId: 'event-1', action: '卖飞', positionAfter: '轻仓', occurredAt: now, asset: '某科技股', evidence: '清没了，它却一飞冲天', confidence: '高' },
    { sourceId: 'douyin-xianxian-husband', contentId: 'event-2', action: '清仓', positionAfter: '空仓', occurredAt: now, sector: '大盘', evidence: '早上我全清了', confidence: '高' }
  ],
  sentimentObservations: [
    { sourceId: 'douyin-xianxian', contentId: 'event-1', sentiment: '踏空焦虑', occurredAt: now, evidence: '清没了，它却一飞冲天', confidence: '高' },
    { sourceId: 'douyin-xianxian-husband', contentId: 'event-2', sentiment: '谨慎', occurredAt: now, evidence: '没想到市场反弹', confidence: '中' }
  ]
}
const olderReport = { id: 'report-0', generatedAt: olderAt, sourceIds: ['douyin-xianxian'], eventIds: ['event-0'], summary: '闲闲加仓科技板块，情绪偏乐观。',
  positionActions: [{ sourceId: 'douyin-xianxian', contentId: 'event-0', action: '加仓', positionAfter: '重仓', occurredAt: olderAt, sector: '科技', evidence: '今天又加了一笔，现在仓位很重', confidence: '高' }],
  sentimentObservations: [{ sourceId: 'douyin-xianxian', contentId: 'event-0', sentiment: '乐观', occurredAt: olderAt, evidence: '继续看好科技行情', confidence: '中' }] }

const registerFixture = () => {
  ipcMain.handle('trade-master:load', () => ({
    home: '/tmp/visual-fixture', userProfile: { capital: 100000 }, portfolio: null, household: null, accountState: null,
    watchlist: { instruments: [] }, goals: {}, discipline: { state: 'NORMAL' }, strategyProfile: {}, evolution: null,
    notifications: null, automation: { install_status: 'installed', tasks: [{ id: 'voc_monitor', mode: 'voc_monitor', enabled: true, schedule: { kind: 'daily_window', interval_minutes: 2, windows: ['07:00-23:30'] } }] },
    strategies: { rules: [] }, strategyCandidates: [], strategyVersions: [], pausedStrategies: [], automationRuns: [], notificationAudit: null,
    voc: { schemaVersion: 1, home: '/tmp/visual-fixture/voc', sources, recentEvents: [
      { id: 'event-1', schemaVersion: 1, fingerprint: 'event-1', sourceId: 'douyin-xianxian', platform: 'douyin', contentId: 'event-1', publishedAt: now, capturedAt: now, url: 'https://example.com/1', mediaType: 'video', text: '#股票 踏空加卖飞4W，血压飙升' },
      { id: 'event-2', schemaVersion: 1, fingerprint: 'event-2', sourceId: 'douyin-xianxian-husband', platform: 'douyin', contentId: 'event-2', publishedAt: now, capturedAt: now, url: 'https://example.com/2', mediaType: 'video', transcript: '#股票 早上我全清了，没想到市场反弹' }
    ], recentReports: [report, olderReport], pendingInboxCount: 0, loadedAt: now, errors: [] }, loadedAt: now, errors: []
  }))
  ipcMain.handle('ai:config:load', () => ({ provider: 'codex-local', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' }))
  ipcMain.handle('chat-sessions:list', () => [])
  ipcMain.handle('chat-sessions:create', () => ({ id: 'capture', title: '新对话', createdAt: now, updatedAt: now, messageCount: 0, messages: [] }))
  ipcMain.handle('ai:chat:list-runs', () => [])
}

const capture = async () => {
  await mkdir(outputRoot, { recursive: true })
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, backgroundColor: '#f7f7f5', webPreferences: { preload: join(projectRoot, 'out/preload/index.mjs'), contextIsolation: true, sandbox: false } })
  await window.loadFile(join(projectRoot, 'out/renderer/index.html'), { search: 'skipOnboarding=1' })
  await new Promise((resolve) => setTimeout(resolve, 250))
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('场外情绪'))?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await writeFile(join(outputRoot, 'voc-desktop.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('监控设置'))?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await writeFile(join(outputRoot, 'voc-desktop-settings.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('监控设置'))?.click()`)
  const scrollMetrics = await window.webContents.executeJavaScript(`(() => { const root = document.querySelector('.voc-view'); if (!root) return null; root.scrollTop = root.scrollHeight; return { clientHeight: root.clientHeight, scrollHeight: root.scrollHeight, scrollTop: root.scrollTop }; })()`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await writeFile(join(outputRoot, 'voc-scrolled-bottom.png'), (await window.webContents.capturePage()).toPNG())
  await writeFile(join(outputRoot, 'voc-scroll-metrics.json'), JSON.stringify(scrollMetrics, null, 2))
  await window.webContents.executeJavaScript(`document.querySelector('.voc-view')?.scrollTo({ top: 0 })`)
  window.setSize(1100, 720)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await writeFile(join(outputRoot, 'voc-compact.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`document.querySelector('.voc-insight-brief')?.scrollIntoView({ block: 'start' })`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await writeFile(join(outputRoot, 'voc-compact-summary.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`document.querySelector('.voc-trends')?.scrollIntoView({ block: 'start' })`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await writeFile(join(outputRoot, 'voc-compact-trends.png'), (await window.webContents.capturePage()).toPNG())
  const evidenceOpened = await window.webContents.executeJavaScript(`(() => { const button = document.querySelector('.voc-inference button'); if (!button) return false; button.click(); return true })()`)
  if (!evidenceOpened) throw new Error('没有找到可点击的仓位方向标签')
  await new Promise((resolve) => setTimeout(resolve, 180))
  const evidenceText = await window.webContents.executeJavaScript(`document.querySelector('.voc-tag-evidence')?.textContent || ''`)
  if (!evidenceText.includes('判断依据') || !evidenceText.includes('查看原始内容')) throw new Error(`仓位依据面板内容不完整：${evidenceText}`)
  await writeFile(join(outputRoot, 'voc-tag-evidence.png'), (await window.webContents.capturePage()).toPNG())
  await window.webContents.executeJavaScript(`document.querySelector('.voc-reports')?.scrollIntoView({ block: 'start' })`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await writeFile(join(outputRoot, 'voc-compact-actions.png'), (await window.webContents.capturePage()).toPNG())
  console.log(outputRoot, JSON.stringify(scrollMetrics))
  window.destroy(); app.quit()
}

app.whenReady().then(() => { registerFixture(); return capture() }).catch((error) => { console.error(error); app.exit(1) })
