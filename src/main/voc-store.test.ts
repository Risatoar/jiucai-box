import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ingestVocInbox, loadVocSnapshot, saveVocRiskReport, updateVocSource } from './voc-store'

const previousHome = process.env.TRADE_MASTER_HOME
afterEach(() => { if (previousHome == null) delete process.env.TRADE_MASTER_HOME; else process.env.TRADE_MASTER_HOME = previousHome })

describe('voc-store', () => {
  it('initializes named sources, ingests once and keeps an auditable report', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-voc-'))
    process.env.TRADE_MASTER_HOME = home
    let snapshot = await loadVocSnapshot()
    expect(snapshot.sources.map((source) => source.displayName)).toEqual(['峰哥亡命天涯', '王小雨', '大曾子', '闲闲', '闲闲老公'])
    expect(snapshot.sources.every((source) => source.status === 'needs_connector')).toBe(true)

    await updateVocSource('weibo-fengge', { profileUrl: 'https://weibo.com/u/example', enabled: true })
    const inbox = join(home, 'voc/inbox')
    await mkdir(inbox, { recursive: true })
    const item = { schemaVersion: 1, sourceId: 'weibo-fengge', platform: 'weibo', contentId: 'post-1', publishedAt: '2026-07-21T01:00:00.000Z', url: 'https://weibo.com/example/post-1', mediaType: 'post', text: '今天关注某个板块。' }
    await writeFile(join(inbox, 'first.json'), JSON.stringify(item))
    const first = await ingestVocInbox()
    expect(first.events).toHaveLength(1)

    await writeFile(join(inbox, 'duplicate.json'), JSON.stringify(item))
    expect((await ingestVocInbox()).events).toHaveLength(0)
    await saveVocRiskReport(first.events, '博主提到板块，但没有明确买入证据。', { positionActions: [{
      sourceId: 'weibo-fengge', contentId: 'post-1', action: '减仓', positionAfter: '轻仓',
      occurredAt: item.publishedAt, sector: '科技', evidence: '今天关注某个板块。', confidence: '低'
    }], sentimentObservations: [{ sourceId: 'weibo-fengge', contentId: 'post-1', sentiment: '谨慎', occurredAt: item.publishedAt, evidence: '今天关注某个板块。', confidence: '低' }],
    trendSummary: { today: '今天谨慎关注科技板块。', recent: '近期历史不足。' } })
    snapshot = await loadVocSnapshot()
    expect(snapshot.recentEvents).toHaveLength(1)
    expect(snapshot.recentReports[0]).toMatchObject({ summary: '博主提到板块，但没有明确买入证据。', sourceIds: ['weibo-fengge'], positionActions: [{ action: '减仓', positionAfter: '轻仓' }], sentimentObservations: [{ sentiment: '谨慎' }], trendSummary: { recent: '近期历史不足。' } })
    expect(JSON.parse(await readFile(join(home, 'voc/sources.json'), 'utf8')).sources[0]).toMatchObject({ status: 'ready', lastSeenPublishedAt: item.publishedAt })
  })

  it('backfills confirmed profile links without overwriting a custom link', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-voc-migration-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(join(home, 'voc'), { recursive: true })
    await writeFile(join(home, 'voc/sources.json'), JSON.stringify({ sources: [
      { id: 'weibo-fengge', platform: 'weibo', displayName: '峰哥亡命天涯', handle: '峰哥亡命天涯', enabled: true, inverseWeight: .8, status: 'needs_binding' },
      { id: 'douyin-wangxiaoyu', platform: 'douyin', displayName: '王小雨', handle: '王小雨', profileUrl: 'https://www.douyin.com/user/custom', enabled: true, inverseWeight: .7, status: 'needs_connector' }
    ] }))
    const snapshot = await loadVocSnapshot()
    expect(snapshot.sources.find((source) => source.id === 'weibo-fengge')).toMatchObject({ profileUrl: 'https://weibo.com/u/2397417584', status: 'needs_connector' })
    expect(snapshot.sources.find((source) => source.id === 'douyin-wangxiaoyu')).toMatchObject({ profileUrl: 'https://www.douyin.com/user/custom', inverseWeight: .7 })
    expect(snapshot.sources.find((source) => source.id === 'douyin-xianxian-husband')?.profileUrl).toContain('MS4wLjABAAAALMi0G2nrvuUgP00z8zZgndA8w9j3kTI0vZK4ZSK079MUcUuPBAi1WOHa-SByU32C')
  })

  it('rejects a Douyin item whose author does not match the monitored profile', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-voc-author-'))
    process.env.TRADE_MASTER_HOME = home
    await loadVocSnapshot()
    const inbox = join(home, 'voc/inbox')
    await mkdir(inbox, { recursive: true })
    await writeFile(join(inbox, 'wrong-author.json'), JSON.stringify({
      schemaVersion: 1, sourceId: 'douyin-wangxiaoyu', platform: 'douyin', contentId: 'wrong-1',
      publishedAt: '2026-07-21T01:00:00.000Z', url: 'https://www.douyin.com/video/wrong-1',
      mediaType: 'video', text: '无关作者的视频', metadata: { authorProfileId: 'another-user' }
    }))
    const result = await ingestVocInbox()
    expect(result.events).toHaveLength(0)
    expect(result.errors[0]).toContain('作者与监控账号不一致')
  })
})
