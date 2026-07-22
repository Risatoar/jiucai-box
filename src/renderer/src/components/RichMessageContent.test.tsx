import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RichMessageContent } from './RichMessageContent'

describe('RichMessageContent', () => {
  it('把自动化无变化结果展示为状态模块', () => {
    const html = renderToStaticMarkup(<RichMessageContent content="定时任务「盘中盯盘」执行完成，本次没有材料变化（NO_REPLY）。" />)

    expect(html).toContain('message-result-banner no_change')
    expect(html).toContain('盘中盯盘')
    expect(html).toContain('无变化')
  })

  it('展示风险、下一步和可交互追问', () => {
    const html = renderToStaticMarkup(<RichMessageContent content={'结论：先观察。\n风险：\n- 跌破支撑\n下一步：\n- 等待确认'} onFollowUp={() => undefined} />)

    expect(html).toContain('message-module-section warning')
    expect(html).toContain('message-module-section action')
    expect(html).toContain('复制')
    expect(html).toContain('查看原文')
    expect(html).toContain('转成清单')
    expect(html).toContain('复核风险')
  })

  it('普通短回答也保留复制和快速追问', () => {
    const html = renderToStaticMarkup(<RichMessageContent content="暂时没有新变化。" onFollowUp={() => undefined} />)

    expect(html).toContain('暂时没有新变化。')
    expect(html).toContain('复制')
    expect(html).not.toContain('message-result-banner')
  })

  it('长分析模块默认展开，同时允许用户手动收起', () => {
    const items = Array.from({ length: 6 }, (_, index) => `- 第 ${index + 1} 项市场变化`).join('\n')
    const html = renderToStaticMarkup(<RichMessageContent content={`市场走势与异动：\n${items}`} />)

    expect(html).toContain('message-module-sections single')
    expect(html).toContain('<details class="message-module-section neutral standard" open="">')
    expect(html).toContain('6 项')
  })

  it('多账户使用整行独立账户模块展示', () => {
    const html = renderToStaticMarkup(<RichMessageContent content={'## 我 → 我的主账户\n- 现金 7580 元\n## 老婆 → 老婆的账户\n- 鹏辉能源 300 股'} />)

    expect(html.match(/message-module-section neutral account/g)).toHaveLength(2)
    expect(html).toContain('我的主账户')
    expect(html).toContain('老婆的账户')
    expect(html.match(/独立账户/g)).toHaveLength(2)
  })
})
