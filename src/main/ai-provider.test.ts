import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveAttachmentBytes } from './attachment-store'
import { buildCodexExecArgs, sendAiMessage, summarizeProcessError } from './ai-provider'

const previousHome = process.env.TRADE_MASTER_HOME
const previousFetch = globalThis.fetch
afterEach(() => { if (previousHome == null) delete process.env.TRADE_MASTER_HOME; else process.env.TRADE_MASTER_HOME = previousHome; globalThis.fetch = previousFetch; vi.restoreAllMocks() })

describe('sendAiMessage attachments', () => {
  it('uses Responses multimodal input when a message contains a file', async () => {
    process.env.TRADE_MASTER_HOME = await mkdtemp(join(tmpdir(), 'jiucai-ai-file-'))
    const attachment = await saveAttachmentBytes('session-1', { name: 'note.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('真实附件') })
    let requestBody = ''
    globalThis.fetch = vi.fn(async (_url, init) => { requestBody = String(init?.body); return new Response(JSON.stringify({ output_text: '已读取附件' }), { status: 200 }) }) as typeof fetch
    const result = await sendAiMessage({ provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', apiKey: 'test' }, [{ role: 'user', content: '分析', attachments: [attachment] }])
    expect(result).toBe('已读取附件')
    expect(requestBody).toContain('input_file')
    expect(requestBody).toContain('data:text/plain;base64')
  })

  it('isolates unattended Codex runs from interactive MCP and user configuration', () => {
    const args = buildCodexExecArgs({ provider: 'codex-local', baseUrl: '', model: 'gpt-5' }, [], 'automation')
    expect(args).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only']))
    expect(args).not.toContain('--model')
    expect(args).not.toContain('gpt-5')
    expect(args.at(-1)).toBe('-')
  })

  it('isolates memory extraction from tools and user configuration', () => {
    const args = buildCodexExecArgs({ provider: 'codex-local', baseUrl: '', model: 'gpt-5' }, [], 'memory')
    expect(args).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only']))
  })

  it('keeps only the useful Codex error instead of storing the full process log', () => {
    const stderr = 'WARN noisy startup\nuser\nvery long prompt\nERROR: {"error":{"message":"model is not supported"}}\n'
    expect(summarizeProcessError(stderr, 1)).toBe('model is not supported')
  })

  it('streams chat completion deltas and returns the complete text', async () => {
    const events: string[] = []
    const stream = [
      'data: {"choices":[{"delta":{"content":"流式"}}]}', '',
      'data: {"choices":[{"delta":{"content":"成功"}}]}', '',
      'data: [DONE]', ''
    ].join('\n')
    globalThis.fetch = vi.fn(async () => new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch
    const result = await sendAiMessage(
      { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', apiKey: 'test' },
      [{ role: 'user', content: '测试' }],
      { onEvent: (event) => { if (event.content) events.push(event.content) } }
    )
    expect(result).toBe('流式成功')
    expect(events).toEqual(['流式', '成功'])
  })

  it('allows an active API request to be stopped', async () => {
    const controller = new AbortController()
    globalThis.fetch = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as typeof fetch
    const pending = sendAiMessage(
      { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', apiKey: 'test' },
      [{ role: 'user', content: '测试停止' }],
      { signal: controller.signal }
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('enables Codex JSONL output for interactive streaming', () => {
    const args = buildCodexExecArgs({ provider: 'codex-local', baseUrl: '', model: '' }, [], 'chat', true, '/tmp/trade-master')
    expect(args).toContain('--json')
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write', '--cd', '/tmp/trade-master']))
    expect(args).toEqual(expect.arrayContaining(['-c', 'approval_policy="never"']))
  })
})
