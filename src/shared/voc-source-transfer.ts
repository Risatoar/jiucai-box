import type { VocPlatform, VocSource } from './voc'

export interface VocSourceConfig {
  id: string
  platform: VocPlatform
  displayName: string
  handle: string
  profileUrl?: string
  enabled: boolean
  inverseWeight: number
}

export interface VocSourceTransferPayload {
  schemaVersion: 1
  kind: 'jiucai-box-voc-sources'
  exportedAt: string
  sources: VocSourceConfig[]
}

const platforms = new Set<VocPlatform>(['weibo', 'douyin', 'wechat', 'manual'])
const objectValue = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 顶层必须是监控账号配置对象')
  return value as Record<string, unknown>
}
const text = (value: unknown, label: string, max = 100): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少${label}`)
  if (value.trim().length > max) throw new Error(`${label}不能超过 ${max} 字`)
  return value.trim()
}

export const buildVocSourceTransferJson = (sources: VocSource[], drafts: Record<string, string> = {}, exportedAt = new Date().toISOString()): string => JSON.stringify({
  schemaVersion: 1,
  kind: 'jiucai-box-voc-sources',
  exportedAt,
  sources: sources.map((source) => ({
    id: source.id,
    platform: source.platform,
    displayName: source.displayName,
    handle: source.handle,
    profileUrl: (drafts[source.id] ?? source.profileUrl ?? '').trim() || undefined,
    enabled: source.enabled,
    inverseWeight: source.inverseWeight
  }))
} satisfies VocSourceTransferPayload, null, 2)

export const parseVocSourceTransferJson = (raw: string): VocSourceConfig[] => {
  if (!raw.trim() || raw.length > 100_000) throw new Error('JSON 文件不能为空且不能超过 100 KB')
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { throw new Error('JSON 格式不正确，请检查逗号、引号和括号') }
  const root = Array.isArray(parsed) ? { sources: parsed } : objectValue(parsed)
  if (!Array.isArray(root.sources) || !root.sources.length) throw new Error('sources 必须是非空账号数组')
  if (root.sources.length > 100) throw new Error('一次最多导入 100 个监控账号')
  const ids = new Set<string>()
  return root.sources.map((value, index) => {
    const source = objectValue(value)
    const id = text(source.id, `第 ${index + 1} 个账号的 ID`, 64)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error(`${id} 的 ID 只能包含字母、数字、下划线和短横线`)
    if (ids.has(id)) throw new Error(`账号 ID 重复：${id}`)
    ids.add(id)
    const platform = text(source.platform, `${id} 的平台`, 20) as VocPlatform
    if (!platforms.has(platform)) throw new Error(`${id} 的平台必须是 weibo、douyin、wechat 或 manual`)
    const displayName = text(source.displayName, `${id} 的名称`, 80)
    const handle = typeof source.handle === 'string' && source.handle.trim() ? text(source.handle, `${id} 的账号名`, 100) : displayName
    const profileUrl = typeof source.profileUrl === 'string' ? source.profileUrl.trim() : ''
    if (profileUrl && !/^https:\/\//i.test(profileUrl)) throw new Error(`${displayName} 的主页必须是 HTTPS 链接`)
    const inverseWeight = source.inverseWeight == null ? 0.8 : Number(source.inverseWeight)
    if (!Number.isFinite(inverseWeight) || inverseWeight < 0 || inverseWeight > 1) throw new Error(`${displayName} 的反向权重必须在 0 到 1 之间`)
    return { id, platform, displayName, handle, profileUrl: profileUrl || undefined, enabled: source.enabled !== false, inverseWeight }
  })
}
