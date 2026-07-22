const { app, BrowserWindow, ipcMain } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const projectRoot = join(__dirname, '..')
const outputRoot = process.env.JIUCAI_CAPTURE_HOME || '/tmp/jiucai-box-captures'
let captureUserProfile = { capital: 200000, styles: ['短线', '波段'], experience: '3-5年', maxDrawdown: 12, targetReturn: 25, targetMonths: 12, instruments: ['stock', 'etf'], tradingHabits: ['只看关键提醒', '容易追涨'] }

const captureBars = (period) => Array.from({ length: period === '1d' ? 120 : 180 }, (_, index) => {
  const center = 4.08 + Math.sin(index / 8) * 0.055 + index * 0.0007
  const open = center + Math.sin(index * 1.7) * 0.012
  const close = center + Math.cos(index * 1.3) * 0.014
  const date = new Date('2026-07-20T01:30:00.000Z')
  date.setUTCMinutes(date.getUTCMinutes() + index * (period === '15m' ? 15 : period === '1d' ? 1440 : 5))
  return {
    time: date.toISOString(), open, close,
    high: Math.max(open, close) + 0.012,
    low: Math.min(open, close) - 0.011,
    volume: 1_500_000 + (index % 17) * 130_000,
    amount: null,
    closed: index < 179
  }
})

