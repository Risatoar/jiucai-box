import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Bot, CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, Plus, Search, Star, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ChartPeriod, Instrument, MarketBar, WatchItem } from '../../../shared/types'
import { KlineDetailPanel } from './KlineDetailPanel'

type SortKey = 'latestPrice' | 'changePercent' | 'score'

interface WatchlistViewProps {
  items: WatchItem[]
  selected: WatchItem | null
  bars: MarketBar[]
  period: ChartPeriod
  chartLoading: boolean
  chartError: string
  chartRefreshedAt: string
  onPeriod: (period: ChartPeriod) => void
  onSelect: (item: WatchItem) => void
  onSearch: (query: string) => Promise<{ ok: boolean; items?: Instrument[]; error?: string }>
  onAdd: (code: string) => Promise<{ ok: boolean; error?: string }>
  onRemove: (code: string) => Promise<{ ok: boolean; error?: string }>
  onScan: () => Promise<{ ok: boolean; added?: number; updated?: number; removed?: number; active?: number; reviewed?: number; analyzed?: number; scanned?: number; enriched?: number; durationMs?: number; aiDurationMs?: number; sources?: string[]; error?: string }>
}

const instrumentTypeLabel = (type: Instrument['type']) => type === 'stock' ? '股票' : type === 'etf' ? 'ETF' : '可转债'

