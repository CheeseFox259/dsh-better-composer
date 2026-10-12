/**
 * In-memory test fake for DoctorClient.
 * Tracks calls and simulates all 7 domain areas without wire networking.
 */
import type { ScanReport, ScanScope, ScanProgress } from '../../src/doctor/host/jobs.ts'
import type { AnalysisPlan, AnalysisResult, CandidateConstraint } from '../../src/doctor/host/analyze.ts'
import type { ConstraintScope, EvidencePage } from '../../src/doctor/host/runtime.ts'
import type { ProviderPlan } from '../../src/doctor/host/provider.ts'
import type { ObservedModes } from '../../src/doctor/host/observe.ts'
import type {
  AnalysisIntent,
  DoctorClient,
  FeedbackSubmitIntent,
  FeedbackTree,
  StoredConstraint,
} from '../../src/client/context-doctor/doctor-client.ts'

export interface FakeDoctorClientState {
  scanReport?: ScanReport
  feedbackTree?: FeedbackTree
  constraints?: StoredConstraint[]
  evidencePage?: EvidencePage
  analysisAvailable?: boolean
  analysisPlan?: AnalysisPlan
  analysisResult?: AnalysisResult
  providerPlan?: ProviderPlan
  modes?: ObservedModes
  capabilities?: Record<string, unknown>
}

export class FakeDoctorClient implements DoctorClient {
  state: FakeDoctorClientState
  readonly calls = {
    scanRun: [] as { scope: ScanScope; options?: { signal?: AbortSignal; onProgress?: (p: ScanProgress) => void } }[],
    analysisAvailable: 0,
    analysisPrepare: [] as { intent: AnalysisIntent }[],
    analysisRun: [] as { plan: AnalysisPlan; options?: { idempotencyKey?: string; signal?: AbortSignal } }[],
    feedbackLoad: 0,
    feedbackSubmit: [] as FeedbackSubmitIntent[],
    feedbackWithdraw: [] as { occurrenceId: string; revision: number }[],
    constraintsList: 0,
    constraintsConfirm: [] as { candidate: CandidateConstraint; values?: { requirement?: string; conditions?: string[]; exceptions?: string[]; scope?: ConstraintScope } }[],
    constraintsUpdate: [] as { id: string; expectedRevision: number; patch: Record<string, unknown> }[],
    evidenceQuery: [] as { sessionId: string; options?: { offset?: number; cutoffSeq?: number; refs?: readonly string[] } }[],
    providerPrepare: [] as { modeId: string; enabled: boolean }[],
    providerApply: [] as string[],
    modes: 0,
    capabilities: 0,
  }

  constructor(initialState: FakeDoctorClientState = {}) {
    this.state = {
      feedbackTree: { problems: [] },
      constraints: [],
      analysisAvailable: true,
      modes: { available: true, modes: [] },
      capabilities: {},
      ...initialState,
    }
  }

  readonly scan = {
    run: async (scope: ScanScope, options?: { signal?: AbortSignal; onProgress?: (p: ScanProgress) => void }): Promise<ScanReport> => {
      this.calls.scanRun.push({ scope, options })
      if (options?.signal?.aborted) throw new Error('扫描已取消')
      if (!this.state.scanReport) throw new Error('未配置假 ScanReport')
      return this.state.scanReport
    },
  }

