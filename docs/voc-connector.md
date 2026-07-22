# 场外 VOC 采集接入

韭菜盒子使用独立 Chrome 用户目录读取用户授权后可见的微博、抖音公开主页。应用不读取或导出 Cookie、密码、私信和关注列表，只访问 `sources.json` 中的白名单主页；采集结果写入 `~/.trade-master/voc/inbox/`，再由应用完成去重、审计、AI 摘要、风险合流和通知。

## 首次登录

1. 打开“场外情绪”。
2. 点击“登录采集浏览器”。
3. 在打开的独立 Chrome 窗口分别登录微博和抖音。
4. 登录完成后直接关闭该 Chrome 窗口。后台采集会自动切回无界面模式。

该登录态只保存在 `~/.trade-master/voc/chrome-profile/`。登录窗口未关闭时后台采集会暂停，不会强行关闭正在进行的登录流程。

## 目录约定

- `sources.json`：监控账号、唯一主页、状态和反指权重。
- `inbox/*.json`：连接器尚未消费的新内容。
- `processed/`：已成功消费的原始输入。
- `rejected/`：格式不正确或账号不匹配的输入。
- `events/YYYY-MM-DD/`：去重后的不可变内容事件。
- `reports/`：有新增内容时生成的风险摘要与结构化仓位动作。
- `collector-state.json`：每个账号最近检查时间和已见内容 ID。
- `chrome-profile/`：专用 Chrome 登录态，由 Chrome 自己管理。
- `models/`：本地 Whisper 语音模型缓存。

## 输入格式

每个文件只放一条内容，必须是 JSON：

```json
{
  "schemaVersion": 1,
  "sourceId": "weibo-fengge",
  "platform": "weibo",
  "contentId": "平台内稳定内容ID",
  "publishedAt": "2026-07-21T08:30:00.000+08:00",
  "capturedAt": "2026-07-21T08:31:10.000+08:00",
  "url": "https://原始内容链接",
  "mediaType": "video",
  "title": "可选标题",
  "text": "可选正文",
  "transcript": "视频或直播的可选逐字稿",
  "metadata": {
    "collector": "连接器名称",
    "authorId": "平台稳定账号ID"
  }
}
```

`title`、`text`、`transcript` 至少提供一个。视频会先读取公开文案，再使用 FFmpeg 提取音频、本地 Whisper 转写，并对关键帧执行 macOS Vision OCR。识别失败时仍保留文案，但不得根据封面或标题推断博主的真实买卖动作。

## 运行规则

- 每个账号默认至少间隔 3 分钟检查，账号之间串行错峰。
- 只有新内容 ID 才打开详情页并执行音视频识别。
- 第一次接入每个账号只处理最新一条，避免历史内容集中触发提醒。
- 原始视频只进入临时目录，识别完成后删除；临时签名媒体地址不写入事件仓。
- DOM 读取严格限制在博文、作品详情容器，不扫描消息侧栏或评论区。
- 首次视频转写会下载本地 Whisper 模型，因此第一条视频可能耗时较长。

## 当前账号 ID

- `weibo-fengge`：微博，峰哥亡命天涯。
- `douyin-wangxiaoyu`：抖音，王小雨。
- `douyin-dazengzi`：抖音，大曾子。
- `douyin-xianxian`：抖音，闲闲。
- `douyin-xianxian-husband`：抖音，闲闲老公。

以上账号已绑定用户确认的唯一主页。只有连接器成功送入至少一条可验证内容后，账号才显示“采集正常”。

## 分析边界

- 必须区分博主原话、连接器元数据和模型推断。
- 仓位动作统一记录为：买入、加仓、减仓、清仓、空仓、割肉、止盈、卖飞、踏空、持仓未动或未确认。
- 每条动作必须关联当前新增内容的 `sourceId`、`contentId`，并保存原文或逐字稿中可逐字核验的 `evidence`；证据不在原始内容中时直接丢弃。
- “准备减仓”“想卖”“如果跌了就割”等计划、观点和条件句不能记为已执行动作；无法确认执行结果时使用“未确认”。
- 卖飞表示卖出后标的继续上涨，踏空表示未持有且错过上涨；仅有看空、卖出或上涨中的任一单独证据都不足以得出结论。
- `positionAfter` 只记录空仓、轻仓、半仓、重仓、满仓或未知；原文没有仓位比例时不得臆测。
- 情绪只记录恐慌、谨慎、中性、乐观、亢奋、踏空焦虑或未知，每条情绪同样必须保留原句证据。
- 每次有新增内容时，同时更新当天综合结论和近 7 日趋势；按账号展示最新推测仓位、情绪变化、今日动作和近期操作轨迹。
- 时间优先使用原始发布时间，不使用采集时间替代行为发生时间。
- 反指因子只提高风险警惕，必须与价格位置、量价、资金流、账户和纪律交叉验证。
- 无新增内容返回 `NO_REPLY`，不重复发送旧摘要。

风险报告中的结构化字段示例：

```json
{
  "trendSummary": {
    "today": "今天各账号的持仓、情绪与操作变化",
    "recent": "近7日各账号的持仓、情绪与操作趋势"
  },
  "positionActions": [
    {
      "sourceId": "douyin-xianxian",
      "contentId": "平台内容ID",
      "action": "减仓",
      "positionAfter": "轻仓",
      "occurredAt": "2026-07-21T14:30:00.000+08:00",
      "asset": "可选标的",
      "sector": "可选板块",
      "evidence": "可在原文中逐字找到的证据",
      "confidence": "高"
    }
  ],
  "sentimentObservations": [
    {
      "sourceId": "douyin-xianxian",
      "contentId": "平台内容ID",
      "sentiment": "踏空焦虑",
      "occurredAt": "2026-07-21T14:30:00.000+08:00",
      "evidence": "可在原文中逐字找到的情绪证据",
      "confidence": "高"
    }
  ]
}
```
