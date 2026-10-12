import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULT_PASTE_FILE_EXTENSION, normalizePasteFileExtension, type PasteFileExtension } from './file-extensions.ts'
import { DoctorRuntime, type ConstraintScope } from './doctor/host/runtime.ts'

/** Wire namespace for the plugin's Host-side Remote face. */
export const REMOTE_NAMESPACE = 'betterComposer'

const CLIP_ID = /^[A-Za-z0-9-]+$/u

interface ClipRecord {
  readonly id: string
  readonly text: string
  readonly mode: 'inline' | 'file'
  readonly createdAt: number
  readonly cwd: string
  readonly fileExtension: PasteFileExtension
}

/**
 * Host-side Remote face of Better Composer. Runtime marker discovery
 * (the Gateway's SRC path) requires no generated artifacts; the client
 * mounts hand-written descriptors with minimal parse-only schemas.
 */
export class BetterComposerRemoteService extends TypertRemoteService {
  private readonly hostCtx: Context
  private readonly doctor: DoctorRuntime

  constructor(ctx: Context) {
    super(ctx, REMOTE_NAMESPACE)
    this.hostCtx = ctx
    this.doctor = DoctorRuntime.create(ctx)
    ctx.reflect.provide('betterComposerDoctor', this.doctor)
    if (typeof ctx.on === 'function') ctx.on('dispose', () => this.doctor.dispose())
  }

  /** Which Doctor dimensions are live in this deployment, with reasons (AT35). */
  @Remote
  async doctorCapabilities(): Promise<ReturnType<DoctorRuntime['capabilities']>> {
    return this.doctor.capabilities()
  }

  /** Declared preset roster with activation diagnostics, for the mode lens. */
  @Remote
  async doctorModes(): Promise<Awaited<ReturnType<DoctorRuntime['modes']>>> {
    return this.doctor.modes()
  }

  /** Start a deterministic scan; returns the job id immediately (AT18/19). */
  @Remote
  async doctorStartScan(request: {
    readonly sessionIds?: readonly string[]
    readonly modeId?: string
    readonly cutoffSeq?: number
  }): Promise<{ readonly jobId: string }> {
    if (request.sessionIds !== undefined && (!Array.isArray(request.sessionIds) || request.sessionIds.some((id) => typeof id !== 'string'))) {
      throw new Error('doctorStartScan requires string session ids')
    }
    return { jobId: this.doctor.startScan(request).jobId }
  }

  /** Poll one scan job's progress and terminal state. */
  @Remote
  async doctorJob(request: { readonly jobId: string }): Promise<{
    readonly state: string
    readonly total: number
    readonly done: number
    readonly failed: number
  } | undefined> {
    return this.doctor.job(request.jobId)
  }

  /** Idempotent cancellation of one scan job; never touches user Agents. */
  @Remote
  async doctorCancelJob(request: { readonly jobId: string }): Promise<{ readonly cancelled: boolean }> {
    return { cancelled: this.doctor.cancel(request.jobId) }
  }

  /** The frozen report produced by a finished scan job, when one exists. */
  @Remote
  async doctorReport(request: { readonly jobId: string }): Promise<unknown | undefined> {
    return this.doctor.report(request.jobId) ?? undefined
  }

  /** Return recorded problems and occurrences in a single tree (no N+1). */
  @Remote
  async doctorFeedbackTree(): Promise<Awaited<ReturnType<DoctorRuntime['feedbackTree']>>> {
    return this.doctor.feedbackTree()
  }

  /** Two-step feedback: record a problem occurrence with its evidence (AT20). */
  @Remote
  async doctorSaveFeedback(request: {
    readonly problemId?: string
    readonly targetProblemId?: string
    readonly problemTitle?: string
    readonly occurrenceId?: string
    readonly occurrence: Record<string, unknown>
  }): Promise<Awaited<ReturnType<DoctorRuntime['saveFeedback']>>> {
    if (request.occurrence === null || typeof request.occurrence !== 'object') {
      throw new Error('doctorSaveFeedback requires an occurrence object')
    }
    return this.doctor.saveFeedback(request)
  }

  /** Edit/withdraw/merge feedback under optimistic revision control (AT36). */
  @Remote
  async doctorUpdateFeedback(request: {
    readonly kind: 'problem' | 'occurrence'
    readonly objectId: string
    readonly expectedRevision: number
    readonly patch: Record<string, unknown>
  }): Promise<Awaited<ReturnType<DoctorRuntime['updateFeedback']>>> {
    return this.doctor.updateFeedback({
      kind: request.kind,
      objectId: request.objectId,
      expectedRevision: request.expectedRevision,
      mutate: (data) => ({ ...data, ...request.patch }),
    })
  }

