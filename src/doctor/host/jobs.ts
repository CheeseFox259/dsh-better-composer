/**
 * Context Doctor scan jobs (W3). Deterministic scans only: bounded read
 * concurrency, cancellation at session/page boundaries, frozen per-session
 * cutoffs, and coverage accounting that names failures instead of dropping
 * them (architecture.md §12.2, AT18/19/35).
 */
import type { ReadStatus, VersionRef } from '../contracts.ts'
import type { Eligibility } from '../eligibility.ts'
import { assessEligibility } from '../eligibility.ts'
import {
  buildSessionView,
  computeSessionMetrics,
  type SessionMetrics,
} from '../metrics.ts'
import { REPORT_RULE_VERSIONS, hasCurrentRuleVersions } from '../rule-versions.ts'
import type { DoctorSource } from './source.ts'
import { computeModeEvaluation, type ModeEvaluation } from '../mode-evaluation.ts'

export type { ModeEvaluation } from '../mode-evaluation.ts'

export type ScanJobState =
  | 'queued'
  | 'reading'
  | 'computing'
  | 'complete'
  | 'partial'
  | 'cancelled'
  | 'failed'

export interface ScanScope {
  /** Explicit session ids; absent means the whole business-visible list. */
  readonly sessionIds?: readonly string[]
  /** Keep only sessions whose stored header names this agent preset. */
  readonly modeId?: string
  /** Per-session analysis cutoff; defaults to the stored end. */
  readonly cutoffSeq?: number
}

export interface ScanProgress {
  readonly state: ScanJobState
  readonly total: number
  readonly done: number
  readonly failed: number
}

export interface SessionFailure {
  readonly sessionId: string
  readonly reason: string
}

export interface ScanCoverage {
  readonly candidates: number
  readonly completed: number
  readonly partial: number
  readonly failed: number
  /** Sessions skipped by the mode filter after a cheap peek. */
  readonly modeSkipped: number
  readonly failures: readonly SessionFailure[]
}

export interface SessionReportEntry {
  readonly sessionId: string
  readonly originSessionId: string
  readonly modeId?: string
  readonly title?: string
  readonly cutoffSeq: number
  readonly status: ReadStatus
  readonly eligibility: Eligibility
  readonly metrics: SessionMetrics
  readonly versions: readonly VersionRef[]
}

export interface ScanReport {
  readonly id: string
  readonly createdAt: number
  readonly scope: ScanScope
  readonly ruleVersions: readonly string[]
  readonly coverage: ScanCoverage
  readonly sessions: readonly SessionReportEntry[]
  readonly modeEvaluation?: ModeEvaluation
}

export interface ScanHandle {
  readonly jobId: string
  /** Resolves with the frozen report, or undefined when cancelled. */
  readonly done: Promise<ScanReport | undefined>
}

interface JobRecord {
  readonly controller: AbortController
  progress: ScanProgress
  report: ScanReport | undefined
  readonly settle: (report: ScanReport | undefined) => void
  readonly done: Promise<ScanReport | undefined>
}

const DEFAULT_CONCURRENCY = 2

export interface ScannerOptions {
  readonly concurrency?: number
  readonly now?: () => number
}

/**
 * Runs deterministic scans over the read-only source. One job reads at most
 * `concurrency` sessions at once, never activates an Agent, and produces one
 * immutable report. Cancellation stops scheduling and closes handles; partial
 * results are reported through job status, never by mutating a live report.
 */
export class DoctorScanner {
  private readonly source: DoctorSource
  private readonly concurrency: number
  private readonly now: () => number
  private readonly jobs = new Map<string, JobRecord>()
  private nextJobId = 1

  constructor(source: DoctorSource, options: ScannerOptions = {}) {
    this.source = source
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
    this.now = options.now ?? (() => Date.now())
  }

  status(jobId: string): ScanProgress | undefined {
    return this.jobs.get(jobId)?.progress
  }

  /** The frozen report of a finished job, when one exists. */
  report(jobId: string): ScanReport | undefined {
    const report = this.jobs.get(jobId)?.report
    return report !== undefined && hasCurrentRuleVersions(report.ruleVersions) ? report : undefined
  }

  /** Find a frozen report by its report id across all finished jobs. */
  reportById(reportId: string): ScanReport | undefined {
    for (const job of this.jobs.values()) {
      if (job.report?.id === reportId && hasCurrentRuleVersions(job.report.ruleVersions)) {
        return job.report
      }
    }
    return undefined
  }

