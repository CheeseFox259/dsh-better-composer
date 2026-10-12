/**
 * W2 tests: effective-exchange eligibility (H2=A, J2, J3).
 * AT15 two full exchanges; AT16 recovery merging with strict pure-continue
 * phrases; AT17 fork own-interval counting only.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assistantMessageEvent,
  compactionReplacementEvent,
  turnEndEvent,
  turnStartEvent,
  userMessageEvent,
} from '../helpers/doctor-events.ts'
import { assessEligibility } from '../../src/doctor/eligibility.ts'
import type { SessionSnapshot } from '../../src/doctor/contracts.ts'

function snapshotOf(events: SessionEvent[], inheritedEventCount = 0): SessionSnapshot {
  return {
    sessionId: 's1',
    originSessionId: 's1',
    createdAt: 0,
    archived: false,
    inheritedEventCount,
    cutoffSeq: events.length,
    storedEventCount: events.length,
    events,
    status: { kind: 'ok' },
    versions: [],
  }
}

describe('assessEligibility: confirmed exchanges', () => {
  it('counts two complete user-model exchanges as eligible (AT15)', () => {
    const eligibility = assessEligibility(snapshotOf([
      userMessageEvent(0, 0, 'first task'),
      assistantMessageEvent(1, 0, 0, 'done one'),
      userMessageEvent(2, 1, 'second task'),
      assistantMessageEvent(3, 1, 1, 'done two'),
    ]))
    expect(eligibility.confirmedExchanges).toBe(2)
    expect(eligibility.status).toBe('eligible')
    expect(eligibility.recoveryGroups).toEqual([])
  })

  it('one exchange plus pure "continue" recoveries stays below the threshold (AT15)', () => {
    const events: SessionEvent[] = [
      turnStartEvent(0, 0),
      userMessageEvent(1, 0, 'do the work'),
      assistantMessageEvent(2, 0, 0, 'partial work'),
      turnEndEvent(3, 0, 'max-tokens'),
      turnStartEvent(4, 1),
      userMessageEvent(5, 1, '继续'),
      assistantMessageEvent(6, 1, 0, 'more work'),
      turnEndEvent(7, 1, 'max-tokens'),
      turnStartEvent(8, 2),
      userMessageEvent(9, 2, 'Continue'),
      assistantMessageEvent(10, 2, 0, 'finished'),
    ]
    const eligibility = assessEligibility(snapshotOf(events))
    // Three turns merged into ONE exchange: the continuations carried no new instruction.
    expect(eligibility.confirmedExchanges).toBe(1)
    expect(eligibility.possibleExchanges).toBe(0)
    expect(eligibility.status).toBe('ineligible')
    expect(eligibility.recoveryGroups).toHaveLength(1)
    expect(eligibility.recoveryGroups[0]!.continuationSeqs).toEqual([5, 9])
  })

  it('a continuation carrying a new constraint is NOT merged (AT16)', () => {
    const events: SessionEvent[] = [
      turnStartEvent(0, 0),
      userMessageEvent(1, 0, 'run the migration'),
      assistantMessageEvent(2, 0, 0, 'migrating'),
      turnEndEvent(3, 0, 'aborted'),
      turnStartEvent(4, 1),
      userMessageEvent(5, 1, '继续，但不要修改数据库'),
      assistantMessageEvent(6, 1, 0, 'continuing without database changes'),
    ]
    const eligibility = assessEligibility(snapshotOf(events))
    expect(eligibility.confirmedExchanges).toBe(2)
    expect(eligibility.recoveryGroups).toEqual([])
    expect(eligibility.status).toBe('eligible')
  })

  it('a corrected goal after cancellation starts a new exchange, not a merge', () => {
    const events: SessionEvent[] = [
      turnStartEvent(0, 0),
      userMessageEvent(1, 0, 'write the report'),
      assistantMessageEvent(2, 0, 0, 'drafting'),
      turnEndEvent(3, 0, 'aborted'),
      turnStartEvent(4, 1),
      userMessageEvent(5, 1, '不对，先修复测试再写报告'),
      assistantMessageEvent(6, 1, 0, 'fixing tests first'),
    ]
    const eligibility = assessEligibility(snapshotOf(events))
    expect(eligibility.confirmedExchanges).toBe(2)
    expect(eligibility.recoveryGroups).toEqual([])
  })
})

describe('assessEligibility: incomplete responses and forks', () => {
  it('an interrupted assistant response is a possible exchange, not a confirmed one (J3)', () => {
    const interrupted = assistantMessageEvent(2, 0, 0, 'partial prefix')
    interrupted.data.interrupted = true
    const eligibility = assessEligibility(snapshotOf([
      userMessageEvent(0, 0, 'task'),
      interrupted,
      userMessageEvent(3, 1, 'next task'),
      assistantMessageEvent(4, 1, 1, 'done'),
    ]))
    expect(eligibility.confirmedExchanges).toBe(1)
    expect(eligibility.possibleExchanges).toBe(1)
    expect(eligibility.status).toBe('ineligible')
    expect(eligibility.reasons.some((reason) => reason.includes('incomplete'))).toBe(true)
  })

  it('fork inherited history does not count toward the child threshold (AT17, J2=A)', () => {
    const inherited: SessionEvent[] = [
      userMessageEvent(0, 0, 'inherited ask'),
      assistantMessageEvent(1, 0, 0, 'inherited answer'),
    ]
    const own: SessionEvent[] = [
      userMessageEvent(2, 1, 'own ask'),
      assistantMessageEvent(3, 1, 1, 'own answer'),
    ]
    const eligibility = assessEligibility(snapshotOf([...inherited, ...own], 2))
    expect(eligibility.confirmedExchanges).toBe(1)
    expect(eligibility.status).toBe('ineligible')
    expect(eligibility.reasons).toContain('fork-own-exchanges-only')
  })

  it('a compaction checkpoint on the surface is not a user instruction', () => {
    const eligibility = assessEligibility(snapshotOf([
      userMessageEvent(0, 0, 'first'),
      assistantMessageEvent(1, 0, 0, 'answer'),
      compactionReplacementEvent(2, 1, 0, 0, 1, 'checkpoint'),
      userMessageEvent(3, 1, 'second'),
      assistantMessageEvent(4, 1, 1, 'answer two'),
    ]))
    expect(eligibility.confirmedExchanges).toBe(2)
    expect(eligibility.status).toBe('eligible')
  })
})