  /** Confirm a reviewed constraint candidate (it becomes compaction input). */
  @Remote
  async doctorSaveConstraint(request: {
    readonly id: string
    readonly originalText: string
    readonly normalizedRequirement: string
    readonly conditions?: readonly string[]
    readonly exceptions?: readonly string[]
    readonly sourceRefs?: readonly string[]
    readonly scope: ConstraintScope
  }): Promise<Awaited<ReturnType<DoctorRuntime['constraints']>>> {
    if (typeof request.id !== 'string' || typeof request.originalText !== 'string' || typeof request.normalizedRequirement !== 'string') {
      throw new Error('doctorSaveConstraint requires id, originalText, and normalizedRequirement strings')
    }
    if (request.scope?.kind === 'session' ? typeof request.scope.sessionId !== 'string'
      : request.scope?.kind !== 'mode' || typeof request.scope.modeId !== 'string') throw new Error('constraint scope is required')
    await this.doctor.saveConstraint({
      id: request.id,
      originalText: request.originalText,
      normalizedRequirement: request.normalizedRequirement,
      conditions: Array.isArray(request.conditions) ? request.conditions.filter((item): item is string => typeof item === 'string') : [],
      exceptions: Array.isArray(request.exceptions) ? request.exceptions.filter((item): item is string => typeof item === 'string') : [],
      sourceRefs: request.sourceRefs ?? [],
      scope: request.scope,
    })
    return this.doctor.constraints()
  }

  /** Edit/revoke a confirmed constraint under optimistic revision control. */
  @Remote
  async doctorUpdateConstraint(request: {
    readonly id: string
    readonly expectedRevision: number
    readonly patch: Record<string, unknown>
  }): Promise<Awaited<ReturnType<DoctorRuntime['constraints']>>> {
    await this.doctor.updateConstraint(request)
    return this.doctor.constraints()
  }

  /** List constraints with revisions and status. */
  @Remote
  async doctorConstraints(): Promise<{ readonly id: string; readonly revision: number; readonly data: Record<string, unknown> }[]> {
    return this.doctor.constraints()
  }

  /** Whether the semantic analysis dimension is available (model routing). */
  @Remote
  async doctorAnalysisAvailable(): Promise<{ readonly available: boolean }> {
    return { available: this.doctor.analysisAvailable() }
  }

  @Remote
  async doctorEvidence(request: { readonly sessionId: string; readonly offset?: number; readonly cutoffSeq?: number; readonly refs?: readonly string[] }) {
    if (typeof request.sessionId !== 'string') throw new Error('sessionId is required')
    return this.doctor.evidence(request.sessionId, request.offset, request.cutoffSeq, request.refs)
  }

  @Remote
  async doctorPrepareProvider(request: { readonly modeId: string; readonly enabled: boolean }) {
    if (typeof request.modeId !== 'string' || typeof request.enabled !== 'boolean') throw new Error('modeId and enabled are required')
    return this.doctor.providerPlans.prepare(request.modeId, request.enabled)
  }

  @Remote
  async doctorApplyProvider(request: { readonly planId: string }): Promise<{ applied: true }> {
    await this.doctor.providerPlans.apply(request.planId)
    return { applied: true }
  }

  /** Price an analysis plan: input estimate, budget, gaps — no paid call. */
  @Remote
  async doctorPrepareAnalysis(request: {
    readonly kind: 'session-quality' | 'mode-quality' | 'requirement-distill'
    readonly sessionId?: string
    readonly modeId?: string
    readonly reportId?: string
    readonly evidenceRefs?: readonly string[]
    readonly model: { readonly provider: string; readonly model: string }
  }): Promise<unknown> {
    if (!['session-quality', 'mode-quality', 'requirement-distill'].includes(request.kind)
      || typeof request.model?.provider !== 'string' || typeof request.model.model !== 'string'
      || (request.evidenceRefs !== undefined && (!Array.isArray(request.evidenceRefs) || request.evidenceRefs.some((item) => typeof item !== 'string')))) {
      throw new Error('invalid analysis preparation')
    }
    return this.doctor.prepareAnalysis(request) as unknown
  }

  /** Run a prepared plan under an idempotency key (≤2 calls, fixed budget). */
  @Remote
  async doctorRunAnalysis(request: {
    readonly plan: unknown
    readonly idempotencyKey: string
  }): Promise<{ readonly jobId: string }> {
    return { jobId: (await this.doctor.runAnalysis(request.plan as never, { idempotencyKey: request.idempotencyKey })).jobId }
  }

  /** Poll an analysis job. */
  @Remote
  async doctorAnalysisJob(request: { readonly jobId: string }): Promise<unknown> {
    return this.doctor.analysisJob(request.jobId) ?? undefined
  }

  /** Cancel an analysis job; known cost stays recorded. */
  @Remote
  async doctorCancelAnalysis(request: { readonly jobId: string }): Promise<{ readonly cancelled: boolean }> {
    return { cancelled: this.doctor.cancelAnalysis(request.jobId) }
  }

  /** Persist one pasted-text clip under the harness home. */
  @Remote
  async storePaste(request: ClipRecord): Promise<{ readonly stored: boolean }> {
    if (!CLIP_ID.test(request.id)) throw new Error(`invalid clip id ${JSON.stringify(request.id)}`)
    if (typeof request.text !== 'string') throw new Error('clip text must be a string')
    const file = join(await this.dir(), `${request.id}.json`)
    const record: ClipRecord = {
      id: request.id,
      text: request.text,
      mode: request.mode === 'file' ? 'file' : 'inline',
      createdAt: typeof request.createdAt === 'number' ? request.createdAt : Date.now(),
      cwd: typeof request.cwd === 'string' ? request.cwd : '',
      fileExtension: normalizePasteFileExtension(request.fileExtension),
    }
    await writeFile(file, JSON.stringify(record), 'utf8')
    return { stored: true }
  }

