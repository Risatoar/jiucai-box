import type { VocEvent, VocInboxItem } from './voc'

const stockMarketTerms = /股票|股市|股民|炒股|A股|证券|个股|大盘|上证|深证|创业板|科创板|北交所|同花顺|东方财富|仓位|持仓|加仓|补仓|减仓|清仓|空仓|割肉|止盈|卖飞|踏空|涨停|跌停|牛市|熊市|板块|基金|ETF|可转债|收盘|开盘|盘中|套牢|解套|回本|交易日|科技股?|半导体|半導體|芯片|晶片|CPU|有色|多单|空单|对冲|對沖/i
const stockMarketMetaphors = /侥幸逃离火场之后不要返回|逃离火场.{0,8}不要返回/i
const sportsBettingTerms = /买球|赌球|足彩|竞彩|赔率|盘口|让球|串关|世界杯|欧洲杯|欧冠|英超|西甲|德甲|意甲|法甲|中超|阿根廷|巴西队|足球|篮球|球赛|比赛结果|夺冠/i

export const vocEvidenceText = (event: Pick<VocInboxItem, 'title' | 'text' | 'transcript' | 'metadata'>) => [
  event.title,
  event.text,
  event.transcript,
  event.metadata?.screenText
].filter((item): item is string => typeof item === 'string').join(' ')

export const isStockMarketVocEvent = (event: VocEvent | VocInboxItem) => {
  const evidence = vocEvidenceText(event)
  if (!stockMarketTerms.test(evidence) && !stockMarketMetaphors.test(evidence)) return false
  if (sportsBettingTerms.test(evidence) && !/股票|股市|炒股|A股|证券|大盘|仓位|持仓|同花顺/.test(evidence)) return false
  return true
}
