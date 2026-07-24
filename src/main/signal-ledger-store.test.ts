import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage, MarketBar, SignalLedgerRecord } from '../shared/types'
import { backfillSignalLedgerFromConversations, evaluateSignalRecord, persistMessageSignals, summarizeSignals } from './signal-ledger-store'

const previousHome = process.env.TRADE_MASTER_HOME
let temporaryHome = ''

afterEach(async () => {
  if (temporaryHome) await rm(temporaryHome, { recursive: true, force: true })
  temporaryHome = ''
  if (previousHome == null) delete process.env.TRADE_MASTER_HOME
  else process.env.TRADE_MASTER_HOME = previousHome
})

const pendingOutcomes = ([1, 3, 7, 15] as const).map((horizon) => ({ horizon, status: 'pending' as const }))
const record = (side: 'buy' | 'sell'): SignalLedgerRecord => ({
  id: side,
  fingerprint: side,
  code: '300438',
  name: '鹏辉能源',
  side,
  signal: side === 'buy' ? 'strong_buy' : 'strong_sell',
  stance: '持仓管理',
  recordedAt: '2026-07-20T06:00:00.000Z',
  signalDate: '2026-07-20',
  referencePrice: 100,
  referencePriceSource: 'current_price',
  summary: '测试信号',
  points: [],
  risks: [],
  evidence: [],
  confidence: '中',
  sourceSessionId: 'session',
  sourceMessageId: 'message',
  outcomes: pendingOutcomes,
  caseKind: 'pending',
  caseReason: '等待'
})

const bars: MarketBar[] = [
  { time: '2026-07-21T15:00:00+08:00', open: 100, high: 102, low: 99, close: 101, volume: 1, amount: null },
  { time: '2026-07-22T15:00:00+08:00', open: 101, high: 102, low: 98, close: 99, volume: 1, amount: null },
  { time: '2026-07-23T15:00:00+08:00', open: 99, high: 104, low: 99, close: 103, volume: 1, amount: null }
]

describe('signal ledger evaluation', () => {
  it('uses later trading days and treats buy-up as positive', () => {
    const evaluated = evaluateSignalRecord(record('buy'), bars, '2026-07-23T16:00:00+08:00')
    expect(evaluated.outcomes.find((item) => item.horizon === 1)?.directionalReturnPercent).toBe(1)
    expect(evaluated.outcomes.find((item) => item.horizon === 3)).toMatchObject({
      status: 'completed',
      tradingDate: '2026-07-23',
      underlyingReturnPercent: 3,
      directionalReturnPercent: 3,
      maxFavorablePercent: 4,
      maxAdversePercent: -2
    })
    expect(evaluated.caseKind).toBe('goodcase')
    expect(evaluated.outcomes.find((item) => item.horizon === 7)?.status).toBe('pending')
  })

  it('treats sell-down as positive directional return', () => {
    const falling = bars.map((bar, index) => ({ ...bar, high: 100 - index, low: 98 - index, close: 99 - index }))
    const evaluated = evaluateSignalRecord(record('sell'), falling)
    expect(evaluated.outcomes.find((item) => item.horizon === 3)?.underlyingReturnPercent).toBe(-3)
    expect(evaluated.outcomes.find((item) => item.horizon === 3)?.directionalReturnPercent).toBe(3)
    expect(evaluated.caseKind).toBe('goodcase')
  })

  it('summarizes accuracy separately for every horizon', () => {
    const buy = evaluateSignalRecord(record('buy'), bars)
    const sell = evaluateSignalRecord(record('sell'), bars)
    const summary = summarizeSignals([buy, sell])
    expect(summary.total).toBe(2)
    expect(summary.byHorizon.find((item) => item.horizon === 3)).toMatchObject({ completed: 2, correct: 1, accuracyPercent: 50 })
  })
})

describe('signal ledger persistence', () => {
  it('persists only the explicit signal side and keeps opposite points as a future plan', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'jiucai-signals-'))
    process.env.TRADE_MASTER_HOME = temporaryHome
    const message: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: '结构化提示',
      timestamp: '10:30',
      stockStrategyCards: [{
        code: '300438',
        name: '鹏辉能源',
        signal: 'strong_sell',
        stance: '持仓管理',
        summary: '先减仓，企稳后接回',
        currentPrice: '60.00',
        buyPoints: [{ label: '接回', price: '56-58', condition: '止跌并重新站回均价线' }],
        sellPoints: [{ label: '减仓', price: '60', condition: '跌破支撑且反抽无力' }],
        risks: ['继续下跌'],
        evidence: ['趋势走弱'],
        confidence: '中'
      }]
    }
    expect(await persistMessageSignals('session-1', message)).toBe(1)
    expect(await persistMessageSignals('session-1', message)).toBe(0)
    const ledger = JSON.parse(await readFile(join(temporaryHome, 'signals', 'ledger.json'), 'utf8')) as { records: SignalLedgerRecord[] }
    expect(ledger.records.map((item) => item.side)).toEqual(['sell'])
    expect(ledger.records.every((item) => item.referencePrice === 60)).toBe(true)
  })

  it('keeps blocked strong signals for audit but excludes them from accuracy', () => {
    const blocked = {
      ...record('buy'),
      signal: 'strong_buy' as const,
      executionStatus: 'blocked' as const,
      summary: '技术修复成立，但执行被成交核对阻断'
    }
    const evaluated = evaluateSignalRecord(blocked, bars)
    const summary = summarizeSignals([evaluated])
    expect(evaluated).toMatchObject({ evaluationEligible: false, caseKind: 'pending' })
    expect(summary).toMatchObject({ total: 1, eligible: 0, excluded: 1, evaluated: 0 })
  })

  it('backfills structured signals from existing conversations on startup', async () => {
    temporaryHome = await mkdtemp(join(tmpdir(), 'jiucai-signal-backfill-'))
    process.env.TRADE_MASTER_HOME = temporaryHome
    const conversations = join(temporaryHome, 'conversations')
    await mkdir(conversations, { recursive: true })
    await writeFile(join(conversations, 'history.json'), JSON.stringify({
      id: 'history',
      title: '历史提示',
      createdAt: '2026-07-10T01:00:00.000Z',
      updatedAt: '2026-07-10T02:00:00.000Z',
      messageCount: 1,
      messages: [{
        id: 'historical-signal',
        role: 'assistant',
        content: '历史买点',
        timestamp: '10:00',
        stockStrategyCards: [{
          code: '300438', name: '鹏辉能源', signal: 'prepare_buy', stance: '等待确认', summary: '止跌后准备接回',
          currentPrice: '58.20', buyPoints: [{ label: '接回', condition: '重新站稳支撑' }], sellPoints: [],
          risks: [], evidence: [], confidence: '中', dataAsOf: '2026-07-10T10:00:00+08:00'
        }]
      }]
    }))

    expect(await backfillSignalLedgerFromConversations()).toBe(1)
    expect(await backfillSignalLedgerFromConversations()).toBe(0)
    const ledger = JSON.parse(await readFile(join(temporaryHome, 'signals', 'ledger.json'), 'utf8')) as { records: SignalLedgerRecord[] }
    expect(ledger.records[0]).toMatchObject({ code: '300438', side: 'buy', signalDate: '2026-07-10', referencePrice: 58.2 })
  })
})
