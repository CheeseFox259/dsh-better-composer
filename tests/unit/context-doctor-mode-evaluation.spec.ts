/**
 * Tests for host-side mode evaluation pipeline: funnel, fingerprint groups,
 * typical session, pooled contribution, and component burden rows (E2/E3, AT07/13/18).
 */
import { describe, expect, it } from 'vitest'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assistantMessageEvent,
  fixtureCallId,
  toolCallEvent,
  toolResultEvent,
  userMessageEvent,
} from '../helpers/doctor-events.ts'
import { DoctorSource } from '../../src/doctor/host/source.ts'
import { DoctorScanner, type ScanReport, type SessionReportEntry } from '../../src/doctor/host/jobs.ts'
import {
  computeModeEvaluation,
  type ModeEvaluation,
} from '../../src/doctor/mode-evaluation.ts'

interface FixtureSession {
  readonly id: string
  readonly events: SessionEvent[]
  readonly modeId?: string
  readonly failRead?: boolean
}

function makeScanner(fixtures: FixtureSession[]) {
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
          async close() {},
          async [Symbol.asyncDispose]() {},
        } as never
      },
    },
  })
  const scanner = new DoctorScanner(source, { concurrency: 2 })
  return { scanner }
}

describe('computeModeEvaluation unit calculations (E2, funnel, component rows)', () => {
  it('E2: typical session reports median and equal-weight mean; pooled contribution pools Σnum/Σden', () => {
    const entryS1 = {
      sessionId: 's1',
      cutoffSeq: 10,
      status: { kind: 'ok' },
      eligibility: { status: 'eligible' },
      versions: [{ kind: 'observed-fingerprint', digest: 'fp-1', coverage: 'complete-within-scope' }],
      metrics: {
        composition: {
          observedUsage: { id: 'C01', metricVersion: 'v', scope: 's1', value: null, unit: 'observed-tokens', method: 'm' },
          compositionShares: [],
          exactDuplicates: { id: 'C05', metricVersion: 'v', scope: 's1', value: 0.1, numerator: 10_000, denominator: 100_000, observedCount: 1, unit: 'ratio', method: 'm' },
          repeatedToolResults: { id: 'C06', metricVersion: 'v', scope: 's1', value: 0, unit: 'count', method: 'm' },
          buckets: [],
        },
        tools: { exposure: {} as never, usageRatio: {} as never, pairing: {} as never, ptcFacts: {} as never, perTool: [], callShare: [], status: [], repeatArgs: [], toolBurden: [] },
        extensions: { skillCatalog: {} as never, skillLoads: {} as never, skillReloads: {} as never, skillBurden: {} as never, mcpComponents: {} as never, skillLoadsByPath: [], components: [], mcpReachability: [] },
        carrying: { addRemove: {} as never, cumulativeCarry: {} as never, cacheReadRatio: {} as never, compactionChange: {} as never, capabilityChanges: {} as never },
        issues: [],
      },
    } as unknown as SessionReportEntry

    const entryS2 = {
      sessionId: 's2',
      cutoffSeq: 10,
      status: { kind: 'ok' },
      eligibility: { status: 'eligible' },
      versions: [{ kind: 'observed-fingerprint', digest: 'fp-1', coverage: 'complete-within-scope' }],
      metrics: {
        composition: {
          observedUsage: { id: 'C01', metricVersion: 'v', scope: 's2', value: null, unit: 'observed-tokens', method: 'm' },
          compositionShares: [],
          exactDuplicates: { id: 'C05', metricVersion: 'v', scope: 's2', value: 0.3, numerator: 300_000, denominator: 1_000_000, observedCount: 1, unit: 'ratio', method: 'm' },
          repeatedToolResults: { id: 'C06', metricVersion: 'v', scope: 's2', value: 0, unit: 'count', method: 'm' },
          buckets: [],
        },
        tools: { exposure: {} as never, usageRatio: {} as never, pairing: {} as never, ptcFacts: {} as never, perTool: [], callShare: [], status: [], repeatArgs: [], toolBurden: [] },
        extensions: { skillCatalog: {} as never, skillLoads: {} as never, skillReloads: {} as never, skillBurden: {} as never, mcpComponents: {} as never, skillLoadsByPath: [], components: [], mcpReachability: [] },
        carrying: { addRemove: {} as never, cumulativeCarry: {} as never, cacheReadRatio: {} as never, compactionChange: {} as never, capabilityChanges: {} as never },
        issues: [],
      },
    } as unknown as SessionReportEntry

    const evaluation = computeModeEvaluation('mode-code', [entryS1, entryS2], { candidates: 2, modeSkipped: 0 })
    expect(evaluation.modeId).toBe('mode-code')
    expect(evaluation.groups).toHaveLength(1)
    const group = evaluation.groups[0]!
    expect(group.fingerprint).toBe('fp-1')
    expect(group.repetition.median).toBeCloseTo(0.2, 10)
    expect(group.repetition.mean).toBeCloseTo(0.2, 10)
    expect(group.repetition.pooledContribution).toBeCloseTo(310_000 / 1_100_000, 10)
    expect(group.repetition.sampleCount).toBe(2)
  })

  it('funnel counts candidates, eligible, readable, and perMetricComputable', () => {
    const emptyMetrics = {
      composition: { observedUsage: {} as never, compositionShares: [], exactDuplicates: { value: null, observedCount: 0 } as never, repeatedToolResults: {} as never, buckets: [] },
      tools: { exposure: {} as never, usageRatio: {} as never, pairing: {} as never, ptcFacts: {} as never, perTool: [], callShare: [], status: [], repeatArgs: [], toolBurden: [] },
      extensions: { skillCatalog: {} as never, skillLoads: {} as never, skillReloads: {} as never, skillBurden: {} as never, mcpComponents: {} as never, skillLoadsByPath: [], components: [], mcpReachability: [] },
      carrying: { addRemove: {} as never, cumulativeCarry: {} as never, cacheReadRatio: {} as never, compactionChange: {} as never, capabilityChanges: {} as never },
      issues: [],
    }
    const entries = [
      {
        sessionId: 'a',
        status: { kind: 'ok' },
        eligibility: { status: 'eligible' },
        versions: [],
        metrics: {
          ...emptyMetrics,
          composition: { ...emptyMetrics.composition, exactDuplicates: { value: 0.1, observedCount: 1 } as never },
        },
      },
      {
        sessionId: 'b',
        status: { kind: 'ok' },
        eligibility: { status: 'ineligible' },
        versions: [],
        metrics: emptyMetrics,
      },
      {
        sessionId: 'c',
        status: { kind: 'error', reason: 'read-failed:x' },
        eligibility: { status: 'eligible' },
        versions: [],
        metrics: emptyMetrics,
      },
    ] as unknown as SessionReportEntry[]

    const evaluation = computeModeEvaluation('mode-code', entries, { candidates: 120, modeSkipped: 10 })
    expect(evaluation.funnel).toEqual({
      candidates: 110,
      eligible: 2,
      readable: 1,
      perMetricComputable: 1,
    })
  })

  it('aggregates component rows across eligible readable sessions', () => {
    const entry = {
      sessionId: 's1',
      status: { kind: 'ok' },
      eligibility: { status: 'eligible' },
      versions: [{ kind: 'observed-fingerprint', digest: 'fp-1', coverage: 'complete-within-scope' }],
      metrics: {
        composition: { observedUsage: {} as never, compositionShares: [], exactDuplicates: {} as never, repeatedToolResults: {} as never, buckets: [] },
        tools: {
          exposure: {} as never, usageRatio: {} as never, pairing: {} as never, ptcFacts: {} as never,
          callShare: [{ name: 'shell', share: 0.5, calls: 2 }],
          status: [{ name: 'shell', success: 1, error: 1, unknown: 0, pending: 0 }],
          toolBurden: [{ name: 'shell', definitionBytes: 200, definitionChars: 800, resultBytes: 0, carryRequests: 2 }],
          perTool: [{ name: 'shell', exposed: true, called: true }],
          repeatArgs: [],
        },
        extensions: {
          skillCatalog: {} as never, skillLoads: {} as never, skillReloads: {} as never, skillBurden: {} as never, mcpComponents: {} as never,
          skillLoadsByPath: [],
          components: [
            { name: 'shell', kind: 'native' as const },
            { name: 'mcp__fs__read', kind: 'mcp' as const, server: 'fs' },
          ],
          mcpReachability: [],
        },
        carrying: { addRemove: {} as never, cumulativeCarry: {} as never, cacheReadRatio: {} as never, compactionChange: {} as never, capabilityChanges: {} as never },
        issues: [],
      },
    } as unknown as SessionReportEntry

    const evaluation = computeModeEvaluation('mode-code', [entry], { candidates: 1, modeSkipped: 0 })
    const rows = evaluation.groups[0]!.components
    const shell = rows.find((row) => row.name === 'shell')!
    expect(shell.calls).toBe(2)
    expect(shell.errors).toBe(1)
    expect(shell.burdenBytes).toBe(200)
    expect(shell.burdenEstimatedTokens).toBe(200)
    const mcp = rows.find((row) => row.name === 'mcp__fs__read')!
    expect(mcp.kind).toBe('mcp')
    expect(mcp.exposed).toBe(true)
  })
})

