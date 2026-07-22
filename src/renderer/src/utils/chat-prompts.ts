export interface ChatQuickAction {
  label: string
  prompt: string
}

interface EmptyStateChatQuickAction extends ChatQuickAction {
  emptyLabel: string
}

export const chatQuickActions: EmptyStateChatQuickAction[] = [
  { label: '检查家庭持仓', emptyLabel: '帮我分别看看家庭账户安全吗', prompt: '请按家庭成员和账户分别检查当前持仓风险，不要合并成本和数量。' },
  { label: '今日关注', emptyLabel: '今天还有什么值得关注？', prompt: '今天还有什么值得关注？' },
  { label: '今日交易策略', emptyLabel: '给我今天的交易策略', prompt: '请结合家庭持仓、关注标的和交易规则，按成员和账户分别给我今天的交易策略。' },
  { label: '明日交易策略', emptyLabel: '提前制定明天的交易策略', prompt: '请结合家庭持仓、关注标的和交易规则，按成员和账户分别制定明天的交易策略。' },
  { label: '复盘今天买卖', emptyLabel: '帮我复盘今天的买卖', prompt: '帮我复盘今天的买卖' }
]

export const automationQuickActions: ChatQuickAction[] = [
  { label: '总结本次结果', prompt: '请用三个要点总结本次定时任务结果，并明确最重要的下一步。' },
  { label: '逐只解释策略', prompt: '请按本次结果涉及的每个标的，逐只用白话解释当前判断、触发条件、失效条件和下一检查点。' },
  { label: '重新核对持仓', prompt: '请基于最新家庭持仓和交易记录，重新核对本次定时任务结论；不同成员和账户不要合并。' },
  { label: '下一检查点', prompt: '请只列出本次结果的下一检查时间、需要观察的数据，以及什么变化才需要提醒我。' },
  { label: '解释提醒原因', prompt: '请解释本次定时任务为什么提醒或没有提醒，并指出所依据的材料变化。' }
]

export const emptyStateSuggestions = chatQuickActions.map(({ emptyLabel: label, prompt }) => ({ label, prompt }))
