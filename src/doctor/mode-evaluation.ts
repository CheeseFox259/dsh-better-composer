/**
 * Mode quality evaluation pipeline (W2/W4 host sinking).
 * Pre-aggregates mode-level funnel, fingerprint observation groups,
 * C05 typical session / pooled contribution metrics, and component burden rows
 * directly from in-memory SessionReportEntry records during scanning.
 */
import type { VersionRef } from './contracts.ts'
import type { SessionReportEntry } from './host/jobs.ts'
import { allMetricValues } from './metrics.ts'

export interface ModeFunnel {
  readonly candidates: number
  readonly eligible: number
  readonly readable: number
  readonly perMetricComputable: number
}

export interface ModeComponentRow {
  readonly name: string
  readonly kind: 'native' | 'mcp' | 'unknown'
  readonly exposed: boolean
  readonly used: boolean
  readonly calls: number
  readonly errors: number
  readonly burdenBytes: number
  readonly burdenEstimatedTokens: number | null
}

export interface ModeRepetition {
  readonly median: number | null
  readonly mean: number | null
  readonly pooledContribution: number | null
  readonly sampleCount: number
}

export interface ModeEvaluationGroup {
  readonly fingerprint: string
  readonly versionRefs: readonly VersionRef[]
  readonly sessionIds: readonly string[]
  readonly candidates: number
  readonly eligible: number
  readonly components: readonly ModeComponentRow[]
  readonly repetition: ModeRepetition
}

export interface ModeEvaluation {
  readonly modeId: string
  readonly funnel: ModeFunnel
  readonly groups: readonly ModeEvaluationGroup[]
}

/** One eligible session's contribution to a group metric. */
interface SessionSample {
  readonly sessionId: string
  readonly numerator: number
  readonly denominator: number
}

/**
 * 典型会话 (typical session): median plus the equal-weight session mean (E2).
 */
function typicalSession(ratios: readonly number[]): {
  readonly median: number | null
  readonly mean: number | null
} {
  if (ratios.length === 0) return { median: null, mean: null }
  const sorted = [...ratios].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
  return { median, mean }
}

/**
 * 总体资源贡献 (pooled contribution): Σ numerators / Σ denominators (E2).
 */
function pooledContribution(samples: readonly SessionSample[]): number | null {
  const numerator = samples.reduce((sum, sample) => sum + sample.numerator, 0)
  const denominator = samples.reduce((sum, sample) => sum + sample.denominator, 0)
  return denominator === 0 ? null : numerator / denominator
}

/**
 * Component table rows for 能力与配置: exposure / usage / calls / burden.
 */
function buildModeComponentRows(entries: readonly SessionReportEntry[]): readonly ModeComponentRow[] {
  const activeEntries = entries.filter((entry) => entry.eligibility.status === 'eligible' && entry.status.kind !== 'error')
  const totals = new Map<string, { calls: number; errors: number }>()
  for (const entry of activeEntries) {
    for (const share of entry.metrics.tools.callShare) {
      const status = entry.metrics.tools.status.find((row) => row.name === share.name)
      const current = totals.get(share.name) ?? { calls: 0, errors: 0 }
      totals.set(share.name, { calls: current.calls + share.calls, errors: current.errors + (status?.error ?? 0) })
    }
  }
  const burden = new Map<string, number>()
  const burdenChars = new Map<string, number | null>()
  for (const entry of activeEntries) {
    for (const row of entry.metrics.tools.toolBurden) {
      burden.set(row.name, (burden.get(row.name) ?? 0) + row.definitionBytes)
      const previous = burdenChars.get(row.name)
      burdenChars.set(row.name, row.definitionChars === undefined || previous === null ? null : (previous ?? 0) + row.definitionChars)
    }
  }
  const exposed = new Set<string>()
  const used = new Set<string>()
  for (const entry of activeEntries) {
    for (const tool of entry.metrics.tools.perTool) {
      if (tool.exposed) exposed.add(tool.name)
      if (tool.called) used.add(tool.name)
    }
  }
  const kinds = new Map<string, 'native' | 'mcp' | 'unknown'>()
  for (const entry of activeEntries) {
    for (const component of entry.metrics.extensions.components) {
      kinds.set(component.name, component.kind)
    }
  }
  const names = new Set([...totals.keys(), ...exposed, ...kinds.keys()])
  for (const name of kinds.keys()) exposed.add(name)
  return [...names].map((name) => ({
    name,
    kind: kinds.get(name) ?? 'unknown',
    exposed: exposed.has(name),
    used: used.has(name),
    calls: totals.get(name)?.calls ?? 0,
    errors: totals.get(name)?.errors ?? 0,
    burdenBytes: burden.get(name) ?? 0,
    burdenEstimatedTokens: burdenChars.get(name) == null ? null : Math.round(burdenChars.get(name)! / 4),
  })).sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name))
}

