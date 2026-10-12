/**
 * Context Doctor data contracts shared by the Host read adapters, the pure
 * rule modules, and the Remote surface. Types only — no runtime behavior —
 * per architecture.md §12.3.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SurfaceFoldResult } from '@deepseek-ai/dsh-session/surface'

/** Which data layer one observation came from; layers never substitute for each other. */
export type EvidenceLayer =
  | 'stored-event'
  | 'reconstructed-host'
  | 'provider-reported'
  | 'local-estimate'
  | 'user-feedback'

/** How complete one source observation is; unknown never pretends to be complete. */
export type Coverage =
  | 'complete-within-scope'
  | 'partial'
  | 'unknown'

/**
 * Stable address of one analyzable fact. Seq-based identity survives list
 * reordering; blockPath locates the content inside one event's payload.
 */
export interface SourceRef {
  /** Runtime partition that produced the observation (one host process). */
  readonly runtimePartition: string
  /** Local session id the fact was read from. */
  readonly sessionId: string
  /** Fork-origin session id when the content was inherited; equals sessionId otherwise. */
  readonly originSessionId: string
  /** Event sequence number inside the local log. */
  readonly seq: number
  /** Durable message identity when the fact addresses one message. */
  readonly messageId?: string
  /** Dotted path to the content block inside the event payload. */
  readonly blockPath?: string
  /** Content hash pinning the exact observed bytes. */
  readonly contentHash?: string
  readonly layer: EvidenceLayer
}

/**
 * One observed version of a configuration or content source. The kind decides
 * what the digest covers; `coverage` says whether the digest is authoritative.
 */
export interface VersionRef {
  readonly kind: 'declaration' | 'runtime-config' | 'rendered-content' | 'skill-rendered' | 'observed-fingerprint'
  /** Content-addressed digest of everything the kind covers. */
  readonly digest: string
  /** Host schema vocabulary the digested content was read with. */
  readonly schemaVersion?: string
  readonly coverage: Coverage
  /** Present when the version was observed through a live binding. */
  readonly observedBinding?: string
  /** Fields deliberately excluded from the digest (e.g. secrets) — named, not silently dropped. */
  readonly excludedFields?: readonly string[]
  /** Other versions this observation depends on. */
  readonly dependencyRefs?: readonly string[]
}

/** Why one session read ended where it did. */
export type ReadStatus =
  | { readonly kind: 'ok' }
  | { readonly kind: 'partial'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string }

/** Frozen cross-session candidate produced by listing, before any body read. */
export interface CandidateSession {
  readonly sessionId: string
  /** Observed agent preset id for the session, when the header provides one. */
  readonly modeId?: string
  readonly cwd?: string
  readonly updatedAt?: number
  readonly parentSessionId?: string
  readonly agentAvailable: boolean
  /** Archived sessions stay in the candidate set; archiving is not deletion. */
  readonly archived: boolean
}

/**
 * Immutable snapshot of one session read up to a fixed cutoff. Later events
 * never mutate it; a newer read produces a newer snapshot with a higher
 * cutoff. (AT19: denominators stay frozen per report.)
 */
export interface SessionSnapshot {
  readonly sessionId: string
  readonly originSessionId: string
  readonly modeId?: string
  readonly title?: string
  readonly createdAt: number
  readonly cwd?: string
  readonly archived: boolean
  /** Exact fork-inherited prefix length; own events start here (fork ledger, AT17). */
  readonly inheritedEventCount: number
  /** Frozen analysis boundary: events with seq < cutoffSeq were read. */
  readonly cutoffSeq: number
  /** Total durable events advertised by storage at open time. */
  readonly storedEventCount: number
  /** Events read into the snapshot, contiguous from seq 0. */
  readonly events: readonly SessionEvent[]
  /** Surface fold over `events`; absent when folding failed (partial coverage). */
  readonly fold?: SurfaceFoldResult
  readonly status: ReadStatus
  /** Observed configuration/content versions at the cutoff. */
  readonly versions: readonly VersionRef[]
}

/** Availability of one public host capability, with the reason it is missing. */
export interface CapabilityProbe {
  readonly available: boolean
  readonly reason?: string
}

/**
 * One reproducible measurement (architecture.md §12.3). Ratios carry their
 * numerator/denominator; missing data is named, never zero-filled. Estimated
 * and observed units stay distinct.
 */
export interface MetricValue {
  /** Metric card id, e.g. `C05`. */
  readonly id: string
  /** Frozen rule implementation version. */
  readonly metricVersion: string
  /** Session id or mode-group key this value belongs to. */
  readonly scope: string
  /** Scalar value; null only when the metric cannot be computed at all. */
  readonly value: number | null
  readonly unit:
    | 'bytes'
    | 'chars'
    | 'estimated-tokens'
    | 'observed-tokens'
    | 'count'
    | 'ratio'
    | 'bytes-per-request'
    | 'estimated-tokens-per-request'
  /** Human-auditable method statement, including the measurement basis. */
  readonly method: string
  readonly numerator?: number
  readonly denominator?: number
  /** Samples meeting every precondition for this metric. */
  readonly eligibleCount?: number
  /** Samples actually observed (≤ eligible when data is missing). */
  readonly observedCount?: number
  readonly missingReasons?: readonly string[]
  readonly sourceRefs?: readonly SourceRef[]
  readonly warnings?: readonly string[]
}

/** Independent quality issue lines — never merged into an occupancy share (AT04). */
export interface IssueLine {
  readonly kind: 'user-recorded' | 'structural' | 'proxy'
  readonly text: string
  readonly evidenceRefs: readonly unknown[]
}