describe('DoctorScanner modeEvaluation integration', () => {
  it('omits modeEvaluation when scan scope has no modeId, but includes doctor-aggregate/1 ruleVersion', async () => {
    const { scanner } = makeScanner([
      { id: 's1', events: [userMessageEvent(0, 0, 'hi'), assistantMessageEvent(1, 0, 0, 'ok')] },
    ])
    const report = await scanner.startScan({}).done
    expect(report).toBeDefined()
    expect(report!.modeEvaluation).toBeUndefined()
    expect(report!.ruleVersions).toContain('doctor-aggregate/1')
  })

  it('attaches modeEvaluation to ScanReport when scan scope specifies modeId', async () => {
    const repeated = 'repeated context '.repeat(10)
    const callId = fixtureCallId()
    const { scanner } = makeScanner([
      {
        id: 'session-1',
        modeId: 'agent-coder',
        events: [
          userMessageEvent(0, 0, repeated),
          assistantMessageEvent(1, 0, 0, repeated),
          userMessageEvent(2, 1, 'do it'),
          toolCallEvent(3, 1, 0, callId, 'shell', { cmd: 'echo 1' }),
          toolResultEvent(4, 1, 0, callId, 'output', undefined, 3),
          assistantMessageEvent(5, 1, 1, 'done'),
        ],
      },
      {
        id: 'session-2',
        modeId: 'other-mode',
        events: [
          userMessageEvent(0, 0, 'hi'),
          assistantMessageEvent(1, 0, 0, 'hey'),
        ],
      },
    ])

    const report = (await scanner.startScan({ modeId: 'agent-coder' }).done)!
    expect(report).toBeDefined()
    expect(report.ruleVersions).toContain('doctor-aggregate/1')
    expect(report.coverage.modeSkipped).toBe(1)
    expect(report.modeEvaluation).toBeDefined()

    const evaluation = report.modeEvaluation!
    expect(evaluation.modeId).toBe('agent-coder')
    expect(evaluation.funnel.candidates).toBe(1)
    expect(evaluation.funnel.eligible).toBe(1)
    expect(evaluation.funnel.readable).toBe(1)
    expect(evaluation.groups.length).toBeGreaterThanOrEqual(1)

    const group = evaluation.groups[0]!
    expect(typeof group.fingerprint).toBe('string')
    expect(group.candidates).toBe(1)
    expect(group.eligible).toBe(1)
    expect(group.components.some((row) => row.name === 'shell')).toBe(true)
    expect(group.repetition.sampleCount).toBe(1)
    expect(group.repetition.median).not.toBeNull()
  })
})
