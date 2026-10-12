/**
 * Context Doctor host runtime (W3). Binds the read-only DoctorSource gateways
 * to whatever public host services actually exist in this deployment, probing
 * real capabilities rather than trusting package versions (architecture.md
 * §18, AT35). Missing capabilities disable only their own dimension.
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join } from 'node:path'
import type { CapabilityProbe } from '../contracts.ts'
import { DoctorSource, type DoctorCapabilities, type DoctorSourceGateways } from './source.ts'
import { DoctorScanner, type ScanHandle, type ScanProgress, type ScanReport, type ScanScope } from './jobs.ts'
import { DoctorStore, StoreConflictError } from './store.ts'
import { observeCurrentModes, observeStandingMount, fingerprintMountTree, mountObservationToVersionRef, mountBindingIdentity, type ObservedModes } from './observe.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { brandedSessionId } from './source.ts'
import { DoctorAnalyzer, type AnalysisHandle, type AnalysisLlm, type AnalysisPlan } from './analyze.ts'
import { buildSessionView } from '../metrics.ts'
import { canonicalize, contentHash } from '../versions.ts'
import { DoctorProviderPlans, type DoctorConfigEditor } from './provider.ts'

export type ConstraintScope = { readonly kind: 'session'; readonly sessionId: string } | { readonly kind: 'mode'; readonly modeId: string }

export interface EvidencePage {
  readonly sessionId: string
  readonly cutoffSeq: number
  readonly nextOffset?: number
  readonly status: import('../contracts.ts').ReadStatus
  readonly items: readonly { readonly ref: string; readonly text: string; readonly role: string; readonly bucket?: string }[]
}

function sessionOfRef(ref: string): string | undefined {
  const separator = ref.lastIndexOf(':')
  return separator > 0 && /^\d+$/.test(ref.slice(separator + 1)) ? ref.slice(0, separator) : undefined
}

export interface DoctorRuntimeCapabilities extends DoctorCapabilities {
  readonly doctor: CapabilityProbe
}

export interface FeedbackOccurrenceRecord {
  readonly id: string
  readonly revision: number
  readonly problemId: string
  readonly data: Record<string, unknown>
}

export interface FeedbackProblemRecord {
  readonly id: string
  readonly revision: number
  readonly title: string
  readonly data: Record<string, unknown>
  readonly occurrences: readonly FeedbackOccurrenceRecord[]
}

export interface FeedbackTreeRecord {
  readonly problems: readonly FeedbackProblemRecord[]
}

export interface PrepareAnalysisIntent {
  readonly kind: 'session-quality' | 'mode-quality' | 'requirement-distill'
  readonly sessionId?: string
  readonly modeId?: string
  readonly reportId?: string
  readonly evidenceRefs?: readonly string[]
  readonly evidence?: readonly (string | { readonly ref: string; readonly text?: string })[]
  readonly model: { readonly provider: string; readonly model: string }
}

interface WorkspaceRegistryFace {
  readonly archivedSessionIds: readonly string[]
}

/**
 * Probes one host service through `ctx.get` and verifies the exact surface
 * Doctor needs, so a present-but-different service still degrades cleanly.
 */
function probe<T>(ctx: Context, name: string, check: (service: unknown) => T | undefined): T | undefined {
  let service: unknown
  try {
    service = ctx.get(name, false)
  } catch {
    return undefined
  }
  if (service === undefined || service === null) return undefined
  try {
    return check(service)
  } catch {
    return undefined
  }
}

/** One runtime instance per host plugin context. */
export class DoctorRuntime {
  readonly source: DoctorSource
  readonly scanner: DoctorScanner
  readonly store: DoctorStore
  readonly analyzer: DoctorAnalyzer | undefined
  readonly providerPlans: DoctorProviderPlans
  private readonly registryFace: { list(): Promise<readonly unknown[]> } | undefined
  private readonly receipts: import('../compaction.ts').ExecutionReceipt[] = []

