import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import type { AttachmentInput, ChatAttachment } from '../shared/types'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_ATTACHMENTS = 5
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const mimeByExtension: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
  '.csv': 'text/csv', '.tsv': 'text/tsv', '.html': 'text/html', '.xml': 'text/xml', '.js': 'text/javascript',
  '.ts': 'text/x-typescript', '.tsx': 'text/tsx', '.jsx': 'text/jsx', '.py': 'text/x-python', '.sql': 'text/x-sql',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

const root = () => join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'conversations/assets')
const assertSession = (sessionId: string) => { if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('会话 ID 非法') }
const safeName = (name: string) => basename(name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-120) || 'attachment'
const metadata = (sessionId: string, name: string, mimeType: string, size: number): ChatAttachment => {
  assertSession(sessionId)
  if (size <= 0) throw new Error('附件内容为空')
  if (size > MAX_FILE_BYTES) throw new Error('单个附件不能超过 20 MB')
  const id = randomUUID()
  const cleaned = safeName(name)
  const extension = extname(cleaned).toLowerCase()
  return { id, name: cleaned, mimeType: mimeType || mimeByExtension[extension] || 'application/octet-stream', size, kind: (mimeType.startsWith('image/') || imageExtensions.has(extension)) ? 'image' : 'file', storageKey: `${sessionId}/${id}-${cleaned}` }
}

export const resolveAttachmentPath = (storageKey: string): string => {
  const cleaned = normalize(storageKey)
  if (!cleaned || isAbsolute(cleaned) || cleaned.startsWith('..') || cleaned.includes(`..${sep}`)) throw new Error('附件路径非法')
  const base = resolve(root())
  const target = resolve(base, cleaned)
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('附件路径越界')
  return target
}

export const importAttachmentFiles = async (sessionId: string, paths: string[]): Promise<ChatAttachment[]> => {
  if (paths.length > MAX_ATTACHMENTS) throw new Error('每次最多添加 5 个附件')
  const attachments: ChatAttachment[] = []
  for (const source of paths) {
    const info = await stat(source)
    if (!info.isFile()) continue
    const attachment = metadata(sessionId, basename(source), mimeByExtension[extname(source).toLowerCase()] || '', info.size)
    const target = resolveAttachmentPath(attachment.storageKey)
    await mkdir(resolveAttachmentPath(sessionId), { recursive: true })
    await copyFile(source, target)
    attachments.push(attachment)
  }
  return attachments
}

export const saveAttachmentBytes = async (sessionId: string, input: AttachmentInput): Promise<ChatAttachment> => {
  const bytes = Buffer.from(input.bytes)
  const attachment = metadata(sessionId, input.name, input.mimeType, bytes.byteLength)
  const target = resolveAttachmentPath(attachment.storageKey)
  await mkdir(resolveAttachmentPath(sessionId), { recursive: true })
  await writeFile(target, bytes)
  return attachment
}

export const readAttachment = async (attachment: ChatAttachment): Promise<Buffer> => {
  const value = await readFile(resolveAttachmentPath(attachment.storageKey))
  if (value.byteLength !== attachment.size) throw new Error(`附件已变化：${attachment.name}`)
  return value
}

export const discardAttachment = async (storageKey: string): Promise<boolean> => {
  try { await unlink(resolveAttachmentPath(storageKey)); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}
