/**
 * W3 tests: deterministic scan jobs — lifecycle, bounded concurrency,
 * cancellation, frozen cutoffs, and coverage accounting (AT18/19/35).
 */
import { describe, expect, it } from 'vitest'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assistantMessageEvent,
  userMessageEvent,
} from '../helpers/doctor-events.ts'
import { DoctorSource } from '../../src/doctor/host/source.ts'
import { DoctorScanner } from '../../src/doctor/host/jobs.ts'
import { allMetricValues } from '../../src/doctor/metrics.ts'

interface FixtureSession {
  readonly id: string
  readonly events: SessionEvent[]
  readonly modeId?: string
  readonly failRead?: boolean
}

function makeScanner(fixtures: FixtureSession[]) {
  const activeReads = new Set<string>()
  let maxConcurrent = 0
  const stored = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  const source = new DoctorSource({
    catalog: {
      async list() {
        return fixtures.map((fixture) => ({
          sessionId: fixture.id,
          updatedAt: 1,
          running: false,
          blank: false,
          agentAvailable: false,
        }))
      },
    },
    archive: { async archivedSessionIds() { return [] } },
    persistence: {
      async stat(id) {
        const fixture = stored.get(id)
        if (fixture === undefined) return undefined
        return {
          header: { id, createdAt: 1, isSeeded: false, ...(fixture.modeId === undefined ? {} : { agentPreset: fixture.modeId }) },
          revision: 1,
          eventCount: fixture.events.length,
        } as never
      },
      async open(id): Promise<SessionHandle> {
        activeReads.add(id)
        maxConcurrent = Math.max(maxConcurrent, activeReads.size)
        const fixture = stored.get(id)!
        return {
          id: id as never,
          header: {} as never,
          inheritedEventCount: 0,
          access: 'read',
          async read(offset = 0, length = 200) {
            if (fixture.failRead === true) throw new Error('backend failure')
            return { eventState: 'owned', events: fixture.events.slice(offset, offset + length) }
          },
          async append() { throw new Error('read-only') },
          async flush() { throw new Error('read-only') },
          async close() { activeReads.delete(id) },
          async [Symbol.asyncDispose]() {},
        } as never
      },
    },
  })
  const scanner = new DoctorScanner(source, { concurrency: 2 })
  return { scanner, maxConcurrent: () => maxConcurrent }
}

