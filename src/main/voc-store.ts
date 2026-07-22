import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { VocEvent, VocInboxItem, VocReportAnalysis, VocRiskReport, VocSnapshot, VocSource } from '../shared/voc'
import { defaultVocSources, extractDouyinProfileId } from '../shared/voc'
import { isStockMarketVocEvent } from '../shared/voc-relevance'
import { parseVocSourceTransferJson } from '../shared/voc-source-transfer'

const root = () => join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'voc')
const json = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T
const writeJson = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(`${path}.tmp`, path)
}
const readJsonDirectory = async <T>(path: string, limit: number): Promise<T[]> => {
  try {
    const files = (await readdir(path, { recursive: true })).filter((file) => file.endsWith('.json')).sort().reverse().slice(0, limit)
    return await Promise.all(files.map((file) => json<T>(join(path, file))))
  } catch { return [] }
}

const sourcesPath = () => join(root(), 'sources.json')
export const ensureVocSources = async (): Promise<VocSource[]> => {
  try {
    const stored = await json<{ sources?: VocSource[] }>(sourcesPath())
    const existing = new Map((stored.sources || []).map((source) => [source.id, source]))
    const merged = defaultVocSources.map((source) => {
      const current = existing.get(source.id)
      if (!current) return source
      const profileUrl = current.profileUrl || source.profileUrl
      const status = current.status === 'ready' || current.status === 'error' ? current.status : profileUrl ? 'needs_connector' : 'needs_binding'
      return { ...source, ...current, profileUrl, status } as VocSource
    })
    for (const source of stored.sources || []) if (!merged.some((item) => item.id === source.id)) merged.push(source)
    if (JSON.stringify(merged) !== JSON.stringify(stored.sources || [])) await writeJson(sourcesPath(), { schemaVersion: 1, sources: merged, updatedAt: new Date().toISOString() })
    return merged
  } catch {
    await writeJson(sourcesPath(), { schemaVersion: 1, sources: defaultVocSources, updatedAt: new Date().toISOString() })
    return defaultVocSources
  }
}