  readonly analysis = {
    available: async (): Promise<boolean> => {
      this.calls.analysisAvailable += 1
      return this.state.analysisAvailable ?? true
    },
    prepare: async (intent: AnalysisIntent): Promise<AnalysisPlan> => {
      this.calls.analysisPrepare.push({ intent })
      return this.state.analysisPlan ?? {
        id: 'fake-plan-1',
        model: intent.model,
        inputEstimateTokens: 100,
        feasible: true,
        evidence: [],
        dataGaps: [],
        budget: { totalInputTokens: 1000, maxCalls: 1, outputTokensPerCall: 500 },
      }
    },
    run: async (plan: AnalysisPlan, options?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<AnalysisResult> => {
      this.calls.analysisRun.push({ plan, options })
      if (options?.signal?.aborted) throw new Error('分析已取消')
      return this.state.analysisResult ?? {
        candidates: [],
        summary: '完成分析',
        evidenceUsed: [],
        model: plan.model,
        tokenUsage: { totalTokens: 100 },
      }
    },
  }

  readonly feedback = {
    load: async (): Promise<FeedbackTree> => {
      this.calls.feedbackLoad += 1
      return this.state.feedbackTree ?? { problems: [] }
    },
    submit: async (input: FeedbackSubmitIntent): Promise<FeedbackTree> => {
      this.calls.feedbackSubmit.push(input)
      const current = this.state.feedbackTree ?? { problems: [] }
      const problemId = input.targetProblemId || `problem-${current.problems.length + 1}`
      const occurrenceId = `occ-${Date.now()}`
      const existingProblem = current.problems.find((p) => p.id === problemId)
      const newOcc = {
        id: occurrenceId,
        revision: 1,
        problemId,
        data: {
          type: input.type,
          typeLabel: input.typeLabel ?? input.type,
          note: input.note,
          sessionId: input.sessionId,
          modeId: input.modeId,
          evidenceRefs: input.evidenceRefs ?? [],
          counted: true,
          ...input.occurrence,
        },
      }
      let nextProblems = [...current.problems]
      if (existingProblem) {
        nextProblems = nextProblems.map((p) =>
          p.id === problemId ? { ...p, occurrences: [...p.occurrences, newOcc] } : p,
        )
      } else {
        nextProblems.push({
          id: problemId,
          revision: 1,
          title: input.problemTitle ?? '新问题',
          data: { title: input.problemTitle ?? '新问题' },
          occurrences: [newOcc],
        })
      }
      this.state.feedbackTree = { problems: nextProblems }
      return this.state.feedbackTree
    },
    withdraw: async (occurrenceId: string, revision: number): Promise<FeedbackTree> => {
      this.calls.feedbackWithdraw.push({ occurrenceId, revision })
      const current = this.state.feedbackTree ?? { problems: [] }
      const nextProblems = current.problems.map((p) => ({
        ...p,
        occurrences: p.occurrences.map((o) =>
          o.id === occurrenceId ? { ...o, data: { ...o.data, withdrawn: true } } : o,
        ),
      }))
      this.state.feedbackTree = { problems: nextProblems }
      return this.state.feedbackTree
    },
  }

  readonly constraints = {
    list: async (): Promise<StoredConstraint[]> => {
      this.calls.constraintsList += 1
      return this.state.constraints ?? []
    },
    confirm: async (
      candidate: CandidateConstraint,
      values?: { requirement?: string; conditions?: string[]; exceptions?: string[]; scope?: ConstraintScope },
    ): Promise<StoredConstraint[]> => {
      this.calls.constraintsConfirm.push({ candidate, values })
      const current = this.state.constraints ?? []
      const next: StoredConstraint[] = [
        ...current.filter((c) => c.id !== candidate.id),
        {
          id: candidate.id,
          revision: 1,
          data: {
            originalText: candidate.originalText,
            normalizedRequirement: values?.requirement ?? candidate.normalizedRequirement,
            conditions: values?.conditions ?? candidate.conditions,
            exceptions: values?.exceptions ?? candidate.exceptions,
            scope: values?.scope ?? candidate.scope,
            status: 'active',
          },
        },
      ]
      this.state.constraints = next
      return next
    },
    update: async (
      id: string,
      expectedRevision: number,
      patch: Record<string, unknown>,
    ): Promise<StoredConstraint[]> => {
      this.calls.constraintsUpdate.push({ id, expectedRevision, patch })
      const current = this.state.constraints ?? []
      const target = current.find((c) => c.id === id)
      if (!target) throw new Error(`未找到约束 ${id}`)
      const next: StoredConstraint[] = current.map((c) =>
        c.id === id ? { ...c, revision: c.revision + 1, data: { ...c.data, ...patch } } : c,
      )
      this.state.constraints = next
      return next
    },
  }

  readonly evidence = {
    query: async (sessionId: string, options?: { offset?: number; cutoffSeq?: number; refs?: readonly string[] }): Promise<EvidencePage> => {
      this.calls.evidenceQuery.push({ sessionId, options })
      return this.state.evidencePage ?? {
        sessionId,
        cutoffSeq: options?.cutoffSeq ?? 0,
        offset: options?.offset ?? 0,
        status: { kind: 'ok' },
        items: [],
      }
    },
  }

  readonly provider = {
    prepare: async (modeId: string, enabled: boolean): Promise<ProviderPlan> => {
      this.calls.providerPrepare.push({ modeId, enabled })
      return this.state.providerPlan ?? {
        planId: `plan-${modeId}`,
        modeId,
        enabled,
        promptChanges: [],
        toolChanges: [],
        revision: 1,
      } as unknown as ProviderPlan
    },
    apply: async (planId: string): Promise<void> => {
      this.calls.providerApply.push(planId)
    },
  }

  readonly modes = {
    modes: async (): Promise<ObservedModes> => {
      this.calls.modes += 1
      return this.state.modes ?? { available: true, modes: [] }
    },
    capabilities: async (): Promise<Record<string, unknown>> => {
      this.calls.capabilities += 1
      return this.state.capabilities ?? {}
    },
  }
}
