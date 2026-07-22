import { describe, expect, it } from 'vitest'
import type { VocSource } from './voc'
import { buildVocSourceTransferJson, parseVocSourceTransferJson } from './voc-source-transfer'

const source: VocSource = { id: 'weibo-demo', platform: 'weibo', displayName: '示例账号', handle: '示例账号', profileUrl: 'https://weibo.com/old', enabled: true, inverseWeight: 0.8, status: 'ready' }

describe('voc source transfer', () => {
  it('exports the current input draft without runtime health fields', () => {
    const payload = JSON.parse(buildVocSourceTransferJson([source], { 'weibo-demo': 'https://weibo.com/new' }, '2026-07-22T00:00:00.000Z'))
    expect(payload).toMatchObject({ schemaVersion: 1, kind: 'jiucai-box-voc-sources', exportedAt: '2026-07-22T00:00:00.000Z' })
    expect(payload.sources).toEqual([{ id: 'weibo-demo', platform: 'weibo', displayName: '示例账号', handle: '示例账号', profileUrl: 'https://weibo.com/new', enabled: true, inverseWeight: 0.8 }])
  })

  it('accepts an envelope or a plain array and validates unsafe values', () => {
    const config = { id: 'douyin-demo', platform: 'douyin', displayName: '示例', profileUrl: 'https://www.douyin.com/user/demo', enabled: false, inverseWeight: 0.6 }
    expect(parseVocSourceTransferJson(JSON.stringify([config]))[0]).toMatchObject({ ...config, handle: '示例' })
    expect(() => parseVocSourceTransferJson(JSON.stringify({ sources: [{ ...config, profileUrl: 'http://unsafe.example' }] }))).toThrow('必须是 HTTPS 链接')
    expect(() => parseVocSourceTransferJson(JSON.stringify({ sources: [config, config] }))).toThrow('账号 ID 重复')
  })
})