  private constructor(gateways: DoctorSourceGateways, storeDir: string, registryFace?: { list(): Promise<readonly unknown[]> }, llm?: AnalysisLlm, editor?: DoctorConfigEditor) {
    this.source = new DoctorSource(gateways)
    this.scanner = new DoctorScanner(this.source)
    this.store = new DoctorStore(join(storeDir, 'doctor'))
    this.registryFace = registryFace
    this.analyzer = llm === undefined ? undefined : new DoctorAnalyzer({ llm })
    this.providerPlans = new DoctorProviderPlans(editor)
  }

  /** Bind to a host context; every missing service narrows, never throws. */
  static create(ctx: Context): DoctorRuntime {
    const catalog = () => probe(ctx, 'sessionController', (service) => {
      const candidate = service as { list?: unknown }
      if (typeof candidate.list !== 'function') return undefined
      return {
        list: (signal?: AbortSignal) =>
          (service as { list(request: unknown, signal?: AbortSignal): Promise<{ items: readonly unknown[] }> })
            .list({}, signal)
            .then((value) => value.items as never),
      }
    })

    const archive = () => probe(ctx, 'workspaceRegistry', (service) => {
      const candidate = service as { archivedSessionIds?: unknown }
      if (!Array.isArray(candidate.archivedSessionIds)) return undefined
      return { archivedSessionIds: async () => candidate.archivedSessionIds as string[] }
    })

    const persistence = probe(ctx, 'sessionPersistence', (service) => {
      const candidate = service as { stat?: unknown; open?: unknown }
      if (typeof candidate.stat !== 'function' || typeof candidate.open !== 'function') return undefined
      return {
        stat: (id: string, options?: { signal?: AbortSignal }) =>
          (service as { stat(id: unknown, options?: unknown): Promise<unknown> }).stat(id, options) as never,
        open: (id: string, access: 'read', options?: { signal?: AbortSignal }) =>
          (service as { open(id: unknown, access: string, options?: unknown): Promise<unknown> }).open(id, access, options) as never,
      }
    })

    const registryFace = probe(ctx, 'agentPresets', (service) => {
      const candidate = service as { list?: unknown }
      if (typeof candidate.list !== 'function') return undefined
      return { list: () => (service as { list(): Promise<readonly unknown[]> }).list() }
    })

    const llm = probe(ctx, 'llm', (service) => {
      const candidate = service as { stream?: unknown }
      if (typeof candidate.stream !== 'function') return undefined
      return { stream: candidate.stream.bind(service) } as AnalysisLlm
    })
    const editor = probe(ctx, 'configEditor', (service) => {
      const face = service as DoctorConfigEditor
      return typeof face.entries === 'function' && typeof face.edit === 'function' ? face : undefined
    })
    const agents = probe(ctx, 'agents', (service) => {
      const face = service as { get(id: ReturnType<typeof brandedSessionId>): Agent | undefined }
      return typeof face.get === 'function' ? face : undefined
    })

    return new DoctorRuntime(
      {
        // The native controller can mount after this out-of-tree plugin.
        // Resolve it at each read so startup order cannot freeze an empty catalog.
        get catalog() { return catalog() },
        get archive() { return archive() },
        ...(persistence === undefined ? {} : { persistence }),
        activeVersions: (id) => {
          const agent = agents?.get(brandedSessionId(id))
          const mount = agent === undefined ? undefined : observeStandingMount(agent.ctx)
          return mount === undefined ? [] : [mountObservationToVersionRef(mount.presetId, fingerprintMountTree(mount), mountBindingIdentity(mount))]
        },
      },
      join(resolveDshHome(), 'storages', 'better-composer'),
      registryFace,
      llm,
      editor,
    )
  }

  /** In-memory store variant for tests and embedded use. */
  static isolated(storeDir: string, gateways: DoctorSourceGateways, llm?: AnalysisLlm): DoctorRuntime {
    return new DoctorRuntime(gateways, storeDir, undefined, llm)
  }

