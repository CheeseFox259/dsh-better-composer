import { beforeEach, describe, expect, it } from 'vitest'
import { formatTokens, summarizeContextWindow } from '../../src/client/context-map.ts'

let nextSeq = 0
beforeEach(() => { nextSeq = 0 })

function event(type: string, data: unknown, seq = nextSeq++) {
  return { type: 'event', event: { type, seq, time: 0, data } }
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
    expect(summary.turns[0]).toEqual({ index: 1, userTokens: 100, assistantTokens: 60, toolCalls: 1, toolTokens: 0, toolChars: 0, fileRefs: 1, imageCount: 0 })
  })

  it('accumulates tool result payload into the owning turn', () => {
    const summary = summarizeContextWindow([
      event('user/message', { turn: 1, content: [{ type: 'text', text: 'q'.repeat(40) }] }),
      event('tool/result', { turn: 1, step: 1, content: [{ type: 'text', text: 'r'.repeat(200) }] }),
    ], 1)

    expect(summary.toolResults).toBe(1)
    expect(summary.turns[0]?.toolChars).toBe(200)
    expect(summary.turns[0]?.toolTokens).toBe(50)
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
  it('owns injected messages by native turn and step boundaries', async () => {
    const { buildContextBrowser } = await import('../../src/client/context-map.ts')
    const entries = [
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      event('user/message', { content: [{ type: 'text', text: 'first prompt' }], source: { kind: 'user' } }),
      event('user/message', { content: [{ type: 'text', text: 'injected file notice' }], source: { kind: 'context' } }),
      event('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'first answer' }] } }),
      event('step/end', { turn: 1, step: 1 }),
      event('step/start', { turn: 1, step: 2 }),
      event('user/message', { content: [{ type: 'text', text: 'injected skill' }], source: { kind: 'context' } }),
      event('tool/call', { turn: 1, step: 2, name: 'read' }),
      event('tool/result', { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'file contents' }] } }),
      event('assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'second answer' }] } }),
      event('step/end', { turn: 1, step: 2 }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event('turn/start', { turn: 2 }),
      event('step/start', { turn: 2, step: 1 }),
      event('user/message', { content: [{ type: 'text', text: 'second prompt' }], source: { kind: 'user' } }),
      event('assistant/message', { turn: 2, step: 1, message: { content: [{ type: 'text', text: 'last answer' }] } }),
      event('step/end', { turn: 2, step: 1 }),
      event('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ]

    const summary = summarizeContextWindow(entries, 1)
    const browser = buildContextBrowser(entries)

    expect(summary.turns.map(turn => turn.index)).toEqual([1, 2])
    expect(browser.turns.map(turn => turn.index)).toEqual([1, 2])
    expect(browser.turns[0]?.steps.map(step => step.index)).toEqual([1, 2])
    expect(browser.turns[0]?.steps[0]?.messages.map(message => message.role)).toEqual(['user', 'user', 'assistant'])
    expect(browser.turns[0]?.steps[1]?.messages.map(message => message.role)).toEqual(['user', 'tool', 'assistant'])
    expect(summary.turns[0]?.toolCalls).toBe(1)
    expect(browser.turns[0]?.steps[1]?.toolNames).toEqual(['read'])
  })

  it('keeps source and fork seqs stable across history pages and transient entries', async () => {
    const { buildContextBrowser } = await import('../../src/client/context-map.ts')
    const header = event('request/header', { header: { config: { provider: 'deepseek', model: 'v4' }, tools: [{ name: 'read', description: 'Read' }] } }, 30)
    const system = event('system/message', { turn: 4, step: 1, message: { content: [{ type: 'text', text: 'system' }] } }, 31)
    const suffix = [
      header,
      system,
      event('turn/start', { turn: 4 }, 32),
      event('step/start', { turn: 4, step: 1 }, 33),
      event('user/message', { content: [{ type: 'text', text: 'prompt' }], source: { kind: 'user' } }, 34),
      { type: 'transient', event: { type: 'assistant/attempt', seq: 35 } },
      event('assistant/message', { turn: 4, step: 1, message: { content: [{ type: 'text', text: 'answer' }] } }, 35),
      event('step/end', { turn: 4, step: 1 }, 36),
      event('turn/end', { turn: 4, reason: { kind: 'completed' } }, 37),
    ]
    const prefix = [
      event('turn/start', { turn: 3 }, 20),
      event('step/start', { turn: 3, step: 1 }, 21),
      event('user/message', { content: [{ type: 'text', text: 'earlier' }], source: { kind: 'user' } }, 22),
      event('assistant/message', { turn: 3, step: 1, message: { content: [{ type: 'text', text: 'earlier answer' }] } }, 23),
      event('step/end', { turn: 3, step: 1 }, 24),
      event('turn/end', { turn: 3, reason: { kind: 'completed' } }, 25),
    ]
    const paged = buildContextBrowser(suffix)
    // A repeated header is the overlap of two adjacent immutable pages.
    const complete = buildContextBrowser([...prefix, header, ...suffix])

    expect(paged.turns[0]?.startSeq).toBe(32)
    expect(paged.turns[0]?.endSeq).toBe(37)
    expect(paged.turns[0]?.steps[0]?.startSeq).toBe(33)
    expect(paged.turns[0]?.steps[0]?.messages.map(message => message.seq)).toEqual([34, 35])
    expect(paged.tools[0]?.seq).toBe(30)
    expect(paged.systemNodes[0]?.seq).toBe(31)
    expect(complete.turns.find(turn => turn.index === 4)).toEqual(paged.turns[0])
    expect(complete.tools).toEqual(paged.tools)
    expect(complete.systemNodes).toEqual(paged.systemNodes)
    expect(summarizeContextWindow([...prefix, header, ...suffix], 1).userMessages).toBe(2)
  })

  it('accepts zero boundary IDs and preserves native compaction metadata', async () => {
    const { buildContextBrowser } = await import('../../src/client/context-map.ts')
    const checkpoint = event('user/message', {
      content: [{ type: 'text', text: 'checkpoint' }, { type: 'file', name: 'a.ts' }, { type: 'image' }],
      source: { kind: 'context' },
    })
    const entries = [
      event('turn/start', { turn: 0 }, 0),
      event('step/start', { turn: 0, step: 0 }, 1),
      { ...checkpoint, event: { ...checkpoint.event, seq: 2, surfaceOp: { op: 'replace' } } },
      event('assistant/message', {
        turn: 0, step: 0,
        message: { content: [{ type: 'text', text: 'partial response' }] },
        usage: { outputTokens: 32 }, interrupted: true,
      }, 3),
      event('step/end', { turn: 0, step: 0 }, 4),
      event('turn/end', { turn: 0, reason: { kind: 'aborted', reason: 'user' } }, 5),
    ]
    const browser = buildContextBrowser(entries)
    const summary = summarizeContextWindow(entries, 1)

    expect(browser.turns.map(turn => turn.index)).toEqual([0])
    expect(summary.turns.map(turn => turn.index)).toEqual([0])
    expect(browser.turns[0]?.startSeq).toBe(0)
    expect(browser.turns[0]?.endSeq).toBe(5)
    expect(browser.turns[0]?.steps[0]?.index).toBe(0)
    expect(browser.turns[0]?.steps[0]?.startSeq).toBe(1)
    expect(browser.turns[0]?.steps[0]?.messages[0]).toMatchObject({ seq: 2, source: 'context', surfaceReplace: true, files: ['a.ts'] })
    expect(browser.turns[0]?.steps[0]?.messages[1]).toMatchObject({ seq: 3, outputTokens: 32, interrupted: true })
    expect(browser.compactTurns).toEqual([0])
    expect(summary.turns[0]).toMatchObject({ fileRefs: 1, imageCount: 1, assistantTokens: 32 })
  })

  it('assigns identical turn indexes and per-turn tokens in the summary and the browser', async () => {
    const { buildContextBrowser, summarizeContextWindow } = await import('../../src/client/context-map.ts')
    const entries = [
      event('user/message', { turn: 1, step: 1, content: [{ type: 'text', text: 'u'.repeat(40) }] }),
      event('assistant/message', { turn: 1, step: 1, content: [{ type: 'text', text: 'a'.repeat(80) }], usage: { outputTokens: 30 } }),
      event('tool/result', { turn: 1, step: 1, content: [{ type: 'text', text: 'r'.repeat(200) }] }),
      // Legacy window without native boundaries: a direct user message opens
      // the next turn and the assistant answer joins it in both folds.
      event('user/message', { content: [{ type: 'text', text: 'v'.repeat(20) }] }),
      event('assistant/message', { content: [{ type: 'text', text: 'b'.repeat(60) }] }),
    ]

    const summary = summarizeContextWindow(entries, 1)
    const browser = buildContextBrowser(entries)

    expect(summary.turns.map(turn => turn.index)).toEqual(browser.turns.map(turn => turn.index))
    for (const turn of browser.turns) {
      const stat = summary.turns.find(candidate => candidate.index === turn.index)
      expect(stat).toBeDefined()
      expect(stat!.userTokens).toBe(Math.ceil(turn.userChars / 4))
      expect(stat!.assistantTokens).toBe(turn.assistantTokens)
      expect(stat!.toolChars).toBe(turn.toolChars)
      expect(stat!.toolTokens).toBe(Math.ceil(turn.toolChars / 4))
    }
    expect(summary.turns[0]?.toolChars).toBe(200)
    expect(browser.turns[0]?.steps[0]?.messages.map(message => message.role)).toEqual(['user', 'assistant', 'tool'])
  })

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
    expect(browser.turns[0]?.assistantTokens).toBe(128)
    expect(browser.turns[0]?.steps[0]?.messages[0]?.outputTokens).toBe(128)
    expect(browser.turns[0]?.steps[0]?.messages[0]?.chars).toBe(6)

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

it('keeps native boundary identities unchanged when an older zero-ID page is added', async () => {
  const { buildContextBrowser } = await import('../../src/client/context-map.ts')
  const older = [event('turn/start', {turn:0},0),event('step/start',{turn:0,step:0},1),event('user/message',{content:[{type:'text',text:'older'}]},2)]
  const suffix = [event('turn/start',{turn:3},30),event('step/start',{turn:3,step:4},31),event('user/message',{content:[{type:'text',text:'same source'}]},32)]
  const partial = buildContextBrowser(suffix)
  const complete = buildContextBrowser([...older,...suffix])
  expect(partial.turns[0]?.index).toBe(3)
  expect(complete.turns.find(turn=>turn.startSeq===30)?.index).toBe(3)
  expect(complete.turns.find(turn=>turn.startSeq===30)?.steps[0]?.index).toBe(partial.turns[0]?.steps[0]?.index)
  const olderStep = event('step/start',{turn:3,step:0},29)
  expect(buildContextBrowser([olderStep,...suffix]).turns.find(turn=>turn.startSeq===30)?.steps.find(step=>step.startSeq===31)?.index).toBe(4)
})
