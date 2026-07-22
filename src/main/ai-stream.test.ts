import { describe, expect, it } from 'vitest'
import { parseCodexJsonLine, readSseJson } from './ai-stream'

describe('AI stream parsing', () => {
  it('turns Codex lifecycle and agent messages into UI events', () => {
    expect(parseCodexJsonLine('{"type":"turn.started"}').streamEvent?.message).toContain('正在理解')
    const message = parseCodexJsonLine('{"type":"item.completed","item":{"type":"agent_message","text":"正在核对持仓"}}')
    expect(message.finalText).toBe('正在核对持仓')
    expect(message.streamEvent).toMatchObject({ type: 'content', mode: 'replace' })
    expect(parseCodexJsonLine('{"type":"turn.completed"}').completed).toBe(true)
  })

  it('parses SSE frames split across stream chunks', async () => {
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"response.output_'))
        controller.enqueue(encoder.encode('text.delta","delta":"完成"}\n\n'))
        controller.close()
      }
    }), { headers: { 'Content-Type': 'text/event-stream' } })
    const events: Array<Record<string, unknown>> = []
    await readSseJson(response, (event) => events.push(event))
    expect(events).toEqual([{ type: 'response.output_text.delta', delta: '完成' }])
  })
})
