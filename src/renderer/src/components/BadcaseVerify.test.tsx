import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RichMessageContent } from './RichMessageContent'

describe('markdown 渲染 badcase 验证', () => {
  it('账户概览中的 **加粗** 正确渲染，不外露星号', () => {
    const content = '## 我 → 我的主账户\n**持仓事实：** 现金7580元（已确认），总资产7582.09元。\n**策略：** 空仓等待，不急于出手。'
    const html = renderToStaticMarkup(<RichMessageContent content={content} />)
    expect(html).toContain('<strong>持仓事实：</strong>')
    expect(html).not.toContain('**持仓事实')
    expect(html).toContain('<strong>策略：</strong>')
  })

  it('--- 分隔线不再外露为纯文本，结论正文正常展示', () => {
    const content = '结论\n---\n六项门槛全部不通过，禁止改写活动策略。'
    const html = renderToStaticMarkup(<RichMessageContent content={content} />)
    expect(html).not.toContain('><!---')
    expect(html).not.toContain('<p>---</p>')
    expect(html).toContain('六项门槛全部不通过')
    expect(html).toContain('禁止改写活动策略')
  })

  it('证据门槛表格渲染为 table 且不外露分隔符', () => {
    const table = [
      '| 检查项 | 要求 | 当前状态 | 结论 |',
      '|---|---|---|---|',
      '| 样本外准确率 | ≥80% | 30.43% | 不通过 |',
    ].join('\n')
    const content = `证据门槛检查（全部未通过）\n${table}`
    const html = renderToStaticMarkup(<RichMessageContent content={content} />)
    expect(html).toContain('<table>')
    expect(html).toContain('样本外准确率')
    expect(html).not.toContain('|---|')
  })

  it('多段 markdown 正文保持段落结构，不被压成一坨', () => {
    const content = '**持仓事实：** 现金7580元。\n\n**关注池扫描：** 关注列表中000938紫光股份。\n\n**策略：** 空仓等待。'
    const html = renderToStaticMarkup(<RichMessageContent content={content} />)
    expect(html).toContain('<strong>持仓事实：</strong>')
    expect(html).toContain('<strong>关注池扫描：</strong>')
    expect(html).toContain('<strong>策略：</strong>')
  })
})
