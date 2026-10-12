/**
 * W0 published-contract verification for Context Doctor.
 *
 * These tests pin the *published* `@deepseek-ai/dsh-*@0.1.7-alpha.2` package
 * surface the Doctor design relies on. They intentionally exercise only root
 * exports: no deep `src/*` imports, no private host APIs. A failure here means
 * the affected capability must degrade per architecture.md §18, not route
 * around the missing contract.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  CompactionId,
  compactCheckpointSource,
  isCompactCheckpointSource,
} from '@deepseek-ai/dsh-compaction'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { ContentBlock, Message, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  livePresetMounts,
  standingMountFor,
} from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionPersistence, SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import {
  SessionSeq,
  deriveEventMessage,
  foldSurface,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import {
  assistantMessageEvent,
  compactionReplacementEvent,
  fixtureCallId,
  systemMessageEvent,
  toolCallEvent,
  toolResultEvent,
  userMessageEvent,
} from '../helpers/doctor-events.ts'

describe('W0 published contract: session surface fold', () => {
  it('folds a plain log into model-visible order with stable message identities', () => {
    const events: SessionEvent[] = [
      systemMessageEvent(0, 0, 0, 'You are helpful.'),
      userMessageEvent(1, 0, 'first prompt'),
      assistantMessageEvent(2, 0, 0, 'first answer'),
      userMessageEvent(3, 1, 'second prompt'),
      assistantMessageEvent(4, 1, 1, 'second answer'),
    ]

    const fold = foldSurface(events)

    expect(fold.nodes).toEqual([0, 1, 2, 3, 4].map((seq) => SessionSeq(seq)))
    expect(fold.replacements).toEqual([])

    const user = deriveEventMessage(events[1]!, fold.projectedMessages)
    const assistant = deriveEventMessage(events[2]!, fold.projectedMessages)
    const again = deriveEventMessage(events[1]!, fold.projectedMessages)

    // Plain appends carry no plugin projection: the fold returns an empty
    // projection map and derivation reads the durable event content, keeping
    // the message's stable identity across derivations (AT28 ID basis).
    expect(fold.projectedMessages.size).toBe(0)
    expect(user).not.toBeNull()
    expect(assistant).not.toBeNull()
    expect(user!.id).toBe(events[1]!.data.id)
    expect(again!.id).toBe(user!.id)
    expect(typeof user!.id).toBe('string')
    expect(user!.id.length).toBeGreaterThan(0)
  })

  it('a compaction replacement shadows only the cited span; head and tail stay effective (AT05, AT28)', () => {
    const events: SessionEvent[] = [
      systemMessageEvent(0, 0, 0, 'You are helpful.'),
      userMessageEvent(1, 0, 'setup instructions'),
      assistantMessageEvent(2, 0, 0, 'worked output'),
      toolCallEvent(3, 0, 0, fixtureCallId(), 'read_file', { path: 'a.ts' }),
      toolResultEvent(4, 0, 0, fixtureCallId(), 'file contents', undefined, 3),
      compactionReplacementEvent(5, 1, 0, 1, 4, 'Summary of the earlier work.'),
      userMessageEvent(6, 1, 'follow-up question'),
      assistantMessageEvent(7, 1, 1, 'follow-up answer'),
    ]

    const fold = foldSurface(events)

    // The replacement node occupies the shadowed span's position; the
    // surrounding head (system) and tail survive on the effective surface.
    expect(fold.nodes).toEqual([0, 5, 6, 7].map((seq) => SessionSeq(seq)))
    expect(fold.replacements).toHaveLength(1)

    const summary = deriveEventMessage(events[5]!, fold.projectedMessages)
    expect(summary).not.toBeNull()
    expect(summary!.role).toBe('user')
    expect(isCompactCheckpointSource(summary!.source)).toBe(true)
    if (isCompactCheckpointSource(summary!.source)) {
      expect(summary!.source.compactionId).toBe(CompactionId(`fixture-compact-5`))
    }

    // Shadowed nodes are no longer derivable from the effective surface.
    expect(fold.nodes).not.toContain(SessionSeq(2))
    expect(fold.nodes).not.toContain(SessionSeq(4))
  })

  it('checkpoint source helper round-trips through the published marker contract', () => {
    const source = compactCheckpointSource(CompactionId('compact-42'))
    expect(isCompactCheckpointSource(source)).toBe(true)
    expect(isCompactCheckpointSource({ kind: 'user' })).toBe(false)

    const message = createUserMessage({ content: [{ type: 'text', text: 'checkpoint' }], source })
    expect(isCompactCheckpointSource(message.source)).toBe(true)
  })
})

describe('W0 published contract: session-persistence read handle (A01)', () => {
  it('types support bounded read-only paging without ownership', async () => {
    // Compile-and-run construction against the published Service type: the
    // Doctor read path opens read handles, pages to a fixed cutoff, and
    // always closes. The fake implements the published abstract surface.
    const fakePersistence: Pick<SessionPersistence, 'open'> = {
      async open(id, access): Promise<SessionHandle> {
        expect(access).toBe('read')
        const events: SessionEvent[] = [userMessageEvent(0, 0, `session ${id}`)]
        return {
          id,
          header: {
            id,
            cwd: '/tmp/fixture',
            agentPreset: 'standard',
            isSeeded: false,
          } as SessionHandle['header'],
          inheritedEventCount: 0,
          access: 'read',
          async read(offset = 0, length = 2) {
            return { eventState: 'owned', events: events.slice(offset, offset + length) }
          },
          async append(): Promise<void> {
            throw new Error('read handle must never append')
          },
          async flush(): Promise<void> {
            throw new Error('read handle must never flush')
          },
          async close(): Promise<void> {},
          async [Symbol.asyncDispose](): Promise<void> {},
        }
      },
    }

    const handle = await fakePersistence.open('session-a' as never, 'read')
    try {
      const first = await handle.read(0, 2)
      const rest = await handle.read(first.events.length, 2)
      expect(first.events).toHaveLength(1)
      expect(rest.events).toHaveLength(0)
    } finally {
      await handle.close()
    }
  })
})

describe('W0 published contract: preset registry live mounts (A13, §11.1)', () => {
  it('exposes standingMountFor and livePresetMounts root functions', () => {
    expect(typeof standingMountFor).toBe('function')
    expect(typeof livePresetMounts).toBe('function')

    // A context with no scope parent resolves to undefined instead of throwing.
    const bare = {} as Context
    expect(standingMountFor(bare)).toBeUndefined()
  })
})

describe('W0 published contract: compaction subclass hook (W6 basis)', () => {
  it('a Doctor engine subclass overrides summarize(input, agent, signal) with public types only', () => {
    // Structural input/result declarations compatible with the protected base
    // hook, using only root-exported dsh-llm vocabulary. If the published
    // signature drifts, this file stops compiling — that is the W0 signal.
    interface DoctorSummaryInput {
      readonly tools?: readonly ToolSchema[]
      readonly messages: readonly Message[]
    }

    interface DoctorSummaryResult {
      summary: ContentBlock[]
      provider: string
      model: string
      usage?: TokenUsage
      rawOutput?: ContentBlock[]
    }

    class DoctorCompactionEngine extends BasicCompactionEngine {
      protected override async summarize(
        input: DoctorSummaryInput,
        _agent: Agent,
        signal?: AbortSignal,
      ): Promise<DoctorSummaryResult> {
        signal?.throwIfAborted()
        return {
          summary: input.messages.length === 0
            ? []
            : [{ type: 'text', text: 'doctor enhanced summary' }],
          provider: 'fixture',
          model: 'fixture-small',
        }
      }
    }

    expect(typeof DoctorCompactionEngine).toBe('function')
    const prototype = DoctorCompactionEngine.prototype as unknown as {
      summarize(input: DoctorSummaryInput, agent: Agent, signal?: AbortSignal): Promise<DoctorSummaryResult>
    }
    expect(typeof prototype.summarize).toBe('function')
  })
})

describe('W0 fixture skeleton sanity', () => {
  it('builders produce contiguous seqs across the AT event vocabulary', () => {
    const events: SessionEvent[] = [
      systemMessageEvent(0, 0, 0, 'sys'),
      userMessageEvent(1, 0, 'u1'),
      assistantMessageEvent(2, 0, 0, 'a1', { input: 10, output: 5 }),
      toolCallEvent(3, 0, 1, fixtureCallId(), 'run_code', { code: '1' }),
      toolResultEvent(4, 0, 1, fixtureCallId(), 'ok', undefined, 3),
      compactionReplacementEvent(5, 1, 0, 1, 4, 'summary'),
      userMessageEvent(6, 1, 'u2'),
      assistantMessageEvent(7, 1, 1, 'a2'),
    ]
    events.forEach((event, index) => {
      expect(event.seq).toBe(SessionSeq(index))
    })
    const fold = foldSurface(events)
    expect(fold.nodes[0]).toBe(SessionSeq(0))
  })
})
