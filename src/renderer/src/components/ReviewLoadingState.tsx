import { BarChart3, Flame, LoaderCircle, ScanSearch } from 'lucide-react'

interface ReviewLoadingStateProps {
  selectionLabel: string
  periodLabel: string
  stageText: string
}

export function ReviewLoadingState({ selectionLabel, periodLabel, stageText }: ReviewLoadingStateProps) {
  return (
    <div className="review-loading-panel" role="status" aria-live="polite">
      <div className="review-loading-copy">
        <span className="review-loading-icon"><LoaderCircle size={18} className="spinning" /></span>
        <div>
          <strong>正在生成{selectionLabel}{periodLabel}</strong>
          <span>{stageText} 结果生成后会直接保留在当前页面。</span>
        </div>
      </div>

      <div className="review-loading-steps" aria-label="复盘分析内容">
        <div><BarChart3 size={15} /><span><strong>全市场行情</strong><small>指数、涨跌家数与市场强弱</small></span></div>
        <div><Flame size={15} /><span><strong>热门方向</strong><small>板块热度、龙头与风险变化</small></span></div>
        <div><ScanSearch size={15} /><span><strong>历史复核</strong><small>AI 候选与买卖信号表现</small></span></div>
      </div>

      <div className="review-loading-preview" aria-hidden="true">
        <div className="review-loading-preview-heading">
          <span />
          <i />
        </div>
        <div className="review-loading-preview-metrics">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
        <div className="review-loading-preview-body">
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}
