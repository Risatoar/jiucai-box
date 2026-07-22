import { describe, expect, it } from 'vitest'
import { incomingMessageFromLine, questionFromIncoming, type FeishuIncomingMessage } from './feishu-conversation'

const message = (patch: Partial<FeishuIncomingMessage> = {}): FeishuIncomingMessage => ({
  eventId: 'evt_1',
  messageId: 'om_message_1',
  chatId: 'oc_chat_1',
  chatType: 'p2p',
  senderId: 'ou_user_1',
  messageType: 'text',
  content: '帮我看看今天的持仓',
  ...patch
})

describe('Feishu conversation event parsing', () => {
  it('parses a flat lark-cli receive event', () => {
    const parsed = incomingMessageFromLine(JSON.stringify({
      event_id: 'evt_1', message_id: 'om_message_1', chat_id: 'oc_chat_1',
      chat_type: 'p2p', sender_id: 'ou_user_1', message_type: 'text', content: '你好'
    }))
    expect(parsed).toMatchObject({ chatType: 'p2p', content: '你好', senderId: 'ou_user_1' })
  })

  it('accepts private chat messages directly', () => {
    expect(questionFromIncoming(message())).toBe('帮我看看今天的持仓')
  })

  it('only accepts group messages with a leading bot mention', () => {
    expect(questionFromIncoming(message({ chatType: 'group', content: '@韭菜盒子 帮我看看今天的策略' }))).toBe('帮我看看今天的策略')
    expect(questionFromIncoming(message({ chatType: 'group', content: '<at user_id="ou_bot">韭菜盒子</at> 今天有什么风险？' }))).toBe('今天有什么风险？')
    expect(questionFromIncoming(message({ chatType: 'group', content: '大家今天有什么策略？' }))).toBeNull()
  })

  it('ignores bot senders, cards and malformed lines', () => {
    const flat = { event_id: 'evt_1', message_id: 'om_message_1', chat_id: 'oc_chat_1', chat_type: 'p2p', sender_id: 'ou_user_1', message_type: 'text', content: '你好' }
    expect(incomingMessageFromLine(JSON.stringify({ ...flat, sender_type: 'bot' }))).toBeNull()
    expect(incomingMessageFromLine(JSON.stringify({ ...flat, message_type: 'interactive' }))).toBeNull()
    expect(incomingMessageFromLine('{bad json')).toBeNull()
  })
})
