import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  ChatMessage,
  ChatSession,
  DailySignalReview,
  MarketBar,
  SignalAccuracySummary,
  SignalCaseKind,
  SignalHistorySnapshot,
  SignalLedgerRecord,
  SignalLedgerSide,
  SignalOutcome,
  SignalOutcomeHorizon,
  StockStrategyCardData
} from '../shared/types'
import { runTradeMaster } from './trade-master'

interface SignalLedgerFile {
  schemaVersion: 1
  updatedAt: string
  records: SignalLedgerRecord[]
}

const HORIZONS: SignalOutcomeHorizon[] = [1, 3, 7, 15]
const CASE_THRESHOLDS: Record<SignalOutcomeHorizon, number> = { 1: 1.5, 3: 2, 7: 3, 15: 5 }
const signalRoot = () => join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'signals')
const ledgerPath = () => join(signalRoot(), 'ledger.json')
let writeQueue: Promise<unknown> = Promise.resolve()

const shanghaiDate = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const round = (value: number) => Math.round(value * 100) / 100
const parsePrice = (value?: string): number | null => {
  if (!value) return null
  const values = [...value.matchAll(/\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter((item) => Number.isFinite(item) && item > 0)
  if (!values.length) return null
  return round(values.length > 1 ? (values[0] + values[1]) / 2 : values[0])
}

const readLedger = async (): Promise<SignalLedgerFile> => {
  try {
    const parsed = JSON.parse(await readFile(ledgerPath(), 'utf8')) as SignalLedgerFile
    return { schemaVersion: 1, updatedAt: parsed.updatedAt || new Date(0).toISOString(), records: Array.isArray(parsed.records) ? parsed.records : [] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), records: [] }
    throw error
  }
}

const writeJsonAtomic = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

const writeLedger = async (records: SignalLedgerRecord[]) => {
  await writeJsonAtomic(ledgerPath(), { schemaVersion: 1, updatedAt: new Date().toISOString(), records } satisfies SignalLedgerFile)
}

const serialized = async <T>(work: () => Promise<T>): Promise<T> => {
  const result = writeQueue.then(work, work)
  writeQueue = result.then(() => undefined, () => undefined)
  return result
}

const sidesForCard = (card: StockStrategyCardData): SignalLedgerSide[] => {
  if (card.signal === 'immediate_buy' || card.signal === 'strong_buy' || card.signal === 'prepare_buy') return ['buy']
  if (card.signal === 'immediate_sell' || card.signal === 'strong_sell' || card.signal === 'prepare_sell') return ['sell']
  return []
}

const blockedLanguage = /(?:暂不|不追|等待|尚未|不能|不得|禁止|不足以|阻断|仅观察|继续观察|未核对)/
const eligibility = (signal: SignalLedgerRecord['signal'], executionStatus?: SignalLedgerRecord['executionStatus'], summary = '') => {
  if (!['immediate_buy', 'immediate_sell', 'strong_buy', 'strong_sell'].includes(signal)) {
    return { eligible: false, reason: '准备或观察信号仅留作审计，不进入准确率分母' }
  }
  if (executionStatus === 'blocked' || blockedLanguage.test(summary)) {
    return { eligible: false, reason: '技术信号被账户、纪律、费用或确认闸门阻断，不作为用户可执行信号' }
  }
  return { eligible: true, reason: '明确且未被阻断的推荐级信号' }
}

const buildRecord = (
  sessionId: string,
  message: ChatMessage,
  card: StockStrategyCardData,
  side: SignalLedgerSide,
  recordedAt: string
): SignalLedgerRecord => {
  const points = side === 'buy' ? card.buyPoints : card.sellPoints
  const currentPrice = parsePrice(card.currentPrice)
  const pointPrice = parsePrice(points.find((point) => point.price)?.price)
  const referencePrice = currentPrice ?? pointPrice
  const fingerprint = createHash('sha256')
    .update([sessionId, message.id, card.code, card.accountScope || '', side].join('|'))
    .digest('hex')
    .slice(0, 24)
  const preferredSignal = side === 'buy'
    ? (card.signal === 'immediate_buy' || card.signal === 'strong_buy' || card.signal === 'prepare_buy' ? card.signal : 'prepare_buy')
    : (card.signal === 'immediate_sell' || card.signal === 'strong_sell' || card.signal === 'prepare_sell' ? card.signal : 'prepare_sell')
  const signalTime = card.dataAsOf && Number.isFinite(Date.parse(card.dataAsOf)) ? card.dataAsOf : recordedAt
  const evaluation = eligibility(preferredSignal, card.executionStatus, card.summary)
  return {
    id: randomUUID(),
    fingerprint,
    code: card.code,
    name: card.name,
    side,
    signal: preferredSignal,
    stance: card.stance,
    accountScope: card.accountScope,
    source: card.source,
    recordedAt,
    signalDate: shanghaiDate(signalTime),
    referencePrice,
    referencePriceSource: currentPrice != null ? 'current_price' : pointPrice != null ? 'point_price' : 'missing',
    summary: card.summary,
    strategy: card.strategy,
    decisionPolicyId: card.decisionPolicyId,
    positionState: card.positionState,
    tradeIntent: card.tradeIntent,
    triggerStrategy: card.triggerStrategy,
    actionPurpose: card.actionPurpose,
    points,
    invalidation: card.invalidation,
    risks: card.risks,
    evidence: card.evidence,
    confidence: card.confidence,
    dataAsOf: card.dataAsOf,
    executionStatus: card.executionStatus,
    executionBlockers: card.executionBlockers,
    evaluationEligible: evaluation.eligible,
    eligibilityReason: evaluation.reason,
    executionValidUntil: card.executionValidUntil,
    sourceSessionId: sessionId,
    sourceMessageId: message.id,
    outcomes: HORIZONS.map((horizon) => ({ horizon, status: 'pending' })),
    caseKind: 'pending',
    caseReason: referencePrice == null ? '已记录提示，缺少可计算收益的基准价格' : '等待后续交易日行情'
  }
}

export const persistMessageSignals = async (sessionId: string, message: ChatMessage): Promise<number> => {
  if (message.role !== 'assistant' || !message.stockStrategyCards?.length) return 0
  const cards = message.stockStrategyCards
  return serialized(async () => {
    const ledger = await readLedger()
    const known = new Set(ledger.records.map((record) => record.fingerprint))
    const recordedAt = new Date().toISOString()
    const additions = cards.flatMap((card) =>
      sidesForCard(card).map((side) => buildRecord(sessionId, message, card, side, recordedAt))
    ).filter((record) => !known.has(record.fingerprint))
    if (!additions.length) return 0
    await writeLedger([...ledger.records, ...additions])
    return additions.length
  })
}

export const persistSessionSignals = async (session: ChatSession): Promise<number> => serialized(async () => {
  const ledger = await readLedger()
  const known = new Set(ledger.records.map((record) => record.fingerprint))
  const additions: SignalLedgerRecord[] = []
  for (const message of session.messages) {
    if (message.role !== 'assistant' || !message.stockStrategyCards?.length) continue
    const recordedAt = new Date().toISOString()
    for (const card of message.stockStrategyCards) {
      for (const side of sidesForCard(card)) {
        const record = buildRecord(session.id, message, card, side, recordedAt)
        if (known.has(record.fingerprint)) continue
        known.add(record.fingerprint)
        additions.push(record)
      }
    }
  }
  if (additions.length) await writeLedger([...ledger.records, ...additions])
  return additions.length
})

export const backfillSignalLedgerFromConversations = async (): Promise<number> => serialized(async () => {
  const home = process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
  let files: string[]
  try { files = (await readdir(join(home, 'conversations'))).filter((file) => file.endsWith('.json')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  const ledger = await readLedger()
  const known = new Set(ledger.records.map((record) => record.fingerprint))
  const additions: SignalLedgerRecord[] = []
  for (const file of files) {
    try {
      const session = JSON.parse(await readFile(join(home, 'conversations', file), 'utf8')) as ChatSession
      for (const message of session.messages || []) {
        if (message.role !== 'assistant' || !message.stockStrategyCards?.length) continue
        for (const card of message.stockStrategyCards) {
          const recordedAt = card.dataAsOf && Number.isFinite(Date.parse(card.dataAsOf)) ? card.dataAsOf : session.updatedAt
          for (const side of sidesForCard(card)) {
            const record = buildRecord(session.id, message, card, side, recordedAt)
            if (known.has(record.fingerprint)) continue
            known.add(record.fingerprint)
            additions.push(record)
          }
        }
      }
    } catch { /* one malformed conversation must not block the ledger migration */ }
  }
  if (additions.length) await writeLedger([...ledger.records, ...additions])
  return additions.length
})

const barDate = (bar: MarketBar) => shanghaiDate(bar.time)

const classify = (outcomes: SignalOutcome[], referencePrice: number | null): { kind: SignalCaseKind; reason: string } => {
  if (referencePrice == null) return { kind: 'pending', reason: '缺少信号基准价格，暂不能计算准确性' }
  const latest = [...outcomes].reverse().find((item) => item.status === 'completed' && item.directionalReturnPercent != null)
  if (!latest || latest.directionalReturnPercent == null) return { kind: 'pending', reason: '等待后续交易日行情' }
  const threshold = CASE_THRESHOLDS[latest.horizon]
  const value = latest.directionalReturnPercent
  if (value >= threshold) return { kind: 'goodcase', reason: `${latest.horizon}日方向收益 ${value >= 0 ? '+' : ''}${value.toFixed(2)}%，达到 +${threshold}% 有效阈值` }
  if (value <= -threshold) return { kind: 'badcase', reason: `${latest.horizon}日方向收益 ${value.toFixed(2)}%，低于 -${threshold}% 失误阈值` }
  return { kind: 'neutral', reason: `${latest.horizon}日方向收益 ${value >= 0 ? '+' : ''}${value.toFixed(2)}%，尚未形成显著好坏案例` }
}

export const evaluateSignalRecord = (record: SignalLedgerRecord, bars: MarketBar[], evaluatedAt = new Date().toISOString()): SignalLedgerRecord => {
  const evaluation = eligibility(record.signal, record.executionStatus, record.summary)
  if (!evaluation.eligible) {
    return {
      ...record,
      evaluationEligible: false,
      eligibilityReason: evaluation.reason,
      caseKind: 'pending',
      caseReason: evaluation.reason,
      evaluatedAt
    }
  }
  if (record.referencePrice == null) {
    const result = classify(record.outcomes, null)
    return { ...record, evaluationEligible: true, eligibilityReason: evaluation.reason, caseKind: result.kind, caseReason: result.reason, evaluatedAt }
  }
  const future = bars
    .filter((bar) => barDate(bar) > record.signalDate)
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
  const outcomes = HORIZONS.map((horizon): SignalOutcome => {
    const target = future[horizon - 1]
    if (!target) return { horizon, status: 'pending' }
    const window = future.slice(0, horizon)
    const raw = (target.close / record.referencePrice! - 1) * 100
    const directional = record.side === 'buy' ? raw : -raw
    const directionalMoves = window.flatMap((bar) => {
      const high = (bar.high / record.referencePrice! - 1) * 100
      const low = (bar.low / record.referencePrice! - 1) * 100
      return record.side === 'buy' ? [high, low] : [-low, -high]
    })
    return {
      horizon,
      status: 'completed',
      tradingDate: barDate(target),
      closePrice: target.close,
      underlyingReturnPercent: round(raw),
      directionalReturnPercent: round(directional),
      maxFavorablePercent: round(Math.max(...directionalMoves)),
      maxAdversePercent: round(Math.min(...directionalMoves))
    }
  })
  const result = classify(outcomes, record.referencePrice)
  return { ...record, outcomes, evaluationEligible: true, eligibilityReason: evaluation.reason, caseKind: result.kind, caseReason: result.reason, evaluatedAt }
}

export const summarizeSignals = (records: SignalLedgerRecord[]): SignalAccuracySummary => {
  const eligibleRecords = records.filter((record) => eligibility(record.signal, record.executionStatus, record.summary).eligible)
  const evaluated = eligibleRecords.filter((record) => record.caseKind !== 'pending')
  const completedDirectional = evaluated.filter((record) => record.outcomes.some((outcome) => outcome.status === 'completed'))
  const correct = completedDirectional.filter((record) => [...record.outcomes].reverse().find((outcome) => outcome.status === 'completed')?.directionalReturnPercent! > 0).length
  return {
    total: records.length,
    eligible: eligibleRecords.length,
    excluded: records.length - eligibleRecords.length,
    evaluated: evaluated.length,
    pending: eligibleRecords.filter((record) => record.caseKind === 'pending').length,
    goodcases: eligibleRecords.filter((record) => record.caseKind === 'goodcase').length,
    badcases: eligibleRecords.filter((record) => record.caseKind === 'badcase').length,
    neutral: eligibleRecords.filter((record) => record.caseKind === 'neutral').length,
    directionalAccuracyPercent: completedDirectional.length ? round(correct / completedDirectional.length * 100) : null,
    byHorizon: HORIZONS.map((horizon) => {
      const completed = eligibleRecords.flatMap((record) => record.outcomes.filter((outcome) => outcome.horizon === horizon && outcome.status === 'completed'))
      const horizonCorrect = completed.filter((outcome) => (outcome.directionalReturnPercent ?? 0) > 0).length
      return {
        horizon,
        completed: completed.length,
        correct: horizonCorrect,
        accuracyPercent: completed.length ? round(horizonCorrect / completed.length * 100) : null,
        averageDirectionalReturnPercent: completed.length
          ? round(completed.reduce((sum, outcome) => sum + (outcome.directionalReturnPercent || 0), 0) / completed.length)
          : null
      }
    })
  }
}

const loadDailyBars = async (code: string, start: string): Promise<MarketBar[]> => {
  const output = await runTradeMaster('market', ['bars', '--code', code, '--period', '1d', '--limit', '45', '--start', start])
  const payload = JSON.parse(output) as { bars?: MarketBar[] }
  return Array.isArray(payload.bars) ? payload.bars : []
}

const refreshRecords = async (records: SignalLedgerRecord[]) => {
  const groups = new Map<string, SignalLedgerRecord[]>()
  for (const record of records) groups.set(record.code, [...(groups.get(record.code) || []), record])
  const refreshed = new Map<string, SignalLedgerRecord>()
  const errors: string[] = []
  const entries = [...groups.entries()]
  for (let index = 0; index < entries.length; index += 4) {
    await Promise.all(entries.slice(index, index + 4).map(async ([code, codeRecords]) => {
      try {
        const start = codeRecords.map((record) => record.signalDate).sort()[0]
        const bars = await loadDailyBars(code, start)
        for (const record of codeRecords) refreshed.set(record.id, evaluateSignalRecord(record, bars))
      } catch (error) {
        errors.push(`${code}: ${error instanceof Error ? error.message : String(error)}`)
        for (const record of codeRecords) refreshed.set(record.id, record)
      }
    }))
  }
  return { records: records.map((record) => refreshed.get(record.id) || record), errors }
}

export const loadSignalHistory = async (code: string): Promise<SignalHistorySnapshot> => serialized(async () => {
  const ledger = await readLedger()
  const target = ledger.records.filter((record) => record.code === code)
  const refreshed = await refreshRecords(target)
  if (JSON.stringify(target) !== JSON.stringify(refreshed.records)) {
    const updates = new Map(refreshed.records.map((record) => [record.id, record]))
    await writeLedger(ledger.records.map((record) => updates.get(record.id) || record))
  }
  return {
    code,
    generatedAt: new Date().toISOString(),
    records: refreshed.records.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt)),
    summary: summarizeSignals(refreshed.records),
    refreshError: refreshed.errors.length ? refreshed.errors.join('；') : undefined
  }
})

const reviewMarkdown = (review: DailySignalReview) => [
  `# ${review.tradingDate} 历史信号准确性复盘`,
  '',
  `- 历史信号：${review.summary.total}`,
  `- 可计入准确率 / 已排除：${review.summary.eligible} / ${review.summary.excluded}`,
  `- 已评估：${review.summary.evaluated}`,
  `- 方向准确率：${review.summary.directionalAccuracyPercent == null ? '待样本' : `${review.summary.directionalAccuracyPercent}%`}`,
  `- goodcase / badcase：${review.summary.goodcases} / ${review.summary.badcases}`,
  '',
  '## 反思',
  '',
  ...review.reflection.map((item) => `- ${item}`)
].join('\n')

export const reviewSignalLedger = async (tradingDate = shanghaiDate(new Date())): Promise<DailySignalReview> => serialized(async () => {
  const ledger = await readLedger()
  const before = new Map(ledger.records.map((record) => [record.id, JSON.stringify(record.outcomes)]))
  const refreshed = await refreshRecords(ledger.records)
  await writeLedger(refreshed.records)
  const summary = summarizeSignals(refreshed.records)
  const latestDirectionalReturn = (record: SignalLedgerRecord) =>
    [...record.outcomes].reverse().find((item) => item.status === 'completed')?.directionalReturnPercent || 0
  const goodcases = refreshed.records.filter((record) => record.caseKind === 'goodcase')
    .sort((left, right) => Math.abs(latestDirectionalReturn(right)) - Math.abs(latestDirectionalReturn(left))).slice(0, 5)
  const badcases = refreshed.records.filter((record) => record.caseKind === 'badcase')
    .sort((left, right) => latestDirectionalReturn(left) - latestDirectionalReturn(right)).slice(0, 5)
  const reflection = [
    badcases.length ? `优先复核 ${badcases.length} 个 badcase 的趋势判断、触发时机和卖出后接回条件。` : '本轮没有达到显著失误阈值的 badcase，继续积累样本。',
    goodcases.length ? `保留 ${goodcases.length} 个 goodcase 的共同证据，仅作为候选规则证据，不直接改写活动策略。` : 'goodcase 样本不足，暂不提炼新规则。',
    `1/3/7/15 日结果按交易日收盘回填；卖出后下跌记为正向，买入后上涨记为正向。`
  ]
  const review: DailySignalReview = {
    schemaVersion: 1,
    tradingDate,
    generatedAt: new Date().toISOString(),
    summary,
    updatedSignalIds: refreshed.records.filter((record) => before.get(record.id) !== JSON.stringify(record.outcomes)).map((record) => record.id),
    goodcases,
    badcases,
    reflection
  }
  if (badcases.length) {
    const candidatePath = join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'evolution', 'candidates', `signal-review-${tradingDate}.json`)
    await writeJsonAtomic(candidatePath, {
      schema_version: 1,
      id: `signal-review-${tradingDate}`,
      classification: 'L2',
      status: 'needs_strategy_refinement',
      source: 'signal-ledger-daily-review',
      generated_at: review.generatedAt,
      evidence: { summary, goodcase_ids: goodcases.map((item) => item.id), badcase_ids: badcases.map((item) => item.id) },
      proposed_focus: ['减少错误方向信号', '补齐卖出后的接回条件', '区分下跌趋势与震荡做T'],
      guardrail: '仅生成策略候选；达到历史、样本外和影子验证门槛后才能升级活动策略'
    })
    review.strategyCandidateFile = candidatePath
  }
  const reportRoot = join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'reviews')
  await writeJsonAtomic(join(reportRoot, `signal-review-${tradingDate}.json`), review)
  await mkdir(reportRoot, { recursive: true })
  await writeFile(join(reportRoot, `signal-review-${tradingDate}.md`), `${reviewMarkdown(review)}\n`, 'utf8')
  return review
})