  capabilities(): DoctorRuntimeCapabilities {
    const base = this.source.capabilities()
    return {
      ...base,
      doctor: { available: true },
    }
  }

  modes(): Promise<ObservedModes> {
    return observeCurrentModes(this.registryFace as never)
  }

  startScan(scope: ScanScope): ScanHandle {
    return this.scanner.startScan(scope)
  }

  job(jobId: string): ScanProgress | undefined {
    return this.scanner.status(jobId)
  }

  report(jobId: string): ScanReport | undefined {
    return this.scanner.report(jobId)
  }

  cancel(jobId: string): boolean {
    return this.scanner.cancel(jobId)
  }

  /** Persist a completed report into the rebuildable cache. */
  async keepReport(report: ScanReport): Promise<void> {
    await this.store.putReport({ id: report.id, data: report })
  }

  // ---- Feedback operations (Problem/Occurrence, AT20–23, AT36) ----

  async feedbackTree(): Promise<FeedbackTreeRecord> {
    await this.reconcileStoredEvidence()
    const problems = await this.store.listProblems()
    const result = await Promise.all(
      problems.map(async (problem) => {
        const occurrences = await this.store.listOccurrences(problem.id)
        return {
          id: problem.id,
          revision: problem.revision,
          title: typeof problem.data['title'] === 'string' ? (problem.data['title'] as string) : problem.id,
          data: problem.data,
          occurrences: occurrences.map((occ) => ({
            id: occ.id,
            revision: occ.revision,
            problemId: problem.id,
            data: occ.data,
          })),
        }
      }),
    )
    return { problems: result }
  }

  async saveFeedback(input: {
    readonly problemId?: string
    readonly targetProblemId?: string
    readonly problemTitle?: string
    readonly occurrence: Record<string, unknown>
    readonly occurrenceId?: string
  }): Promise<FeedbackTreeRecord> {
    const problemTitle = input.problemTitle?.trim() || '未命名问题'
    const problemId = input.targetProblemId || input.problemId || `problem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const occurrenceId = input.occurrenceId || `occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await this.store.saveProblem({ title: problemTitle }, problemId)
    await this.store.addOccurrence(problemId, input.occurrence, occurrenceId)
    return this.feedbackTree()
  }

  async updateFeedback(input: {
    readonly objectId: string
    readonly expectedRevision: number
    readonly mutate: (data: Record<string, unknown>) => Record<string, unknown>
    readonly kind: 'problem' | 'occurrence'
  }): Promise<FeedbackTreeRecord> {
    try {
      if (input.kind === 'problem') {
        await this.store.updateProblem(input.objectId, input.expectedRevision, input.mutate)
      } else {
        await this.store.updateOccurrence(input.objectId, input.expectedRevision, input.mutate)
      }
      return this.feedbackTree()
    } catch (error) {
      if (error instanceof StoreConflictError) {
        throw new DoctorConflictError(input.objectId, error.expectedRevision, error.actualRevision)
      }
      throw error
    }
  }

  async problems(): Promise<{ readonly id: string; readonly revision: number; readonly data: Record<string, unknown> }[]> {
    await this.reconcileStoredEvidence()
    return (await this.store.listProblems()).map((envelope) => ({ id: envelope.id, revision: envelope.revision, data: envelope.data }))
  }

  async occurrences(problemId: string): Promise<{ readonly id: string; readonly revision: number; readonly data: Record<string, unknown> }[]> {
    return (await this.store.listOccurrences(problemId)).map((envelope) => ({ id: envelope.id, revision: envelope.revision, data: envelope.data }))
  }

  // ---- Constraints: reviewed candidates become confirmed; revoked ones drop out ----

