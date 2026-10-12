import { describe, expect, it } from 'vitest'
import { betterComposerRemoteContribution } from '../../src/client/remote.ts'
import { DoctorClient } from '../../src/client/context-doctor/doctor-client.ts'
import { BetterComposerRemoteService } from '../../src/remote.ts'
import { userMessageEvent } from '../helpers/doctor-events.ts'

describe('Context Doctor wire requests', () => {
  it('exposes doctorFeedbackTree descriptor and removes fine-grained problems/occurrences', () => {
    const methods = betterComposerRemoteContribution.descriptors.map((d) => d.method)
    expect(methods).toContain('doctorFeedbackTree')
    expect(methods).not.toContain('doctorProblems')
    expect(methods).not.toContain('doctorOccurrences')
  })

  it('preserves selected refs and the frozen cutoff through the evidence wire request', async () => {
    const events = [userMessageEvent(0, 0, 'first'), userMessageEvent(1, 0, 'chosen'), userMessageEvent(2, 0, 'later')]
    const persistence = {
      async stat() { return { header: { id: 's1', createdAt: 1, isSeeded: false }, eventCount: events.length } },
      async open() { return { inheritedEventCount: 0, async read(offset: number, limit: number) { return { events: events.slice(offset, offset + limit) } }, async close() {} } },
    }
    const service = new BetterComposerRemoteService({ get: (name: string) => name === 'sessionPersistence' ? persistence : undefined, reflect: { provide: () => () => {} } } as never)
    const descriptor = betterComposerRemoteContribution.descriptors.find((item) => item.method === 'doctorEvidence')!
    const request = { sessionId: 's1', offset: 0, cutoffSeq: 2, refs: ['s1:1'] }
    const wire = descriptor.parameters[0]!.codec.create().parse(request)
    expect(wire).toEqual(request)
    expect(await service.doctorEvidence(wire as never)).toMatchObject({ cutoffSeq: 2, items: [{ ref: 's1:1', text: 'chosen' }] })
  })

  it('cancels a Host scan when unmount happens before the start response returns', async () => {
    const abort = new AbortController()
    const cancelled: string[] = []
    const face = {
      async doctorStartScan() { abort.abort(); return { ok: true, value: { jobId: 'scan-pending' } } },
      async doctorCancelJob(request: { jobId: string }) { cancelled.push(request.jobId); return { ok: true, value: { cancelled: true } } },
    }
    const client = new DoctorClient(face as never)
    await expect(client.scan.run({}, { signal: abort.signal })).rejects.toThrow()
    expect(cancelled).toEqual(['scan-pending'])
  })

  it('preserves the constraint id when editing or revoking a constraint', () => {
    const descriptor = betterComposerRemoteContribution.descriptors.find((item) => item.method === 'doctorUpdateConstraint')!
    const codec = descriptor.parameters[0]!.codec.create()
    const request = { id: 'c1', expectedRevision: 1, patch: { status: 'revoked' } }
    expect(codec.parse(request)).toEqual(request)
  })
})
