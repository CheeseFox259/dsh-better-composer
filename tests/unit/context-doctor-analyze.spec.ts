/**
 * W5 tests: user-initiated semantic analysis — explicit plans, fixed budgets,
 * cancellation, and candidate constraints that never auto-execute (AT24/25/34).
 */
import { describe, expect, it } from 'vitest'
import { DoctorAnalyzer } from '../../src/doctor/host/analyze.ts'

function makeAnalyzer(llm?: { stream(options: Record<string, unknown>): AsyncIterable<unknown> }) {
  const calls: Record<string, unknown>[] = []
  const analyzer = new DoctorAnalyzer({
    llm: llm ?? {
      async *stream(options: Record<string, unknown>) {
        calls.push(options)
        yield { type: 'text-delta', index: 0, text: '{"findings":[{"kind":"omission-risk","statement":"test"}]}' }
      },
    },
    now: () => 1_700_000_000_000,
  })
  return { analyzer, calls }
}

describe('DoctorAnalyzer.prepare', () => {
  it('builds a plan without any paid call: estimates input against the budget', async () => {
    const { analyzer, calls } = makeAnalyzer()
    const plan = await analyzer.prepare({
      kind: 'session-quality',
      evidence: [{ ref: 's1:12', text: 'x'.repeat(4000) }],
      statisticsSummary: 'usage 42.8k; duplicates 10%',
      model: { provider: 'p', model: 'm' },
    })
    expect(plan.budget.totalInputTokens).toBeLessThanOrEqual(24_000)
    expect(plan.budget.maxCalls).toBe(2)
    expect(plan.budget.outputTokensPerCall).toBeLessThanOrEqual(4000)
    expect(plan.inputEstimateTokens).toBeGreaterThan(0)
    expect(plan.inputEstimateEstimated).toBe(true) // chars/4 heuristic, labeled
    expect(calls).toHaveLength(0)
  })

  it('rejects evidence that blows the budget instead of silently exceeding it (AT34)', async () => {
    const { analyzer } = makeAnalyzer()
    const plan = await analyzer.prepare({
      kind: 'session-quality',
      evidence: [{ ref: 's1:1', text: 'x'.repeat(400_000) }],
      statisticsSummary: '',
      model: { provider: 'p', model: 'm' },
    })
    expect(plan.feasible).toBe(false)
    expect(plan.dataGaps.some((gap) => gap.includes('budget'))).toBe(true)
  })
})

