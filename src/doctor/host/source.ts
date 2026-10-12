/**
 * Context Doctor read-only source adapters (W1). The seam is deliberately
 * narrow: business-visible listing, the archive set, and read-only persistence
 * paging. Nothing here resumes an Agent, follows a live session, takes write
 * ownership, or reads drafts (architecture.md §4, AT18/AT33).
 *
 * Doctor-internal identifiers stay plain strings; host brands are applied only
 * at this boundary so the module remains testable without a runtime host.
 */
import type {
  SessionHandle,
  SessionPersistence,
  SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import { foldSurface } from '@deepseek-ai/dsh-session/surface'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SurfaceFoldResult } from '@deepseek-ai/dsh-session/surface'
import type {
  CandidateSession,
  CapabilityProbe,
  ReadStatus,
  SessionSnapshot,
  VersionRef,
} from '../contracts.ts'
import { fingerprintEvents } from '../versions.ts'

/** Event-page target for one read; bounded reads stay resumable after failures. */
const EVENT_PAGE = 200

/** Business-visible session listing, frozen for one scan. */
export interface SessionCatalogGateway {
  list(signal?: AbortSignal): Promise<readonly SessionSummary[]>
}

/** Registry-global archive set; absence degrades, never guesses. */
export interface ArchiveGateway {
  archivedSessionIds(signal?: AbortSignal): Promise<readonly string[]>
}

/**
 * Read-only persistence seam. `open` is typed to take `'read'` only: a caller
 * cannot express write ownership through this interface.
 */
export interface PersistenceGateway {
  stat(id: string, options?: { signal?: AbortSignal }): Promise<SessionPersistenceSnapshot | undefined>
  open(id: string, access: 'read', options?: { signal?: AbortSignal }): Promise<SessionHandle>
}

export interface DoctorSourceGateways {
  readonly catalog?: SessionCatalogGateway
  readonly archive?: ArchiveGateway
  readonly persistence?: PersistenceGateway
  readonly activeVersions?: (sessionId: string) => readonly VersionRef[]
}

export interface DoctorCapabilities {
  readonly catalog: CapabilityProbe
  readonly archive: CapabilityProbe
  readonly persistence: CapabilityProbe
}

const missing: CapabilityProbe = { available: false, reason: 'service-unavailable' }

/** Read-only adapters from the public host services to Doctor snapshots. */
export class DoctorSource {
  private readonly gateways: DoctorSourceGateways

  constructor(gateways: DoctorSourceGateways) {
    this.gateways = gateways
  }

  /** Which read dimensions are live; a missing gateway disables only its own dimension. */
  capabilities(): DoctorCapabilities {
    return {
      catalog: this.gateways.catalog === undefined ? missing : { available: true },
      archive: this.gateways.archive === undefined ? missing : { available: true },
      persistence: this.gateways.persistence === undefined ? missing : { available: true },
    }
  }

  async exists(sessionId: string): Promise<boolean | undefined> {
    if (this.gateways.persistence === undefined) return undefined
    try { return await this.gateways.persistence.stat(sessionId) !== undefined }
    catch { return undefined }
  }

  /**
   * Freeze the business-visible candidate set for one scan. Archived sessions
   * stay in the set — archiving hides, it does not delete (AT18).
   */
  async freezeCandidates(signal?: AbortSignal): Promise<readonly CandidateSession[]> {
    if (this.gateways.catalog === undefined) return []
    const [items, archivedIds] = await Promise.all([
      this.gateways.catalog.list(signal),
      this.gateways.archive === undefined
        ? Promise.resolve([] as readonly string[])
        : this.gateways.archive.archivedSessionIds(signal),
    ])
    const archived = new Set(archivedIds)
    const candidates: CandidateSession[] = items.map((item) => ({
      sessionId: item.sessionId,
      updatedAt: item.updatedAt,
      agentAvailable: item.agentAvailable,
      archived: archived.has(item.sessionId),
      ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
      ...(item.parentSessionId === undefined ? {} : { parentSessionId: item.parentSessionId }),
    }))
    const listed = new Set(candidates.map((item) => item.sessionId))
    for (const sessionId of archivedIds) if (!listed.has(sessionId)) candidates.push({ sessionId, archived: true, agentAvailable: false })
    return candidates
  }

  /**
   * Cheap metadata peek: mode id and stored size without opening the log.
   * Lets scans filter by mode before paying for a body read.
   */
  async peek(sessionId: string, signal?: AbortSignal): Promise<{ readonly modeId?: string; readonly storedEventCount: number } | undefined> {
    const persistence = this.gateways.persistence
    if (persistence === undefined) return undefined
    try {
      const stat = await persistence.stat(sessionId, { signal })
      if (stat === undefined) return undefined
      return {
        storedEventCount: stat.eventCount ?? 0,
        ...(stat.header.agentPreset === undefined ? {} : { modeId: stat.header.agentPreset }),
      }
    } catch {
      return undefined
    }
  }