const registerCaptureFixture = () => {
  if (process.env.JIUCAI_CAPTURE_FIXTURE !== '1') return
  const captureSession = {
    id: 'capture', title: '帮我看看现在的持仓安全吗', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 24,
    messages: [
      { id: 'capture-user', role: 'user', content: '我把今天的持仓和交易记录放进来了，帮我看看现在安全吗？', timestamp: '19:42', attachments: [{ id: 'capture-position', name: '持仓截图.png', mimeType: 'image/png', size: 142000, kind: 'file', storageKey: 'capture/position.png' }] },
      { id: 'capture-assistant', role: 'assistant', content: '结论：沪深 300 ETF 的闭合结构和量能已经确认，出现相对明确的条件买点。', timestamp: '19:43', stockStrategyCards: [{ code: '510300', name: '沪深300ETF', exchange: 'SH', instrumentType: 'etf', currentPrice: '4.168', changePercent: '+0.68%', signal: 'strong_buy', stance: '可关注', summary: '5分钟与15分钟闭合结构、独立量能同时确认，进入人工复核。', strategy: '先核对账户、纪律、费用和现金安全垫，再决定是否分批执行。', buyPoints: [{ label: '确认买点', price: '4.16-4.18', condition: '回踩不破均价线，且下一根完整5分钟K线继续保持量能' }], sellPoints: [], support: '4.12', resistance: '4.25', stopLoss: '4.08', invalidation: '有效跌破 4.08 后，本次买点失效。', risks: ['不得追价', '账户执行条件仍需人工核对'], evidence: ['5分钟与15分钟闭合结构确认', '独立量能达到阈值'], nextCheck: '下一根 5 分钟 K 线收盘后', confidence: '高', dataAsOf: '10:15' }], attachments: [{ id: 'capture-review', name: '今日复盘.pdf', mimeType: 'application/pdf', size: 68000, kind: 'file', storageKey: 'capture/review.pdf' }] },
      { id: 'capture-user-2', role: 'user', content: '那今天收盘前，我应该重点看什么？', timestamp: '19:47', attachments: [{ id: 'capture-note', name: '收盘检查.txt', mimeType: 'text/plain', size: 1200, kind: 'file', storageKey: 'capture/closing-check.txt' }] },
      { id: 'capture-assistant-2', role: 'assistant', content: '收盘前看两件事就够了：价格有没有跌破今天的低点，成交量有没有突然放大。两项都没有出现，就继续持有观察。', timestamp: '19:48' },
      { id: 'capture-user-3', role: 'user', content: '如果跌破了，要一次全部卖掉吗？', timestamp: '19:51' },
      { id: 'capture-assistant-3', role: 'assistant', content: '不建议因为一次短暂跌破就全部卖掉。先确认是不是连续 5 分钟都在关键价格下面，再按你能接受的亏损分批处理。', timestamp: '19:52' },
      { id: 'capture-user-4', role: 'user', content: '帮我把今天的结论整理成一份复盘。', timestamp: '19:56' },
      { id: 'capture-assistant-4', role: 'assistant', content: '今天的结论：仓位安全，暂时不需要卖出；收盘前观察今天低点和成交量；出现 5 分钟有效跌破后，再考虑分批降低仓位。', timestamp: '19:57' },
      ...Array.from({ length: 8 }, (_, index) => [
        { id: `capture-user-${index + 5}`, role: 'user', content: `继续确认第 ${index + 5} 项交易计划。`, timestamp: `20:${String(index * 2 + 1).padStart(2, '0')}` },
        { id: `capture-assistant-${index + 5}`, role: 'assistant', content: '已核对，没有出现新的风险，继续按原计划观察。', timestamp: `20:${String(index * 2 + 2).padStart(2, '0')}` }
      ]).flat(),
      { id: 'capture-review-final-user', role: 'user', content: '最后帮我整理成可以直接看的行动结论。', timestamp: '20:35' },
      { id: 'capture-review-final', role: 'assistant', timestamp: '20:36', content: `结论：当前仓位风险可控，收盘前继续持有观察，不追涨。

触发条件：
- 完整 5 分钟 K 线重新放量站稳 4.18，再进入人工复核
- 成交量不能明显弱于上午均值

风险：
- 有效跌破 4.08 后，本次判断失效
- 临近收盘突然放量下跌，需要优先保护本金

市场走势与异动：
- 股票中位数仍偏弱，指数反弹不能代表个股风险解除
- ETF 整体强于个股，但当前位置不适合追涨
- 可转债波动扩大，只保留完整结构确认后的候选
- 上午没有出现可以直接执行的新开仓机会
- 已发现候选继续留在下午重评估名单
- 所有盘中信号仍需人工核对账户与成交条件

下一步：
1. 收盘前检查今天低点和成交量
2. 收盘后核对账户可用数量
3. 明早开盘前刷新持仓事实` }
    ]
  }
  if (process.env.JIUCAI_CAPTURE_STOCK_FALLBACK === '1') {
    captureSession.messages.push(
      { id: 'capture-review-user', role: 'user', content: '帮我复盘今天的买卖', timestamp: '20:43' },
      { id: 'capture-review-assistant', role: 'assistant', timestamp: '20:44', content: `结论：今天只确认了 1 笔卖出，没有确认买入。

华峰转债（118071）10张，于开盘以188.76元全部卖出。目前持仓0张，已经结束。

5. 下一步

今天不再因为华峰转债继续上涨而买回。

- 触发：没有买回触发条件，后续只能作为一笔全新的交易重新评估。
- 失效：看到上涨就追、只看1分钟快速拉升，或买后现金低于3060元，都直接放弃。
- 成本状态：华峰转债本次手续费需要确认。
- 下一检查点：今晚查看券商成交明细。` }
    )
    captureSession.messageCount = captureSession.messages.length
  }
  const secondarySession = {
    id: 'capture-secondary', title: '明天盘前检查清单', createdAt: new Date(Date.now() - 3_600_000).toISOString(), updatedAt: new Date(Date.now() - 3_600_000).toISOString(), messageCount: 2,
    messages: [{ id: 'capture-secondary-user', role: 'user', content: '明天盘前需要核对什么？', timestamp: '18:42' }]
  }
  const multiAccountSession = {
    id: 'capture-multi-account', title: '分别看看两个账户', createdAt: new Date(Date.now() - 3_000_000).toISOString(), updatedAt: new Date(Date.now() - 90_000).toISOString(), messageCount: 2,
    messages: [
      { id: 'capture-multi-account-user', role: 'user', content: '分别看看我和老婆的账户，下午怎么处理？', timestamp: '11:30' },
      { id: 'capture-multi-account-assistant', role: 'assistant', timestamp: '11:31', content: `结论：两个账户的风险预算和持仓事实不同，必须分别处理。

## 我 → 我的主账户
- 现金 7580 元，159516 和 118071 已清仓，不能重复计算为持仓
- 下午继续空仓观察，不追涨；只有完整 15 分钟结构确认后再人工复核
- 当前没有买入或卖出动作

## 老婆 → 老婆的账户
- 鹏辉能源 300 股，可用数量 300 股；午盘价格 56.73 元
- 成交和成本变化尚未核对完，不追加减仓数量，也不补仓
- 下午先看 56.20 元观察位，完整 15 分钟确认后再给独立策略

风险与下一检查点：
- 不得用主账户现金替老婆账户计算仓位
- 13:15 检查两个账户各自的完整 15 分钟走势`, stockStrategyCards: [
        { code: '300438', name: '鹏辉能源', exchange: 'SZ', instrumentType: 'stock', accountScope: '我 → 我的主账户', currentPrice: '56.73', changePercent: '-1.82%', signal: 'none', stance: '未持仓观察', summary: '主账户当前未持有，不得借用老婆账户的持仓事实生成卖出动作。', strategy: '仅观察完整 15 分钟结构，不追涨、不代替另一账户计算仓位。', buyPoints: [], sellPoints: [], support: '56.20', resistance: '58.00', stopLoss: '--', invalidation: '未形成独立买点前保持观察。', risks: ['主账户未持仓', '禁止跨账户合并数量'], evidence: ['主账户持仓快照无该证券'], nextCheck: '13:15 完整 15 分钟 K 线', confidence: '中', dataAsOf: '11:30' },
        { code: '300438', name: '鹏辉能源', exchange: 'SZ', instrumentType: 'stock', accountScope: '老婆 → 老婆的账户', currentPrice: '56.73', changePercent: '-1.82%', signal: 'none', stance: '持仓管理', summary: '老婆账户持有 300 股且可用 300 股，成交与成本变化仍待核对。', strategy: '先看 56.20 元观察位，完整 15 分钟确认后再给该账户独立策略。', buyPoints: [], sellPoints: [], support: '56.20', resistance: '58.00', stopLoss: '55.80', invalidation: '成本或可用数量核对不完整时不执行。', risks: ['成本尚未复核', '只能使用老婆账户可用数量'], evidence: ['老婆账户持仓 300 股', '可用数量 300 股'], nextCheck: '13:15 完整 15 分钟 K 线', confidence: '中', dataAsOf: '11:30' }
      ] }
    ]
  }
  const singleModuleSession = {
    id: 'capture-single-module', title: '场外反指监控', createdAt: new Date(Date.now() - 2_800_000).toISOString(), updatedAt: new Date(Date.now() - 80_000).toISOString(), messageCount: 2,
    messages: [
      { id: 'capture-single-user', role: 'user', content: '复核一下本轮场外情绪信号。', timestamp: '12:33' },
      { id: 'capture-single-assistant', role: 'assistant', timestamp: '12:34', content: `结论：本轮没有明确的加仓、减仓或清仓动作，整体为“无明确动作”，不能据此调整家庭持仓。

判断依据：
反向情绪风险：近期情绪已从亏损、清仓转向踏空焦虑和对科技走强的兴奋，容易引发追涨；这只能提高警惕，不能单独形成买卖建议。

需要交叉验证：只有后续明确具体证券和实际买卖，才检查价格、成交量及完整收盘走势。本次没有明确成交，因此没有某笔实际费用。

- 账号：大曾子
- 原始发布时间：2026-07-22 12:23
- 判断：具体证券、买卖动作及仓位均未确认，下一检查点是是否披露具体标的、成交记录或明确仓位变化` }
    ]
  }
  const automationSessions = [
    { id: 'automation-intraday', title: '盘中盯盘 · 定时任务', createdAt: new Date(Date.now() - 2_400_000).toISOString(), updatedAt: new Date(Date.now() - 60_000).toISOString(), messageCount: 2, messages: [
      { id: 'automation-intraday-message', role: 'assistant', content: '定时任务「盘中盯盘」执行完成，本次没有材料变化（NO_REPLY）。', timestamp: '11:20' },
      { id: 'automation-intraday-error', role: 'assistant', content: '定时任务「候选池行情复核」执行失败：行情服务连接超时。\n\n阻断条件：三个市场数据源均未返回完整报价，旧关注列表已保留。\n\n下一步：等待行情恢复后重试，不使用缓存价格生成买入信号。', timestamp: '11:22', status: 'error' }
    ] },
    { id: 'automation-candidate_refresh', title: '盘中候选池刷新 · 定时任务', createdAt: new Date(Date.now() - 7_200_000).toISOString(), updatedAt: new Date(Date.now() - 1_800_000).toISOString(), messageCount: 6, messages: [{ id: 'automation-candidate-message', role: 'assistant', content: '候选池已刷新。', timestamp: '10:50' }] }
  ]
  const captureSessions = [captureSession, multiAccountSession, singleModuleSession, automationSessions[0], secondarySession, automationSessions[1]]
  const archivedSessionIds = new Set()
  const watchlist = { instruments: [
    { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH', source: 'user', status: 'active', score: 82, signal: '观察' },
    { code: '600519', name: '贵州茅台', type: 'stock', exchange: 'SH', source: 'agent', status: 'active', score: 76, signal: '未评估' }
  ] }
  const household = {
    members: [
      { id: 'self', name: '我', relationship: '本人', riskProfile: 'balanced', monitoringEnabled: true, isOwner: true, createdAt: '2026-07-01T10:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z' },
      { id: 'mother', name: '妈妈', relationship: '母亲', riskProfile: 'conservative', monitoringEnabled: true, isOwner: false, createdAt: '2026-07-10T10:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z' }
    ],
    accounts: [
      { id: 'primary-account', memberId: 'self', name: '我的主账户', source: 'primary', totalAsset: 200000, cash: 68000, monitoringEnabled: true, positions: [{ instrument: { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH' }, quantity: 12000, availableQuantity: 12000, averageCost: 4.02, status: 'confirmed' }], updatedAt: '2026-07-20T10:00:00.000Z' },
      { id: 'mother-retirement', memberId: 'mother', name: '养老稳健账户', broker: '华泰证券', source: 'managed', totalAsset: 120000, cash: 52000, monitoringEnabled: true, positions: [{ instrument: { code: '510300', name: '沪深300ETF', type: 'etf', exchange: 'SH' }, quantity: 8000, availableQuantity: 8000, averageCost: 3.96, status: 'confirmed' }], updatedAt: '2026-07-20T10:00:00.000Z' },
      { id: 'mother-secondary', memberId: 'mother', name: '长期配置账户', broker: '招商证券', source: 'managed', totalAsset: 80000, cash: 30000, monitoringEnabled: false, positions: [{ instrument: { code: '600519', name: '贵州茅台', type: 'stock', exchange: 'SH' }, quantity: 100, availableQuantity: 100, averageCost: 1450, status: 'confirmed' }], updatedAt: '2026-07-19T10:00:00.000Z' }
    ],
    updatedAt: '2026-07-20T10:00:00.000Z'
  }
  ipcMain.handle('trade-master:load', () => ({
    home: '/tmp/visual-fixture', userProfile: captureUserProfile, portfolio: null, household, watchlist, goals: captureUserProfile ? {} : null, discipline: { state: 'NORMAL' }, strategyProfile: captureUserProfile ? {} : null, evolution: null,
    notifications: null, automation: { install_status: 'planned', tasks: [] }, strategies: { rules: [] }, strategyCandidates: [], loadedAt: new Date().toISOString(), errors: []
  }))
  ipcMain.handle('trade-master:run', (_event, command, args = []) => {
    const operation = args[0]
    if (command === 'plan' && operation === 'today') return { ok: true, output: JSON.stringify({ instruments: [{ instrument: { code: '510300' }, latest_signals: [{ id: 'capture-signal', strategy: 'stage_support_rebound', side: 'buy', level: 'confirm', period: '5m', kState: 'closed', time: '2026-07-20 10:45', price: 4.12, confidence: .72, reasons: ['回踩缩量后重新站稳均价线', '量价结构完成确认'], invalidation: '下一根完整5分钟K线重新跌破4.08' }] }] }) }
    if (command !== 'market') return { ok: true, output: '{}' }
    if (operation === 'quote') return { ok: true, output: JSON.stringify({ quotes: [{ price: 4.168, changeRatio: 0.0068, amount: 2_846_000_000, exchangeTime: new Date().toISOString() }] }) }
    const period = args[args.indexOf('--period') + 1] || '5m'
    return { ok: true, output: JSON.stringify({ bars: captureBars(period) }) }
  })
  ipcMain.handle('watchlist:scan', async () => {
    await new Promise((resolve) => setTimeout(resolve, 650))
    return { ok: true, active: 6, added: 3, updated: 2, removed: 1, reviewed: 3, analyzed: 8 }
  })
  ipcMain.handle('ai:market-insight', () => ({ ok: true, insight: {
    stance: '等待确认', openPosition: '条件支持', currentStrategy: '等待回踩确认，不追涨。', todayOutlook: '反弹后接近压力区，优先观察量价确认。', nextSessionStrategy: null, buyPoints: [{ label: '回踩观察位', price: '4.12-4.14', condition: '缩量回踩后，完整 5 分钟 K 线重新收回均价线' }], sellPoints: [{ label: '压力位减仓', price: '4.24-4.26', condition: '放量冲高但完整 5 分钟 K 线无法站稳' }],
    triggers: ['回踩缩量并重新站稳均价线'], invalidation: ['有效跌破 4.08'], evidence: ['价格仍在日线 MA20 上方'], confidence: '中', generatedAt: new Date().toISOString(), dataAsOf: new Date().toISOString()
  } }))
  ipcMain.handle('ai:config:load', () => ({ provider: 'codex-local', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' }))
  ipcMain.handle('profile:save', (_event, profile) => profile)
  ipcMain.handle('household:member:create', () => ({ ok: true }))
  ipcMain.handle('household:account:create', () => ({ ok: true }))
  ipcMain.handle('household:member:update', () => ({ ok: true }))
  ipcMain.handle('household:account:update', () => ({ ok: true }))
  ipcMain.handle('household:trade:record', () => ({ ok: true }))
  ipcMain.handle('setup:prepare', async (event, requestId) => {
    const send = (progress) => event.sender.send('setup:progress', { requestId, progress })
    send({ stage: 'checking', percent: 8, title: '正在检查运行环境', detail: '无需打开终端，一般只需几秒' })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const progress = { stage: 'complete', percent: 100, title: '准备完成', detail: '接下来只要回答几个简单问题' }
    send(progress)
    return { ok: true, progress }
  })
  ipcMain.handle('updates:status', () => ({ state: 'up-to-date', currentVersion: '0.1.0', message: '已是最新版本' }))
  ipcMain.handle('updates:check', () => ({ state: 'up-to-date', currentVersion: '0.1.0', message: '已是最新版本' }))
  ipcMain.handle('updates:restart', () => true)
  ipcMain.handle('chat-sessions:list', (_event, archived = false) => captureSessions
    .filter((session) => archivedSessionIds.has(session.id) === archived)
    .map(({ messages: _messages, ...session }) => ({ ...session, archivedAt: archived ? new Date().toISOString() : undefined })))
  ipcMain.handle('chat-sessions:load', (_event, id) => captureSessions.find((session) => session.id === id) || captureSession)
  ipcMain.handle('chat-sessions:set-archived', (_event, id, archived) => {
    if (archived) archivedSessionIds.add(id)
    else archivedSessionIds.delete(id)
    return { ...(captureSessions.find((session) => session.id === id) || captureSession), archivedAt: archived ? new Date().toISOString() : undefined }
  })
  ipcMain.handle('memories:load', () => ({
    settings: { useMemories: true, generateMemories: true },
    items: [
      { id: 'memory-1', content: '用户偏好先看结论和下一步，再看详细证据。', category: 'preference', pinned: true, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-20T10:00:00.000Z' },
      { id: 'memory-2', content: '用户的长期目标是控制回撤，在可承受风险内逐步提高收益稳定性。', category: 'goal', pinned: false, createdAt: '2026-07-19T10:00:00.000Z', updatedAt: '2026-07-19T10:00:00.000Z' }
    ]
  }))
  ipcMain.handle('memories:save-settings', (_event, settings) => settings)
  ipcMain.handle('memories:create', (_event, input) => ({ id: 'memory-new', ...input, pinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }))
  ipcMain.handle('memories:update', (_event, id, patch) => ({ id, ...patch }))
  ipcMain.handle('memories:delete', () => true)
}

async function capturePreviewComparison(referencePath, implementationPath) {
  if (!referencePath || !implementationPath) return
  const htmlPath = join(outputRoot, 'conversation-preview-comparison.html')
  const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#efefec;font-family:-apple-system,sans-serif}.labels{height:40px;display:grid;grid-template-columns:1fr 1fr;background:#222;color:#fff}.labels span{display:flex;align-items:center;padding:0 18px;font-size:13px}.compare{height:300px;display:grid;grid-template-columns:1fr 1fr;gap:2px}.panel{display:flex;align-items:center;justify-content:center;background:#fafaf8;overflow:hidden}.reference{width:510px;height:220px;background-image:url('${pathToFileURL(referencePath).href}');background-repeat:no-repeat;background-size:2048px 1370px;background-position:-390px -575px}.panel img{max-width:510px;max-height:220px;object-fit:contain}</style><div class="labels"><span>Codex 参考</span><span>韭菜盒子实现</span></div><div class="compare"><div class="panel"><div class="reference"></div></div><div class="panel"><img src="${pathToFileURL(implementationPath).href}"></div></div>`
  await writeFile(htmlPath, html)
  const compareWindow = new BrowserWindow({ width: 1100, height: 340, show: false, backgroundColor: '#efefec' })
  await compareWindow.loadFile(htmlPath)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const capture = await compareWindow.webContents.capturePage()
  await writeFile(join(outputRoot, 'conversation-preview-comparison.png'), capture.toPNG())
  compareWindow.destroy()
}

async function captureHistoryComparison(referencePath, implementationPath) {
  if (!referencePath || !implementationPath) return
  const htmlPath = join(outputRoot, 'conversation-history-comparison.html')
  const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#efefec;font-family:-apple-system,sans-serif}.labels{height:40px;display:grid;grid-template-columns:1fr 1fr;background:#222;color:#fff}.labels span{display:flex;align-items:center;padding:0 18px;font-size:13px}.compare{height:390px;display:grid;grid-template-columns:1fr 1fr;gap:2px}.panel{display:flex;align-items:center;justify-content:center;background:#fafaf8;overflow:hidden}.reference{width:610px;height:290px;background-image:url('${pathToFileURL(referencePath).href}');background-repeat:no-repeat;background-size:2164px 1802px;background-position:-420px -650px}.panel img{max-width:540px;max-height:330px;object-fit:contain}</style><div class="labels"><span>Codex 选中态</span><span>韭菜盒子选中态</span></div><div class="compare"><div class="panel"><div class="reference"></div></div><div class="panel"><img src="${pathToFileURL(implementationPath).href}"></div></div>`
  await writeFile(htmlPath, html)
  const compareWindow = new BrowserWindow({ width: 1100, height: 430, show: false, backgroundColor: '#efefec' })
  await compareWindow.loadFile(htmlPath)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const capture = await compareWindow.webContents.capturePage()
  await writeFile(join(outputRoot, 'conversation-history-comparison.png'), capture.toPNG())
  compareWindow.destroy()
}

async function captureComparison(referencePath, implementationName, outputName) {
  if (!referencePath) return
  const implementationPath = join(outputRoot, implementationName)
  const htmlPath = join(outputRoot, `${outputName}.html`)
  const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#e9e9e5;font-family:-apple-system,sans-serif}.labels{position:fixed;inset:0 0 auto;display:grid;grid-template-columns:1fr 1fr;height:42px;background:#20201e;color:#fff;z-index:2}.labels span{display:flex;align-items:center;padding:0 18px;font-size:14px;font-weight:650}.compare{height:900px;padding-top:42px;display:grid;grid-template-columns:1fr 1fr;gap:2px}.compare div{min-width:0;display:flex;align-items:flex-start;justify-content:center;background:#f7f7f5;overflow:hidden}.compare img{width:100%;height:100%;object-fit:contain;object-position:top center}</style><div class="labels"><span>截图标注</span><span>当前实现</span></div><div class="compare"><div><img src="${pathToFileURL(referencePath).href}"></div><div><img src="${pathToFileURL(implementationPath).href}"></div></div>`
  await writeFile(htmlPath, html)
  const compareWindow = new BrowserWindow({ width: 1800, height: 900, show: false, backgroundColor: '#e9e9e5' })
  await compareWindow.loadFile(htmlPath)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const capture = await compareWindow.webContents.capturePage()
  await writeFile(join(outputRoot, `${outputName}.png`), capture.toPNG())
  compareWindow.destroy()
}

async function capture() {
  await mkdir(outputRoot, { recursive: true })
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f7f7f5',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(projectRoot, 'out/preload/index.mjs'),
      contextIsolation: true,
      sandbox: false
    }
  })
  await window.loadFile(join(projectRoot, 'out/renderer/index.html'), { search: 'skipOnboarding=1' })
  await window.webContents.executeJavaScript(`
    localStorage.removeItem('jiucai.layout.leftCollapsed')
    localStorage.removeItem('jiucai.layout.rightCollapsed')
    localStorage.removeItem('jiucai.layout.leftPaneWidth')
    localStorage.removeItem('jiucai.layout.rightPaneWidth')
    localStorage.removeItem('jiucai.context.tabs')
    localStorage.removeItem('jiucai.context.activeTool')
    localStorage.removeItem('jiucai.sidebar.recentExpanded')
    localStorage.removeItem('jiucai.sidebar.automationExpanded')
  `)
  await window.loadFile(join(projectRoot, 'out/renderer/index.html'), { search: 'skipOnboarding=1' })
  await new Promise((resolve) => setTimeout(resolve, 350))
  if (process.env.JIUCAI_CAPTURE_SIDEBAR_GROUPS_ONLY === '1') {
    const expanded = await window.webContents.capturePage({ x: 0, y: 0, width: 330, height: 900 })
    await writeFile(join(outputRoot, 'sidebar-groups-expanded.png'), expanded.toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('button[aria-controls="automation-conversations"]')?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 160))
    const collapsedGroup = await window.webContents.capturePage({ x: 0, y: 0, width: 330, height: 900 })
    await writeFile(join(outputRoot, 'sidebar-automation-collapsed.png'), collapsedGroup.toPNG())
    console.log(outputRoot)
    window.destroy()
    app.quit()
    return
  }
  if (process.env.JIUCAI_CAPTURE_MARKET_AI_ONLY === '1') {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('我的关注'))?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const insight = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'market-ai-points.png'), insight.toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('.watchlist-row')?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 220))
    const kline = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'market-kline-clean.png'), kline.toPNG())
    console.log(outputRoot)
    window.destroy()
    app.quit()
    return
  }
  if (process.env.JIUCAI_CAPTURE_WATCHLIST_SCAN === '1') {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('我的关注'))?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 900))
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('让 AI 找机会'))?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const loading = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'watchlist-scan-loading.png'), loading.toPNG())
    await new Promise((resolve) => setTimeout(resolve, 700))
    const complete = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'watchlist-scan-complete.png'), complete.toPNG())
    console.log(outputRoot)
    window.destroy()
    app.quit()
    return
  }
  if (process.env.JIUCAI_CAPTURE_HOUSEHOLD_ONLY === '1') {
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('家庭持仓'))?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 900))
    const owner = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'household-portfolio-owner.png'), owner.toPNG())
    await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.household-member-tabs button')).find((button) => button.textContent?.includes('妈妈'))?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 180))
    const member = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'household-portfolio-member.png'), member.toPNG())
    console.log(outputRoot)
    window.destroy()
    app.quit()
    return
  }
  if (process.env.JIUCAI_CAPTURE_MESSAGE_MODULES === '1') {
    await window.webContents.executeJavaScript(`(() => { const scroll = document.querySelector('.chat-scroll'); if (scroll) scroll.scrollTop = scroll.scrollHeight })()`)
    await new Promise((resolve) => setTimeout(resolve, 180))
    const structured = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'message-modules-structured.png'), structured.toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('[data-preview-session-id="capture-multi-account"]')?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 320))
    const accounts = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'message-modules-accounts.png'), accounts.toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('[data-preview-session-id="capture-single-module"]')?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 320))
    const single = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'message-modules-single.png'), single.toPNG())
    await window.webContents.executeJavaScript(`document.querySelector('[data-preview-session-id="automation-intraday"]')?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 320))
    const automation = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'message-modules-automation.png'), automation.toPNG())
    window.setSize(1120, 760)
    await new Promise((resolve) => setTimeout(resolve, 180))
    const compact = await window.webContents.capturePage()
    await writeFile(join(outputRoot, 'message-modules-compact.png'), compact.toPNG())
    console.log(outputRoot)
    window.destroy()
    app.quit()
    return
  }
  const mainCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'main-workspace.png'), mainCapture.toPNG())

  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="收起左侧导航"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const collapsedSidebarCapture = await window.webContents.capturePage({ x: 0, y: 0, width: 250, height: 420 })
  await writeFile(join(outputRoot, 'sidebar-collapsed-traffic-lights.png'), collapsedSidebarCapture.toPNG())
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="展开左侧导航"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 120))

  const stockCardToggle = process.env.JIUCAI_CAPTURE_STOCK_FALLBACK === '1'
    ? `Array.from(document.querySelectorAll('.stock-strategy-tag')).at(-1)?.click()`
    : `document.querySelector('.stock-strategy-tag')?.click()`
  await window.webContents.executeJavaScript(stockCardToggle)
  await new Promise((resolve) => setTimeout(resolve, 160))
  const stockCardCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'chat-stock-card-expanded.png'), stockCardCapture.toPNG())
  window.setSize(1120, 760)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const compactStockCardCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'chat-stock-card-compact.png'), compactStockCardCapture.toPNG())
  window.setSize(1440, 900)
  await new Promise((resolve) => setTimeout(resolve, 160))
  await window.webContents.executeJavaScript(stockCardToggle)

  const historyIdleCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'conversation-history-idle.png'), historyIdleCapture.toPNG())

  const historyStartScroll = await window.webContents.executeJavaScript(`document.querySelector('.chat-scroll')?.scrollTop || 0`)
  await window.webContents.executeJavaScript(`document.querySelector('[data-history-turn-index="1"]')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const historyCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'conversation-history.png'), historyCapture.toPNG())
  await writeFile(join(outputRoot, 'conversation-history-selected.png'), historyCapture.toPNG())
  const historyBounds = await window.webContents.executeJavaScript(`
    (() => {
      const rail = document.querySelector('.conversation-history-rail')?.getBoundingClientRect()
      const preview = document.querySelector('.conversation-history-preview')?.getBoundingClientRect()
      if (!rail || !preview) return null
      const left = Math.min(rail.left, preview.left) - 8
      const top = Math.min(rail.top, preview.top) - 8
      const right = Math.max(rail.right, preview.right) + 8
      const bottom = Math.max(rail.bottom, preview.bottom) + 8
      return { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right - left), height: Math.ceil(bottom - top) }
    })()
  `)
  if (historyBounds) {
    const historyFocus = await window.webContents.capturePage(historyBounds)
    const historyPath = join(outputRoot, 'conversation-history-focus.png')
    await writeFile(historyPath, historyFocus.toPNG())
    await captureHistoryComparison(process.env.JIUCAI_REFERENCE_HISTORY_SELECTED_IMAGE || process.env.JIUCAI_REFERENCE_PREVIEW_IMAGE, historyPath)
  }
  await window.webContents.executeJavaScript(`document.querySelector('[data-history-turn-index="1"]')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`)
  await new Promise((resolve) => setTimeout(resolve, 140))
  await window.webContents.executeJavaScript(`document.querySelector('[data-history-turn-index="0"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const historyEndScroll = await window.webContents.executeJavaScript(`document.querySelector('.chat-scroll')?.scrollTop || 0`)
  if (historyEndScroll >= historyStartScroll) throw new Error(`历史回溯未向前滚动: ${historyStartScroll} -> ${historyEndScroll}`)
  await captureComparison(process.env.JIUCAI_REFERENCE_HISTORY_IDLE_IMAGE, 'conversation-history-idle.png', 'qa-history-idle-comparison')
  await captureComparison(process.env.JIUCAI_REFERENCE_HISTORY_SELECTED_IMAGE, 'conversation-history-selected.png', 'qa-history-selected-comparison')
  if (process.env.JIUCAI_CAPTURE_HISTORY_ONLY === '1') {
    console.log(outputRoot)
    window.destroy()
    app.quit()
    return
  }

  await window.webContents.executeJavaScript(`
    document.querySelector('[data-preview-session-id="capture"]')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  `)
  await new Promise((resolve) => setTimeout(resolve, 520))
  const previewCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'conversation-preview.png'), previewCapture.toPNG())
  const previewBounds = await window.webContents.executeJavaScript(`
    (() => { const rect = document.querySelector('.conversation-preview-card')?.getBoundingClientRect(); return rect ? { x: Math.floor(rect.x - 8), y: Math.floor(rect.y - 8), width: Math.ceil(rect.width + 16), height: Math.ceil(rect.height + 16) } : null })()
  `)
  if (previewBounds) {
    const focusedPreview = await window.webContents.capturePage(previewBounds)
    const previewPath = join(outputRoot, 'conversation-preview-focus.png')
    await writeFile(previewPath, focusedPreview.toPNG())
    await capturePreviewComparison(process.env.JIUCAI_REFERENCE_PREVIEW_IMAGE, previewPath)
  }
  await window.webContents.executeJavaScript(`document.querySelector('[data-preview-session-id="capture"]')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`)
  await new Promise((resolve) => setTimeout(resolve, 160))

  await window.webContents.executeJavaScript(`document.querySelector('.conversation-more')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const archiveMenuCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'conversation-archive-menu.png'), archiveMenuCapture.toPNG())
  await window.webContents.executeJavaScript(`document.querySelector('.conversation-menu button')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="查看已归档会话"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const archivedCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'archived-conversations.png'), archivedCapture.toPNG())
  await window.webContents.executeJavaScript(`document.querySelector('.conversation-more')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 80))
  await window.webContents.executeJavaScript(`document.querySelector('.conversation-menu button')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="返回最近对话"]')?.click()`)

  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('我的关注'))?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const watchlistCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'watchlist-list.png'), watchlistCapture.toPNG())
  const sidebarBeforeDrag = await window.webContents.executeJavaScript(`document.querySelector('.sidebar')?.getBoundingClientRect().width || 0`)
  const leftHandle = await window.webContents.executeJavaScript(`(() => { const rect = document.querySelector('.pane-resize-handle.left')?.getBoundingClientRect(); return rect ? { x: Math.round(rect.x + rect.width / 2) } : null })()`)
  if (!leftHandle) throw new Error('未找到左侧拖拽手柄')
  await window.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector('.pane-resize-handle.left')
    handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ${leftHandle.x}, pointerId: 2 }))
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ${leftHandle.x + 60}, pointerId: 2 }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: ${leftHandle.x + 60}, pointerId: 2 }))
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const sidebarAfterDrag = await window.webContents.executeJavaScript(`document.querySelector('.sidebar')?.getBoundingClientRect().width || 0`)
  if (sidebarAfterDrag < sidebarBeforeDrag + 50) throw new Error(`左栏拖拽未生效: ${sidebarBeforeDrag} -> ${sidebarAfterDrag}`)
  const paneBeforeDrag = await window.webContents.executeJavaScript(`document.querySelector('.context-panel-slot')?.getBoundingClientRect().width || 0`)
  const rightHandle = await window.webContents.executeJavaScript(`(() => { const rect = document.querySelector('.pane-resize-handle.right')?.getBoundingClientRect(); return rect ? { x: Math.round(rect.x + rect.width / 2), y: 430 } : null })()`)
  if (!rightHandle) throw new Error('未找到右侧拖拽手柄')
  await window.webContents.executeJavaScript(`(() => {
    const handle = document.querySelector('.pane-resize-handle.right')
    handle?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: ${rightHandle.x}, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ${rightHandle.x - 150}, pointerId: 1 }))
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: ${rightHandle.x - 150}, pointerId: 1 }))
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const paneAfterDrag = await window.webContents.executeJavaScript(`document.querySelector('.context-panel-slot')?.getBoundingClientRect().width || 0`)
  if (paneAfterDrag < paneBeforeDrag + 100) throw new Error(`右栏拖拽未生效: ${paneBeforeDrag} -> ${paneAfterDrag}`)
  const wideInsightCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'market-insight-wide-pane.png'), wideInsightCapture.toPNG())

  await window.webContents.executeJavaScript(`
    document.querySelector('.watchlist-row')?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const klineCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'watchlist-kline.png'), klineCapture.toPNG())

  const signalMarker = await window.webContents.executeJavaScript(`(() => {
    const marker = document.querySelector('.context-panel-slot .signal-trace-marker')
    if (!marker) return false
    const bounds = marker.getBoundingClientRect()
    marker.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 }))
    marker.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 }))
    return true
  })()`)
  if (!signalMarker) throw new Error('真实信号未映射到 K 线红点')
  await new Promise((resolve) => setTimeout(resolve, 160))
  const signalTooltipState = await window.webContents.executeJavaScript(`(() => {
    const tooltip = document.querySelector('.signal-trace-tooltip')
    return tooltip ? { fixed: getComputedStyle(tooltip).position === 'fixed', global: tooltip.parentElement === document.body } : null
  })()`)
  if (!signalTooltipState?.fixed || !signalTooltipState?.global) throw new Error('信号详情不是全局 fixed 浮层')
  const signalTraceCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'signal-trace-hover.png'), signalTraceCapture.toPNG())

  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('.indicator-toolbar button')).find((button) => button.textContent === 'KDJ')?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 160))
  const kdjCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'watchlist-kdj.png'), kdjCapture.toPNG())

  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('.kline-periods button')).find((button) => button.textContent === '日K')?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const dailyKdjCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'watchlist-daily-kdj.png'), dailyKdjCapture.toPNG())

  window.setSize(1120, 760)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const compactPaneWidth = await window.webContents.executeJavaScript(`document.querySelector('.context-panel-slot')?.getBoundingClientRect().width || 0`)
  if (compactPaneWidth > 420) throw new Error(`窄窗口未自动收敛右栏: ${compactPaneWidth}`)
  const compactKlineCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'watchlist-kline-compact.png'), compactKlineCapture.toPNG())
  window.setSize(1440, 900)

  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('交易规则'))?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 200))
  const strategyCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'strategy-lab.png'), strategyCapture.toPNG())

  await window.webContents.executeJavaScript(`
    document.querySelector('button[aria-label="打开工具"]')?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const toolMenuCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'tool-menu.png'), toolMenuCapture.toPNG())

  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('家庭持仓'))?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 900))
  const householdOwnerCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'household-portfolio-owner.png'), householdOwnerCapture.toPNG())
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.household-member-tabs button')).find((button) => button.textContent?.includes('妈妈'))?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const householdMemberCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'household-portfolio-member.png'), householdMemberCapture.toPNG())

  await window.webContents.executeJavaScript(`
    document.querySelector('button[aria-label="收起左侧导航"]')?.click()
    document.querySelector('button[aria-label="收起右侧信息"]')?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const collapsedCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'collapsed-layout.png'), collapsedCapture.toPNG())

  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('设置'))?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const profileCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'settings-profile.png'), profileCapture.toPNG())
  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('.settings-nav button')).find((button) => button.textContent?.includes('记忆'))?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const memoryCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'settings-memory.png'), memoryCapture.toPNG())
  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('.settings-nav button')).find((button) => button.textContent?.includes('应用更新'))?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const updateCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'settings-update.png'), updateCapture.toPNG())

  captureUserProfile = null
  await window.loadFile(join(projectRoot, 'out/renderer/index.html'))
  await new Promise((resolve) => setTimeout(resolve, 120))
  const setupCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'setup-progress.png'), setupCapture.toPNG())
  await new Promise((resolve) => setTimeout(resolve, 520))
  const onboardingCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'onboarding.png'), onboardingCapture.toPNG())
  await window.webContents.executeJavaScript(`
    const capital = document.querySelector('.money-input input')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(capital, '100000')
    capital.dispatchEvent(new Event('input', { bubbles: true }))
    capital.dispatchEvent(new Event('change', { bubbles: true }))
    Array.from(document.querySelectorAll('.onboarding-actions button')).find((button) => button.textContent?.includes('下一步'))?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 80))
  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('.choice')).find((button) => button.textContent?.includes('短线'))?.click()
    Array.from(document.querySelectorAll('.chip')).find((button) => button.textContent?.includes('股票'))?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 80))
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.onboarding-actions button')).find((button) => button.textContent?.includes('下一步'))?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 80))
  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll('.choice')).find((button) => button.textContent?.includes('容易追涨'))?.click()
  `)
  await new Promise((resolve) => setTimeout(resolve, 80))
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.onboarding-actions button')).find((button) => button.textContent?.includes('下一步'))?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const ratingCapture = await window.webContents.capturePage()
  await writeFile(join(outputRoot, 'onboarding-rating.png'), ratingCapture.toPNG())
  await captureComparison(process.env.JIUCAI_REFERENCE_LIST_IMAGE, 'watchlist-list.png', 'qa-list-comparison')
  await captureComparison(process.env.JIUCAI_REFERENCE_CHART_IMAGE, 'watchlist-kline.png', 'qa-chart-comparison')
  await captureComparison(process.env.JIUCAI_REFERENCE_CHAT_IMAGE, 'chat-stock-card-expanded.png', 'qa-chat-card-comparison')
  console.log(outputRoot)
  window.destroy()
  app.quit()
}

app.whenReady().then(() => { registerCaptureFixture(); return capture() }).catch((error) => {
  console.error(error)
  app.exit(1)
})