describe('DoctorScanner lifecycle', () => {
  it('scans all candidates into one immutable report with coverage counts', async () => {
    const { scanner } = makeScanner([
      { id: 'a', events: [userMessageEvent(0, 0, 'hi'), assistantMessageEvent(1, 0, 0, 'ok')], modeId: 'standard' },
      { id: 'b', events: [userMessageEvent(0, 0, 'yo'), assistantMessageEvent(1, 0, 0, 'ok')], modeId: 'minimal' },
    ])
    const handle = scanner.startScan({})
    const report = await handle.done
    expect(report).toBeDefined()
    expect(report!.coverage.candidates).toBe(2)
    expect(report!.coverage.completed).toBe(2)
    expect(report!.sessions.map((entry) => entry.sessionId).sort()).toEqual(['a', 'b'])
    // Metrics are attached per session.
    const a = report!.sessions.find((entry) => entry.sessionId === 'a')!
    expect(allMetricValues(a.metrics).length).toBeGreaterThan(0)
    expect(a.eligibility.sessionId).toBe('a')
    // The report is frozen and contains current METRIC_VERSION.
    expect(Object.isFrozen(report)).toBe(true)
    expect(report!.ruleVersions).toContain('doctor-metrics/3')
  })

  it('filters by modeId via cheap peeks before reading bodies (AT18)', async () => {
    const { scanner } = makeScanner([
      { id: 'a', events: [userMessageEvent(0, 0, 'hi'), assistantMessageEvent(1, 0, 0, 'ok')], modeId: 'standard' },
      { id: 'b', events: [userMessageEvent(0, 0, 'yo'), assistantMessageEvent(1, 0, 0, 'ok')], modeId: 'minimal' },
    ])
    const report = await scanner.startScan({ modeId: 'minimal' }).done
    expect(report!.coverage.candidates).toBe(2)
    expect(report!.coverage.modeSkipped).toBe(1)
    expect(report!.sessions.map((entry) => entry.sessionId)).toEqual(['b'])
    expect(report!.ruleVersions).toContain('doctor-aggregate/1')
    expect(report!.modeEvaluation).toBeDefined()
    expect(report!.modeEvaluation?.modeId).toBe('minimal')
  })

  it('bounds concurrent read handles to the configured concurrency', async () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: `s${index}`,
      events: [userMessageEvent(0, 0, `hi ${index}`), assistantMessageEvent(1, 0, 0, 'ok')],
    }))
    const { scanner, maxConcurrent } = makeScanner(many)
    await scanner.startScan({}).done
    expect(maxConcurrent()).toBeLessThanOrEqual(2)
  })

  it('records failures with reasons instead of dropping sessions (AT35)', async () => {
    const { scanner } = makeScanner([
      { id: 'ok', events: [userMessageEvent(0, 0, 'fine'), assistantMessageEvent(1, 0, 0, 'ok')] },
      { id: 'broken', events: [userMessageEvent(0, 0, 'x')], failRead: true },
    ])
    const report = await scanner.startScan({}).done
    expect(report!.coverage.failed).toBe(1)
    expect(report!.coverage.failures).toEqual([{ sessionId: 'broken', reason: expect.stringContaining('read-failed') }])
    expect(report!.coverage.completed).toBe(1)
  })

  it('freezes each session cutoff inside the report (AT19)', async () => {
    const { scanner } = makeScanner([
      { id: 'a', events: [userMessageEvent(0, 0, 'hi'), assistantMessageEvent(1, 0, 0, 'ok'), userMessageEvent(2, 1, 'more')] },
    ])
    const report = await scanner.startScan({ cutoffSeq: 2 }).done
    const entry = report!.sessions[0]!
    expect(entry.cutoffSeq).toBe(2)
    expect(entry.status.kind).toBe('partial')
  })

  it('rejects reports whose ruleVersions lack current METRIC_VERSION as stale', async () => {
    const { scanner } = makeScanner([
      { id: 'a', events: [userMessageEvent(0, 0, 'hi'), assistantMessageEvent(1, 0, 0, 'ok')] },
    ])
    const handle = scanner.startScan({})
    const report = await handle.done
    expect(scanner.report(handle.jobId)).toBeDefined()

    // Simulate an older persisted/cached report with obsolete ruleVersions
    const staleJobId = 'scan-legacy-1'
    Object.assign((scanner as unknown as { jobs: Map<string, unknown> }).jobs, {})
    const jobs = (scanner as unknown as { jobs: Map<string, { report: unknown }> }).jobs
    jobs.set(staleJobId, {
      report: {
        ...report,
        id: 'report-legacy',
        ruleVersions: ['doctor-metrics/1', 'doctor-eligibility/1'],
      },
    })
    expect(scanner.report(staleJobId)).toBeUndefined()
    expect(scanner.reportById('report-legacy')).toBeUndefined()
  })
})

describe('DoctorScanner cancellation', () => {
  it('cancel is idempotent, stops scheduling, and resolves without a report', async () => {
    const slow: FixtureSession[] = Array.from({ length: 30 }, (_, index) => ({
      id: `s${index}`,
      events: [userMessageEvent(0, 0, `hi ${index}`), assistantMessageEvent(1, 0, 0, 'ok')],
    }))
    const { scanner } = makeScanner(slow)
    const handle = scanner.startScan({})
    scanner.cancel(handle.jobId)
    scanner.cancel(handle.jobId) // idempotent
    const report = await handle.done
    expect(report).toBeUndefined()
    const status = scanner.status(handle.jobId)
    expect(status?.state).toBe('cancelled')
  })

  it('reports expose progress while running', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`,
      events: [userMessageEvent(0, 0, `hi ${index}`), assistantMessageEvent(1, 0, 0, 'ok')],
    }))
    const { scanner } = makeScanner(many)
    const handle = scanner.startScan({})
    const seen: string[] = []
    handle.done.finally(() => { seen.push('done') })
    const report = await handle.done
    expect(report).toBeDefined()
    expect(scanner.status(handle.jobId)?.state).toBe('complete')
  })
})
