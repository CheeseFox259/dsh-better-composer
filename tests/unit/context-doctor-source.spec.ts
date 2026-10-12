/**
 * W1 tests: read-only source adapters with in-memory gateways.
 * Covers AT05 (surface reconstruction with partial degrade), AT18 (read-only
 * scan: no follow/retain, no write ownership), AT19 (frozen cutoff), AT33
 * (only durable logs are read; nothing else is touched).
 */
import { describe, expect, it } from 'vitest'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assistantMessageEvent,
  compactionReplacementEvent,
  systemMessageEvent,
  toolCallEvent,
  toolResultEvent,
  userMessageEvent,
} from '../helpers/doctor-events.ts'
import { DoctorSource } from '../../src/doctor/host/source.ts'

interface FixtureSession {
  readonly id: string
  readonly events: SessionEvent[]
  readonly modeId?: string
  readonly cwd?: string
  readonly parentSessionId?: string
  readonly archived?: boolean
  readonly failRead?: boolean
}

function makeSource(fixtures: FixtureSession[]) {
  const stored = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  const opens: string[] = []
  const closes: string[] = []
  const appends: string[] = []

  const source = new DoctorSource({
    catalog: {
      async list() {
        return fixtures.map((fixture) => ({
          sessionId: fixture.id,
          updatedAt: 1_700_000_000_000,
          running: false,
          blank: fixture.events.length === 0,
          agentAvailable: false,
          ...(fixture.cwd === undefined ? {} : { cwd: fixture.cwd }),
          ...(fixture.parentSessionId === undefined ? {} : { parentSessionId: fixture.parentSessionId }),
        }))
      },
    },
    archive: {
      async archivedSessionIds() {
        return fixtures.filter((fixture) => fixture.archived === true).map((fixture) => fixture.id)
      },
    },
    persistence: {
      async stat(id) {
        const fixture = stored.get(id)
        if (fixture === undefined) return undefined
        return {
          header: {
            id,
            createdAt: 1_700_000_000_000,
            isSeeded: fixture.parentSessionId !== undefined,
            ...(fixture.modeId === undefined ? {} : { agentPreset: fixture.modeId }),
            ...(fixture.cwd === undefined ? {} : { cwd: fixture.cwd }),
            ...(fixture.parentSessionId === undefined ? {} : { parentSession: fixture.parentSessionId }),
          },
          revision: 1,
          eventCount: fixture.events.length,
        } as never
      },
      async open(id): Promise<SessionHandle> {
        opens.push(id)
        const fixture = stored.get(id)
        if (fixture === undefined) throw new Error('not found')
        return {
          id: id as never,
          header: {} as never,
          inheritedEventCount: 0,
          access: 'read',
          async read(offset = 0, length = 200) {
            if (fixture.failRead === true) throw new Error('backend read failure')
            return { eventState: 'owned', events: fixture.events.slice(offset, offset + length) }
          },
          async append() {
            appends.push(id)
            throw new Error('read-only')
          },
          async flush() {
            throw new Error('read-only')
          },
          async close() {
            closes.push(id)
          },
          async [Symbol.asyncDispose]() {},
        } as never
      },
    },
  })

  return { source, opens, closes, appends }
}

describe('DoctorSource.capabilities', () => {
  it('reports every gateway and its missing reason (AT35)', () => {
    const full = new DoctorSource({})
    const capabilities = full.capabilities()
    expect(capabilities.catalog.available).toBe(false)
    expect(capabilities.catalog.reason).toBeDefined()
    expect(capabilities.persistence.available).toBe(false)
    expect(capabilities.archive.available).toBe(false)
  })
})

describe('DoctorSource.freezeCandidates', () => {
  it('includes archived identities that the ordinary list omits', async () => {
    const source = new DoctorSource({ catalog: { async list() { return [] } }, archive: { async archivedSessionIds() { return ['archived'] } } })
    expect((await source.freezeCandidates()).map((item) => item.sessionId)).toEqual(['archived'])
  })
  it('joins the business-visible list with the archive set without dropping archived sessions (AT18)', async () => {
    const { source } = makeSource([
      { id: 's-active', events: [userMessageEvent(0, 0, 'hi')], modeId: 'standard' },
      { id: 's-archived', events: [userMessageEvent(0, 0, 'old')], modeId: 'standard', archived: true },
    ])

    const candidates = await source.freezeCandidates()
    expect(candidates.map((candidate) => candidate.sessionId).sort()).toEqual(['s-active', 's-archived'])
    const archived = candidates.find((candidate) => candidate.sessionId === 's-archived')!
    expect(archived.archived).toBe(true)
    const active = candidates.find((candidate) => candidate.sessionId === 's-active')!
    expect(active.archived).toBe(false)
  })

  it('marks the archive dimension unavailable instead of guessing when the workspace gateway is absent', async () => {
    const { source } = makeSource([{ id: 's1', events: [userMessageEvent(0, 0, 'hi')] }])
    const sourceWithoutArchive = new DoctorSource({
      catalog: (source as never as { gateways: { catalog: unknown } }).gateways.catalog,
    })
    const candidates = await sourceWithoutArchive.freezeCandidates()
    expect(candidates[0]!.archived).toBe(false)
    expect(sourceWithoutArchive.capabilities().archive.available).toBe(false)
  })
})

