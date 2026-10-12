/**
 * W4 view-model tests: the two-lens shapes from experience.md §2 wireframes.
 */
import { describe, expect, it } from 'vitest'
import type { SessionReportEntry, ScanReport } from '../../src/doctor/host/jobs.ts'
import type { SessionMetrics } from '../../src/doctor/metrics.ts'
import {
  buildCompositionRows,
  buildIssueLines,
  buildModeProblemGroups,
  buildSessionSummary,
} from '../../src/client/context-doctor/view-model.ts'

function createMockMetrics(sessionId: string, overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    composition: {
      observedUsage: { id: 'C01', metricVersion: 'v', scope: sessionId, value: null, unit: 'observed-tokens', method: 'm' },
      compositionShares: [],
      exactDuplicates: { id: 'C05', metricVersion: 'v', scope: sessionId, value: null, unit: 'ratio', method: 'm' },
      repeatedToolResults: { id: 'C06', metricVersion: 'v', scope: sessionId, value: 0, unit: 'count', method: 'm' },
      buckets: [],
    },
    tools: {
      exposure: { id: 'T01', metricVersion: 'v', scope: sessionId, value: null, unit: 'ratio', method: 'm' },
      usageRatio: { id: 'T02', metricVersion: 'v', scope: sessionId, value: null, unit: 'ratio', method: 'm' },
      pairing: { id: 'C10', metricVersion: 'v', scope: sessionId, value: null, unit: 'ratio', method: 'm' },
      ptcFacts: { id: 'T08', metricVersion: 'v', scope: sessionId, value: 0, unit: 'count', method: 'm' },
      perTool: [],
      callShare: [],
      status: [],
      repeatArgs: [],
      toolBurden: [],
    },
    extensions: {
      skillCatalog: { id: 'S01', metricVersion: 'v', scope: sessionId, value: null, unit: 'count', method: 'm' },
      skillLoads: { id: 'S02', metricVersion: 'v', scope: sessionId, value: 0, unit: 'count', method: 'm' },
      skillReloads: { id: 'S03', metricVersion: 'v', scope: sessionId, value: null, unit: 'ratio', method: 'm' },
      skillBurden: { id: 'S04', metricVersion: 'v', scope: sessionId, value: 0, unit: 'bytes', method: 'm' },
      mcpComponents: { id: 'M01', metricVersion: 'v', scope: sessionId, value: 0, unit: 'count', method: 'm' },
      skillLoadsByPath: [],
      components: [],
      mcpReachability: [],
    },
    carrying: {
      addRemove: { id: 'C03', metricVersion: 'v', scope: sessionId, value: null, unit: 'bytes', method: 'm' },
      cumulativeCarry: { id: 'C04', metricVersion: 'v', scope: sessionId, value: 0, unit: 'bytes-per-request', method: 'm' },
      cacheReadRatio: { id: 'C08', metricVersion: 'v', scope: sessionId, value: null, unit: 'ratio', method: 'm' },
      compactionChange: { id: 'C12', metricVersion: 'v', scope: sessionId, value: null, unit: 'ratio', method: 'm' },
      capabilityChanges: { id: 'C14', metricVersion: 'v', scope: sessionId, value: 0, unit: 'count', method: 'm' },
    },
    issues: [],
    ...overrides,
  }
}

function entry(partial: Partial<SessionReportEntry> & { sessionId: string }): SessionReportEntry {
  return {
    originSessionId: partial.sessionId,
    cutoffSeq: 1,
    status: { kind: 'ok' },
    eligibility: {
      sessionId: partial.sessionId,
      rawUnits: [],
      recoveryGroups: [],
      confirmedExchanges: 2,
      possibleExchanges: 0,
      status: 'eligible',
      reasons: [],
    },
    versions: [],
    metrics: createMockMetrics(partial.sessionId),
    ...partial,
  } as SessionReportEntry
}