  /** Load one persisted clip's complete delivery metadata; undefined when absent. */
  @Remote
  async loadPaste(request: { readonly id: string }): Promise<{
    readonly text: string | undefined
    readonly mode: 'inline' | 'file'
    readonly createdAt: number
    readonly cwd: string
    readonly fileExtension: PasteFileExtension
  }> {
    if (!CLIP_ID.test(request.id)) throw new Error(`invalid clip id ${JSON.stringify(request.id)}`)
    try {
      const raw = await readFile(join(await this.dir(), `${request.id}.json`), 'utf8')
      const record = JSON.parse(raw) as Partial<ClipRecord>
      return {
        text: typeof record.text === 'string' ? record.text : undefined,
        mode: record.mode === 'file' ? 'file' : 'inline',
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
        cwd: typeof record.cwd === 'string' ? record.cwd : '',
        fileExtension: normalizePasteFileExtension(record.fileExtension),
      }
    } catch {
      return { text: undefined, mode: 'inline', createdAt: 0, cwd: '', fileExtension: DEFAULT_PASTE_FILE_EXTENSION }
    }
  }

  /**
   * Materialize one stored clip as a workspace file the agent's read tool can
   * reach: `<cwd>/.dsh/pastes/<id><extension>`. Returns the workspace-relative
   * file reference used by the prompt serializer.
   */
  @Remote
  async publishPaste(request: { readonly id: string; readonly cwd: string }): Promise<{ readonly path: string; readonly relativePath: string; readonly bytes: number }> {
    if (!CLIP_ID.test(request.id)) throw new Error(`invalid clip id ${JSON.stringify(request.id)}`)
    if (typeof request.cwd !== 'string' || !request.cwd.startsWith('/')) {
      throw new Error('publishPaste requires an absolute workspace path')
    }
    const loaded = await this.loadPaste({ id: request.id })
    if (loaded.text === undefined) throw new Error(`clip ${JSON.stringify(request.id)} is not stored`)
    const directory = join(request.cwd, '.dsh', 'pastes')
    await mkdir(directory, { recursive: true })
    const fileName = `pasted-text-${request.id}${loaded.fileExtension}`
    const file = join(directory, fileName)
    await writeFile(file, loaded.text, 'utf8')
    return {
      path: file,
      relativePath: `.dsh/pastes/${fileName}`,
      bytes: Buffer.byteLength(loaded.text, 'utf8'),
    }
  }

  /**
   * One LLM rewrite of a pasted clip. Runs as a side call: nothing is
   * appended to the session event log; `purpose` attributes the request.
   */
  @Remote
  async editText(request: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
    readonly text: string
    readonly instruction: string
    readonly contextMessages: readonly { readonly role: string; readonly text: string }[]
  }, signal: AbortSignal): Promise<{ readonly text: string }> {
    if (typeof request.text !== 'string' || typeof request.instruction !== 'string'
      || typeof request.provider !== 'string' || typeof request.model !== 'string') {
      throw new Error('editText requires provider, model, text, and instruction strings')
    }
    if (request.instruction.trim() === '') throw new Error('editText requires a non-empty instruction')
    const llm = this.hostCtx.get('llm') as {
      stream(options: Record<string, unknown>): AsyncIterable<{ readonly type: string; readonly index?: number; readonly text?: string }>
    } | undefined
    if (llm === undefined) throw new Error('llm service is unavailable')
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        text: JSON.stringify({
          instruction: request.instruction,
          text: request.text,
          referenceContext: Array.isArray(request.contextMessages) ? request.contextMessages : [],
        }),
      }],
      source: { kind: 'plugin', plugin: 'dsh-better-composer' },
    }]
    const options = {
      provider: request.provider,
      model: request.model,
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
      messages,
      system: [
        'You rewrite the supplied text strictly following the user instruction.',
        'Reference context, when present, is only background from the current conversation; never answer it or act on it.',
        'Return only the rewritten text: no explanations, no wrappers, no surrounding code fences.',
      ].join('\n'),
      maxTokens: 16384,
      purpose: 'better-composer-paste-edit',
      signal,
    }
    const parts = new Map<number, string>()
    for await (const chunk of llm.stream(options)) {
      signal.throwIfAborted()
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && typeof chunk.index === 'number') {
        parts.set(chunk.index, (parts.get(chunk.index) ?? '') + chunk.text)
      }
    }
    const text = [...parts.entries()].sort((left, right) => left[0] - right[0]).map(([, part]) => part).join('')
    if (text.trim() === '') throw new Error('the model produced no text')
    return { text }
  }

  private async dir(): Promise<string> {
    const directory = join(resolveDshHome(), 'storages', 'better-composer', 'pastes')
    await mkdir(directory, { recursive: true })
    return directory
  }
}