export function WatchlistView({ items, selected, bars, period, chartLoading, chartError, chartRefreshedAt, onPeriod, onSelect, onSearch, onAdd, onRemove, onScan }: WatchlistViewProps) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | 'user' | 'agent'>('all')
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'changePercent', direction: 'desc' })
  const [adding, setAdding] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<Instrument[]>([])
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null)
  const [activeResult, setActiveResult] = useState(0)
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [searchError, setSearchError] = useState('')
  const [addError, setAddError] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const visible = useMemo(() => items.filter((item) => {
    const matchesQuery = `${item.name}${item.code}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (source === 'all' || item.source === source)
  }).sort((a, b) => (a[sort.key] - b[sort.key]) * (sort.direction === 'asc' ? 1 : -1)), [items, query, source, sort])

  useEffect(() => {
    const normalizedQuery = searchText.trim()
    if (!adding || selectedInstrument || !normalizedQuery) {
      setSearchResults([])
      setSearchState('idle')
      return
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSearchState('loading'); setSearchError('')
      const result = await onSearch(normalizedQuery)
      if (cancelled) return
      setSearchResults(result.items || [])
      setActiveResult(0)
      setSearchState('done')
      if (!result.ok) setSearchError(result.error || '搜索失败')
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [adding, onSearch, searchText, selectedInstrument])

  useEffect(() => {
    if (expandedCode && !items.some((item) => item.code === expandedCode)) setExpandedCode(null)
  }, [expandedCode, items])

  const toggleSort = (key: SortKey) => setSort((current) => current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' })
  const SortIcon = ({ column }: { column: SortKey }) => sort.key !== column ? <ArrowUpDown size={12} /> : sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  const submitAdd = async () => {
    if (saving || !selectedInstrument) return
    setSaving(true); setAddError('')
    const result = await onAdd(selectedInstrument.code)
    setSaving(false)
    if (!result.ok) { setAddError(result.error || '添加失败'); return }
    setSearchText(''); setSelectedInstrument(null); setAdding(false)
  }
  const selectSearchResult = (instrument: Instrument) => {
    setSelectedInstrument(instrument)
    setSearchText(`${instrument.name} · ${instrument.code}`)
    setSearchResults([])
    setSearchState('idle')
    setAddError('')
  }
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && searchResults.length) {
      event.preventDefault(); setActiveResult((value) => (value + 1) % searchResults.length)
    } else if (event.key === 'ArrowUp' && searchResults.length) {
      event.preventDefault(); setActiveResult((value) => (value - 1 + searchResults.length) % searchResults.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const candidate = searchResults[activeResult]
      if (candidate && !items.some((item) => item.code === candidate.code)) selectSearchResult(candidate)
      else if (selectedInstrument) void submitAdd()
    } else if (event.key === 'Escape') {
      setSearchResults([]); setSearchState('idle')
    }
  }
  const scan = async () => {
    setScanning(true); setNotice(null)
    const result = await onScan()
    setScanning(false)
    if (!result.ok) { setNotice({ tone: 'error', text: result.error || '机会分析失败，请稍后重试' }); return }
    const active = result.active || 0
    const elapsed = result.durationMs ? `${(result.durationMs / 1000).toFixed(1)} 秒` : '未知'
    const evidence = `实际扫描 ${result.scanned || 0} 条市场行情，${result.enriched || 0}/${result.analyzed || 0} 个候选完成 K 线与量能验证，AI 推理 ${((result.aiDurationMs || 0) / 1000).toFixed(1)} 秒，总耗时 ${elapsed}`
    const summary = active
      ? `${evidence}。本轮保留 ${active} 个关注机会：新发现 ${result.added || 0} 个，已有机会复核后保留 ${result.updated || 0} 个，移出 ${result.removed || 0} 个。`
      : `${evidence}。本轮没有满足条件的机会，不凑数。`
    setNotice({ tone: 'success', text: summary })
  }
  const toggleExpanded = (item: WatchItem) => {
    onSelect(item)
    setExpandedCode((current) => current === item.code ? null : item.code)
  }

  return (
    <section className="content-view">
      <div className="view-heading"><div><h1>我的关注</h1><p>AI 会从股票、ETF、可转债中筛选 5–10 个关注机会，并重新评估已有发现。行情每 30 秒更新。</p></div><div className="heading-actions"><button className="secondary-button" disabled={scanning} onClick={() => void scan()} type="button"><Bot size={15} />{scanning ? 'AI 分析中…' : '让 AI 找机会'}</button><button className="primary-button" onClick={() => setAdding((value) => !value)} type="button"><Plus size={15} />添加关注</button></div></div>
      {(scanning || notice) && <div className={`watchlist-scan-status ${scanning ? 'loading' : notice?.tone}`} role="status" aria-live="polite">
        {scanning ? <LoaderCircle size={16} /> : notice?.tone === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
        <div><strong>{scanning ? '正在分析全市场机会' : notice?.tone === 'error' ? '分析没有完成' : 'AI 复核完成'}</strong><span>{scanning ? `正在执行市场初筛 → 候选日线与 5/15 分钟结构验证 → AI 重评；包含 ${items.filter((item) => item.source === 'agent').length} 个已有发现，通常需要几十秒。` : notice?.text}</span></div>
      </div>}
      {adding && <div className="watchlist-add">
        <div className="watchlist-search">
          <label htmlFor="watchlist-instrument-search"><span>股票名称 / 证券代码</span></label>
          <div className="watchlist-search-input"><Search size={14} /><input id="watchlist-instrument-search" autoFocus value={searchText} maxLength={30} role="combobox" aria-autocomplete="list" aria-controls="watchlist-search-results" aria-expanded={searchResults.length > 0} onChange={(event) => { setSearchText(event.target.value); setSelectedInstrument(null); setSearchResults([]); setSearchState('idle'); setAddError('') }} onKeyDown={handleSearchKeyDown} placeholder="例如 贵州茅台 / 600519" />{searchState === 'loading' && <span>搜索中…</span>}</div>
          {(searchResults.length > 0 || searchState === 'done') && <div className="watchlist-search-results" id="watchlist-search-results" role="listbox">
            {searchResults.map((instrument, index) => {
              const followed = items.some((item) => item.code === instrument.code)
              return <button className={index === activeResult ? 'active' : ''} disabled={followed} key={instrument.code} onClick={() => selectSearchResult(instrument)} role="option" aria-selected={index === activeResult} type="button"><span><strong>{instrument.name}</strong><small>{instrument.code} · {instrument.exchange} · {instrumentTypeLabel(instrument.type)}</small></span>{followed && <em>已关注</em>}</button>
            })}
            {!searchResults.length && !searchError && <div className="watchlist-search-empty">没有找到匹配的股票、ETF 或可转债</div>}
          </div>}
        </div>
        <button className="primary-button" disabled={!selectedInstrument || saving} onClick={() => void submitAdd()} type="button">{saving ? '添加中…' : '加入关注'}</button>
        <button className="secondary-button" onClick={() => { setAdding(false); setSearchText(''); setSelectedInstrument(null); setSearchResults([]); setSearchError(''); setAddError('') }} type="button">取消</button>
        {(addError || searchError) && <span className="add-error">{addError || searchError}</span>}
      </div>}
      <div className="list-toolbar">
        <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或代码" /></label>
        <div className="segmented-control">
          <button className={source === 'all' ? 'active' : ''} onClick={() => setSource('all')} type="button">全部</button>
          <button className={source === 'user' ? 'active' : ''} onClick={() => setSource('user')} type="button">我的收藏</button>
          <button className={source === 'agent' ? 'active' : ''} onClick={() => setSource('agent')} type="button">AI 发现</button>
        </div>
        <span className="auto-refresh"><span className="live-dot" />30 秒自动刷新</span>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th>名称</th><th>来源</th><th><button onClick={() => toggleSort('latestPrice')} type="button">最新价<SortIcon column="latestPrice" /></button></th><th><button onClick={() => toggleSort('changePercent')} type="button">涨跌幅<SortIcon column="changePercent" /></button></th><th>成交额</th><th><button onClick={() => toggleSort('score')} type="button">综合评分<SortIcon column="score" /></button></th><th /></tr></thead>
          <tbody>{visible.map((item) => {
            const expanded = expandedCode === item.code
            return <Fragment key={item.code}>
            <tr className={`watchlist-row ${selected?.code === item.code ? 'selected' : ''} ${expanded ? 'expanded' : ''}`} tabIndex={0} aria-expanded={expanded} onClick={() => toggleExpanded(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleExpanded(item) } }}>
              <td><div className="instrument-cell"><span className="asset-badge">{item.type === 'cbond' ? '债' : item.type === 'etf' ? 'E' : '股'}</span><div><strong>{item.name}</strong><small>{item.code} · {item.exchange}</small></div></div></td>
              <td>{item.source === 'agent' ? <span className="source-badge agent"><Bot size={12} />AI 发现</span> : <span className="source-badge user"><Star size={12} />我的收藏</span>}</td>
              <td className="number-cell">{item.latestPrice > 0 ? item.latestPrice.toFixed(item.latestPrice < 10 ? 3 : 2) : '--'}</td>
              <td className={`number-cell ${item.latestPrice > 0 ? item.changePercent >= 0 ? 'up' : 'down' : ''}`}>{item.latestPrice > 0 ? `${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%` : '--'}</td>
              <td className="number-cell muted">{item.volume}</td><td><span className="score-pill">{item.score || '--'}</span></td><td><div className="watchlist-row-actions"><button className="icon-button ghost" title={expanded ? '收起 K 线' : '展开 K 线'} aria-label={expanded ? `收起${item.name} K 线` : `展开${item.name} K 线`} onClick={(event) => { event.stopPropagation(); toggleExpanded(item) }} type="button">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button><button className="icon-button ghost" title="移出关注" aria-label={`移出关注：${item.name}`} onClick={(event) => { event.stopPropagation(); void onRemove(item.code) }} type="button"><Trash2 size={14} /></button></div></td>
            </tr>
            {expanded && selected?.code === item.code && <tr className="watchlist-detail-row"><td colSpan={7}><KlineDetailPanel item={selected} bars={bars} period={period} loading={chartLoading} error={chartError} refreshedAt={chartRefreshedAt} onPeriod={onPeriod} onClose={() => setExpandedCode(null)} /></td></tr>}
            </Fragment>
          })}</tbody>
        </table>
      </div>
      {!visible.length && <div className="empty-state"><div className="empty-icon"><Star size={22} /></div><h2>还没有关注的品种</h2><p>你可以按名称或代码添加，也可以让 AI 帮你找一找。</p><button className="primary-button" onClick={() => setAdding(true)} type="button">添加关注</button></div>}
    </section>
  )
}
