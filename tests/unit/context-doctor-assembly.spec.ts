import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DoctorRuntime } from '../../src/doctor/host/runtime.ts'
import {
  assistantMessageEvent,
  userMessageEvent,
} from '../helpers/doctor-events.ts'

describe('DoctorRuntime semantic analysis assembly (Candidate 3)', () => {
  it('assembles statisticsSummary from reportId and resolves evidenceRefs on the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctor-assembly-'))
    const events = [
      userMessageEvent(0, 0, 'hello doctor'),
      assistantMessageEvent(1, 0, 0, 'response 1'),
      userMessageEvent(2, 1, 'more request'),
      assistantMessageEvent(3, 1, 1, 'response 2'),
    ]
    const runtime = DoctorRuntime.isolated(
      root,
      {
        catalog: {
          async list() {
            return [{ sessionId: 's1', updatedAt: 1, running: false, blank: false, agentAvailable: false }]
          },
        },
        persistence: {
          async stat() {
            return {
              header: { id: 's1', createdAt: 100, isSeeded: false, agentPreset: 'mode-test' },
              revision: 1,
              eventCount: events.length,
            } as never
          },
          async open() {
            return {
              inheritedEventCount: 0,
              async read(offset = 0, limit?: number) {
                return { events: events.slice(offset, limit === undefined ? undefined : offset + limit) }
              },
              async close() {},
            } as never
          },
        },
      },
      {
        async *stream() {
          yield { type: 'text-delta', index: 0, text: 'ok' }
        },
      },
    )

    try {
      // 1. Run a scan to produce an in-memory report in the scanner
      const scanHandle = runtime.startScan({ modeId: 'mode-test' })
      const report = await scanHandle.done
      expect(report).toBeDefined()
      expect(report!.modeEvaluation).toBeDefined()

      // 2. Prepare analysis passing only intent (reportId + evidenceRefs)
      const plan = await (runtime as unknown as {
        prepareAnalysis(intent: {
          kind: 'mode-quality'
          modeId: string
          reportId: string
          evidenceRefs: string[]
          model: { provider: string; model: string }
        }): Promise<{
          statisticsSummary: string
          evidence: { ref: string; text: string }[]
          feasible: boolean
          dataGaps: string[]
        }>
      }).prepareAnalysis({
        kind: 'mode-quality',
        modeId: 'mode-test',
        reportId: report!.id,
        evidenceRefs: ['s1:0'],
        model: { provider: 'test', model: 'm1' },
      })

      expect(plan.feasible).toBe(true)
      expect(plan.evidence).toHaveLength(1)
      expect(plan.evidence[0]!.ref).toBe('s1:0')
      expect(plan.evidence[0]!.text).toBe('hello doctor')

      const summary = JSON.parse(plan.statisticsSummary)
      expect(summary.lens).toBe('mode')
      expect(summary.reportId).toBe(report!.id)
      expect(summary.createdAt).toBe(report!.createdAt)
      expect(summary.coverage).toEqual(report!.coverage)
      expect(summary.scope).toEqual(report!.scope)
      expect(summary.modeGroups).toBeDefined()
      expect(summary.modeGroups.length).toBeGreaterThanOrEqual(1)

      // 3. Prepare session analysis: sessionMetrics in statisticsSummary is the structured object
      const sessionPlan = await (runtime as unknown as {
        prepareAnalysis(intent: {
          kind: 'session-quality'
          sessionId: string
          reportId: string
          evidenceRefs: string[]
          model: { provider: string; model: string }
        }): Promise<{ statisticsSummary: string }>
      }).prepareAnalysis({
        kind: 'session-quality',
        sessionId: 's1',
        reportId: report!.id,
        evidenceRefs: ['s1:0'],
        model: { provider: 'test', model: 'm1' },
      })
      const sessionSummary = JSON.parse(sessionPlan.statisticsSummary)
      expect(sessionSummary.lens).toBe('session')
      expect(sessionSummary.sessionMetrics).toBeDefined()
      expect(sessionSummary.sessionMetrics.composition).toBeDefined()
      expect(sessionSummary.sessionMetrics.tools).toBeDefined()
      expect(sessionSummary.sessionMetrics.carrying).toBeDefined()
      expect(sessionSummary.sessionMetrics.values).toBeUndefined()
    } finally {
      runtime.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('downgrades to feasible: false with dataGaps when reportId is provided but not found', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctor-assembly-stale-'))
    const events = [userMessageEvent(0, 0, 'hi')]
    const runtime = DoctorRuntime.isolated(
      root,
      {
        persistence: {
          async stat() {
            return { header: { id: 's1', createdAt: 1, isSeeded: false }, eventCount: 1 } as never
          },
          async open() {
            return {
              inheritedEventCount: 0,
              async read() { return { events } },
              async close() {},
            } as never
          },
        },
      },
      {
        async *stream() { yield { type: 'text-delta', index: 0, text: 'ok' } },
      },
    )

    try {
      const plan = await (runtime as unknown as {
        prepareAnalysis(intent: {
          kind: 'session-quality'
          sessionId: string
          reportId: string
          evidenceRefs: string[]
          model: { provider: string; model: string }
        }): Promise<{ feasible: boolean; dataGaps: string[] }>
      }).prepareAnalysis({
        kind: 'session-quality',
        sessionId: 's1',
        reportId: 'report-nonexistent',
        evidenceRefs: ['s1:0'],
        model: { provider: 'test', model: 'm1' },
      })

      expect(plan.feasible).toBe(false)
      expect(plan.dataGaps).toEqual(expect.arrayContaining([expect.stringContaining('报告已失效，请重新扫描')]))
    } finally {
      runtime.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('allows prepareAnalysis without reportId when no report is available', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctor-assembly-noreport-'))
    const events = [userMessageEvent(0, 0, 'hi')]
    const runtime = DoctorRuntime.isolated(
      root,
      {
        persistence: {
          async stat() {
            return { header: { id: 's1', createdAt: 1, isSeeded: false }, eventCount: 1 } as never
          },
          async open() {
            return {
              inheritedEventCount: 0,
              async read() { return { events } },
              async close() {},
            } as never
          },
        },
      },
      {
        async *stream() { yield { type: 'text-delta', index: 0, text: 'ok' } },
      },
    )

    try {
      const plan = await (runtime as unknown as {
        prepareAnalysis(intent: {
          kind: 'session-quality'
          sessionId: string
          evidenceRefs: string[]
          model: { provider: string; model: string }
        }): Promise<{ feasible: boolean; statisticsSummary: string }>
      }).prepareAnalysis({
        kind: 'session-quality',
        sessionId: 's1',
        evidenceRefs: ['s1:0'],
        model: { provider: 'test', model: 'm1' },
      })

      expect(plan.feasible).toBe(true)
      const summary = JSON.parse(plan.statisticsSummary)
      expect(summary.lens).toBe('session')
      expect(summary.reportId).toBeUndefined()
    } finally {
      runtime.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