export const updateVocSource = async (id: string, patch: Pick<VocSource, 'profileUrl' | 'enabled'>): Promise<VocSource> => {
  const sources = await ensureVocSources()
  const current = sources.find((source) => source.id === id)
  if (!current) throw new Error('没有找到该 VOC 监控账号')
  const profileUrl = String(patch.profileUrl || '').trim()
  if (profileUrl && !/^https:\/\//i.test(profileUrl)) throw new Error('账号主页必须是 HTTPS 链接')
  const status = !profileUrl ? 'needs_binding' as const : current.status === 'ready' && profileUrl === current.profileUrl ? 'ready' as const : 'needs_connector' as const
  const updated = { ...current, profileUrl: profileUrl || undefined, enabled: patch.enabled, status, lastError: undefined }
  await writeJson(sourcesPath(), { schemaVersion: 1, sources: sources.map((source) => source.id === id ? updated : source), updatedAt: new Date().toISOString() })
  return updated
}

export const importVocSources = async (raw: string): Promise<{ sources: VocSource[]; imported: number; added: number }> => {
  const configs = parseVocSourceTransferJson(raw)
  const current = await ensureVocSources()
  const imported = new Map(configs.map((source) => [source.id, source]))
  const existingIds = new Set(current.map((source) => source.id))
  const merge = (source: VocSource, config: (typeof configs)[number]): VocSource => {
    const sameProfile = (source.profileUrl || '') === (config.profileUrl || '')
    return {
      ...source,
      ...config,
      status: !config.profileUrl ? 'needs_binding' : sameProfile && ['ready', 'error'].includes(source.status) ? source.status : 'needs_connector',
      ...(sameProfile ? {} : { lastCheckedAt: undefined, lastSeenPublishedAt: undefined, lastError: undefined })
    }
  }
  const sources = current.map((source) => imported.has(source.id) ? merge(source, imported.get(source.id)!) : source)
  for (const config of configs) {
    if (existingIds.has(config.id)) continue
    sources.push({ ...config, status: config.profileUrl ? 'needs_connector' : 'needs_binding' })
  }
  await writeJson(sourcesPath(), { schemaVersion: 1, sources, updatedAt: new Date().toISOString(), importedAt: new Date().toISOString() })
  return { sources, imported: configs.length, added: configs.filter((source) => !existingIds.has(source.id)).length }
}

export const updateVocSourceHealth = async (id: string, patch: Pick<VocSource, 'status' | 'lastCheckedAt' | 'lastError'>): Promise<VocSource> => {
  const sources = await ensureVocSources()
  const current = sources.find((source) => source.id === id)
  if (!current) throw new Error('没有找到该 VOC 监控账号')
  const updated = { ...current, ...patch }
  await writeJson(sourcesPath(), { schemaVersion: 1, sources: sources.map((source) => source.id === id ? updated : source), updatedAt: new Date().toISOString() })
  return updated
}

const validateInboxItem = (value: unknown, sources: VocSource[]): VocInboxItem => {
  const item = value as Partial<VocInboxItem>
  const source = sources.find((candidate) => candidate.id === item.sourceId)
  if (!source) throw new Error('sourceId 未在 sources.json 中注册')
  if (item.platform !== source.platform) throw new Error('platform 与监控账号不一致')
  if (item.platform === 'douyin') {
    const expectedAuthor = extractDouyinProfileId(source.profileUrl)
    const actualAuthor = typeof item.metadata?.authorProfileId === 'string' ? item.metadata.authorProfileId : ''
    if (!expectedAuthor || actualAuthor !== expectedAuthor) throw new Error('抖音视频作者与监控账号不一致')
  }
  if (!item.contentId || !item.publishedAt || !item.url || !item.mediaType) throw new Error('缺少 contentId、publishedAt、url 或 mediaType')
  if (Number.isNaN(Date.parse(item.publishedAt))) throw new Error('publishedAt 不是有效时间')
  if (!item.text?.trim() && !item.transcript?.trim() && !item.title?.trim()) throw new Error('至少需要 title、text 或 transcript')
  return { ...item, schemaVersion: 1 } as VocInboxItem
}

const eventId = (item: VocInboxItem) => createHash('sha256').update(`${item.platform}:${item.sourceId}:${item.contentId}`).digest('hex').slice(0, 24)
export const ingestVocInbox = async () => {
  const sources = await ensureVocSources()
  const inbox = join(root(), 'inbox')
  const processed = join(root(), 'processed')
  const rejected = join(root(), 'rejected')
  await Promise.all([mkdir(inbox, { recursive: true }), mkdir(processed, { recursive: true }), mkdir(rejected, { recursive: true })])
  const files = (await readdir(inbox)).filter((file) => file.endsWith('.json')).sort()
  const existing = new Set((await readJsonDirectory<VocEvent>(join(root(), 'events'), 500)).map((event) => event.id))
  const events: VocEvent[] = []
  const observed: VocInboxItem[] = []
  const errors: string[] = []
  for (const file of files) {
    const path = join(inbox, file)
    try {
      const item = validateInboxItem(await json<unknown>(path), sources)
      observed.push(item)
      const id = eventId(item)
      const replaceExisting = item.metadata?.replaceExisting === true && Boolean(item.transcript?.trim())
      if (!existing.has(id) || replaceExisting) {
        const event: VocEvent = { ...item, id, capturedAt: item.capturedAt || new Date().toISOString(), fingerprint: id }
        await writeJson(join(root(), 'events', item.publishedAt.slice(0, 10), `${id}.json`), event)
        events.push(event); existing.add(id)
      }
      await rename(path, join(processed, `${new Date().toISOString().replace(/[:.]/g, '-')}-${file}`))
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
      await rename(path, join(rejected, `${new Date().toISOString().replace(/[:.]/g, '-')}-${file}`)).catch(() => undefined)
    }
  }
  if (observed.length) {
    const checkedAt = new Date().toISOString()
    const updatedSources = sources.map((source) => {
      const items = observed.filter((item) => item.sourceId === source.id)
      if (!items.length) return source
      const lastSeenPublishedAt = items.map((item) => item.publishedAt).sort().at(-1)
      return { ...source, status: 'ready' as const, lastCheckedAt: checkedAt, lastSeenPublishedAt, lastError: undefined }
    })
    await writeJson(sourcesPath(), { schemaVersion: 1, sources: updatedSources, updatedAt: checkedAt })
  }
  return { events, errors }
}

export const saveVocRiskReport = async (events: VocEvent[], summary: string, analysis: Partial<VocReportAnalysis> = {}): Promise<VocRiskReport> => {
  const generatedAt = new Date().toISOString()
  const report = { id: randomUUID(), generatedAt, eventIds: events.map((event) => event.id), sourceIds: [...new Set(events.map((event) => event.sourceId))], summary,
    positionActions: analysis.positionActions || [], sentimentObservations: analysis.sentimentObservations || [], trendSummary: analysis.trendSummary }
  await writeJson(join(root(), 'reports', `${generatedAt.replace(/[:.]/g, '-')}.json`), report)
  return report
}

export const loadVocSnapshot = async (): Promise<VocSnapshot> => {
  const errors: string[] = []
  const sources = await ensureVocSources().catch((error) => { errors.push(String(error)); return [] })
  const [recentEvents, recentReports] = await Promise.all([
    readJsonDirectory<VocEvent>(join(root(), 'events'), 80),
    readJsonDirectory<VocRiskReport>(join(root(), 'reports'), 30)
  ])
  let pendingInboxCount = 0
  try { pendingInboxCount = (await readdir(join(root(), 'inbox'))).filter((file) => file.endsWith('.json')).length } catch { /* empty inbox */ }
  return { schemaVersion: 1, home: root(), sources, recentEvents, recentReports, pendingInboxCount, loadedAt: new Date().toISOString(), errors }
}

export const collectVocEvidence = async () => {
  const ingestion = await ingestVocInbox()
  const snapshot = await loadVocSnapshot()
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const eventCutoff = Date.now() - 24 * 60 * 60 * 1000
  const reportedEventIds = new Set(snapshot.recentReports.flatMap((report) => report.eventIds))
  const pendingEvents = [...ingestion.events, ...snapshot.recentEvents.filter((event) => !reportedEventIds.has(event.id))]
  const relevantEvents = [...new Map(pendingEvents
    .filter((event) => Date.parse(event.publishedAt) >= eventCutoff && isStockMarketVocEvent(event))
    .map((event) => [event.id, event])).values()]
  const recentReports = snapshot.recentReports.filter((report) => Date.parse(report.generatedAt) >= cutoff).map((report) => ({
    ...report, summary: report.summary.slice(0, 1200)
  }))
  return { newEvents: relevantEvents, ignoredEvents: ingestion.events.length - relevantEvents.length, ingestionErrors: ingestion.errors, sources: snapshot.sources, recentReports, inboxContract: join(root(), 'inbox', '*.json') }
}
