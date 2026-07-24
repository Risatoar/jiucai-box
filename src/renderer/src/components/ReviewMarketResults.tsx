import { ChevronDown, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  ReviewHotStock,
  ReviewRepresentative,
  ReviewSectorAnalysis
} from '../../../shared/review-types'

const trendLabel: Record<string, string> = {
  up: '上涨', down: '下跌', range: '震荡', breakout: '突破',
  breakdown: '破位', unknown: '未知'
}

const formatPct = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

const formatPrice = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value) || value <= 0) return '--'
  return value.toFixed(value < 10 ? 3 : 2)
}

const representativeToStock = (
  representative: ReviewRepresentative,
  sector: ReviewSectorAnalysis
): ReviewHotStock => ({
  code: representative.code,
  name: representative.name,
  sector: sector.name,
  role: sector.representatives?.[0]?.code === representative.code ? '龙头' : '补涨',
  changePercent: representative.changePercent ?? null,
  price: representative.price,
  instrumentType: 'stock',
  turnoverRate: representative.turnoverPercent,
  stage: sector.stage,
  summary: `${representative.name}来自全 A 股${sector.name}行业扫描，按当日强度、成交活跃度和行业联动综合排序。`,
  evidence: [
    `所属行业：${sector.name}`,
    `个股涨跌：${formatPct(representative.changePercent)}`,
    representative.leadershipScore != null ? `龙头强度：${representative.leadershipScore}` : ''
  ].filter(Boolean),
  nextScript: sector.observation,
  invalidation: '行业热度明显回落，或个股量价结构转弱且无法快速收回。',
  suggestion: sector.suggestion
})

