import { describe, expect, it } from 'vitest'
import { authorizationFromResponse, authorizedUserFromStatus, chatsFromResponse } from './feishu-connection'

describe('authorizedUserFromStatus', () => {
  it('extracts the current user only from a verified valid login', () => {
    expect(authorizedUserFromStatus({
      verified: true,
      identities: { user: { status: 'ready', tokenStatus: 'valid', openId: 'ou_current', userName: '许翔' } }
    })).toEqual({ openId: 'ou_current', userName: '许翔' })
  })

  it('rejects stale or incomplete login state', () => {
    expect(authorizedUserFromStatus({
      verified: true,
      identities: { user: { status: 'ready', tokenStatus: 'expired', openId: 'ou_current' } }
    })).toBeNull()
  })
})

describe('authorizationFromResponse', () => {
  it('accepts the lark-cli success envelope', () => {
    expect(authorizationFromResponse({ data: { device_code: 'device-code', verification_url: 'https://open.feishu.cn/auth' } })).toEqual({
      deviceCode: 'device-code', verificationUrl: 'https://open.feishu.cn/auth'
    })
  })
})

describe('chatsFromResponse', () => {
  it('extracts selectable active groups from the lark-cli envelope', () => {
    expect(chatsFromResponse({ data: { chats: [
      { chat_id: 'oc_trading', name: '交易提醒', description: '盘中风险', external: false, chat_status: 'normal' },
      { chat_id: 'oc_dissolved', name: '已解散', chat_status: 'dissolved' }
    ] } })).toEqual([{ chatId: 'oc_trading', name: '交易提醒', description: '盘中风险', external: false }])
  })

  it('ignores malformed non-group results', () => {
    expect(chatsFromResponse({ chats: [{ chat_id: 'ou_user', name: '用户' }, { chat_id: 'oc_missing_name' }] })).toEqual([])
  })
})
