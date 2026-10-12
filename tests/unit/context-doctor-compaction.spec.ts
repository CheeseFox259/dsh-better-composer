/**
 * W6 tests: the optional Doctor compaction provider — input organization and
 * the same single summary call, never post-hoc verification (AT27–AT32).
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Message } from '@deepseek-ai/dsh-llm'
import {
  DoctorCompactionEngine,
  type ConfirmedConstraint,
  type DoctorConstraintSource,
  type ExecutionReceipt,
} from '../../src/doctor/compaction.ts'

interface FakeAgent {
  options: { provider: string; model: string }
  session: {
    id: string
    requestHeader(): undefined
    deriveMessages(): Message[]
  }
}

function message(id: string, text: string): Message {
  return {
    id: id as never,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  } as Message
}

function makeEngine(options: {
  constraints?: ConfirmedConstraint[]
  derived?: Message[]
  streamText?: string
  streamError?: Error
  omitSource?: boolean
  omitLlm?: boolean
}) {
  const calls: Record<string, unknown>[] = []
  const receipts: ExecutionReceipt[] = []
  const source: DoctorConstraintSource = {
    activeConstraints: async () => options.constraints ?? [],
    recordReceipt: (receipt) => { receipts.push(receipt) },
  }
  const llm = {
    stream: (streamOptions: Record<string, unknown>) => {
      calls.push(streamOptions)
      if (options.streamError !== undefined) throw options.streamError
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'text-delta', index: 0, text: options.streamText ?? 'checkpoint text' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      } as never
    },
  }
  const ctx = {
    llm,
    reflect: { provide: () => () => {} },
    get: (name: string) => {
      if (name === 'betterComposerDoctor') return options.omitSource === true ? undefined : source
      if (name === 'llm') return options.omitLlm === true ? undefined : llm
      return undefined
    },
  } as unknown as Context
  const engine = new (class extends DoctorCompactionEngine {
    /** Expose the protected hook for testing without a live host. */
    async testSummarize(input: { tools?: readonly unknown[]; messages: readonly Message[] }, agent: FakeAgent, signal?: AbortSignal) {
      return this.summarize(input as never, agent as never, signal)
    }
  })(ctx, { auto: false, maxTokens: 6000 })
  const derived = options.derived ?? []
  const agent: FakeAgent = { options: { provider: 'fixture', model: 'summary-model' }, session: { id: 's1', requestHeader: () => undefined, deriveMessages: () => derived } }
  return { engine, agent, calls, receipts }
}

