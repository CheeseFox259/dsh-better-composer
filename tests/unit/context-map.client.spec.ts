import { describe, expect, it } from 'vitest'
import { formatTokens, summarizeContextWindow } from '../../src/client/context-map.ts'

function event(type: string, data: unknown) {
  return { type: 'event', event: { type, seq: 0, time: 0, data } }
}

describe('context window summary', () => {
  it('folds message, tool, and file events into structure cards', () => {
    const entries = [
      event('user/message', { role: 'user', content: [{ type: 'text', text: 'a'.repeat(400) }, { type: 'file', name: 'a.ts' }] }),
      event('assistant/message', { content: [{ type: 'text', text: 'b'.repeat(200) }], usage: { outputTokens: 60 } }),
      event('tool/call', { name: 'read' }),
      event('tool/result', { message: { source: { callId: 'c1' } } }),
      { type: 'transient', event: { type: 'assistant/attempt' } },
      'garbage',
      null,
    ]

    const summary = summarizeContextWindow(entries, 7)

    expect(summary.revision).toBe(7)
    expect(summary.userMessages).toBe(1)
    expect(summary.assistantMessages).toBe(1)
    expect(summary.toolCalls).toBe(1)
    expect(summary.toolResults).toBe(1)
    expect(summary.fileRefs).toBe(1)
    expect(summary.assistantOutputTokens).toBe(60)
    expect(summary.estimatedMessageTokens).toBe(150)
    expect(summary.turns).toHaveLength(1)
    expect(summary.turns[0]).toEqual({ index: 1, userTokens: 100, assistantTokens: 60 })
  })

  it('starts a new turn per user message and keeps the last twenty', () => {
    const entries = []
    for (let turn = 0; turn < 25; turn += 1) {
      entries.push(event('user/message', { content: [{ type: 'text', text: 'x'.repeat(40) }] }))
      entries.push(event('assistant/message', { content: [{ type: 'text', text: 'y'.repeat(80) }] }))
    }

    const summary = summarizeContextWindow(entries, 1)

    expect(summary.userMessages).toBe(25)
    expect(summary.turns).toHaveLength(20)
    expect(summary.turns[0]?.index).toBe(6)
    expect(summary.turns.at(-1)?.index).toBe(25)
  })

  it('falls back to char estimates when usage is absent', () => {
    const summary = summarizeContextWindow([
      event('assistant/message', { content: [{ type: 'text', text: 'z'.repeat(800) }] }),
    ], 0)

    expect(summary.assistantOutputTokens).toBe(0)
    expect(summary.turns[0]?.assistantTokens).toBe(200)
  })
})

describe('token formatting', () => {
  it('compacts large counts', () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12_400)).toBe('12.4k')
    expect(formatTokens(2_300_000)).toBe('2.3M')
  })
})

describe('context browser model', () => {
  it('folds system nodes, tool inventory, and turn/step hierarchy', async () => {
    const { buildContextBrowser } = await import('../../src/client/context-map.ts')
    const entries = [
      event('system/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'You are helpful.' }] } }),
      event('request/header', { header: { config: { provider: 'deepseek', model: 'v4' }, tools: [
        { name: 'read', description: 'Read a file' },
        { name: 'bash', description: '' },
      ] } }),
      event('turn/start', { turn: 1 }),
      event('user/message', { turn: 1, step: 1, content: [{ type: 'text', text: 'hi' }], source: { kind: 'direct' } }),
      event('step/start', { turn: 1, step: 1 }),
      event('assistant/message', { turn: 1, step: 1, content: [{ type: 'text', text: 'hello' }], usage: { outputTokens: 9 } }),
      event('turn/end', { turn: 1, reason: 'completed' }),
      event('turn/start', { turn: 2 }),
      event('user/message', { turn: 2, step: 1, content: [{ type: 'text', text: 'again' }], surfaceOp: { op: 'replace' }, source: { kind: 'plugin', plugin: 'compact' } }),
    ]

    const model = buildContextBrowser(entries)

    expect(model.systemNodes).toHaveLength(1)
    expect(model.systemNodes[0]?.text).toBe('You are helpful.')
    expect(model.tools.map(tool => tool.name)).toEqual(['read', 'bash'])
    expect(model.tools[0]?.schemaChars).toBeGreaterThan(10)
    expect(model.headerRoute).toBe('deepseek/v4')
    expect(model.turns).toHaveLength(2)
    expect(model.turns[0]?.endSeq).toBeGreaterThan(0)
    expect(model.turns[0]?.steps[0]?.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(model.turns[0]?.outputTokens).toBe(9)
    expect(model.compactTurns).toEqual([2])
    expect(model.compacting).toBe(false)
  })

  it('tracks an in-flight compaction', async () => {
    const { buildContextBrowser } = await import('../../src/client/context-map.ts')
    const model = buildContextBrowser([
      event('compaction/start', { compactionId: 'c1' }),
    ])
    expect(model.compacting).toBe(true)
    const closed = buildContextBrowser([
      event('compaction/start', { compactionId: 'c1' }),
      event('compaction/end', { compactionId: 'c1' }),
    ])
    expect(closed.compacting).toBe(false)
  })
})

describe('context browser data integrity', () => {
  it('reads assistant usage at the event-data top level (regression: nested message)', async () => {
    const { buildContextBrowser, summarizeContextWindow } = await import('../../src/client/context-map.ts')
    const entries = [
      event('assistant/message', {
        turn: 1, step: 1,
        message: { content: [{ type: 'text', text: 'answer' }] },
        usage: { outputTokens: 128 },
      }),
    ]

    const browser = buildContextBrowser(entries)
    expect(browser.turns[0]?.outputTokens).toBe(128)
    expect(browser.turns[0]?.steps[0]?.messages[0]?.outputTokens).toBe(128)

    const summary = summarizeContextWindow(entries, 1)
    expect(summary.assistantOutputTokens).toBe(128)
    expect(summary.estimatedMessageTokens).toBe(2)
  })

  it('collects file names and per-step tool call names (mcp flagged)', async () => {
    const { buildContextBrowser } = await import('../../src/client/context-map.ts')
    const entries = [
      event('user/message', { turn: 1, step: 1, content: [{ type: 'file', name: 'tsconfig.json' }] }),
      event('tool/call', { turn: 1, step: 1, name: 'mcp__fs__read' }),
      event('tool/call', { turn: 1, step: 1, name: 'bash' }),
    ]
    const browser = buildContextBrowser(entries)
    const step = browser.turns[0]?.steps[0]
    expect(step?.messages[0]?.files).toEqual(['tsconfig.json'])
    expect(step?.toolNames).toEqual(['mcp__fs__read', 'bash'])
  })
})
