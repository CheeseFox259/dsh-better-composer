/**
 * DoctorClient: High-level client facade for Context Doctor operations (Candidate 1).
 * Encapsulates polling loops, AbortSignal cancellation wiring, error unwrapping,
 * statistics summary packaging, and returns latest states directly without N+1 requests.
 */
import type { ScanReport, ScanScope, ScanProgress } from '../../doctor/host/jobs.ts'
import type { AnalysisPlan, AnalysisResult, CandidateConstraint } from '../../doctor/host/analyze.ts'
import type { ConstraintScope, EvidencePage } from '../../doctor/host/runtime.ts'
import type { ProviderPlan } from '../../doctor/host/provider.ts'
import type { ObservedModes } from '../../doctor/host/observe.ts'
import type { DoctorRemoteFace, RemoteResult } from '../remote.ts'

/** Resolve an injected DoctorClient or build one from a raw remote face. */
export function resolveDoctorClient(
  direct: DoctorClient | undefined,
  face: DoctorRemoteFace | undefined,
): DoctorClient | undefined {
  return direct ?? (face ? new DoctorClient(face) : undefined)
}

export interface FeedbackOccurrenceItem {
  readonly id: string
  readonly revision: number
  readonly problemId: string
  readonly data: Record<string, unknown>
}

export interface FeedbackProblemItem {
  readonly id: string
  readonly revision: number
  readonly title: string
  readonly data: Record<string, unknown>
  readonly occurrences: readonly FeedbackOccurrenceItem[]
}

export interface FeedbackTree {
  readonly problems: readonly FeedbackProblemItem[]
}

export interface FeedbackSubmitIntent {
  readonly targetProblemId?: string
  readonly problemTitle?: string
  readonly type: string
  readonly typeLabel?: string
  readonly note?: string
  readonly sessionId?: string
  readonly modeId?: string
  readonly evidenceRefs?: readonly string[]
  readonly occurrence?: Record<string, unknown>
}

export interface StoredConstraint {
  readonly id: string
  readonly revision: number
  readonly data: Record<string, unknown>
}

export interface AnalysisIntent {
  readonly kind: 'session-quality' | 'mode-quality' | 'requirement-distill'
  readonly sessionId?: string
  readonly modeId?: string
  readonly reportId?: string
  readonly evidenceRefs?: readonly string[]
  readonly model: { readonly provider: string; readonly model: string }
}

export function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  const error = result.error
  throw new Error(
    error instanceof Error
      ? error.message
      : error !== null && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error),
  )
}

function waitWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export class DoctorClient {
  constructor(private readonly face: DoctorRemoteFace) {}

  readonly scan = {
    run: async (
      scope: ScanScope,
      options?: { signal?: AbortSignal; onProgress?: (progress: ScanProgress) => void },
    ): Promise<ScanReport> => {
      options?.signal?.throwIfAborted()
      const { jobId } = unwrapRemote(
        await this.face.doctorStartScan({
          ...scope,
          sessionIds: scope.sessionIds === undefined ? undefined : [...scope.sessionIds],
        }),
      )
      const cancel = () => {
        void this.face.doctorCancelJob({ jobId }).catch(() => {})
      }
      options?.signal?.addEventListener('abort', cancel, { once: true })
      if (options?.signal?.aborted) cancel()

      try {
        while (true) {
          options?.signal?.throwIfAborted()
          const status = unwrapRemote(await this.face.doctorJob({ jobId })) as ScanProgress | undefined
          if (!status) throw new Error('扫描任务已失效，请更新统计')
          if (status.state === 'cancelled') throw new Error('扫描已取消')
          options?.onProgress?.(status)

          if (['complete', 'partial', 'failed'].includes(status.state)) {
            const report = unwrapRemote(await this.face.doctorReport({ jobId })) as ScanReport | undefined
            if (!report) throw new Error('扫描失败，未生成报告')
            return report
          }
          await waitWithSignal(150, options?.signal)
        }
      } finally {
        options?.signal?.removeEventListener('abort', cancel)
      }
    },
  }

  readonly analysis = {
    available: async (): Promise<boolean> => {
      const res = unwrapRemote(await this.face.doctorAnalysisAvailable()) as { available: boolean }
      return res?.available === true
    },

    prepare: async (intent: AnalysisIntent): Promise<AnalysisPlan> => {
      const res = unwrapRemote(
        await this.face.doctorPrepareAnalysis({
          kind: intent.kind,
          sessionId: intent.sessionId,
          modeId: intent.modeId,
          reportId: intent.reportId,
          evidenceRefs: intent.evidenceRefs ?? [],
          model: intent.model,
        }),
      )
      return res as AnalysisPlan
    },

    run: async (
      plan: { id: string } | AnalysisPlan,
      options?: {
        idempotencyKey?: string
        signal?: AbortSignal
        onProgress?: (progress: { state: string; error?: string; result?: AnalysisResult }) => void
      },
    ): Promise<AnalysisResult> => {
      options?.signal?.throwIfAborted()
      const { jobId } = unwrapRemote(
        await this.face.doctorRunAnalysis({
          plan: { id: plan.id },
          idempotencyKey: options?.idempotencyKey ?? plan.id,
        }),
      )
      const cancel = () => {
        void this.face.doctorCancelAnalysis({ jobId }).catch(() => {})
      }
      options?.signal?.addEventListener('abort', cancel, { once: true })
      if (options?.signal?.aborted) cancel()

      try {
        while (true) {
          options?.signal?.throwIfAborted()
          const progress = unwrapRemote(await this.face.doctorAnalysisJob({ jobId })) as
            | { state: string; error?: string; result?: AnalysisResult }
            | undefined
          if (!progress) throw new Error('分析任务已失效')
          options?.onProgress?.(progress)

          if (['complete', 'partial'].includes(progress.state)) {
            if (!progress.result) throw new Error(progress.error || '分析完成但未生成结果')
            return progress.result
          }
          if (progress.state === 'cancelled') throw new Error('分析已取消')
          if (progress.state === 'failed') throw new Error(progress.error || '分析任务失败')

          await waitWithSignal(150, options?.signal)
        }
      } finally {
        options?.signal?.removeEventListener('abort', cancel)
      }
    },
  }

  readonly feedback = {
    load: async (): Promise<FeedbackTree> => {
      const res = unwrapRemote(await this.face.doctorFeedbackTree())
      return res as FeedbackTree
    },

    submit: async (input: FeedbackSubmitIntent): Promise<FeedbackTree> => {
      const occurrencePayload: Record<string, unknown> = {
        type: input.type,
        typeLabel: input.typeLabel ?? input.type,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.modeId ? { modeId: input.modeId } : {}),
        ...(input.note ? { note: input.note } : {}),
        reportedAt: Date.now(),
        counted: true,
        evidenceRefs: input.evidenceRefs ?? [],
        ...input.occurrence,
      }
      const res = unwrapRemote(
        await this.face.doctorSaveFeedback({
          targetProblemId: input.targetProblemId,
          problemTitle: input.problemTitle,
          occurrence: occurrencePayload,
        }),
      )
      return res as FeedbackTree
    },

    withdraw: async (occurrenceId: string, revision: number): Promise<FeedbackTree> => {
      const res = unwrapRemote(
        await this.face.doctorUpdateFeedback({
          kind: 'occurrence',
          objectId: occurrenceId,
          expectedRevision: revision,
          patch: { withdrawn: true },
        }),
      )
      return res as FeedbackTree
    },
  }

  readonly constraints = {
    list: async (): Promise<StoredConstraint[]> => {
      const res = unwrapRemote(await this.face.doctorConstraints())
      return res as StoredConstraint[]
    },

    confirm: async (
      candidate: CandidateConstraint,
      values?: { requirement?: string; conditions?: readonly string[]; exceptions?: readonly string[]; scope?: ConstraintScope },
    ): Promise<StoredConstraint[]> => {
      const scope = values?.scope ?? { kind: 'session', sessionId: '' }
      const res = unwrapRemote(
        await this.face.doctorSaveConstraint({
          id: candidate.id,
          originalText: candidate.originalText,
          normalizedRequirement: values?.requirement ?? candidate.normalizedRequirement,
          conditions: values?.conditions ?? candidate.conditions,
          exceptions: values?.exceptions ?? candidate.exceptions,
          sourceRefs: candidate.sourceRefs,
          scope,
        }),
      )
      return res as StoredConstraint[]
    },

    update: async (
      id: string,
      expectedRevision: number,
      patch: Record<string, unknown>,
    ): Promise<StoredConstraint[]> => {
      const res = unwrapRemote(
        await this.face.doctorUpdateConstraint({
          id,
          expectedRevision,
          patch,
        }),
      )
      return res as StoredConstraint[]
    },
  }

  readonly evidence = {
    query: async (
      sessionId: string,
      options?: { offset?: number; cutoffSeq?: number; refs?: readonly string[] },
    ): Promise<EvidencePage> => {
      const res = unwrapRemote(await this.face.doctorEvidence({ sessionId, ...options }))
      return res as EvidencePage
    },
  }

  readonly provider = {
    prepare: async (modeId: string, enabled: boolean): Promise<ProviderPlan> => {
      const res = unwrapRemote(await this.face.doctorPrepareProvider({ modeId, enabled }))
      return res as ProviderPlan
    },

    apply: async (planId: string): Promise<void> => {
      unwrapRemote(await this.face.doctorApplyProvider({ planId }))
    },
  }

  readonly modes = {
    modes: async (): Promise<ObservedModes> => {
      const res = unwrapRemote(await this.face.doctorModes())
      return res as ObservedModes
    },

    capabilities: async (): Promise<Record<string, unknown>> => {
      const res = unwrapRemote(await this.face.doctorCapabilities())
      return res as Record<string, unknown>
    },
  }
}