function InstrumentDetailModal({ stock, onClose }: { stock: ReviewHotStock; onClose: () => void }) {
  const [state, setState] = useState<'idle' | 'adding' | 'added' | 'error'>('idle')
  const addToWatch = async () => {
    if (!window.desktopApi || state === 'adding' || state === 'added') return
    setState('adding')
    try {
      await window.desktopApi.addWatchItem(stock.code)
      setState('added')
    } catch {
      setState('error')
    }
  }
  return (
    <div className="review-detail-backdrop" onClick={onClose}>
      <div className="review-detail-modal review-instrument-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <header className="review-detail-header">
          <div className="review-detail-title">
            <strong>{stock.name}</strong>
            <small>{stock.code} · {stock.sector || '未分类'} · {stock.role}</small>
          </div>
          <button className="review-icon-button" onClick={onClose} type="button" aria-label="关闭详情"><X size={18} /></button>
        </header>
        <div className="review-detail-body">
          <div className="review-instrument-quote">
            <div><span>现价</span><strong>{formatPrice(stock.price)}</strong></div>
            <div><span>涨跌</span><strong className={(stock.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{formatPct(stock.changePercent)}</strong></div>
            {stock.turnoverRate != null && <div><span>换手率</span><strong>{formatPct(stock.turnoverRate)}</strong></div>}
          </div>
          <p className="review-detail-summary">{stock.summary}</p>
          {stock.evidence?.length > 0 && (
            <div className="review-detail-evidence"><strong>全市场证据</strong><ul>{stock.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
          )}
          <div className="review-hotstock-script"><strong>次日观察：</strong>{stock.nextScript}</div>
          <div className="review-hotstock-invalidation"><strong>失效条件：</strong>{stock.invalidation}</div>
          <div className="review-suggestion"><strong>建议：</strong>{stock.suggestion}</div>
          <button className="review-watch-primary" onClick={addToWatch} disabled={state === 'adding' || state === 'added'} type="button">
            <Plus size={16} />{state === 'added' ? '已加入我的收藏' : state === 'adding' ? '正在添加…' : state === 'error' ? '重试加入收藏' : '加入我的收藏'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SectorCard({ sector, index }: { sector: ReviewSectorAnalysis; index: number }) {
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<ReviewHotStock | null>(null)
  const stocks = (sector.representatives || []).filter((item) => item.type === 'stock' || !item.type)
  return (
    <article className={`review-sector-card review-trend-${sector.trend}`}>
      <button className="review-sector-header" onClick={() => setOpen((value) => !value)} type="button" aria-expanded={open}>
        <span className="review-sector-index">{index + 1}</span>
        <span className="review-sector-title"><strong>{sector.name}</strong><span className="review-sector-stage">{sector.stage}</span></span>
        <span className="review-sector-trend">{trendLabel[sector.trend] || sector.trend}</span>
        <ChevronDown size={16} className={open ? 'open' : ''} />
      </button>
      {open && <div className="review-sector-body">
        <p className="review-sector-summary">{sector.summary}</p>
        {sector.evidence?.length > 0 && <ul className="review-evidence-list">{sector.evidence.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>}
        {stocks.length > 0 && <div className="review-leader-block">
          <strong>个股龙头</strong>
          <div className="review-leader-list">
            {stocks.map((stock) => (
              <button key={stock.code} className="review-leader-chip" onClick={() => setSelected(representativeToStock(stock, sector))} type="button">
                <span>{stock.name}</span><small>{stock.code}</small><em className={(stock.changePercent ?? 0) >= 0 ? 'up' : 'down'}>{formatPct(stock.changePercent)}</em>
              </button>
            ))}
          </div>
          <small className="review-leader-note">均来自全 A 股行业扫描，点击可看详情并收藏</small>
        </div>}
        <div className="review-observation"><strong>观察点：</strong>{sector.observation}</div>
        <div className="review-suggestion"><strong>操作建议：</strong>{sector.suggestion}</div>
      </div>}
      {selected && <InstrumentDetailModal stock={selected} onClose={() => setSelected(null)} />}
    </article>
  )
}

function HotStockRow({ stock }: { stock: ReviewHotStock }) {
  const [detail, setDetail] = useState(false)
  return (
    <article className="review-hotstock-row">
      <button className="review-hotstock-header" onClick={() => setDetail(true)} type="button">
        <span className="review-hotstock-name"><strong>{stock.name}</strong><small>{stock.code}</small></span>
        <span className="review-hotstock-meta">
          <span className={`review-pill ${(stock.changePercent ?? 0) >= 0 ? 'up' : 'down'}`}>{formatPct(stock.changePercent)}</span>
          <span className="review-pill stage">{stock.stage}</span><span className="review-pill role">{stock.role}</span>
        </span>
      </button>
      <div className="review-hotstock-body">
        <p>{stock.summary}</p>
        {stock.evidence?.length > 0 && <ul className="review-evidence-list compact">{stock.evidence.slice(0, 3).map((item, index) => <li key={index}>{item}</li>)}</ul>}
        <div className="review-hotstock-script"><strong>次日剧本：</strong>{stock.nextScript}</div>
        <div className="review-hotstock-invalidation"><strong>失效条件：</strong>{stock.invalidation}</div>
      </div>
      {detail && <InstrumentDetailModal stock={stock} onClose={() => setDetail(false)} />}
    </article>
  )
}

export function GroupedHotStocks({ stocks }: { stocks: ReviewHotStock[] }) {
  const groups = useMemo(() => {
    const result = new Map<string, ReviewHotStock[]>()
    for (const stock of stocks.filter((item) => item.instrumentType === 'stock' || !item.instrumentType)) {
      const sector = stock.sector || '其他'
      result.set(sector, [...(result.get(sector) || []), stock])
    }
    return [...result.entries()]
  }, [stocks])
  if (!groups.length) return <div className="review-empty">暂无全市场热门个股数据</div>
  return <div className="review-hotstock-groups">
    {groups.map(([sector, items]) => <section className="review-hotstock-group" key={sector}>
      <header><div><strong>{sector}</strong><span>全市场行业强势股</span></div><small>{items.length} 只</small></header>
      <div className="review-hotstocks">{items.map((stock) => <HotStockRow key={stock.code} stock={stock} />)}</div>
    </section>)}
  </div>
}