describe('DoctorAnalyzer.run', () => {
  it('records a native error finish after valid JSON as failed and keeps observed usage', async () => {
    const usage = { inputTokens: 11, outputTokens: 8 }
    const { analyzer } = makeAnalyzer({ async *stream() {
      yield { type: 'text-delta', index: 0, text: '{"findings":[]}' }
      yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'disconnected', code: 'NETWORK' } } }
    } })
    const plan = await analyzer.prepare({ kind: 'session-quality', evidence: [], statisticsSummary: '', model: { provider: 'p', model: 'm' } })
    const job = analyzer.run(plan, { idempotencyKey: 'native-error' })
    await job.done
    expect(analyzer.status(job.jobId)).toMatchObject({ state: 'failed', error: 'disconnected', usageObserved: [usage] })
  })

  it('executes the host-prepared evidence and budget even if a caller changes the returned plan', async () => {
    const { analyzer, calls } = makeAnalyzer()
    const plan = await analyzer.prepare({ kind: 'session-quality', evidence: [{ ref: 's1:1', text: 'reviewed' }], statisticsSummary: '', model: { provider: 'p', model: 'm' } })
    const job = analyzer.run({ ...plan, evidence: [{ ref: 's2:1', text: 'unreviewed' }], budget: { ...plan.budget, outputTokensPerCall: 99999 } }, { idempotencyKey: 'tampered' })
    await job.done
    expect(JSON.stringify(calls[0])).toContain('reviewed')
    expect(JSON.stringify(calls[0])).not.toContain('unreviewed')
    expect(calls[0]?.maxTokens).toBe(4000)
  })

  it('keeps a provider failure in the pollable task instead of rejecting an abandoned background promise', async () => {
    const { analyzer } = makeAnalyzer({ async *stream() { throw new Error('provider offline') } })
    const plan = await analyzer.prepare({ kind: 'session-quality', evidence: [], statisticsSummary: '', model: { provider: 'p', model: 'm' } })
    const job = analyzer.run(plan, { idempotencyKey: 'offline' })
    await expect(job.done).resolves.toBeUndefined()
    expect(analyzer.status(job.jobId)).toMatchObject({ state: 'failed', error: 'provider offline' })
  })

  it('runs at most two calls, binds results to the source versions, and records usage', async () => {
    let callCount = 0
    const { analyzer } = makeAnalyzer({
      stream: async function* (options: Record<string, unknown>) {
        callCount += 1
        void options
        yield { type: 'text-delta', index: 0, text: '{"findings":[]}' }
      },
    })
    const plan = await analyzer.prepare({
      kind: 'session-quality',
      evidence: [{ ref: 's1:12', text: 'short' }],
      statisticsSummary: 'summary',
      model: { provider: 'p', model: 'm' },
      sourceVersions: ['v1'],
    })
    const job = analyzer.run(plan, { idempotencyKey: 'run-1' })
    const result = await job.done
    expect(callCount).toBeLessThanOrEqual(2)
    expect(callCount).toBe(1) // one main call; the second is only for an explicit summary pass
    expect(result!.state).toBe('complete')
    expect(result!.sourceVersions).toEqual(['v1'])
  })

  it('idempotent runs do not re-pay: same idempotency key returns the settled result', async () => {
    let callCount = 0
    const { analyzer } = makeAnalyzer({
      stream: async function* () {
        callCount += 1
        yield { type: 'text-delta', index: 0, text: '{}' }
      },
    })
    const plan = await analyzer.prepare({
      kind: 'mode-quality',
      evidence: [],
      statisticsSummary: 's',
      model: { provider: 'p', model: 'm' },
    })
    const first = analyzer.run(plan, { idempotencyKey: 'same-key' })
    const second = analyzer.run(plan, { idempotencyKey: 'same-key' })
    expect(second.jobId).toBe(first.jobId)
    await Promise.all([first.done, second.done])
    expect(callCount).toBe(1)
    expect(analyzer.status(second.jobId)).toMatchObject({ state: 'complete', result: { findings: [] } })
  })

  it('cancellation stops before the call and settles as cancelled with no usage', async () => {
    const { analyzer } = makeAnalyzer()
    const plan = await analyzer.prepare({
      kind: 'session-quality',
      evidence: [],
      statisticsSummary: 's',
      model: { provider: 'p', model: 'm' },
    })
    const job = analyzer.run(plan, { idempotencyKey: 'cancel-me' })
    analyzer.cancel(job.jobId)
    const result = await job.done
    expect(result).toBeUndefined()
    expect(analyzer.status(job.jobId)?.state).toBe('cancelled')
  })

  it('extracts candidate constraints while keeping the original misreading as evidence, not equal-weight input (AT25)', async () => {
    const { analyzer } = makeAnalyzer({
      async *stream() {
        yield {
          type: 'text-delta', index: 0,
          text: JSON.stringify({
            candidates: [{
              originalText: '本轮只设计，不实现',
              normalizedRequirement: '本轮只做设计；代码开发需新的明确授权',
              conditions: ['用户明确下达开发指令'],
              exceptions: [],
            }],
          }),
        }
      },
    })
    const plan = await analyzer.prepare({
      kind: 'requirement-distill',
      evidence: [{ ref: 's1:8', text: '不对，本轮只设计' }],
      statisticsSummary: '',
      model: { provider: 'p', model: 'm' },
    })
    const result = await analyzer.run(plan, { idempotencyKey: 'k' }).done
    const candidate = result!.candidateConstraints[0]!
    expect(candidate.status).toBe('candidate') // never auto-confirmed
    expect(candidate.originalText).toBe('本轮只设计，不实现')
    expect(candidate.normalizedRequirement).not.toBe(candidate.originalText)
  })

  it('a source change after prepare invalidates the plan instead of auto re-running (AT34)', async () => {
    const { analyzer } = makeAnalyzer()
    const plan = await analyzer.prepare({
      kind: 'session-quality',
      evidence: [{ ref: 's1:1', text: 'a' }],
      statisticsSummary: 's',
      model: { provider: 'p', model: 'm' },
      sourceVersions: ['v1'],
    })
    analyzer.noteSourceChange('v2')
    const job = analyzer.run(plan, { idempotencyKey: 'k' })
    await job.done
    expect(analyzer.status(job.jobId)).toMatchObject({ state: 'failed', error: expect.stringMatching(/stale/i) })
  })
})
