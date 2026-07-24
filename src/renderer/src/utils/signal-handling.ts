import type { HouseholdSnapshot, StockSignalHandlingStatus, StockStrategyCardData } from '../../../shared/types'

export const signalTradeSide = (card: StockStrategyCardData): 'buy' | 'sell' | null => {
  if (card.signal === 'immediate_buy' || card.signal === 'strong_buy' || card.signal === 'prepare_buy') return 'buy'
  if (card.signal === 'immediate_sell' || card.signal === 'strong_sell' || card.signal === 'prepare_sell') return 'sell'
  return null
}

export const signalLabel = (card: StockStrategyCardData) => {
  const immediateExpired = card.signal?.startsWith('immediate_')
    && (!card.executionValidUntil || !Number.isFinite(Date.parse(card.executionValidUntil)) || Date.parse(card.executionValidUntil) <= Date.now())
  if (immediateExpired) return card.signal === 'immediate_sell' ? '推荐卖出（当前点位已过期）' : '推荐买入（当前点位已过期）'
  if (card.signal === 'immediate_buy') return '立即买入'
  if (card.signal === 'immediate_sell') return '立即卖出'
  if (card.signal === 'strong_buy') return '推荐买入'
  if (card.signal === 'strong_sell') return '推荐卖出'
  if (card.signal === 'prepare_buy') return '准备买入'
  if (card.signal === 'prepare_sell') return '准备卖出'
  return '关注'
}

export const handlingLabel = (status: StockSignalHandlingStatus, side: 'buy' | 'sell' | null) => {
  if (status === 'executed') return side === 'sell' ? '已卖出登记' : '已买入登记'
  if (status === 'watching') return '继续观察'
  return '暂不处理'
}

const splitScope = (scope?: string) => {
  if (!scope) return null
  const [memberName, accountName] = scope.split(/\s*(?:→|->)\s*/).map((value) => value.trim())
  return { memberName, accountName }
}

export const resolveSignalAccountId = (card: StockStrategyCardData, household: HouseholdSnapshot) => {
  const scope = splitScope(card.accountScope)
  if (!scope) return household.accounts.find((account) => account.source === 'primary')?.id || household.accounts[0]?.id || ''
  const members = new Map(household.members.map((member) => [member.id, member]))
  const exact = household.accounts.find((account) => {
    const member = members.get(account.memberId)
    const memberMatches = member?.name === scope.memberName || (scope.memberName === '我' && member?.isOwner)
    return memberMatches && account.name === scope.accountName
  })
  if (exact) return exact.id
  const accountMatches = household.accounts.filter((account) => account.name === scope.accountName)
  return accountMatches.length === 1 ? accountMatches[0].id : ''
}

export const priceFromSignal = (value?: string) => {
  const match = value?.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? match[0] : ''
}