describe('session lens view model', () => {
  it('uses character-based estimates and shares for Chinese text, independently of UTF-8 bytes', () => {
    const sample = entry({
      sessionId: 'unicode',
      metrics: createMockMetrics('unicode', {
        composition: {
          observedUsage: { id: 'C01', metricVersion: 'v', scope: 'unicode', value: null, unit: 'observed-tokens', method: 'm' },
          compositionShares: [],
          exactDuplicates: { id: 'C05', metricVersion: 'v', scope: 'unicode', value: null, unit: 'ratio', method: 'm' },
          repeatedToolResults: { id: 'C06', metricVersion: 'v', scope: 'unicode', value: 0, unit: 'count', method: 'm' },
          buckets: [
            { bucket: 'message', bytes: 24, chars: 8, estTokens: 2 },
            { bucket: 'tool-result', bytes: 8, chars: 8, estTokens: 2 },
          ],
        },
      }),
    })
    const rows = buildCompositionRows(sample)
    expect(rows.rows[0]?.estimatedTokens).toBe(2)
    expect(rows.rows[0]?.share).toBe(0.5)
    expect(rows.totalEstimatedTokens).toBe(4)
    expect(rows.totalBytes).toBe(32)
  })

  const base = entry({
    sessionId: 's1',
    metrics: createMockMetrics('s1', {
      composition: {
        observedUsage: {
          id: 'C01', metricVersion: 'v', scope: 's1', value: 42_800, unit: 'observed-tokens',
          method: 'm', numerator: 42_800, eligibleCount: 2, observedCount: 2,
        },
        compositionShares: [],
        exactDuplicates: {
          id: 'C05', metricVersion: 'v', scope: 's1', value: 0.1, unit: 'ratio',
          method: 'm', numerator: 10_000, denominator: 100_000,
        },
        repeatedToolResults: { id: 'C06', metricVersion: 'v', scope: 's1', value: 0, unit: 'count', method: 'm' },
        buckets: [
          { bucket: 'tool-result', bytes: 40_000, chars: 40_000, estTokens: 10_000 },
          { bucket: 'message', bytes: 20_000, chars: 20_000, estTokens: 5_000 },
        ],
      },
      issues: [
        { kind: 'proxy', text: '额外精确副本 10000 bytes（占 10.0%）', evidenceRefs: [] },
      ],
    }),
  })

  it('keeps observed and estimated apart (AT03)', () => {
    const summary = buildSessionSummary(base)
    expect(summary.observedInputTotal).toBe(42_800)
    expect(summary.estimatedCompositionTokens).toBe(15_000)
    expect(summary.observedCoverage).toBe('2/2 请求有供应商报告')
  })

  it('composition rows carry estimated tokens and occupancy share (E1)', () => {
    const { rows, totalBytes, totalEstimatedTokens } = buildCompositionRows(base)
    expect(totalBytes).toBe(60_000)
    expect(totalEstimatedTokens).toBe(15_000)
    const toolResult = rows.find((row) => row.bucket === 'tool-result')!
    expect(toolResult.share).toBeCloseTo(2 / 3, 10)
    expect(toolResult.estimatedTokens).toBe(10_000)
  })

  it('quality issues stay independent lines, not averaged into shares (AT04)', () => {
    const lines = buildIssueLines(base, [{ title: '交付后遗漏验收环境' }])
    const userLine = lines.find((line) => line.kind === 'user-recorded')!
    expect(userLine.text).toBe('交付后遗漏验收环境')
    const proxy = lines.find((line) => line.kind === 'proxy')!
    expect(proxy.text).toContain('10.0%')
    // No issue is folded into composition rows.
    expect(buildCompositionRows(base).rows.every((row) => row.issueBytes === 0)).toBe(true)
  })
})

describe('mode lens view model', () => {
  const report = {
    coverage: { candidates: 120, completed: 76, partial: 8, failed: 0, modeSkipped: 0, failures: [] },
    sessions: [
      entry({ sessionId: 'a' }),
      entry({
        sessionId: 'b',
        eligibility: {
          sessionId: 'b', rawUnits: [], recoveryGroups: [], confirmedExchanges: 1,
          possibleExchanges: 0, status: 'ineligible', reasons: ['insufficient-exchanges'],
        },
      }),
      entry({
        sessionId: 'c',
        status: { kind: 'error', reason: 'read-failed:x' },
        eligibility: {
          sessionId: 'c', rawUnits: [], recoveryGroups: [], confirmedExchanges: 2,
          possibleExchanges: 0, status: 'eligible', reasons: [],
        },
      }),
    ],
  } as unknown as ScanReport

  it('problem groups separate proven versions from unknown (E6/AT13)', () => {
    const groups = buildModeProblemGroups(report, [
      { sessionId: 'a', versionKey: 'v3', counted: true },
      { sessionId: 'a', versionKey: 'v3', counted: true }, // duplicate report, same session
      { sessionId: 'c', versionKey: 'v3', counted: true }, // error session: outside readable window
      { sessionId: 'a', versionKey: 'unknown', counted: true },
      { sessionId: 'b', versionKey: 'v3', counted: false }, // withdrawn
    ])
    const v3 = groups.find((group) => group.versionKey === 'v3')!
    expect(v3.affectedSessions).toBe(1) // only 'a'; 'c' unreadable, withdrawn excluded
    const unknown = groups.find((group) => group.versionKey === 'unknown')!
    expect(unknown.affectedSessions).toBe(1)
    expect(unknown.reports).toBe(1)
  })
})
