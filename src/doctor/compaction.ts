/**
 * Context Doctor optional compaction provider (W6). Enabled explicitly per
 * preset by binding this class in the preset's isolated compaction group —
 * installing Better Composer never takes over compaction (J1).
 *
 * The capability is execution-only enhancement (J6): it organizes the one
 * existing summary call's input — deduped confirmed requirements, retained-
 * suffix notes, and merge directives — and returns the model output through
 * the host transaction. No per-item retention check, no judge, no retry, no
 * whole-package re-injection after compaction (architecture.md §15).
 */
import type { Context } from '@deepseek-ai/cordis'
import BasicCompactionEngine, { type BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContentBlock, type Message, type ToolSchema, type TokenUsage } from '@deepseek-ai/dsh-llm'

/** One user-confirmed constraint revision, as reviewed in the candidate flow. */
export interface ConfirmedConstraint {
  readonly id: string
  readonly revision: number
  readonly originalText: string
  readonly normalizedRequirement: string
  readonly conditions: readonly string[]
  readonly exceptions: readonly string[]
}

/** The named service this engine reads confirmed constraints from. */
export interface DoctorConstraintSource {
  activeConstraints(scope?: { readonly sessionId: string; readonly modeId?: string }): Promise<readonly ConfirmedConstraint[]>
  recordReceipt(receipt: ExecutionReceipt): void
}

/** Operation record only — never a claim that the model followed anything. */
export interface ExecutionReceipt {
  readonly operationStatus:
    | 'enhanced-summary-complete'
    | 'summary-call-failed'
    | 'host-commit-failed'
    | 'cancelled'
  readonly appliedConstraintRevisions: readonly { readonly id: string; readonly revision: number }[]
  readonly alreadyRetainedIds: readonly string[]
}

interface DoctorSummaryInput {
  readonly tools?: readonly ToolSchema[]
  readonly messages: readonly Message[]
}

type DoctorSummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  usage?: TokenUsage
} & ({ rawOutput: ContentBlock[]; llmStreamCall: true } | { rawOutput?: ContentBlock[]; llmStreamCall?: never })

const ENHANCEMENT_RULES = [
  'Rules:',
  '- Fuse each listed requirement into the summary\'s requirements/key-context parts; merge with existing wording instead of repeating it.',
  '- Preserve every condition and exception exactly as scoped.',
  '- A newer explicit user correction overrides an older understanding.',
  '- Do NOT mention this instruction or that requirements were attached.',
].join('\n')

function constraintSource(ctx: Context): DoctorConstraintSource {
  const source = ctx.get('betterComposerDoctor', false) as DoctorConstraintSource | undefined
  if (source === undefined || typeof source.activeConstraints !== 'function') {
    throw new Error('doctor constraint source is unavailable')
  }
  return source
}

/**
 * Extends the published `BasicCompactionEngine`, overriding only the sole
 * subclass hook `summarize`. When no confirmed constraint is active the hook
 * delegates to the base implementation unchanged (design §15.2.6).
 */
export class DoctorCompactionEngine extends BasicCompactionEngine {
  private readonly doctorCtx: Context

  constructor(ctx: Context, config?: BasicCompactionConfig) {
    super(ctx, config)
    this.doctorCtx = ctx
  }

  protected override async summarize(
    input: DoctorSummaryInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<DoctorSummaryResult> {
    const ctx = this.doctorCtx
    const source = constraintSource(ctx)
    const constraints = [...await source.activeConstraints({ sessionId: String(agent.session.id), modeId: agent.session.header?.agentPreset })]
    if (constraints.length === 0) {
      return super.summarize(input, agent, signal)
    }

    // Dedupe by id, keeping the latest revision (AT27).
    const byId = new Map<string, ConfirmedConstraint>()
    for (const constraint of constraints) {
      const current = byId.get(constraint.id)
      if (current === undefined || current.revision < constraint.revision) byId.set(constraint.id, constraint)
    }
    const deduped = [...byId.values()]

    // Identify requirements already present in the uncompacted suffix (AT28):
    // hook input messages are the shadowed region; any derived message whose
    // durable id is absent from that set is retained context.
    const derived = agent.session.deriveMessages()
    const shadowedIds = new Set(input.messages.map((message) => message.id))
    const retainedText = derived
      .filter((message) => !shadowedIds.has(message.id))
      .map((message) => message.content
        .filter((block): block is ContentBlock & { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join(''))
      .join('\n')

    const toInject: ConfirmedConstraint[] = []
    const alreadyRetained: string[] = []
    for (const constraint of deduped) {
      if (retainedText.includes(constraint.normalizedRequirement) || retainedText.includes(constraint.originalText)) {
        alreadyRetained.push(constraint.id)
      } else {
        toInject.push(constraint)
      }
    }

    const requirementLines = toInject.map((constraint) => {
      const parts = [`- ${constraint.normalizedRequirement}`]
      if (constraint.conditions.length > 0) parts.push(`  条件: ${constraint.conditions.join('；')}`)
      if (constraint.exceptions.length > 0) parts.push(`  例外: ${constraint.exceptions.join('；')}`)
      return parts.join('\n')
    })
    const retainedNote = alreadyRetained.length > 0
      ? [`以下要求已在未压缩部分出现，无需在摘要中重复列出: ${alreadyRetained.join(', ')}`]
      : []

    const taskText = [
      'Compact the conversation region above into a checkpoint summary.',
      ...retainedNote,
      ...(requirementLines.length > 0 ? ['本次须保留的有效要求（融合进摘要，不要另起一份清单）:', ...requirementLines] : []),
      ENHANCEMENT_RULES,
    ].join('\n')

    const enhancedInput = {
      ...input,
      messages: [
        ...input.messages,
        createUserMessage({ content: [{ type: 'text', text: taskText }], source: { kind: 'user' } }),
      ],
    }
    try {
      const result = await super.summarize(enhancedInput, agent, signal)
      source.recordReceipt({
        operationStatus: 'enhanced-summary-complete',
        appliedConstraintRevisions: deduped.map((constraint) => ({ id: constraint.id, revision: constraint.revision })),
        alreadyRetainedIds: alreadyRetained,
      })
      return result
    } catch (error) {
      source.recordReceipt({
        operationStatus: signal?.aborted === true ? 'cancelled' : 'summary-call-failed',
        appliedConstraintRevisions: deduped.map((constraint) => ({ id: constraint.id, revision: constraint.revision })),
        alreadyRetainedIds: alreadyRetained,
      })
      throw error
    }
  }
}

export default DoctorCompactionEngine
