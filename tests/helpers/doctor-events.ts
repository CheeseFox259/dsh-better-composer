/**
 * Synthetic session-event builders shared by the Context Doctor contract and
 * rule tests. Every builder returns properly typed {@link SessionEvent} values
 * against the published `@deepseek-ai/dsh-session` vocabulary so fixtures stay
 * honest when the host format moves.
 */
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  type ContentBlock,
  type ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import {
  SessionSeq,
  foldSurface,
  type EpochHeader,
  type RequestHeaderReason,
  type SessionEvent,
  type TurnEndReason,
} from '@deepseek-ai/dsh-session'
import type { SessionSnapshot } from '../../src/doctor/contracts.ts'

/** Monotonic millisecond clock for fixture logs; starts past the epoch. */
export function fixtureClock(): () => number {
  let now = 1_700_000_000_000
  return () => (now += 1_000)
}

function text(content: string): readonly ContentBlock[] {
  return [{ type: 'text', text: content }]
}

let callCounter = 0

/** Fresh tool call identity per fixture run. */
export function fixtureCallId(): ToolCallId {
  callCounter += 1
  return `call-${callCounter}` as ToolCallId
}

/** Wrap one user message as a surface-appended session event. */
export function userMessageEvent(seq: number, turn: number, content: string): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: 0,
    data: createUserMessage({ content: text(content), source: { kind: 'user' } }),
    surfaceOp: 'append',
  }
}

/** Wrap one assistant message (with optional provider usage) as a surface event. */
export function assistantMessageEvent(
  seq: number,
  turn: number,
  step: number,
  content: string,
  usage?: SessionEvent<'assistant/message'>['data']['usage'],
): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: SessionSeq(seq),
    time: 0,
    data: {
      turn,
      step,
      message: createAssistantMessage({ content: text(content), source: { provider: 'fixture', model: 'fixture-small' } }),
      stream: [],
      ...(usage === undefined ? {} : { usage }),
    },
    surfaceOp: 'append',
  }
}

/** Record one tool invocation request (log-only; never on the surface). */
export function toolCallEvent(seq: number, turn: number, step: number, callId: ToolCallId, name: string, args: unknown): SessionEvent<'tool/call'> {
  return {
    type: 'tool/call',
    seq: SessionSeq(seq),
    time: 0,
    data: { turn, step, callId, name, arguments: JSON.stringify(args) },
  }
}

/** Wrap one tool result as a surface-appended session event, citing its `tool/call`. */
export function toolResultEvent(
  seq: number,
  turn: number,
  step: number,
  callId: ToolCallId,
  content: string,
  error?: SessionEvent<'tool/result'>['data']['error'],
  citedCallSeq?: number,
): SessionEvent<'tool/result'> {
  return {
    type: 'tool/result',
    seq: SessionSeq(seq),
    time: 0,
    data: {
      turn,
      step,
      message: createToolResultMessage({ callId, content: text(content), isError: error !== undefined }),
      ...(error === undefined ? {} : { error }),
    },
    surfaceOp: 'append',
    ...(citedCallSeq === undefined ? {} : { sourceEventSeqs: [SessionSeq(citedCallSeq)] }),
  }
}

/** Append one rendered system prompt node. */
export function systemMessageEvent(seq: number, turn: number, step: number, prompt: string): SessionEvent<'system/message'> {
  return {
    type: 'system/message',
    seq: SessionSeq(seq),
    time: 0,
    data: { turn, step, message: createSystemMessage(prompt) },
    surfaceOp: 'append',
  }
}

/** Log-only request header snapshot. */
export function requestHeaderEvent(seq: number, header: EpochHeader, reason: RequestHeaderReason): SessionEvent<'request/header'> {
  return { type: 'request/header', seq: SessionSeq(seq), time: 0, data: { header, reason } }
}

/** Turn boundary markers (log-only). */
export function turnStartEvent(seq: number, turn: number): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq: SessionSeq(seq), time: 0, data: { turn } }
}

export function turnEndEvent(seq: number, turn: number, reason: TurnEndReason = 'completed'): SessionEvent<'turn/end'> {
  return { type: 'turn/end', seq: SessionSeq(seq), time: 0, data: { turn, reason } }
}

/**
 * One compaction-style replacement event: the summary node replaces the
 * inclusive surface span `startSeq..endSeq` and cites every shadowed source.
 */
export function compactionReplacementEvent(
  seq: number,
  turn: number,
  step: number,
  startSeq: number,
  endSeq: number,
  summary: string,
): SessionEvent<'user/message'> {
  const shadowed: number[] = []
  for (let shadowedSeq = startSeq; shadowedSeq <= endSeq; shadowedSeq += 1) shadowed.push(shadowedSeq)
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: 0,
    data: createUserMessage({ content: text(summary), source: compactCheckpointSource(CompactionId(`fixture-compact-${seq}`)) }),
    surfaceOp: { op: 'replace', startSeq: SessionSeq(startSeq), endSeq: SessionSeq(endSeq) },
    sourceEventSeqs: shadowed.map((value) => SessionSeq(value)),
  }
}

/** Append one skill-catalog snapshot user message (A14). */
export function skillCatalogEvent(
  seq: number,
  turn: number,
  entries: readonly { readonly name: string; readonly description: string }[],
): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: 0,
    data: createUserMessage({
      content: text(entries.map((entry) => `- ${entry.name}: ${entry.description}`).join('\n')),
      source: { kind: 'skill-catalog', entries: entries.map((entry) => ({ ...entry })) } as never,
    }),
    surfaceOp: 'append',
  }
}

/** Inject one user-explicit skill invocation message (A15 gesture path). */
export function skillInvocationEvent(seq: number, turn: number, name: string, body: string): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: 0,
    data: createUserMessage({
      content: text(body),
      source: { kind: 'skill-invocation', name, form: 'instructions' } as never,
    }),
    surfaceOp: 'append',
  }
}

/** One frozen snapshot over fixture events, folded when possible. */
export function snapshotOf(events: SessionEvent[], inheritedEventCount = 0): SessionSnapshot {
  let fold: SessionSnapshot['fold']
  try {
    fold = foldSurface(events)
  } catch {
    fold = undefined
  }
  return {
    sessionId: 's1',
    originSessionId: 's1',
    createdAt: 0,
    archived: false,
    inheritedEventCount,
    cutoffSeq: events.length,
    storedEventCount: events.length,
    events,
    ...(fold === undefined ? {} : { fold }),
    status: { kind: 'ok' },
    versions: [],
  }
}