  /**
   * Read one frozen session prefix. The cutoff is fixed for the returned
   * snapshot: events at or past `cutoffSeq` are never observed, and storage
   * growth after the read only marks the snapshot partial, never mutates it
   * (AT19).
   */
  async readSnapshot(
    sessionId: string,
    options: { cutoffSeq?: number; signal?: AbortSignal } = {},
  ): Promise<SessionSnapshot> {
    const persistence = this.gateways.persistence
    if (persistence === undefined) {
      return this.unreadable(sessionId, sessionId, 'persistence-unavailable')
    }

    let stat: SessionPersistenceSnapshot | undefined
    try {
      stat = await persistence.stat(sessionId, { signal: options.signal })
    } catch (error) {
      return this.unreadable(sessionId, sessionId, `stat-failed:${(error as Error).message}`)
    }
    if (stat === undefined) return this.unreadable(sessionId, sessionId, 'not-found')

    const header = stat.header
    const originSessionId = header.parentSession ?? sessionId
    let storedEventCount = stat.eventCount
    let cutoffSeq = storedEventCount === undefined ? undefined : Math.min(options.cutoffSeq ?? storedEventCount, storedEventCount)

    let handle: SessionHandle | undefined
    try {
      handle = await persistence.open(sessionId, 'read', { signal: options.signal })
      const events: SessionEvent[] = []
      let status: ReadStatus = { kind: 'ok' }
      try {
        if (storedEventCount === undefined) {
          // JSONL stat is intentionally header-only. One public read fixes a
          // complete immutable prefix; later growth cannot extend this scan.
          const prefix = await handle.read(0, undefined, { signal: options.signal })
          storedEventCount = prefix.events.length
          cutoffSeq = Math.min(options.cutoffSeq ?? storedEventCount, storedEventCount)
          events.push(...prefix.events.slice(0, cutoffSeq))
        }
        let offset = events.length
        while (cutoffSeq !== undefined && offset < cutoffSeq) {
          const page = await handle.read(offset, Math.min(EVENT_PAGE, cutoffSeq - offset), { signal: options.signal })
          events.push(...(page.events as readonly SessionEvent[]))
          if (page.events.length === 0) break
          offset += page.events.length
        }
        if (cutoffSeq !== undefined && events.length < cutoffSeq) {
          status = { kind: 'partial', reason: 'stored-prefix-shorter-than-cutoff' }
        } else if (storedEventCount !== undefined && cutoffSeq !== undefined && storedEventCount > cutoffSeq) {
          status = { kind: 'partial', reason: 'cutoff-before-stored-end' }
        }
      } catch (error) {
        if (options.signal?.aborted === true) throw error
        const reason = `read-failed:${(error as Error).message}`
        // A failure after some prefix was read keeps the usable prefix as
        // partial; a failure with nothing read is an error snapshot.
        status = events.length > 0
          ? { kind: 'partial', reason }
          : { kind: 'error', reason }
      }

      let fold: SurfaceFoldResult | undefined
      if (events.length > 0) {
        try {
          fold = foldSurface(events)
        } catch (error) {
          // Missing message projections or violated surface invariants degrade
          // the fold dimension; events stay available for non-surface metrics.
          fold = undefined
          status = status.kind === 'ok'
            ? { kind: 'partial', reason: `fold-failed:${(error as Error).message}` }
            : status
        }
      }

      const fingerprint = fingerprintEvents(events)
      const versions: VersionRef[] = [{
        kind: 'observed-fingerprint',
        digest: fingerprint.digest,
        coverage: fingerprint.gaps.length === 0 ? 'complete-within-scope' : 'partial',
        ...(fingerprint.gaps.length === 0 ? {} : { excludedFields: fingerprint.gaps }),
      }]

      return {
        sessionId,
        originSessionId,
        createdAt: header.createdAt,
        title: events.findLast((event) => event.type === 'session/title')?.data.title,
        inheritedEventCount: handle.inheritedEventCount,
        archived: false,
        cutoffSeq: events.length,
        storedEventCount: storedEventCount ?? events.length,
        events,
        ...(fold === undefined ? {} : { fold }),
        status,
        versions: [...versions, ...(this.gateways.activeVersions?.(sessionId) ?? [])],
        ...(header.agentPreset === undefined ? {} : { modeId: header.agentPreset }),
        ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      }
    } catch (error) {
      if (options.signal?.aborted === true) throw error
      return this.unreadable(sessionId, originSessionId, `read-failed:${(error as Error).message}`)
    } finally {
      await handle?.close()
    }
  }

  private unreadable(sessionId: string, originSessionId: string, reason: string): SessionSnapshot {
    return {
      sessionId,
      originSessionId,
      createdAt: 0,
      archived: false,
      inheritedEventCount: 0,
      cutoffSeq: 0,
      storedEventCount: 0,
      events: [],
      status: { kind: 'error', reason },
      versions: [],
    }
  }
}

/** Apply the host brand at the seam for callers that need the branded id. */
export function brandedSessionId(sessionId: string): SessionId {
  return SessionId(sessionId)
}