  async saveConstraint(input: {
    readonly id: string
    readonly originalText: string
    readonly normalizedRequirement: string
    readonly conditions: readonly string[]
    readonly exceptions: readonly string[]
    readonly sourceRefs?: readonly string[]
    readonly scope?: ConstraintScope
  }): Promise<{ readonly revision: number }> {
    const existing = await this.store.getConstraint(input.id)
    if (existing !== undefined) return { revision: existing.revision }
    const saved = await this.store.saveConstraint({
      ...input,
      status: 'active',
      sourceRefs: input.sourceRefs ?? [],
    }, input.id)
    return { revision: saved.revision }
  }

  async updateConstraint(input: {
    readonly id: string
    readonly expectedRevision: number
    readonly patch: Record<string, unknown>
  }): Promise<{ readonly revision: number }> {
    try {
      const updated = await this.store.updateConstraint(input.id, input.expectedRevision, (data) => ({ ...data, ...input.patch }))
      return { revision: updated.revision }
    } catch (error) {
      if (error instanceof StoreConflictError) {
        throw new DoctorConflictError(input.id, error.expectedRevision, error.actualRevision)
      }
      throw error
    }
  }

  async constraints(): Promise<{ readonly id: string; readonly revision: number; readonly data: Record<string, unknown> }[]> {
    await this.reconcileStoredEvidence()
    return (await this.store.listConstraints()).map((envelope) => ({ id: envelope.id, revision: envelope.revision, data: envelope.data }))
  }

  /** Active confirmed constraints — the compaction provider's only input. */
  async activeConstraints(scope?: { readonly sessionId: string; readonly modeId?: string }): Promise<readonly import('../compaction.ts').ConfirmedConstraint[]> {
    await this.reconcileStoredEvidence()
    const all = await this.store.listConstraints()
    return all
      .filter((envelope) => envelope.data['status'] === 'active')
      .filter((envelope) => {
        if (scope === undefined) return true
        const binding = envelope.data['scope'] as ConstraintScope | undefined
        return binding?.kind === 'session' ? binding.sessionId === scope.sessionId
          : binding?.kind === 'mode' && binding.modeId === scope.modeId
      })
      .map((envelope) => ({
        id: envelope.id,
        revision: envelope.revision,
        originalText: String(envelope.data['originalText'] ?? ''),
        normalizedRequirement: String(envelope.data['normalizedRequirement'] ?? ''),
        conditions: Array.isArray(envelope.data['conditions']) ? envelope.data['conditions'] as string[] : [],
        exceptions: Array.isArray(envelope.data['exceptions']) ? envelope.data['exceptions'] as string[] : [],
      }))
  }

  /** ExecutionReceipt sink for the compaction provider (W6). */
  recordReceipt(receipt: import('../compaction.ts').ExecutionReceipt): void {
    this.receipts.push(receipt)
  }

  /** Recent receipts, oldest first — for the task-record view. */
  executionReceipts(): readonly import('../compaction.ts').ExecutionReceipt[] {
    return [...this.receipts]
  }

  // ---- Semantic analysis (user-initiated only; absent LLM degrades this dimension) ----

  analysisAvailable(): boolean {
    return this.analyzer !== undefined
  }

  async prepareAnalysis(input: PrepareAnalysisIntent): Promise<AnalysisPlan> {
    if (this.analyzer === undefined) throw new Error('analysis model is unavailable')

    let report: ScanReport | undefined = undefined
    let reportMissing = false
    if (input.reportId !== undefined) {
      report = this.scanner.reportById(input.reportId)
      if (report === undefined) {
        reportMissing = true
      }
    }

    const lens = input.kind === 'mode-quality' ? 'mode' : 'session'
    const modes = await this.modes()
    const mode = input.modeId ? modes.modes.find((m) => m.id === input.modeId) : undefined

    const statisticsSummary = JSON.stringify({
      lens,
      mode,
      reportId: report?.id,
      createdAt: report?.createdAt,
      coverage: report?.coverage,
      scope: report?.scope,
      sessionMetrics:
        input.kind !== 'mode-quality' && input.sessionId
          ? report?.sessions.find((entry) => entry.sessionId === input.sessionId)?.metrics
          : undefined,
      modeGroups:
        input.kind === 'mode-quality'
          ? report?.modeEvaluation?.groups.map((group) => ({
              version: group.versionRefs,
              candidates: group.candidates,
              eligible: group.eligible,
              components: group.components,
            }))
          : undefined,
    })

    const rawEvidence = input.evidenceRefs ?? input.evidence ?? []
    const selected = await this.selectedEvidence(rawEvidence)
    const dataGaps = reportMissing ? ['报告已失效，请重新扫描'] : undefined

    return this.analyzer.prepare({
      kind: input.kind,
      model: input.model,
      evidence: selected.evidence,
      sourceVersions: selected.versions,
      statisticsSummary,
      ...(dataGaps ? { dataGaps } : {}),
    })
  }

