/**
 * Context Doctor client view models (W4). Pure mapping from the frozen
 * ScanReport / feedback records to the two-lens UI shapes in
 * experience.md §2.1/2.2 — no React, no host state, trivially testable.
 * Display defaults follow the frozen decisions: estimated tokens primary,
 * observed totals separate, area means occupancy (never risk), independent
 * quality issue lines never averaged by size (AT04).
 */
import type { IssueLine } from '../../doctor/contracts.ts'
import type { ScanReport, SessionReportEntry } from '../../doctor/host/jobs.ts'

export type { IssueLine } from '../../doctor/contracts.ts'

/** One composition row for the session lens table. */
export interface CompositionRow {
  readonly bucket: string
  readonly label: string
  readonly bytes: number
  readonly estimatedTokens: number
  readonly share: number | null
  /** Bytes involved in flagged issues for this bucket; independent of share. */
  readonly issueBytes: number
}

const BUCKET_LABELS: Record<string, string> = {
  'system': '系统信息',
  'tool-definition': '工具定义/SDK',
  'skill-catalog': 'Skill目录',
  'skill-body': 'Skill正文',
  'message': '会话消息',
  'tool-result': '工具结果',
  'reference': '参考材料',
  'unknown': 'unknown',
}

function displayTokens(bytes: number): number {
  return Math.round(bytes / 4)
}

/** Composition table over the latest reconstructed request input. */
export function buildCompositionRows(entry: SessionReportEntry): {
  readonly rows: readonly CompositionRow[]
  readonly totalBytes: number
  readonly totalEstimatedTokens: number
} {
  const buckets = entry.metrics?.composition?.buckets ?? (entry.metrics as unknown as { details?: { composition?: typeof entry.metrics.composition.buckets } })?.details?.composition ?? []
  const totalBytes = buckets.reduce((sum, bucket) => sum + bucket.bytes, 0)
  const totalChars = buckets.reduce((sum, bucket) => sum + bucket.chars, 0)
  const duplicateBytes = entry.metrics?.composition?.exactDuplicates?.numerator ?? 0
  // Attribute the duplicate issue to buckets proportionally is wrong; the
  // metric carries per-bucket refs — the UI shows one independent issue line
  // instead of faking per-bucket precision (AT04).
  const rows = buckets.map((bucket) => ({
    bucket: bucket.bucket,
    label: BUCKET_LABELS[bucket.bucket] ?? bucket.bucket,
    bytes: bucket.bytes,
    estimatedTokens: bucket.estTokens,
    share: totalChars === 0 ? null : bucket.chars / totalChars,
    issueBytes: 0,
  }))
  void duplicateBytes
  return {
    rows,
    totalBytes,
    totalEstimatedTokens: displayTokens(totalChars),
  }
}

/** Header numbers for the session lens: observed vs estimated, kept apart (AT03). */
export function buildSessionSummary(entry: SessionReportEntry): {
  readonly observedInputTotal: number | null
  readonly observedCoverage: string
  readonly estimatedCompositionTokens: number
  readonly requestCount: number
  readonly eligibilityStatus: 'eligible' | 'ineligible' | 'needs-review'
  readonly eligibilityReasons: readonly string[]
} {
  const usage = entry.metrics?.composition?.observedUsage
  const composition = buildCompositionRows(entry)
  return {
    observedInputTotal: (usage?.observedCount ?? 0) > 0 ? usage?.value ?? null : null,
    observedCoverage: usage === undefined
      ? 'unobservable'
      : `${usage.observedCount ?? 0}/${usage.eligibleCount ?? 0} 请求有供应商报告`,
    estimatedCompositionTokens: composition.totalEstimatedTokens,
    requestCount: entry.metrics?.composition?.observedUsage?.eligibleCount ?? 0,
    eligibilityStatus: entry.eligibility.status,
    eligibilityReasons: entry.eligibility.reasons,
  }
}

export function buildIssueLines(entry: SessionReportEntry, problems: readonly { title: string }[]): IssueLine[] {
  const userLines: IssueLine[] = problems.map((problem) => ({
    kind: 'user-recorded',
    text: problem.title,
    evidenceRefs: [],
  }))
  return [...userLines, ...(entry.metrics.issues ?? [])]
}

// ---- Mode lens ----

export interface ModeProblemGroup {
  /** 'unknown' groups every session whose authoritative version is unproven. */
  readonly versionKey: string
  readonly affectedSessions: number
  readonly reports: number
}

/**
 * Problem counts per provenance version. Unknown-version occurrences are
 * listed apart, never mixed into the current version's ratio (AT13/E6).
 */
export function buildModeProblemGroups(
  report: ScanReport,
  occurrences: readonly { sessionId: string; versionKey?: string; counted: boolean }[],
): ModeProblemGroup[] {
  const readableIds = new Set(report.sessions.filter((entry) => entry.status.kind !== 'error').map((entry) => entry.sessionId))
  const byVersion = new Map<string, Set<string>>()
  let unknownReports = 0
  for (const occurrence of occurrences) {
    if (!occurrence.counted || !readableIds.has(occurrence.sessionId)) continue
    const key = occurrence.versionKey ?? 'unknown'
    if (key === 'unknown') unknownReports += 1
    const set = byVersion.get(key) ?? new Set<string>()
    set.add(occurrence.sessionId)
    byVersion.set(key, set)
  }
  const groups = [...byVersion.entries()].map(([versionKey, sessions]) => ({
    versionKey,
    affectedSessions: sessions.size,
    reports: versionKey === 'unknown' ? unknownReports : occurrences.filter((o) => (o.versionKey ?? 'unknown') === versionKey && o.counted).length,
  }))
  return groups.sort((left, right) => left.versionKey.localeCompare(right.versionKey))
}
