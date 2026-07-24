import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveAttachmentBytes } from './attachment-store'
import { buildCodexExecArgs, sendAiMessage, summarizeProcessError } from './ai-provider'

const previousHome = process.env.TRADE_MASTER_HOME
const previousFetch = globalThis.fetch
afterEach(() => { if (previousHome == null) delete process.env.TRADE_MASTER_HOME; else process.env.TRADE_MASTER_HOME = previousHome; globalThis.fetch = previousFetch; vi.useRealTimers(); vi.restoreAllMocks() })

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

  it('keeps unattended Codex runs ephemeral and read-only while preserving local model routing', () => {
    const args = buildCodexExecArgs({ provider: 'codex-local', baseUrl: '', model: 'api-model', codexModel: 'gpt-5.6-terra' }, [], 'automation')
    expect(args).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-rules', '--sandbox', 'read-only']))
    expect(args).not.toContain('--ignore-user-config')
    expect(args).toEqual(expect.arrayContaining(['--model', 'gpt-5.6-terra']))
    expect(args).not.toContain('api-model')
    expect(args.at(-1)).toBe('-')
  })

  it('passes the bare alias for a managed third-party Codex model', () => {
    const args = buildCodexExecArgs({ provider: 'codex-local', baseUrl: '', model: '', codexModel: 'auto_model/alwaysday1' }, [], 'chat')
    expect(args).toEqual(expect.arrayContaining(['--model', 'alwaysday1']))
    expect(args).not.toContain('auto_model/alwaysday1')
  })

  it('keeps memory extraction ephemeral and read-only', () => {
    const args = buildCodexExecArgs({ provider: 'codex-local', baseUrl: '', model: 'gpt-5' }, [], 'memory')
    expect(args).toEqual(expect.arrayContaining(['--ephemeral', '--ignore-rules', '--sandbox', 'read-only']))
    expect(args).not.toContain('--ignore-user-config')
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

  it('stops an API request at the configured model timeout', async () => {
    vi.useFakeTimers()
    globalThis.fetch = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })) as typeof fetch
    const pending = sendAiMessage(
      { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', apiKey: 'test', timeoutSeconds: 30 },
      [{ role: 'user', content: '测试模型超时' }]
    )
    const rejection = expect(pending).rejects.toThrow('AI 执行超过 30 秒')
    await vi.advanceTimersByTimeAsync(30_000)
    await rejection
  })

  it('enables Codex JSONL output for interactive streaming', () => {
    const args = buildCodexExecArgs({ provider: 'codex-local', baseUrl: '', model: '' }, [], 'chat', true, '/tmp/trade-master')
    expect(args).toContain('--json')
    expect(args).not.toContain('--model')
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write', '--cd', '/tmp/trade-master']))
    expect(args).toEqual(expect.arrayContaining(['-c', 'approval_policy="never"']))
  })
})
