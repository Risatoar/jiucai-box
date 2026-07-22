import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discardAttachment, readAttachment, resolveAttachmentPath, saveAttachmentBytes } from './attachment-store'

const previousHome = process.env.TRADE_MASTER_HOME
afterEach(() => { if (previousHome == null) delete process.env.TRADE_MASTER_HOME; else process.env.TRADE_MASTER_HOME = previousHome })

describe('attachment-store', () => {
  it('persists clipboard images inside the scoped conversation directory', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-attachment-'))
    const bytes = new Uint8Array([137, 80, 78, 71])
    const attachment = await saveAttachmentBytes('session-1', { name: '截图.png', mimeType: 'image/png', bytes })
    expect(attachment).toMatchObject({ name: '截图.png', kind: 'image', size: 4 })
    expect(await readAttachment(attachment)).toEqual(Buffer.from(bytes))
    expect(() => resolveAttachmentPath('../portfolio.json')).toThrow('附件路径非法')
    expect(await discardAttachment(attachment.storageKey)).toBe(true)
    expect(await discardAttachment(attachment.storageKey)).toBe(false)
  })

  it('allows clipboard images in automation sessions with underscored task ids', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-automation-attachment-'))
    const bytes = new Uint8Array([137, 80, 78, 71])
    const attachment = await saveAttachmentBytes('automation-post_market', { name: '盘后截图.png', mimeType: 'image/png', bytes })

    expect(attachment.storageKey).toMatch(/^automation-post_market\//)
    expect(await readAttachment(attachment)).toEqual(Buffer.from(bytes))
    expect(await discardAttachment(attachment.storageKey)).toBe(true)
  })
})
