import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WatchItem } from '../../../shared/types'
import { WatchlistView } from './WatchlistView'

const item: WatchItem = {
  code: '600000',
  name: '测试龙头',
  type: 'stock',
  exchange: 'SH',
  latestPrice: 12.34,
  changePercent: 6.8,
  volume: '12.6亿',
  score: 88,
  source: 'agent',
  signal: '观察',
  refreshedAt: '刚刚',
  strategyLane: 'hot_leader',
  strategyLabel: '热门主线龙头',
  suitableFor: '龙头战法选手',
  nextAction: '等待分歧转强'
}

const renderView = (items: WatchItem[]) => renderToStaticMarkup(<WatchlistView
  items={items}
  selected={null}
  bars={[]}
  period="1d"
  chartLoading={false}
  chartError=""
  chartRefreshedAt=""
  onPeriod={() => undefined}
  onSelect={() => undefined}
  onSearch={async () => ({ ok: true, items: [] })}
  onAdd={async () => ({ ok: true })}
  onRemove={async () => ({ ok: true })}
  onScan={async () => ({ ok: true })}
/>)

describe('WatchlistView', () => {
  it('shows strategy and next action for AI discoveries with a fixed operation column', () => {
    const html = renderView([item])
    expect(html).toContain('策略标签')
    expect(html).toContain('下一步操作')
    expect(html).toContain('热门主线龙头')
    expect(html).toContain('龙头战法选手')
    expect(html).toContain('等待分歧转强')
    expect(html).toContain('sticky-action-column')
  })

  it('marks legacy AI discoveries for a fresh scan instead of inventing metadata', () => {
    const html = renderView([{ ...item, strategyLane: undefined, strategyLabel: undefined, suitableFor: undefined, nextAction: undefined }])
    expect(html).toContain('待重新扫描')
    expect(html).toContain('重新扫描后生成')
  })
})