describe('DoctorCompactionEngine', () => {
  it('with no confirmed constraints it delegates to the untouched base behavior', async () => {
    const { engine, agent, calls, receipts } = makeEngine({ constraints: [] })
    await engine.testSummarize({ messages: [message('m1', 'shadowed')] }, agent)
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(calls[0])).not.toContain('本次须保留')
    expect(receipts).toHaveLength(0)
  })

  it('a missing constraint source fails loud instead of silently skipping enhancement', async () => {
    const { engine, agent } = makeEngine({ constraints: [], omitSource: true })
    await expect(engine.testSummarize({ messages: [message('m1', 'work')] }, agent))
      .rejects.toThrow('doctor constraint source is unavailable')
  })

  it('builds ONE enhanced call: deduped constraints fused into the summary task (AT27)', async () => {
    const constraints: ConfirmedConstraint[] = [
      {
        id: 'c1', revision: 3, originalText: '交付后打开测试环境',
        normalizedRequirement: '交付后必须打开测试环境',
        conditions: ['用户未要求跳过'], exceptions: ['用户明确要求跳过'],
      },
      // Same constraint from another evidence source: same id+revision → deduped.
      {
        id: 'c1', revision: 3, originalText: '交付后打开测试环境',
        normalizedRequirement: '交付后必须打开测试环境',
        conditions: ['用户未要求跳过'], exceptions: ['用户明确要求跳过'],
      },
    ]
    const { engine, agent, calls, receipts } = makeEngine({ constraints })
    await engine.testSummarize({ messages: [message('m1', 'earlier work')] }, agent)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ provider: 'fixture', model: 'summary-model', maxTokens: 6000 })
    const text = JSON.stringify(calls[0])
    expect(text.match(/交付后必须打开测试环境/g)!.length).toBe(1)
    expect(text).toContain('用户明确要求跳过') // exceptions preserved
    expect(text).toContain('融合') // merge directive, not a second copy
    expect(receipts).toHaveLength(1)
    expect(receipts[0]!.appliedConstraintRevisions).toEqual([{ id: 'c1', revision: 3 }])
    expect(receipts[0]!.operationStatus).toBe('enhanced-summary-complete')
  })

  it('keeps the newest revision when ids collide (AT27 dedupe by id+revision)', async () => {
    const constraints: ConfirmedConstraint[] = [
      { id: 'c1', revision: 2, originalText: 'old', normalizedRequirement: '旧理解', conditions: [], exceptions: [] },
      { id: 'c1', revision: 3, originalText: 'new', normalizedRequirement: '新纠正', conditions: [], exceptions: [] },
    ]
    const { engine, agent, calls } = makeEngine({ constraints })
    await engine.testSummarize({ messages: [message('m1', 'work')] }, agent)
    const text = JSON.stringify(calls[0])
    expect(text).toContain('新纠正')
    expect(text).not.toContain('旧理解')
  })

  it('constraints already present in the retained suffix are noted, not re-injected (AT28)', async () => {
    const constraints: ConfirmedConstraint[] = [{
      id: 'c2', revision: 1, originalText: '交付后打开测试环境',
      normalizedRequirement: '交付后打开测试环境', conditions: [], exceptions: [],
    }]
    const shadowed = message('m1', 'earlier work')
    const retained = message('m2', '用户原话：交付后打开测试环境，勿忘。')
    const { engine, agent, calls, receipts } = makeEngine({
      constraints,
      derived: [shadowed, retained],
    })
    await engine.testSummarize({ messages: [shadowed] }, agent)
    expect(calls).toHaveLength(1)
    const finalMessage = (calls[0]!['messages'] as { content: { text: string }[] }[]).at(-2)!
    expect(finalMessage.content[0]!.text).not.toContain('勿忘')
    expect(finalMessage.content[0]!.text).toContain('已在未压缩部分')
    expect(receipts[0]!.alreadyRetainedIds).toEqual(['c2'])
  })

  it('does no post-hoc verification: the model output passes through untouched (AT29)', async () => {
    const constraints: ConfirmedConstraint[] = [{
      id: 'c3', revision: 1, originalText: 'X 必须保留',
      normalizedRequirement: 'X 必须保留', conditions: [], exceptions: [],
    }]
    const { engine, agent, calls } = makeEngine({
      constraints,
      streamText: '同义改写：完全没有出现原句的影子', // no string match, no IDs
    })
    const result = await engine.testSummarize({ messages: [message('m1', 'work')] }, agent)
    const summary = result.summary as { type: string; text?: string }[]
    expect(summary.some((block) => block.type === 'text' && block.text!.includes('同义改写'))).toBe(true)
    // No verification call was made: exactly one stream call total.
    expect(calls).toHaveLength(1)
  })

  it('host/llm failures keep the host error semantics — no Doctor-specific failure category (AT31)', async () => {
    const constraints: ConfirmedConstraint[] = [{
      id: 'c4', revision: 1, originalText: 'req', normalizedRequirement: 'req', conditions: [], exceptions: [],
    }]
    const { engine, agent, receipts } = makeEngine({
      constraints,
      streamError: new Error('summarization produced no text summary content'),
    })
    await expect(engine.testSummarize({ messages: [message('m1', 'work')] }, agent))
      .rejects.toThrow('summarization produced no text summary content')
    expect(receipts.some((receipt) => receipt.operationStatus === 'summary-call-failed')).toBe(true)
    expect(receipts.some((receipt) => receipt.operationStatus.includes('validation'))).toBe(false)
  })

  it('empty model output fails with the host error, not a Doctor validation verdict (AT31)', async () => {
    const constraints: ConfirmedConstraint[] = [{
      id: 'c6', revision: 1, originalText: 'req', normalizedRequirement: 'req', conditions: [], exceptions: [],
    }]
    const { engine, agent, receipts } = makeEngine({ constraints, streamText: '' })
    await expect(engine.testSummarize({ messages: [message('m1', 'work')] }, agent))
      .rejects.toThrow('summarization produced no text summary content')
    expect(receipts[0]!.operationStatus).toBe('summary-call-failed')
  })

  it('cancellation settles as cancelled without retry', async () => {
    const constraints: ConfirmedConstraint[] = [{
      id: 'c5', revision: 1, originalText: 'req', normalizedRequirement: 'req', conditions: [], exceptions: [],
    }]
    const abort = new AbortController()
    const { engine, agent, calls, receipts } = makeEngine({
      constraints,
      streamError: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    })
    const pending = engine.testSummarize({ messages: [message('m1', 'work')] }, agent, abort.signal)
    abort.abort()
    await expect(pending).rejects.toThrow()
    expect(calls).toHaveLength(1) // no retry after abort
    expect(receipts.some((receipt) => receipt.operationStatus === 'cancelled')).toBe(true)
  })
})
