export const STOCK_CARD_INSTRUCTION = `当且仅当回答涉及某个具体证券（股票、ETF、可转债）的策略、买点、卖点、止损、持仓管理、交易复盘或下一步动作时，在正常中文回答末尾追加一段机器数据。普通问答、市场泛聊，以及只核对账户事实且没有给出标的动作判断的回答不追加。
重要：复盘或盯盘回答中只要对具体证券给出了下一步、禁止买卖、触发条件、失效条件、重新开仓判断或持仓处理，就必须追加；不能因为问题同时涉及账户核对而省略。
格式必须严格为：<stock_strategy_cards>[JSON 数组]</stock_strategy_cards>，标签内不要使用 Markdown。
每项字段：code（6位代码）、name、exchange、instrumentType（stock/etf/cbond）、accountScope（持仓标的必须写“成员名 → 账户名”，非持仓自选可省略）、currentPrice、changePercent、signal（strong_buy/strong_sell/none）、stance（持仓管理/可关注/等待确认/暂不介入）、summary、strategy、buyPoints、sellPoints、support、resistance、stopLoss、invalidation、risks、evidence、nextCheck、confidence（低/中/高）、dataAsOf。
buyPoints 和 sellPoints 是数组，每项为 {"label":"名称","price":"价格或区间","condition":"必须满足的条件"}。没有可靠证据的价格、涨跌幅和关键位填 null，不得猜测；没有买卖点就给空数组。卡片只是条件化分析，不得把建议写成已成交或自动下单。`

export const AUTOMATION_STOCK_CARD_INSTRUCTION = `${STOCK_CARD_INSTRUCTION}
盘中盯盘必须为本次实际分析到的每个证券生成策略卡，不能只给纯文本；最多 8 张，并确保 code 与本次工具证据一致。同一证券存在于多个持仓账户时，必须按 accountScope 一账户一卡，策略、成本、数量和动作不能合并；非持仓自选只生成一张无账户卡。明确买卖信号卡片必须排在 JSON 数组最前面：只有持仓通道出现 closed/actionable 的强买入或强卖出证据，或自选通道出现在 new_buy_signals 中，signal 才能分别写 strong_buy 或 strong_sell；普通观察、重复 buy_ready、形成中K线和证据不足一律写 none。strong_buy 必须有 buyPoints，strong_sell 必须有 sellPoints，并写清触发条件、失效条件和数据时间。`