  async runAnalysis(plan: AnalysisPlan, options: { idempotencyKey: string }): Promise<AnalysisHandle> {
    if (this.analyzer === undefined) throw new Error('analysis model is unavailable')
    const prepared = this.analyzer.preparedPlan(plan.id)
    if (prepared === undefined) throw new Error('分析计划已失效，请重新准备')
    const current = await this.selectedEvidence(prepared.evidence)
    if (canonicalize(current.versions) !== canonicalize(prepared.sourceVersions)) throw new Error('证据已变化，请重新准备分析')
    return this.analyzer.run(prepared, options)
  }

  async analysisJob(jobId: string): Promise<ReturnType<DoctorAnalyzer['status']>> {
    const ids = new Set(this.analyzer?.sourceRefs(jobId).map(sessionOfRef).filter((id): id is string => id !== undefined))
    for (const id of ids) await this.reconcileSession(id)
    return this.analyzer?.status(jobId)
  }

  cancelAnalysis(jobId: string): boolean {
    return this.analyzer?.cancel(jobId) ?? false
  }

  dispose(): void {
    this.scanner.dispose()
    this.analyzer?.dispose()
  }

  /** Bounded evidence pages from persisted history, excluding drafts. */
  async evidence(sessionId: string, offset = 0, cutoffSeq?: number, refs?: readonly string[]): Promise<EvidencePage> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid evidence offset')
    if (refs !== undefined && (!Array.isArray(refs) || refs.some((ref) => {
      if (typeof ref !== 'string' || sessionOfRef(ref) !== sessionId) return true
      const seq = Number(ref.slice(ref.lastIndexOf(':') + 1))
      return !Number.isSafeInteger(seq) || ref !== `${sessionId}:${seq}`
    }))) throw new Error('invalid evidence refs')
    const snapshot = await this.source.readSnapshot(sessionId, { cutoffSeq })
    if (snapshot.status.kind === 'error' && snapshot.status.reason === 'not-found') await this.reconcileSession(sessionId)
    const view = buildSessionView(snapshot)
    const blocks = view.blocks.map((block) => ({ ref: `${sessionId}:${block.seq}`, text: block.text, role: block.role, bucket: block.bucket }))
    const header = snapshot.events.findLast((event) => event.type === 'request/header')
    if (header?.data.header.tools?.length) blocks.unshift({ ref: `${sessionId}:${header.seq}`, text: JSON.stringify(header.data.header.tools, null, 2), role: 'system', bucket: 'tool-definition' })
    const requested = refs === undefined ? undefined : new Set(refs)
    const selected = requested === undefined ? blocks : blocks.filter((block) => requested.has(block.ref))
    return {
      sessionId, cutoffSeq: snapshot.cutoffSeq, status: snapshot.status,
      items: selected.slice(offset, offset + 25),
      ...(offset + 25 < selected.length ? { nextOffset: offset + 25 } : {}),
    }
  }

  private async selectedEvidence(evidence: readonly (string | { readonly ref: string; readonly text?: string })[]) {
    const snapshots = new Map<string, Awaited<ReturnType<DoctorSource['readSnapshot']>>>()
    const versions: string[] = []
    const selected: { ref: string; text: string }[] = []
    for (const item of evidence) {
      const ref = typeof item === 'string' ? item : item.ref
      const sessionId = sessionOfRef(ref)
      if (sessionId === undefined) {
        selected.push({ ref, text: typeof item === 'object' && typeof item.text === 'string' ? item.text : '' })
        continue
      }
      let snapshot = snapshots.get(sessionId)
      if (snapshot === undefined) {
        snapshot = await this.source.readSnapshot(sessionId)
        snapshots.set(sessionId, snapshot)
      }
      if (snapshot.status.kind === 'error') {
        if (snapshot.status.reason === 'not-found') await this.reconcileSession(sessionId)
        throw new Error(`证据不可读：${sessionId} (${snapshot.status.reason})`)
      }
      const seq = Number(ref.slice(ref.lastIndexOf(':') + 1))
      const block = buildSessionView(snapshot).blocks.find((candidate) => candidate.seq === seq)
      const event = snapshot.events[seq]
      const text = block?.text ?? (event?.type === 'request/header' && event.data.header.tools ? JSON.stringify(event.data.header.tools, null, 2) : undefined)
      if (text === undefined) throw new Error(`证据不在当前有效表面：${ref}`)
      selected.push({ ref, text })
      versions.push(`${ref}:${contentHash(text)}:${canonicalize(snapshot.versions)}`)
    }
    return { evidence: selected, versions }
  }

  /** Only confirmed deletion purges source excerpts; archive and read failures do not. */
  async reconcileSession(sessionId: string): Promise<void> {
    if (await this.source.exists(sessionId) !== false) return
    this.analyzer?.forgetSession(sessionId)
    this.scanner.forgetSession(sessionId)
    for (const problem of await this.store.listProblems()) {
      for (const occurrence of await this.store.listOccurrences(problem.id)) {
        if (occurrence.data['sessionId'] !== sessionId) continue
        await this.store.updateOccurrence(occurrence.id, occurrence.revision, (data) => {
          const next = { ...data, evidenceRefs: [], evidenceState: 'deleted' }
          for (const key of ['excerpt', 'evidenceExcerpt', 'evidenceText', 'sourceExcerpt', 'correctionExcerpt']) Reflect.deleteProperty(next, key)
          return next
        })
      }
    }
    for (const constraint of await this.store.listConstraints()) {
      const refs = constraint.data['sourceRefs']
      if (!Array.isArray(refs) || !refs.some((ref) => typeof ref === 'string' && sessionOfRef(ref) === sessionId)) continue
      await this.store.updateConstraint(constraint.id, constraint.revision, (data) => ({ ...data, originalText: '', sourceRefs: [], evidenceState: 'deleted', status: 'source-deleted' }))
    }
    await this.store.clearCache()
  }

  private async reconcileStoredEvidence(): Promise<void> {
    const ids = new Set<string>()
    for (const problem of await this.store.listProblems()) {
      for (const occurrence of await this.store.listOccurrences(problem.id)) {
        if (typeof occurrence.data['sessionId'] === 'string' && occurrence.data['evidenceState'] !== 'deleted') ids.add(occurrence.data['sessionId'])
      }
    }
    for (const constraint of await this.store.listConstraints()) {
      const refs = constraint.data['sourceRefs']
      if (Array.isArray(refs)) for (const ref of refs) if (typeof ref === 'string') {
        const id = sessionOfRef(ref)
        if (id !== undefined) ids.add(id)
      }
    }
    for (const id of ids) await this.reconcileSession(id)
  }
}

/** Wire-level conflict signal for the Remote layer (AT36). */
export class DoctorConflictError extends Error {
  constructor(readonly objectId: string, readonly expectedRevision: number, readonly actualRevision: number) {
    super(`revision conflict for ${objectId}: expected ${expectedRevision}, found ${actualRevision}`)
  }
}
