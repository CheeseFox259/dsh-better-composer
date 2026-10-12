import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { DoctorRuntime } from '../../src/doctor/host/runtime.ts'
import { assistantMessageEvent, compactionReplacementEvent, requestHeaderEvent, userMessageEvent } from '../helpers/doctor-events.ts'

async function withEvidenceRuntime(events: readonly SessionEvent[], run: (runtime: DoctorRuntime) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'doctor-evidence-refs-'))
  const runtime = DoctorRuntime.isolated(root, { persistence: {
    async stat() { return { header: { id: 's1', createdAt: 1, isSeeded: false }, eventCount: events.length } as never },
    async open() { return { inheritedEventCount: 0, async read(offset: number, limit?: number) { return { events: events.slice(offset, limit === undefined ? undefined : offset + limit) } }, async close() {} } as never },
  } })
  try { await run(runtime) }
  finally { runtime.dispose(); await rm(root, { recursive: true, force: true }) }
}

it('looks up selected source refs before applying the existing 25-item evidence paging', async () => {
  const events = Array.from({ length: 31 }, (_, seq) => userMessageEvent(seq, 0, `original ${seq}`))
  await withEvidenceRuntime(events, async (runtime) => {
    const selected = await runtime.evidence('s1', 0, undefined, ['s1:30', 's1:5'])
    expect(selected.items).toEqual([
      { ref: 's1:5', text: 'original 5', role: 'user', bucket: 'message' },
      { ref: 's1:30', text: 'original 30', role: 'user', bucket: 'message' },
    ])
    expect(selected.nextOffset).toBeUndefined()

    const refs = events.map((event) => `s1:${event.seq}`)
    const first = await runtime.evidence('s1', 0, undefined, refs)
    expect(first.items).toHaveLength(25)
    expect(first.nextOffset).toBe(25)
    const next = await runtime.evidence('s1', first.nextOffset, first.cutoffSeq, refs)
    expect(next.items.map((item) => item.ref)).toEqual(['s1:25', 's1:26', 's1:27', 's1:28', 's1:29', 's1:30'])
    expect(next.nextOffset).toBeUndefined()

    expect((await runtime.evidence('s1')).items).toHaveLength(25)
    expect((await runtime.evidence('s1', 0, undefined, [])).items).toEqual([])
  })
})

it('rejects malformed and cross-session evidence refs', async () => {
  await withEvidenceRuntime([userMessageEvent(0, 0, 'original')], async (runtime) => {
    const invalid = [
      ['s2:0'], ['s1'], ['s1:-1'], ['s1:0.5'], ['s1:00'], ['s1:9007199254740992'],
      ['s1:0', null], 's1:0', null,
    ]
    for (const refs of invalid) {
      await expect(runtime.evidence('s1', 0, undefined, refs as never)).rejects.toThrow('invalid evidence refs')
    }
  })
})

it('returns canonical effective evidence and only the latest tool-definition collection at the cutoff', async () => {
  const oldTools = [{ name: 'old', description: 'obsolete', parameters: { type: 'object' } }]
  const currentTools = [{ name: 'shell', description: 'current', parameters: { type: 'object' } }]
  const events = [
    requestHeaderEvent(0, { config: { provider: 'fixture', model: 'local' }, tools: oldTools }, 'initial'),
    userMessageEvent(1, 0, 'old private message'),
    assistantMessageEvent(2, 0, 0, 'old private response'),
    requestHeaderEvent(3, { config: { provider: 'fixture', model: 'local' }, tools: currentTools }, 'change'),
    compactionReplacementEvent(4, 1, 0, 1, 2, 'Summary retained'),
    userMessageEvent(5, 1, 'next message'),
  ]
  await withEvidenceRuntime(events, async (runtime) => {
    const refs = ['s1:0', 's1:1', 's1:3', 's1:4', 's1:99']
    const current = await runtime.evidence('s1', 0, undefined, refs)
    expect(current.items.map(({ ref, text }) => ({ ref, text }))).toEqual([
      { ref: 's1:3', text: '[\n  {\n    "name": "shell",\n    "description": "current",\n    "parameters": {\n      "type": "object"\n    }\n  }\n]' },
      { ref: 's1:4', text: 'Summary retained' },
    ])
    expect(current.items[0]?.bucket).toBe('tool-definition')

    const frozen = await runtime.evidence('s1', 0, 3, refs)
    expect(frozen.cutoffSeq).toBe(3)
    expect(frozen.status).toEqual({ kind: 'partial', reason: 'cutoff-before-stored-end' })
    expect(frozen.items.map((item) => item.ref)).toEqual(['s1:0', 's1:1'])
    expect(frozen.items[1]?.text).toBe('old private message')

    events.push(requestHeaderEvent(6, { config: { provider: 'fixture', model: 'local' }, tools: [] }, 'change'))
    expect((await runtime.evidence('s1', 0, undefined, ['s1:3'])).items).toEqual([])
  })
})

it('reads authoritative evidence and removes a completed analysis original after confirmed deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'doctor-evidence-'))
  let present = true
  let calls = 0
  const events = [userMessageEvent(0, 0, 'original')]
  const runtime = DoctorRuntime.isolated(root, { persistence: {
    async stat() { return present ? { header: { id: 's1', createdAt: 1, isSeeded: false }, eventCount: 1 } as never : undefined },
    async open() { return { inheritedEventCount: 0, async read() { return { events } }, async close() {} } as never },
  } }, { async *stream() { calls += 1; yield { type: 'text-delta', index: 0, text: '{"candidates":[{"originalText":"original","normalizedRequirement":"reviewed","conditions":[],"exceptions":[]}]}' } } })
  try {
    const plan = await runtime.prepareAnalysis({ kind: 'requirement-distill', evidenceRefs: ['s1:0'], model: { provider: 'fixture', model: 'local' } })
    expect(plan.evidence[0]?.text).toBe('original')
    const job = await runtime.runAnalysis(plan, { idempotencyKey: plan.id })
    await job.done
    expect((await runtime.analysisJob(job.jobId))?.result?.candidateConstraints[0]?.originalText).toBe('original')
    present = false
    const deleted = await runtime.evidence('s1', 0, undefined, ['s1:0'])
    expect(deleted.items).toEqual([])
    expect(deleted.status).toEqual({ kind: 'error', reason: 'not-found' })
    expect((await runtime.analysisJob(job.jobId))?.result).toBeUndefined()
    await expect(runtime.runAnalysis(plan, { idempotencyKey: plan.id })).rejects.toThrow('已失效')
    expect(calls).toBe(1)
  } finally { runtime.dispose(); await rm(root, { recursive: true, force: true }) }
})