describe('DoctorSource.readSnapshot', () => {
  it('reads the public handle snapshot when stat omits its optional event count', async () => {
    const events = [userMessageEvent(0, 0, 'real history'), assistantMessageEvent(1, 0, 0, 'reply')]
    const source = new DoctorSource({ persistence: {
      async stat() { return { header: { id: 'real', createdAt: 1, isSeeded: false }, revision: 1 } as never },
      async open() { return { inheritedEventCount: 0, async read(offset = 0, length?: number) { return { events: events.slice(offset, length === undefined ? undefined : offset + length) } }, async close() {} } as never },
    } })
    const snapshot = await source.readSnapshot('real')
    expect(snapshot.cutoffSeq).toBe(2)
    expect(snapshot.events).toEqual(events)
    expect(snapshot.status.kind).toBe('ok')
  })
  it('reads a frozen prefix, folds the surface, and observes versions (AT05, AT19)', async () => {
    const { source, opens, closes, appends } = makeSource([
      {
        id: 's1',
        events: [
          systemMessageEvent(0, 0, 0, 'You are helpful.'),
          userMessageEvent(1, 0, 'first'),
          assistantMessageEvent(2, 0, 0, 'answer'),
          userMessageEvent(3, 1, 'second'),
          assistantMessageEvent(4, 1, 1, 'answer two'),
        ],
        modeId: 'standard',
        cwd: '/repo',
      },
    ])

    const snapshot = await source.readSnapshot('s1', { cutoffSeq: 4 })

    expect(snapshot.sessionId).toBe('s1')
    expect(snapshot.modeId).toBe('standard')
    expect(snapshot.cutoffSeq).toBe(4)
    expect(snapshot.events).toHaveLength(4)
    expect(snapshot.fold?.nodes).toEqual([0, 1, 2, 3])
    expect(snapshot.versions.length).toBeGreaterThan(0)
    // The cutoff precedes the durable end: frozen prefix, partial coverage.
    expect(snapshot.status).toEqual({ kind: 'partial', reason: 'cutoff-before-stored-end' })

    // Reading to the advertised end closes the snapshot as complete.
    const complete = await source.readSnapshot('s1')
    expect(complete.cutoffSeq).toBe(5)
    expect(complete.status.kind).toBe('ok')

    // Read-only discipline: one open+close per read, zero writes (AT18).
    expect(opens).toEqual(['s1', 's1'])
    expect(closes).toEqual(['s1', 's1'])
    expect(appends).toEqual([])
  })

  it('marks the snapshot partial when storage advertised events past the cutoff (AT19)', async () => {
    const { source } = makeSource([
      { id: 's1', events: [userMessageEvent(0, 0, 'a'), userMessageEvent(1, 1, 'b'), userMessageEvent(2, 2, 'c')] },
    ])
    const snapshot = await source.readSnapshot('s1', { cutoffSeq: 2 })
    expect(snapshot.events).toHaveLength(2)
    expect(snapshot.status).toEqual({ kind: 'partial', reason: 'cutoff-before-stored-end' })
  })

  it('records modeId and fork lineage from the stored header (AT17 input)', async () => {
    const { source } = makeSource([
      { id: 'parent', events: [userMessageEvent(0, 0, 'root')], modeId: 'standard' },
      { id: 'child', events: [userMessageEvent(0, 0, 'root')], modeId: 'standard', parentSessionId: 'parent' },
    ])
    const child = await source.readSnapshot('child')
    expect(child.modeId).toBe('standard')
    expect(child.originSessionId).toBe('parent')
    expect(child.inheritedEventCount).toBe(0)
  })

  it('degrades to an error snapshot when the session is missing or the backend fails (AT35)', async () => {
    const { source } = makeSource([
      { id: 'gone-ok', events: [userMessageEvent(0, 0, 'fine')] },
      { id: 'broken', events: [userMessageEvent(0, 0, 'x')], failRead: true },
    ])

    const missing = await source.readSnapshot('nope')
    expect(missing.status.kind).toBe('error')
    if (missing.status.kind === 'error') expect(missing.status.reason).toContain('not-found')

    const broken = await source.readSnapshot('broken')
    expect(broken.status.kind).toBe('error')
    expect(broken.fold).toBeUndefined()
  })

  it('folds compaction replacements so shadowed content leaves the effective surface (AT05)', async () => {
    const { source } = makeSource([
      {
        id: 's1',
        events: [
          userMessageEvent(0, 0, 'original ask'),
          assistantMessageEvent(1, 0, 0, 'original answer'),
          compactionReplacementEvent(2, 1, 0, 0, 1, 'Checkpoint summary.'),
          userMessageEvent(3, 1, 'next'),
          assistantMessageEvent(4, 1, 1, 'next answer'),
        ],
      },
    ])
    const snapshot = await source.readSnapshot('s1')
    expect(snapshot.fold?.nodes).toEqual([2, 3, 4])
    expect(snapshot.status.kind).toBe('ok')
  })

  it('never reads past the durable log: no follow/retain path exists on the gateway (AT18, AT33)', async () => {
    const { source } = makeSource([{ id: 's1', events: [userMessageEvent(0, 0, 'a')] }])
    // The gateway interface only models stat/open/read/close. There is
    // deliberately no method that could resume, follow, or read drafts;
    // this test pins that the snapshot read compiles against the narrow seam.
    const snapshot = await source.readSnapshot('s1')
    expect(snapshot.events).toHaveLength(1)
  })
})
