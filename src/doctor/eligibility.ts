/**
 * Effective-exchange eligibility (architecture.md §16, metrics.md §7.1).
 * Pure rules over one frozen snapshot — no model calls, no host state.
 *
 * H2=A: a session is eligible for mode statistics only after two complete
 * user→model exchanges (U1→A1→U2→A2). J2=A: fork children count only their own
 * interval. J3: when a continuation cannot be proven a pure recovery, it is
 * normal dialogue — never excluded, never sent to a classifier.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionSnapshot } from './contracts.ts'

/** One user instruction unit on the surface. */
export interface ExchangeUnit {
  /** Seq of the user message that opened the unit. */
  readonly startSeq: number
  readonly userText: string
  /** Whether a complete model-visible response exists inside the unit window. */
  readonly complete: boolean
  /** Incomplete closure reason, when not complete. */
  readonly incompleteReason?: 'interrupted-response' | 'no-response'
}

/** Continuation messages merged into one exchange by the recovery rules. */
export interface RecoveryGroup {
  /** Index into {@link Eligibility.rawUnits} of the surviving exchange. */
  readonly exchangeIndex: number
  /** Seqs of user messages merged away as pure continuations. */
  readonly continuationSeqs: readonly number[]
}

export interface Eligibility {
  readonly sessionId: string
  readonly rawUnits: readonly ExchangeUnit[]
  readonly recoveryGroups: readonly RecoveryGroup[]
  /** Exchanges with a complete model response, after recovery merging. */
  readonly confirmedExchanges: number
  /** Units whose model response was interrupted or never arrived. */
  readonly possibleExchanges: number
  readonly status: 'eligible' | 'ineligible' | 'needs-review'
  readonly reasons: readonly string[]
  readonly manualDecision?: 'confirmed' | 'corrected'
}

/** Strict pure-continue phrases; anything else is substantive new instruction. */
const PURE_CONTINUE = new Set([
  '继续', '请继续', '继续吧', '接着', '接着做', '接着来',
  'continue', 'continue please', 'please continue', 'go on', 'keep going', 'resume', 'proceed',
])

function normalizeContinuation(text: string): string {
  return text.trim().toLowerCase().replace(/[\s。！？.!?~～]+/gu, '')
}

function isPureContinue(text: string): boolean {
  const normalized = normalizeContinuation(text)
  return normalized.length > 0 && PURE_CONTINUE.has(normalized)
}

function textOf(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('')
}

function isOriginalUserMessage(event: SessionEvent): event is SessionEvent<'user/message'> {
  return event.type === 'user/message'
    && (event.data.source as { readonly kind?: string }).kind === 'user'
}

function turnEndedInterrupted(event: SessionEvent): boolean {
  return event.type === 'turn/end' && event.data.reason.kind !== 'completed'
}

/**
 * Assess one snapshot. The own interval is `seq >= inheritedEventCount`;
 * inherited content is context, never countable work (AT17).
 */
export function assessEligibility(snapshot: SessionSnapshot): Eligibility {
  const own = snapshot.events.filter((event) => event.seq >= snapshot.inheritedEventCount)

  // Interruption signal per user message: the chain between two original user
  // messages is interrupted when any turn in it ended non-completed or any
  // assistant message in it was flagged interrupted.
  const userMessages = own.filter(isOriginalUserMessage)
  const interruptedBefore = new Map<number, boolean>()
  for (let index = 0; index < userMessages.length; index += 1) {
    const from = userMessages[index]!.seq
    const to = index + 1 < userMessages.length ? userMessages[index + 1]!.seq : Number.POSITIVE_INFINITY
    interruptedBefore.set(userMessages[index]!.seq, own.some((event) =>
      event.seq > from && event.seq < to
      && (turnEndedInterrupted(event) || (event.type === 'assistant/message' && event.data.interrupted === true))))
  }

  // Merge strict pure continuations into the previous exchange.
  const unitStarts: number[] = []
  const merges = new Map<number, number[]>()
  for (const message of userMessages) {
    const text = textOf(message.data.content)
    const previousIndex = unitStarts.length - 1
    if (
      previousIndex >= 0
      && interruptedBefore.get(unitStarts[previousIndex]!) === true
      && isPureContinue(text)
    ) {
      const continuationSeqs = merges.get(previousIndex) ?? []
      continuationSeqs.push(message.seq)
      merges.set(previousIndex, continuationSeqs)
      continue
    }
    unitStarts.push(message.seq)
  }

  // Complete an exchange when any non-interrupted assistant response sits
  // inside its window (original start → next unmerged user message).
  const rawUnits: ExchangeUnit[] = unitStarts.map((startSeq, index) => {
    const end = index + 1 < unitStarts.length ? unitStarts[index + 1]! : Number.POSITIVE_INFINITY
    const window = own.filter((event) => event.seq > startSeq && event.seq < end)
    const userText = textOf((own.find((event) => event.seq === startSeq) as SessionEvent<'user/message'>).data.content)
    const completeResponse = window.find((event) =>
      event.type === 'assistant/message' && event.data.interrupted !== true)
    const anyResponse = window.find((event) => event.type === 'assistant/message')
    if (completeResponse !== undefined) {
      return { startSeq, userText, complete: true }
    }
    return {
      startSeq,
      userText,
      complete: false,
      incompleteReason: anyResponse === undefined ? 'no-response' : 'interrupted-response',
    }
  })

  const recoveryGroups: RecoveryGroup[] = [...merges.entries()]
    .map(([exchangeIndex, continuationSeqs]) => ({ exchangeIndex, continuationSeqs: [...continuationSeqs] }))
    .sort((left, right) => left.exchangeIndex - right.exchangeIndex)

  const confirmedExchanges = rawUnits.filter((unit) => unit.complete).length
  const possibleExchanges = rawUnits.filter((unit) => !unit.complete).length

  const reasons: string[] = []
  if (snapshot.inheritedEventCount > 0) reasons.push('fork-own-exchanges-only')
  if (possibleExchanges > 0) reasons.push('incomplete-exchanges-present')

  // Counting never yields needs-review: an interrupted response is simply not
  // a confirmed exchange. needs-review is reserved for saved user annotations
  // whose source revision later changed (applied by the feedback layer).
  const status: Eligibility['status'] = confirmedExchanges >= 2 ? 'eligible' : 'ineligible'
  if (status === 'ineligible') reasons.push('insufficient-exchanges')

  return {
    sessionId: snapshot.sessionId,
    rawUnits,
    recoveryGroups,
    confirmedExchanges,
    possibleExchanges,
    status,
    reasons,
  }
}
