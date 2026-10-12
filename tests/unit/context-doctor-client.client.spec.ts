import { describe, expect, it } from 'vitest'
import {
  DoctorClient,
  type FeedbackSubmitIntent,
} from '../../src/client/context-doctor/doctor-client.ts'
import type { DoctorRemoteFace, RemoteResult } from '../../src/client/remote.ts'

describe('DoctorClient facade contracts', () => {
  it('scan.run polls scan job to completion and cancels on AbortSignal', async () => {
    const startCalls: unknown[] = []
    const cancelCalls: string[] = []
    let pollCount = 0
    const face: Partial<DoctorRemoteFace> = {
      async doctorStartScan(req) {
        startCalls.push(req)
        return { ok: true, value: { jobId: 'job-scan-1' } }
      },
      async doctorJob(req) {
        pollCount += 1
        if (pollCount === 1) return { ok: true, value: { state: 'reading', total: 1, done: 0, failed: 0 } }
        return { ok: true, value: { state: 'complete', total: 1, done: 1, failed: 0 } }
      },
      async doctorReport(req) {
        return { ok: true, value: { id: 'report-1', createdAt: 1, scope: {}, ruleVersions: [], coverage: { candidates: 1, completed: 1, partial: 0, failed: 0, modeSkipped: 0, failures: [] }, sessions: [] } }
      },
      async doctorCancelJob(req) {
        cancelCalls.push(req.jobId)
        return { ok: true, value: { cancelled: true } }
      },
    }

    const client = new DoctorClient(face as DoctorRemoteFace)
    const report = await client.scan.run({ modeId: 'test' })
    expect(report.id).toBe('report-1')
    expect(startCalls).toHaveLength(1)
    expect(pollCount).toBe(2)

    // Aborted signal triggers cancel
    const abort = new AbortController()
    pollCount = 0 // will not finish immediately
    const scanPromise = client.scan.run({}, { signal: abort.signal })
    abort.abort()
    await expect(scanPromise).rejects.toThrow()
    expect(cancelCalls).toContain('job-scan-1')
  })

  it('analysis.prepare passes intent transparently without local statistics packaging', async () => {
    let preparedRequest: unknown
    const face: Partial<DoctorRemoteFace> = {
      async doctorPrepareAnalysis(req) {
        preparedRequest = req
        return { ok: true, value: { id: 'plan-1', model: { provider: 'test', model: 'm1' } } }
      },
    }
    const client = new DoctorClient(face as DoctorRemoteFace)
    const plan = await client.analysis.prepare({
      kind: 'mode-quality',
      modeId: 'agent-1',
      reportId: 'r1',
      evidenceRefs: ['s1:1'],
      model: { provider: 'test', model: 'm1' },
    })

    expect(plan.id).toBe('plan-1')
    expect(preparedRequest).toEqual({
      kind: 'mode-quality',
      sessionId: undefined,
      modeId: 'agent-1',
      reportId: 'r1',
      evidenceRefs: ['s1:1'],
      model: { provider: 'test', model: 'm1' },
    })
    expect((preparedRequest as Record<string, unknown>)['statisticsSummary']).toBeUndefined()
  })

  it('feedback submit sends intent without client IDs and returns latest feedback tree', async () => {
    let savedRequest: unknown
    const face: Partial<DoctorRemoteFace> = {
      async doctorSaveFeedback(req) {
        savedRequest = req
        return {
          ok: true,
          value: {
            problems: [
              {
                id: 'problem-auto',
                revision: 1,
                title: '标题',
                data: { title: '标题' },
                occurrences: [{ id: 'occ-auto', revision: 1, problemId: 'problem-auto', data: { note: '详情' } }],
              },
            ],
          },
        }
      },
    }
    const client = new DoctorClient(face as DoctorRemoteFace)
    const tree = await client.feedback.submit({
      problemTitle: '标题',
      type: 'missing-action',
      note: '详情',
    })

    expect(tree.problems).toHaveLength(1)
    expect(tree.problems[0]!.id).toBe('problem-auto')
    expect((savedRequest as Record<string, unknown>)['problemId']).toBeUndefined()
    expect((savedRequest as Record<string, unknown>)['occurrenceId']).toBeUndefined()
  })

  it('constraints confirm and update return latest constraint list in single call', async () => {
    let saveReq: unknown
    let updateReq: unknown
    const face: Partial<DoctorRemoteFace> = {
      async doctorSaveConstraint(req) {
        saveReq = req
        return { ok: true, value: [{ id: 'c1', revision: 1, data: { status: 'active' } }] }
      },
      async doctorUpdateConstraint(req) {
        updateReq = req
        return { ok: true, value: [{ id: 'c1', revision: 2, data: { status: 'revoked' } }] }
      },
    }
    const client = new DoctorClient(face as DoctorRemoteFace)
    const list1 = await client.constraints.confirm({
      id: 'c1',
      originalText: 'orig',
      normalizedRequirement: 'norm',
      conditions: [],
      exceptions: [],
      sourceRefs: [],
      scope: { kind: 'session' },
    })
    expect(list1).toHaveLength(1)
    expect(list1[0]!.id).toBe('c1')

    const list2 = await client.constraints.update('c1', 1, { status: 'revoked' })
    expect(list2).toHaveLength(1)
    expect(list2[0]!.revision).toBe(2)
  })
})