function versionOf(entry: SessionReportEntry): string {
  return entry.versions.find((version) => version.kind === 'observed-fingerprint')?.digest ?? 'unobserved'
}

/**
 * Pre-aggregates mode evaluation metrics in host scanning pipeline (zero extra IO).
 */
export function computeModeEvaluation(
  modeId: string,
  entries: readonly SessionReportEntry[],
  coverage: { readonly candidates: number; readonly modeSkipped: number },
): ModeEvaluation {
  const eligible = entries.filter((entry) => entry.eligibility.status === 'eligible').length
  const readable = entries.filter((entry) => entry.eligibility.status === 'eligible' && entry.status.kind !== 'error').length
  const perMetricComputable = entries.filter(
    (entry) =>
      entry.eligibility.status === 'eligible' &&
      entry.status.kind !== 'error' &&
      allMetricValues(entry.metrics).some((metric) => metric.value !== null && (metric.observedCount ?? 1) > 0),
  ).length

  const funnel: ModeFunnel = Object.freeze({
    candidates: coverage.candidates - coverage.modeSkipped,
    eligible,
    readable,
    perMetricComputable,
  })

  const fingerprints = [...new Set(entries.map(versionOf))]
  const groups: ModeEvaluationGroup[] = fingerprints.map((fingerprint) => {
    const groupEntries = entries.filter((entry) => versionOf(entry) === fingerprint)
    const versionRefs = groupEntries[0]?.versions.filter((v) => v.kind === 'observed-fingerprint') ?? []
    const sessionIds = groupEntries.map((entry) => entry.sessionId)
    const candidates = groupEntries.length
    const eligibleCount = groupEntries.filter((entry) => entry.eligibility.status === 'eligible').length
    const components = buildModeComponentRows(groupEntries)

    const samples = groupEntries
      .filter((entry) => entry.eligibility.status === 'eligible' && entry.status.kind !== 'error')
      .flatMap((entry) => {
        const metric = entry.metrics.composition.exactDuplicates
        return metric?.value !== null && metric?.numerator !== undefined && metric.denominator !== undefined && metric.denominator > 0
          ? [{ sessionId: entry.sessionId, numerator: metric.numerator, denominator: metric.denominator }]
          : []
      })

    const typical = typicalSession(samples.map((sample) => sample.numerator / sample.denominator))
    const pooled = pooledContribution(samples)

    const repetition: ModeRepetition = Object.freeze({
      median: typical.median,
      mean: typical.mean,
      pooledContribution: pooled,
      sampleCount: samples.length,
    })

    return Object.freeze({
      fingerprint,
      versionRefs: Object.freeze([...versionRefs]),
      sessionIds: Object.freeze([...sessionIds]),
      candidates,
      eligible: eligibleCount,
      components: Object.freeze([...components]),
      repetition,
    })
  })

  return Object.freeze({
    modeId,
    funnel,
    groups: Object.freeze(groups),
  })
}