  /** Idempotent cancellation; returns false for unknown or finished jobs. */
  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId)
    if (job === undefined) return false
    job.controller.abort()
    return true
  }

  startScan(scope: ScanScope): ScanHandle {
    const controller = new AbortController()
    const jobId = `scan-${this.nextJobId++}`
    let settle!: (report: ScanReport | undefined) => void
    const done = new Promise<ScanReport | undefined>((resolve) => { settle = resolve })
    const job: JobRecord = {
      controller,
      progress: { state: 'queued', total: 0, done: 0, failed: 0 },
      report: undefined,
      settle,
      done,
    }
    this.jobs.set(jobId, job)
    void this.run(job, scope).catch(() => {
      job.progress = { ...job.progress, state: 'failed' }
      settle(undefined)
    })
    return { jobId, done }
  }

  /** Stop plugin-owned work when its runtime is unloaded. */
  dispose(): void {
    for (const job of this.jobs.values()) job.controller.abort()
  }

  forgetSession(sessionId: string): void {
    for (const job of this.jobs.values()) {
      if (job.report?.sessions.some((entry) => entry.sessionId === sessionId)) job.report = undefined
    }
  }

  private async run(job: JobRecord, scope: ScanScope): Promise<void> {
    const { controller } = job
    job.progress = { ...job.progress, state: 'reading' }

    const candidates = scope.sessionIds !== undefined
      ? [...scope.sessionIds]
      : (await this.source.freezeCandidates(controller.signal)).map((candidate) => candidate.sessionId)

    // Cheap mode pre-filter before any body read.
    const targets: string[] = []
    let modeSkipped = 0
    for (const sessionId of candidates) {
      if (controller.signal.aborted) break
      if (scope.modeId === undefined) {
        targets.push(sessionId)
        continue
      }
      const peeked = await this.source.peek(sessionId, controller.signal)
      if (peeked?.modeId === scope.modeId) targets.push(sessionId)
      else modeSkipped += 1
    }

    job.progress = { state: 'reading', total: targets.length, done: 0, failed: 0 }

    const entries: SessionReportEntry[] = []
    const failures: SessionFailure[] = []
    let partial = 0
    let cursor = 0

    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        if (controller.signal.aborted) return
        const sessionId = targets[cursor]!
        cursor += 1
        let entry: SessionReportEntry
        try {
          const snapshot = await this.source.readSnapshot(sessionId, {
            cutoffSeq: scope.cutoffSeq,
            signal: controller.signal,
          })
          const view = buildSessionView(snapshot)
          entry = {
            sessionId: snapshot.sessionId,
            originSessionId: snapshot.originSessionId,
            cutoffSeq: snapshot.cutoffSeq,
            status: snapshot.status,
            eligibility: assessEligibility(snapshot),
            metrics: computeSessionMetrics(view),
            versions: snapshot.versions,
            ...(snapshot.modeId === undefined ? {} : { modeId: snapshot.modeId }),
            ...(snapshot.title === undefined ? {} : { title: snapshot.title }),
          }
        } catch (error) {
          if (controller.signal.aborted) return
          failures.push({ sessionId, reason: (error as Error).message })
          job.progress = { ...job.progress, failed: job.progress.failed + 1, done: job.progress.done + 1 }
          continue
        }
        entries.push(entry)
        const isPartial = entry.status.kind === 'partial'
        if (isPartial) partial += 1
        if (entry.status.kind === 'error') {
          failures.push({ sessionId, reason: entry.status.reason })
        }
        job.progress = {
          ...job.progress,
          done: job.progress.done + 1,
          failed: job.progress.failed + (entry.status.kind === 'error' ? 1 : 0),
        }
      }
    }

    const workers = Array.from({ length: Math.min(this.concurrency, Math.max(1, targets.length)) }, () => worker())
    await Promise.all(workers)

    if (controller.signal.aborted) {
      job.progress = { ...job.progress, state: 'cancelled' }
      job.settle(undefined)
      return
    }

    job.progress = { ...job.progress, state: 'computing' }
    const completed = entries.filter((entry) => entry.status.kind === 'ok').length
    const failedCount = failures.length
    const state: ScanJobState = targets.length === 0
      ? 'failed'
      : failedCount === 0 && partial === 0
        ? 'complete'
        : completed + entries.filter((entry) => entry.status.kind === 'partial').length === 0
          ? 'failed'
          : 'partial'

    const modeEvaluation = scope.modeId === undefined
      ? undefined
      : computeModeEvaluation(scope.modeId, entries, {
          candidates: candidates.length,
          modeSkipped,
        })

    const report: ScanReport = Object.freeze({
      id: `report-${this.now()}-${entries.length}`,
      createdAt: this.now(),
      scope,
      ruleVersions: REPORT_RULE_VERSIONS,
      coverage: Object.freeze({
        candidates: candidates.length,
        completed,
        partial,
        failed: failedCount,
        modeSkipped,
        failures: Object.freeze([...failures]),
      }),
      sessions: Object.freeze([...entries].sort((left, right) => left.sessionId.localeCompare(right.sessionId))),
      ...(modeEvaluation === undefined ? {} : { modeEvaluation }),
    })
    job.report = report
    job.progress = { state, total: targets.length, done: job.progress.done, failed: job.progress.failed }
    job.settle(report)
  }
}
