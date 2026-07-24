import { conceptTagsFromCode } from './concept-code-map'
// 前端概念板块兜底推导：复刻后端 candidate-market-context 的 CONCEPT_RULES，
// 用于存量 watchlist 数据缺少 concepts/theme/industry 字段时，从名称与代码推导概念标签。
// 数据来源优先级：后端落盘的 concepts > theme/sector > 这里的名称推导。

export interface ConceptRule {
  name: string
  pattern: RegExp
}

export const CONCEPT_RULES: ConceptRule[] = [
  { name: '芯片设计', pattern: /芯片设计|Fabless|SoC|主控|MCU|单片机|集成电路|芯片制造|晶圆代工|晶圆厂|IDM/ },
  { name: '半导体设备', pattern: /半导体设备|晶圆设备|刻蚀|薄膜沉积|检测设备/ },
  { name: '半导体材料', pattern: /半导体材料|硅片|光刻胶|电子特气|靶材|封装材料/ },
  { name: '存储芯片', pattern: /存储|DRAM|NAND|Flash|NOR|内存/ },
  { name: '封测', pattern: /封测|封装|测试|SIP|先进封装/ },
  { name: '光刻胶', pattern: /光刻胶|光掩膜/ },
  { name: 'PCB', pattern: /PCB|印制电路|覆铜板|CCL|高频板/ },
  { name: '光模块', pattern: /光模块|CPO|高速铜缆|硅光/ },
  { name: 'AI算力', pattern: /AI算力|算力|服务器|GPU|液冷/ },
  { name: '大模型', pattern: /大模型|LLM|生成式AI|AIGC|多模态/ },
  { name: '人工智能', pattern: /人工智能|AI|智能|机器视觉|语音识别/ },
  { name: '云计算', pattern: /云计算|云服务|IDC|数据中心/ },
  { name: '网络安全', pattern: /网络安全|信息安全|信创|密码/ },
  { name: '机器人', pattern: /机器人|机械手|协作机器人/ },
  { name: '减速器', pattern: /减速器|谐波|RV减速|行星减速/ },
  { name: '智能制造', pattern: /智能制造|工业互联|工业软件|自动化/ },
  { name: '低空经济', pattern: /低空经济|eVTOL|飞行汽车|无人机|通航/ },
  { name: '卫星互联网', pattern: /卫星|商业航天|北斗|星网/ },
  { name: '新能源车', pattern: /新能源车|电动汽车|智能驾驶|车联网/ },
  { name: '锂电池', pattern: /锂电|动力电池|电芯|电池回收/ },
  { name: '固态电池', pattern: /固态电池|半固态/ },
  { name: '光伏', pattern: /光伏|太阳能|硅料|硅片|组件/ },
  { name: '逆变器', pattern: /逆变器|储能变流器|PCS/ },
  { name: '储能', pattern: /储能|电池储能/ },
  { name: '风电', pattern: /风电|海上风电|风机/ },
  { name: '氢能', pattern: /氢能|燃料电池|加氢/ },
  { name: '创新药', pattern: /创新药|CXO|CRO|CDMO|小分子药/ },
  { name: '医疗器械', pattern: /医疗器械|诊断|检测|影像设备/ },
  { name: '疫苗', pattern: /疫苗|免疫/ },
  { name: '军工', pattern: /军工|国防|航天|航空|卫星导航/ },
  { name: '大飞机', pattern: /大飞机|航空发动机|商用航发/ },
  { name: '船舶', pattern: /船舶|造船|海工装备/ },
  { name: '证券', pattern: /证券|券商|投行/ },
  { name: '银行', pattern: /银行/ },
  { name: '保险', pattern: /保险/ },
  { name: '房地产', pattern: /地产|房地产|物业/ },
  { name: '建筑建材', pattern: /建筑|建材|水泥|玻璃/ },
  { name: '有色金属', pattern: /有色|铜|铝|锌|铅锌/ },
  { name: '黄金', pattern: /黄金|金价|贵金属/ },
  { name: '稀土', pattern: /稀土|永磁|钕铁硼/ },
  { name: '煤炭', pattern: /煤炭|焦煤/ },
  { name: '石油石化', pattern: /石油|石化|原油|天然气/ },
  { name: '电力', pattern: /电力|火电|水电|核电|电网/ },
  { name: '消费电子', pattern: /消费电子|手机|PC|平板|VR|AR|穿戴/ },
  { name: '家电', pattern: /家电|白电|黑电|厨电/ },
  { name: '食品饮料', pattern: /食品|饮料|白酒|啤酒|乳业/ },
  { name: '旅游酒店', pattern: /旅游|酒店|免税|景区/ },
  { name: '零售', pattern: /零售|超市|百货|电商/ },
  { name: '传媒游戏', pattern: /传媒|游戏|影视|广告/ },
  { name: '港股科技', pattern: /港股科技|恒生科技|互联网/ },
]

export function inferConceptTags(...texts: Array<string | undefined | null>): string[] {
  const text = texts.filter(Boolean).join(' ')
  if (!text) return []
  return CONCEPT_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name)
}

// 给单只股票推导概念：优先用后端字段，缺失时从名称兜底
export function resolveConceptTags(item: {
  type: string
  name: string
  code?: string
  concepts?: string[] | null
  theme?: string | null
  sector?: string | null
}): string[] {
  if (item.type !== 'stock') return []
  if (Array.isArray(item.concepts) && item.concepts.length) return item.concepts
  const fromName = inferConceptTags(item.name, item.code)
  if (fromName.length) return fromName
  const fromCode = conceptTagsFromCode(item.code)
  if (fromCode.length) return fromCode
  if (item.sector) return [item.sector]
  if (item.theme) return [item.theme]
  return []
}
