/**
 * Context Doctor deterministic metrics (W2). Pure rules over one frozen
 * {@link SessionSnapshot}: no model calls, no host state, reproducible from
 * the snapshot alone (metrics.md §1). Denominators follow the frozen
 * contracts: own-interval requests only, per-structure bases, observed vs
 * eligible counts reported separately, missing data named never zero-filled.
 */
import type { Message, TokenUsage } from '@deepseek-ai/dsh-llm'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { deriveEventMessage, foldSurface, type SurfaceFoldResult } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { IssueLine, MetricValue, SessionSnapshot, SourceRef } from './contracts.ts'
import { canonicalize, contentHash } from './versions.ts'
import { METRIC_VERSION } from './rule-versions.ts'

export { METRIC_VERSION }

/** Estimated tokens: chars/4 heuristic, always labeled estimated (G1). */
export function estimateTokens(chars: number): number {
  return Math.round(chars / 4)
}

/** Exclusive purpose bucket per metrics.md §1.4. */
export type Bucket =
  | 'system'
  | 'tool-definition'
  | 'skill-catalog'
  | 'skill-body'
  | 'message'
  | 'tool-result'
  | 'reference'
  | 'unknown'

/** One text block of the reconstructed request surface. */
export interface SurfaceBlock {
  readonly seq: number
  readonly messageId?: string
  readonly role: 'system' | 'user' | 'assistant' | 'tool' | 'developer'
  readonly bucket: Bucket
  readonly text: string
  readonly bytes: number
  readonly chars: number
  readonly estTokens: number
  readonly sourceKind: string
}

/** One identifiable own-interval model request (R_s member). */
export interface RequestRecord {
  readonly index: number
  /** The assistant message whose input this request represents. */
  readonly responseSeq: number
  readonly turn: number
  readonly step: number
  /** Usage reported by the provider for this attempt; absent when not reported. */
  readonly usage?: TokenUsage
  /** Seq of the latest request/header preceding this response, when any. */
  readonly headerSeq?: number
  /** Folded immediately before this response; later replacements cannot alter it. */
  readonly inputBlocks?: readonly SurfaceBlock[]
}

export interface ToolCallRecord {
  readonly seq: number
  readonly turn: number
  readonly step: number
  readonly callId: string
  readonly name: string
  readonly argumentsRaw: string
  readonly argumentsNormalized: string
  readonly resultSeq?: number
  readonly isError?: boolean
  readonly error?: { readonly name: string; readonly code: string; readonly reason?: string }
  /** PTC sub-dispatches parented to this run_code call. */
  readonly subCalls: readonly SubCallRecord[]
}

export interface SubCallRecord {
  readonly subCallId: string
  readonly name: string
  readonly isError?: boolean
}

export interface CompactionRecord {
  readonly seq: number
  readonly shadowedSeqs: readonly number[]
  readonly beforeBytes: number
  readonly afterBytes: number
  readonly retainedBytes: number
}

export interface SkillCatalogRecord {
  readonly seq: number
  readonly entries: readonly { readonly name: string; readonly description: string }[]
}

export interface SkillLoadRecord {
  readonly seq: number
  readonly name: string
  /** Tool-load path or gesture-injection path (never mixed into one funnel, AT09). */
  readonly path: 'tool' | 'gesture'
  readonly bodyHash?: string
}

/** Normalized, reproducible view over one snapshot. */
export interface SessionView {
  readonly snapshot: SessionSnapshot
  /** Surface blocks in model-visible order (excludes tool definitions). */
  readonly blocks: readonly SurfaceBlock[]
  readonly requests: readonly RequestRecord[]
  readonly toolCalls: readonly ToolCallRecord[]
  readonly compactions: readonly CompactionRecord[]
  readonly skillCatalogs: readonly SkillCatalogRecord[]
  readonly skillLoads: readonly SkillLoadRecord[]
  /** Text of any event's derived content by seq — including shadowed nodes. */
  readonly eventText: (seq: number) => string
  /** Latest header's tool schemas with reconstructed sizes, in header order. */
  readonly toolDefinitions: readonly { readonly name: string; readonly bytes: number; readonly chars: number; readonly schemaHash: string }[]
  /** Seq positions where the observed capability fingerprint changed (C14). */
  readonly capabilityChangePoints: readonly { readonly seq: number; readonly part: string }[]
  /** True when folding failed; surface-based metrics degrade to unobservable. */
  readonly surfaceDegraded: boolean
}

function textOf(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text!)
    .join('')
}

function bytesOf(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

function bucketOf(message: Message): { bucket: Bucket; sourceKind: string } {
  const source = message.source as { readonly kind?: string; readonly name?: string }
  const kind = source.kind ?? 'unknown'
  if (message.role === 'system') return { bucket: 'system', sourceKind: kind }
  if (message.role === 'tool') {
    // The `skill` loader tool returns rendered skill bodies (A15).
    return { bucket: 'tool-result', sourceKind: kind }
  }
  if (message.role === 'user') {
    if (kind === 'skill-catalog') return { bucket: 'skill-catalog', sourceKind: kind }
    if (kind === 'skill-invocation') return { bucket: 'skill-body', sourceKind: kind }
    if (isCompactCheckpointSource(message.source)) return { bucket: 'message', sourceKind: kind }
    return { bucket: 'message', sourceKind: kind }
  }
  return { bucket: 'message', sourceKind: kind }
}

/** Structural narrowings for plugin-augmented event types (never on the surface). */
interface PtcDispatchStartData {
  readonly rootCallId: string
  readonly parentCallId: string
  readonly subCallId: string
  readonly name: string
}

interface PtcDispatchData extends PtcDispatchStartData {
  readonly isError: boolean
}

/** Minimal event read shape; lets the PTC narrowings accept augmented types safely. */
interface EventLike {
  readonly type: string
  readonly seq: number
  readonly data: unknown
}

function asPtcStart(event: EventLike): { readonly seq: number; readonly data: PtcDispatchStartData } | undefined {
  return event.type === 'tool/ptc-dispatch-start' ? event as never : undefined
}

function asPtcSettled(event: EventLike): { readonly seq: number; readonly data: PtcDispatchData } | undefined {
  return event.type === 'tool/ptc-dispatch' ? event as never : undefined
}

/** Build the normalized view. Degrades per-dimension; never throws on odd logs. */
function surfaceBlocks(snapshot: SessionSnapshot, fold: SurfaceFoldResult | undefined): SurfaceBlock[] {
  const blocks: SurfaceBlock[] = []
  if (fold !== undefined) {
    for (const seq of fold.nodes) {
      const event = snapshot.events[seq]
      if (event === undefined) continue
      const message = deriveEventMessage(event, fold.projectedMessages)
      if (message === null) continue
      const text = textOf(message.content)
      let { bucket, sourceKind } = bucketOf(message)
      if (event.type === 'tool/result' && snapshot.events.some((call) =>
        call.type === 'tool/call' && call.data.callId === event.data.message.toolCallId && call.data.name === 'skill')) {
        bucket = 'skill-body'
      }
      blocks.push({
        seq,
        messageId: message.id,
        role: message.role,
        bucket,
        text,
        bytes: bytesOf(text),
        chars: text.length,
        estTokens: estimateTokens(text.length),
        sourceKind,
      })
    }
  }
  return blocks
}

/** Build the normalized view at the cutoff and each own request boundary. */
export function buildSessionView(snapshot: SessionSnapshot): SessionView {
  const own = snapshot.events.filter((event) => event.seq >= snapshot.inheritedEventCount)
  const blocks = surfaceBlocks(snapshot, snapshot.fold)
  const surfaceDegraded = snapshot.fold === undefined

  // Latest header per position, for request reconstruction.
  const headers = snapshot.events.filter((event) => event.type === 'request/header')
  const headerSeqFor = (seq: number): number | undefined => {
    let latest: number | undefined
    for (const header of headers) {
      if (header.seq < seq && (latest === undefined || header.seq > latest)) latest = header.seq
    }
    return latest
  }
  const headerTools = new Map<number, NonNullable<SessionEvent<'request/header'>['data']['header']['tools']>>()
  for (const header of headers) {
    const tools = header.data.header.tools
    if (tools !== undefined) headerTools.set(header.seq, tools)
  }

  const requests: RequestRecord[] = []
  own.filter((event) => event.type === 'assistant/message').forEach((event, index) => {
    let inputBlocks: readonly SurfaceBlock[] | undefined
    try {
      inputBlocks = surfaceBlocks(snapshot, foldSurface(snapshot.events.filter((prior) => prior.seq < event.seq)))
    } catch {
      // The individual request's surface is not reconstructable.
    }
    const record: RequestRecord = {
      index,
      responseSeq: event.seq,
      turn: event.data.turn,
      step: event.data.step,
      headerSeq: headerSeqFor(event.seq),
      inputBlocks,
    }
    requests.push(event.data.usage === undefined ? record : { ...record, usage: event.data.usage })
  })

  const toolCalls: ToolCallRecord[] = []
  const resultsByCallId = new Map<string, SessionEvent<'tool/result'>>()
  const subCallsByParent = new Map<string, SubCallRecord[]>()
  const settledSubCalls = new Set<string>()
  for (const event of own) {
    const settled = asPtcSettled(event)
    if (settled !== undefined) {
      settledSubCalls.add(settled.data.subCallId)
      continue
    }
    const started = asPtcStart(event)
    if (started !== undefined) {
      const list = subCallsByParent.get(started.data.parentCallId) ?? []
      list.push({ subCallId: started.data.subCallId, name: started.data.name })
      subCallsByParent.set(started.data.parentCallId, list)
      continue
    }
    if (event.type === 'tool/result') resultsByCallId.set(event.data.message.toolCallId, event)
  }
  for (const event of own) {
    if (event.type !== 'tool/call') continue
    const result = resultsByCallId.get(event.data.callId)
    const subCalls = subCallsByParent.get(event.data.callId) ?? []
    let argsNormalized = event.data.arguments
    try {
      argsNormalized = canonicalize(JSON.parse(event.data.arguments))
    } catch {
      // Unparseable arguments stay raw; the metric names this as a warning basis.
    }
    const record: ToolCallRecord = {
      seq: event.seq,
      turn: event.data.turn,
      step: event.data.step,
      callId: event.data.callId,
      name: event.data.name,
      argumentsRaw: event.data.arguments,
      argumentsNormalized: argsNormalized,
      subCalls,
    }
    toolCalls.push(result === undefined ? record : {
      ...record,
      resultSeq: result.seq,
      isError: result.data.message.isError,
      ...(result.data.error === undefined ? {} : { error: result.data.error }),
    })
  }

  // Compaction before/after sizes (C12): sizes are measured from the events
  // themselves — shadowed nodes are gone from the FINAL surface, so reading
  // blocks would under-report `before` as zero.
  const textOfEventSeq = (seq: number): string => {
    const event = snapshot.events[seq]
    if (event === undefined) return ''
    if (event.type === 'user/message' || event.type === 'system/message' || event.type === 'assistant/message') {
      const message = deriveEventMessage(event, snapshot.fold?.projectedMessages)
      return message === null ? '' : textOf(message.content)
    }
    if (event.type === 'tool/result') return textOf(event.data.message.content)
    return ''
  }
  const compactions: CompactionRecord[] = []
  if (snapshot.fold !== undefined) {
    for (const replacement of snapshot.fold.replacements) {
      const beforeBytes = replacement.shadowedSeqs.reduce((total, seq) => total + bytesOf(textOfEventSeq(seq)), 0)
      const afterBytes = bytesOf(textOfEventSeq(replacement.seq))
      const replacedEnd = Math.max(...replacement.shadowedSeqs)
      // Retained suffix: final-surface nodes positioned after the replacement
      // node itself — the summary node is the `after`, never part of "retained".
      const replacementIndex = snapshot.fold.nodes.indexOf(replacement.seq)
      const retainedBytes = snapshot.fold.nodes
        .slice(replacementIndex + 1)
        .reduce((total, seq) => total + bytesOf(textOfEventSeq(seq)), 0)
      compactions.push({
        seq: replacement.seq,
        shadowedSeqs: [...replacement.shadowedSeqs],
        beforeBytes,
        afterBytes,
        retainedBytes,
      })
    }
  }

  const skillCatalogs: SkillCatalogRecord[] = []
  const skillLoads: SkillLoadRecord[] = []
  for (const block of blocks) {
    if (block.bucket === 'skill-catalog') {
      const event = snapshot.events[block.seq] as SessionEvent<'user/message'>
      const source = event.data.source as { readonly kind?: string; readonly entries?: readonly { readonly name: string; readonly description: string }[] }
      skillCatalogs.push({ seq: block.seq, entries: source.entries ?? [] })
    }
    if (block.bucket === 'skill-body' && block.role === 'user') {
      const event = snapshot.events[block.seq] as SessionEvent<'user/message'>
      const source = event.data.source as { readonly kind?: string; readonly name?: string }
      if (source.kind === 'skill-invocation') {
        skillLoads.push({ seq: block.seq, name: source.name ?? 'unknown', path: 'gesture', bodyHash: contentHash(block.text) })
      }
    }
  }
  for (const call of toolCalls) {
    if (call.name !== 'skill') continue
    let name = 'unknown'
    try {
      name = (JSON.parse(call.argumentsRaw) as { name?: string }).name ?? 'unknown'
    } catch {
      // raw fallback
    }
    const resultText = call.resultSeq === undefined ? '' : textOfEventSeq(call.resultSeq)
    skillLoads.push({
      seq: call.seq,
      name,
      path: 'tool',
      ...(resultText.length === 0 ? {} : { bodyHash: contentHash(resultText) }),
    })
  }

  // Tool definitions from the latest header within the cutoff (C02 bucket, T07).
  const lastHeaderWithTools = [...headerTools.entries()].sort((left, right) => left[0] - right[0]).at(-1)
  const toolDefinitions = (lastHeaderWithTools?.[1] ?? []).map((tool) => {
    const canonical = canonicalize(tool)
    return {
      name: tool.name,
      bytes: bytesOf(canonical),
      chars: canonical.length,
      schemaHash: contentHash(canonical),
    }
  })

  // Capability change points (C14): positions where a fingerprint part changes.
  const capabilityChangePoints: { seq: number; part: string }[] = []
  const seenToolHash = new Map<string, number>()
  const seenCatalogHash = new Map<string, number>()
  for (const header of headers) {
    const tools = header.data.header.tools
    if (tools === undefined) continue
    const hash = contentHash(tools.map((tool) => canonicalize(tool)).join('\n'))
    const first = seenToolHash.get(hash)
    if (first === undefined) {
      if (seenToolHash.size > 0) capabilityChangePoints.push({ seq: header.seq, part: 'tool-definitions' })
      seenToolHash.set(hash, header.seq)
    }
  }
  for (const catalog of skillCatalogs) {
    const hash = contentHash(canonicalize(catalog.entries))
    const first = seenCatalogHash.get(hash)
    if (first === undefined) {
      if (seenCatalogHash.size > 0) capabilityChangePoints.push({ seq: catalog.seq, part: 'skill-catalog' })
      seenCatalogHash.set(hash, catalog.seq)
    }
  }

  return {
    snapshot,
    blocks,
    requests,
    toolCalls,
    compactions,
    skillCatalogs,
    skillLoads,
    toolDefinitions,
    capabilityChangePoints,
    surfaceDegraded,
    eventText: textOfEventSeq,
  }
}

// ---------------------------------------------------------------------------
// Metric computations
// ---------------------------------------------------------------------------

function ref(snapshot: SessionSnapshot, seq: number, extra: Partial<SourceRef> = {}): SourceRef {
  return {
    runtimePartition: 'local',
    sessionId: snapshot.sessionId,
    originSessionId: snapshot.originSessionId,
    seq,
    layer: 'reconstructed-host',
    ...extra,
  }
}

/** The reconstructed input for request r: surface nodes up to its response. */
function requestInputBlocks(view: SessionView, request: RequestRecord): readonly SurfaceBlock[] {
  return request.inputBlocks ?? []
}

/** C01: observed usage buckets per request plus reported totals. */
function c01ObservedUsage(view: SessionView): MetricValue {
  const withUsage = view.requests.filter((request) => request.usage !== undefined)
  const totals = withUsage.reduce((acc, request) => {
    const usage = request.usage!
    return {
      uncached: acc.uncached + usage.inputTokens,
      cacheRead: acc.cacheRead + (usage.cacheReadTokens ?? 0),
      cacheWrite: acc.cacheWrite + (usage.cacheWriteTokens ?? 0),
      output: acc.output + usage.outputTokens,
    }
  }, { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 })

  return {
    id: 'C01',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: totals.uncached + totals.cacheRead + totals.cacheWrite,
    unit: 'observed-tokens',
    method: 'Σ observed usage buckets over own-interval requests with provider-reported usage; output reported separately, never in input denominators. input-total = uncachedInput + cacheRead + cacheWrite.',
    numerator: totals.uncached + totals.cacheRead + totals.cacheWrite,
    eligibleCount: view.requests.length,
    observedCount: withUsage.length,
    missingReasons: withUsage.length < view.requests.length ? ['usage-not-reported'] : [],
    warnings: ['reported-subtotal-not-full-ledger'],
  }
}

/** C02: composition of the effective surface at the frozen boundary, plus its latest tool definitions. */
function c02Composition(view: SessionView): { values: MetricValue[]; buckets: { bucket: Bucket; bytes: number; chars: number; estTokens: number }[] } {
  const input = view.blocks
  const byBucket = new Map<Bucket, { bytes: number; chars: number; estTokens: number }>()
  for (const block of input) {
    const entry = byBucket.get(block.bucket) ?? { bytes: 0, chars: 0, estTokens: 0 }
    byBucket.set(block.bucket, { bytes: entry.bytes + block.bytes, chars: entry.chars + block.chars, estTokens: entry.estTokens + block.estTokens })
  }
  for (const definition of view.toolDefinitions) {
    const entry = byBucket.get('tool-definition') ?? { bytes: 0, chars: 0, estTokens: 0 }
    const chars = definition.chars
    byBucket.set('tool-definition', {
      bytes: entry.bytes + definition.bytes,
      chars: entry.chars + chars,
      estTokens: entry.estTokens + estimateTokens(chars),
    })
  }
  const total = [...byBucket.values()].reduce((sum, entry) => sum + entry.bytes, 0)
  const buckets = [...byBucket.entries()]
    .map(([bucket, sizes]) => ({ bucket, ...sizes }))
    .sort((left, right) => right.bytes - left.bytes)

  const values: MetricValue[] = buckets.map((entry) => ({
    id: 'C02',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: entry.bytes,
    unit: 'bytes',
    method: `Exclusive bucket '${entry.bucket}' share at the frozen effective-surface boundary; reconstructed text and tool schemas, not final provider wire bytes.`,
    numerator: entry.bytes,
    denominator: total,
    eligibleCount: view.surfaceDegraded ? 0 : 1,
    observedCount: view.surfaceDegraded ? 0 : 1,
    missingReasons: view.surfaceDegraded ? ['surface-fold-unavailable'] : [],
  }))
  return { values, buckets }
}

/** C05: exact duplicate extra copies within the latest request input (AT01). */
function c05ExactDuplicateExtra(view: SessionView): MetricValue {
  const lastRequest = view.requests.at(-1)
  const input = lastRequest === undefined ? view.blocks : requestInputBlocks(view, lastRequest)
  const clusters = new Map<string, number>()
  for (const block of input) {
    if (block.text.length === 0) continue
    clusters.set(block.text, (clusters.get(block.text) ?? 0) + 1)
  }
  let extraBytes = 0
  let extraByBucket = new Map<Bucket, number>()
  const seenInCluster = new Map<string, number>()
  for (const block of input) {
    if (block.text.length === 0) continue
    const seen = seenInCluster.get(block.text) ?? 0
    seenInCluster.set(block.text, seen + 1)
    const cluster = clusters.get(block.text)!
    if (seen > 0 && cluster > 1) {
      extraBytes += block.bytes
      extraByBucket.set(block.bucket, (extraByBucket.get(block.bucket) ?? 0) + block.bytes)
    }
  }
  const total = input.reduce((sum, block) => sum + block.bytes, 0)
  void clusters

  return {
    id: 'C05',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: total === 0 ? null : extraBytes / total,
    unit: 'ratio',
    method: 'Extra exact-copy bytes (2nd+ identical-text instance) over the latest reconstructed request input; earliest instance retained as representative; presence of duplicates, not a quality verdict.',
    numerator: extraBytes,
    denominator: total,
    eligibleCount: view.surfaceDegraded ? 0 : 1,
    observedCount: view.surfaceDegraded ? 0 : 1,
    missingReasons: view.surfaceDegraded ? ['surface-fold-unavailable'] : [],
    sourceRefs: [...extraByBucket.entries()].map(([, bytes]) => ref(view.snapshot, 0, { contentHash: `extra:${bytes}` })),
  }
}

/** C08: cache-read share over observed input-total (E/E basis, §1.1). */
function c08CacheReadRatio(view: SessionView): MetricValue {
  const withUsage = view.requests.filter((request) => request.usage !== undefined)
  const cacheRead = withUsage.reduce((sum, request) => sum + (request.usage!.cacheReadTokens ?? 0), 0)
  const inputTotal = withUsage.reduce((sum, request) => sum
    + request.usage!.inputTokens
    + (request.usage!.cacheReadTokens ?? 0)
    + (request.usage!.cacheWriteTokens ?? 0), 0)
  return {
    id: 'C08',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: inputTotal === 0 ? null : cacheRead / inputTotal,
    unit: 'ratio',
    method: 'Σ observed cacheRead / Σ same-batch observed (uncachedInput + cacheRead + cacheWrite); zero denominator reported as no_samples, never 0%.',
    numerator: cacheRead,
    denominator: inputTotal,
    eligibleCount: view.requests.length,
    observedCount: withUsage.length,
    missingReasons: [
      ...(withUsage.length < view.requests.length ? ['usage-not-reported'] : []),
      ...(inputTotal === 0 && withUsage.length > 0 ? ['no-samples'] : []),
    ],
  }
}

/** C03: added/removed block bytes between adjacent comparable requests. */
function c03AddRemove(view: SessionView): MetricValue {
  const comparable = view.requests.filter((request) => request.inputBlocks !== undefined)
  if (comparable.length < 2) {
    return {
      id: 'C03',
      metricVersion: METRIC_VERSION,
      scope: view.snapshot.sessionId,
      value: null,
      unit: 'bytes',
      method: 'Set difference of block instances (seq+contentHash) between adjacent own-interval requests; content edits count as remove+add.',
      eligibleCount: 0,
      observedCount: 0,
      missingReasons: ['insufficient-comparable-requests'],
    }
  }
  let added = 0
  let removed = 0
  for (let index = 1; index < comparable.length; index += 1) {
    const prev = new Set(requestInputBlocks(view, comparable[index - 1]!).map((block) => `${block.seq}:${contentHash(block.text)}`))
    const next = new Set(requestInputBlocks(view, comparable[index]!).map((block) => `${block.seq}:${contentHash(block.text)}`))
    for (const block of requestInputBlocks(view, comparable[index]!)) {
      if (!prev.has(`${block.seq}:${contentHash(block.text)}`)) added += block.bytes
    }
    for (const block of requestInputBlocks(view, comparable[index - 1]!)) {
      if (!next.has(`${block.seq}:${contentHash(block.text)}`)) removed += block.bytes
    }
  }
  return {
    id: 'C03',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: added - removed,
    unit: 'bytes',
    method: 'Net block-instance byte change across adjacent own-interval requests; positive = growth. Lineage preserved: edited content is remove+add.',
    numerator: added,
    denominator: removed,
    eligibleCount: comparable.length - 1,
    observedCount: comparable.length - 1,
  }
}

/** C04: cumulative carry of every block instance across the requests that include it. */
function c04CumulativeCarry(view: SessionView): MetricValue {
  let carry = 0
  for (const request of view.requests) {
    carry += requestInputBlocks(view, request).reduce((sum, block) => sum + block.bytes, 0)
  }
  return {
    id: 'C04',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: carry,
    unit: 'bytes-per-request',
    method: 'Σ_r Σ_block∈input(r) bytes — long-horizon burden ledger, not a waste verdict; inherited content counts when re-carried by own requests.',
    eligibleCount: view.requests.length,
    observedCount: view.requests.filter((request) => request.inputBlocks !== undefined).length,
    missingReasons: view.requests.some((request) => request.inputBlocks === undefined) ? ['request-surface-unavailable'] : [],
  }
}

/** C06: repeated tool-result production (same result text hash from distinct calls). */
function c06RepeatedToolResults(view: SessionView): MetricValue {
  const byHash = new Map<string, number>()
  for (const call of view.toolCalls) {
    if (call.resultSeq === undefined) continue
    const text = view.eventText(call.resultSeq)
    if (text.length === 0) continue
    byHash.set(contentHash(text), (byHash.get(contentHash(text)) ?? 0) + 1)
  }
  const repeatProductions = [...byHash.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const producedResults = view.toolCalls.filter((call) => call.resultSeq !== undefined).length
  return {
    id: 'C06',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: repeatProductions,
    unit: 'count',
    method: 'Distinct calls producing byte-identical result text; content equality only — same output does not imply a useless re-confirmation.',
    numerator: repeatProductions,
    denominator: producedResults,
    eligibleCount: view.toolCalls.length,
    observedCount: producedResults,
    missingReasons: view.toolCalls.some((call) => call.resultSeq === undefined) ? ['pending-results-at-cutoff'] : [],
    warnings: producedResults === 0 ? ['no-result-content-observed'] : [],
  }
}

/** C10: tool call pairing state within the own interval. */
function c10ToolPairing(view: SessionView): MetricValue {
  const calls = view.toolCalls
  const paired = calls.filter((call) => call.resultSeq !== undefined).length
  const callIds = new Set(calls.map((call) => call.callId))
  const orphanResults = view.snapshot.events.filter((event) =>
    event.seq >= view.snapshot.inheritedEventCount
    && event.type === 'tool/result'
    && !callIds.has(event.data.message.toolCallId)).length
  const duplicateResults = orphanResults
  return {
    id: 'C10',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: calls.length === 0 ? null : paired / calls.length,
    unit: 'ratio',
    method: 'Own-interval tool/call events with exactly one tool/result by callId, over all own-interval calls; pending at cutoff excluded from the numerator, listed separately.',
    numerator: paired,
    denominator: calls.length,
    eligibleCount: calls.length,
    observedCount: calls.length,
    missingReasons: calls.length === 0 ? ['no-samples'] : [],
    warnings: [
      ...(calls.some((call) => call.resultSeq === undefined) ? ['pending-at-cutoff'] : []),
      ...(duplicateResults > 0 ? [`orphan-results:${duplicateResults}`] : []),
    ],
  }
}

/** C12: compaction before/after byte change with retained suffix listed apart. */
function c12CompactionChange(view: SessionView): MetricValue {
  const totalBefore = view.compactions.reduce((sum, record) => sum + record.beforeBytes, 0)
  const totalAfter = view.compactions.reduce((sum, record) => sum + record.afterBytes, 0)
  return {
    id: 'C12',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: totalBefore === 0 ? null : 1 - totalAfter / totalBefore,
    unit: 'ratio',
    method: '1 − (replacement bytes / shadowed bytes) over fold replacements; retained suffix is not counted as reduction; a size change is not a lossless-quality proof.',
    numerator: totalBefore - totalAfter,
    denominator: totalBefore,
    eligibleCount: view.compactions.length,
    observedCount: view.compactions.length,
    missingReasons: view.compactions.length === 0 ? ['no-samples'] : [],
  }
}

/** C14: capability change positions (mode/capability changes with locations). */
function c14CapabilityChanges(view: SessionView): MetricValue {
  return {
    id: 'C14',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: view.capabilityChangePoints.length,
    unit: 'count',
    method: 'Positions where the observed tool-definition or skill-catalog fingerprint changed; a change is a grouping signal, never a degradation verdict.',
    eligibleCount: 1,
    observedCount: 1,
    sourceRefs: view.capabilityChangePoints.map((point) => ref(view.snapshot, point.seq, { blockPath: point.part })),
  }
}

// ---- Tool metrics ----

/** T01: requests with observable tool exposure over own-interval requests. */
function t01ToolExposure(view: SessionView): MetricValue {
  const withHeader = view.requests.filter((request) => request.headerSeq !== undefined)
  const withTools = withHeader.filter((request) => {
    const tools = view.requests && headerToolsFor(view, request.headerSeq!)
    return tools !== undefined && tools.length > 0
  })
  return {
    id: 'T01',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: withHeader.length === 0 ? null : withTools.length / withHeader.length,
    unit: 'ratio',
    method: 'Own-interval requests whose latest preceding request/header carried tool schemas, over requests with any observable header; header count is not a request count.',
    numerator: withTools.length,
    denominator: withHeader.length,
    eligibleCount: view.requests.length,
    observedCount: withHeader.length,
    missingReasons: [
      ...(withHeader.length < view.requests.length ? ['request-header-missing'] : []),
      ...(withHeader.length === 0 ? ['no-samples'] : []),
    ],
  }
}

function headerToolsFor(view: SessionView, headerSeq: number) {
  const event = view.snapshot.events[headerSeq]
  return event !== undefined && event.type === 'request/header' ? event.data.header.tools : undefined
}

/** T02: per-session tool usage coverage (exposed ⇒ called in own interval). */
function t02ToolUsage(view: SessionView): { values: MetricValue[]; perTool: { name: string; exposed: boolean; called: boolean }[] } {
  const exposedNames = new Set(view.toolDefinitions.map((definition) => definition.name))
  const calledNames = new Set(view.toolCalls.map((call) => call.name))
  const perTool = [...exposedNames].map((name) => ({ name, exposed: true, called: calledNames.has(name) }))
  for (const name of calledNames) {
    if (!exposedNames.has(name)) perTool.push({ name, exposed: false, called: true })
  }
  const exposed = perTool.filter((tool) => tool.exposed)
  const used = exposed.filter((tool) => tool.called)
  return {
    perTool,
    values: [{
      id: 'T02',
      metricVersion: METRIC_VERSION,
      scope: view.snapshot.sessionId,
      value: exposed.length === 0 ? null : used.length / exposed.length,
      unit: 'ratio',
      method: 'Exposed tools with ≥1 own-interval call over exposed tools; visibility is the denominator, actual need is unknown and not inferred.',
      numerator: used.length,
      denominator: exposed.length,
      eligibleCount: exposed.length,
      observedCount: exposed.length,
      missingReasons: exposed.length === 0 ? ['no-samples'] : [],
    }],
  }
}

/** T03: per-tool call share over all own-interval calls (entry and subcall separated). */
function t03CallShare(view: SessionView): { name: string; share: number | null; calls: number }[] {
  const nativeCalls = view.toolCalls
  const total = nativeCalls.length
  const byName = new Map<string, number>()
  for (const call of nativeCalls) byName.set(call.name, (byName.get(call.name) ?? 0) + 1)
  return [...byName.entries()].map(([name, calls]) => ({
    name,
    calls,
    share: total === 0 ? null : calls / total,
  }))
}

/** T04: per-tool terminal status distribution; structured error vs unknown separated. */
function t04StatusDistribution(view: SessionView): { name: string; success: number; error: number; unknown: number; pending: number }[] {
  const byName = new Map<string, { success: number; error: number; unknown: number; pending: number }>()
  for (const call of view.toolCalls) {
    const entry = byName.get(call.name) ?? { success: 0, error: 0, unknown: 0, pending: 0 }
    if (call.resultSeq === undefined) entry.pending += 1
    else if (call.isError === true) entry.error += 1
    else if (call.isError === false) entry.success += 1
    else entry.unknown += 1
    byName.set(call.name, entry)
  }
  return [...byName.entries()].map(([name, counts]) => ({ name, ...counts }))
}

/** T05: same-tool same-args repeat candidates within one user turn. */
function t05RepeatArgs(view: SessionView): { name: string; repeats: number; total: number }[] {
  const byTurn = new Map<number, ToolCallRecord[]>()
  for (const call of view.toolCalls) {
    const list = byTurn.get(call.turn) ?? []
    list.push(call)
    byTurn.set(call.turn, list)
  }
  const byName = new Map<string, { repeats: number; total: number }>()
  for (const calls of byTurn.values()) {
    const seen = new Map<string, number>()
    for (const call of calls.sort((left, right) => left.seq - right.seq)) {
      const key = `${call.name}::${call.argumentsNormalized}`
      const count = seen.get(key) ?? 0
      seen.set(key, count + 1)
      const entry = byName.get(call.name) ?? { repeats: 0, total: 0 }
      byName.set(call.name, { repeats: entry.repeats + (count > 0 ? 1 : 0), total: entry.total + 1 })
    }
  }
  return [...byName.entries()].map(([name, counts]) => ({ name, ...counts }))
}

/** T07: per-tool definition burden plus result burden, listed separately. */
function t07ToolBurden(view: SessionView): { name: string; definitionBytes: number; definitionChars?: number; resultBytes: number; carryRequests: number }[] {
  const resultBytesByName = new Map<string, number>()
  for (const call of view.toolCalls) {
    if (call.resultSeq === undefined) continue
    const text = view.eventText(call.resultSeq)
    if (text.length === 0) continue
    resultBytesByName.set(call.name, (resultBytesByName.get(call.name) ?? 0) + bytesOf(text))
  }
  const rows: { name: string; definitionBytes: number; definitionChars?: number; resultBytes: number; carryRequests: number }[] = view.toolDefinitions.map((definition) => ({
    name: definition.name,
    definitionBytes: definition.bytes,
    definitionChars: definition.chars,
    resultBytes: resultBytesByName.get(definition.name) ?? 0,
    carryRequests: view.requests.length,
  }))
  for (const [name, resultBytes] of resultBytesByName) {
    if (!rows.some((row) => row.name === name)) rows.push({ name, definitionBytes: 0, resultBytes, carryRequests: view.requests.length })
  }
  return rows
}

/** T08 (facts only): run_code entry calls and PTC sub-call totals (AT08). */
function t08PtcFacts(view: SessionView): MetricValue {
  const entryCalls = view.toolCalls.filter((call) => call.name === 'run_code')
  const subCalls = entryCalls.reduce((sum, call) => sum + call.subCalls.length, 0)
  return {
    id: 'T08',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: subCalls,
    unit: 'count',
    method: 'Absolute counts: run_code entry calls and their PTC SDK sub-dispatches. SDK exposure coverage stays unobservable without a parsed SDK manifest; sub-call share uses subCalls as its own denominator (8/12, never 8/15).',
    numerator: subCalls,
    denominator: entryCalls.length,
    eligibleCount: entryCalls.length,
    observedCount: entryCalls.length,
    missingReasons: entryCalls.length === 0 ? ['no-samples'] : ['sdk-exposure-unparsed'],
  }
}

// ---- Skill metrics ----

/** S01: visible catalog observations on the surface. */
function s01SkillCatalog(view: SessionView): MetricValue {
  const latest = view.skillCatalogs.at(-1)
  return {
    id: 'S01',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: latest?.entries.length ?? null,
    unit: 'count',
    method: 'Latest skill-catalog snapshot still on the effective surface; catalog metadata is not proof of loaded body versions.',
    eligibleCount: view.skillCatalogs.length,
    observedCount: view.skillCatalogs.length,
    missingReasons: view.skillCatalogs.length === 0 ? ['no-samples'] : [],
  }
}

/** S02: skill loads by path — tool loads and gesture injections stay separate (AT09). */
function s02SkillLoads(view: SessionView): { values: MetricValue[]; byPath: { path: 'tool' | 'gesture'; loads: number }[] } {
  const tool = view.skillLoads.filter((load) => load.path === 'tool').length
  const gesture = view.skillLoads.filter((load) => load.path === 'gesture').length
  return {
    byPath: [{ path: 'tool', loads: tool }, { path: 'gesture', loads: gesture }],
    values: [
      {
        id: 'S02',
        metricVersion: METRIC_VERSION,
        scope: view.snapshot.sessionId,
        value: tool + gesture,
        unit: 'count',
        method: 'Skill body loads via the `skill` tool plus user-gesture injections, counted separately — a gesture never passed catalog exposure and is not forced into that funnel.',
        numerator: tool + gesture,
        denominator: view.skillCatalogs.length,
        eligibleCount: view.skillCatalogs.length,
        observedCount: view.skillCatalogs.length,
        missingReasons: view.skillCatalogs.length === 0 ? ['catalog-unobserved'] : [],
      },
    ],
  }
}

/** S03: reloads of identical rendered bodies while still resident (AT10). */
function s03SkillReloads(view: SessionView): MetricValue {
  let resident = new Set<string>()
  let reloads = 0
  let judgeable = 0
  const sorted = [...view.skillLoads].sort((left, right) => left.seq - right.seq)
  const compactionSeqs = [...view.compactions.map((record) => record.seq)].sort((left, right) => left - right)
  let previousSeq = -1
  for (const load of sorted) {
    // A compaction between loads evicts resident bodies: what comes back is a
    // new residency, never a reload.
    while (compactionSeqs.length > 0 && compactionSeqs[0]! > previousSeq && compactionSeqs[0]! < load.seq) {
      resident = new Set()
      compactionSeqs.shift()
    }
    previousSeq = load.seq
    if (load.bodyHash === undefined) continue
    judgeable += 1
    if (resident.has(load.bodyHash)) reloads += 1
    resident.add(load.bodyHash)
  }
  return {
    id: 'S03',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: judgeable === 0 ? null : reloads / judgeable,
    unit: 'ratio',
    method: 'Identical rendered-body hash loaded again while resident; reloads after compaction removal are a new residency, not a reload; rendered bodies with parameters are content instances, not source-file versions.',
    numerator: reloads,
    denominator: judgeable,
    eligibleCount: sorted.length,
    observedCount: judgeable,
    missingReasons: judgeable < sorted.length ? ['body-hash-unavailable'] : [],
  }
}

/** S04: skill-body bytes, carry request count, and catalog bytes. */
function s04SkillBurden(view: SessionView): MetricValue {
  const bodyBytes = view.blocks
    .filter((block) => block.bucket === 'skill-body')
    .reduce((sum, block) => sum + block.bytes, 0)
  const catalogBytes = view.blocks
    .filter((block) => block.bucket === 'skill-catalog')
    .reduce((sum, block) => sum + block.bytes, 0)
  return {
    id: 'S04',
    metricVersion: METRIC_VERSION,
    scope: view.snapshot.sessionId,
    value: bodyBytes + catalogBytes,
    unit: 'bytes',
    method: 'Current skill-body plus skill-catalog bytes on the reconstructed surface; skill text works without re-calling — this is a burden ledger, not a waste rate.',
    numerator: bodyBytes,
    denominator: catalogBytes,
    eligibleCount: view.surfaceDegraded ? 0 : 1,
    observedCount: view.surfaceDegraded ? 0 : 1,
    missingReasons: view.surfaceDegraded ? ['surface-fold-unavailable'] : [],
  }
}

// ---- MCP metrics ----

/** Attribute a tool name to its MCP server only when unambiguous (A19). */
export function attributeMcpServer(toolName: string): string | undefined {
  if (!toolName.startsWith('mcp__')) return undefined
  const segments = toolName.split('__')
  if (segments.length < 3) return undefined
  const server = segments[1]!
  return server.length > 0 ? server : undefined
}

/** M01: configured components observable from the latest header. */
function m01Components(view: SessionView): { values: MetricValue[]; components: { name: string; kind: 'native' | 'mcp' | 'unknown'; server?: string }[] } {
  const components = view.toolDefinitions.map((definition) => {
    const server = attributeMcpServer(definition.name)
    return server === undefined
      ? { name: definition.name, kind: 'native' as const }
      : { name: definition.name, kind: 'mcp' as const, server }
  })
  const unresolved = view.toolCalls.filter((call) =>
    call.name.startsWith('mcp__') && attributeMcpServer(call.name) === undefined).length
  return {
    components,
    values: [{
      id: 'M01',
      metricVersion: METRIC_VERSION,
      scope: view.snapshot.sessionId,
      value: components.length,
      unit: 'count',
      method: 'Components visible through the latest request header; the historical header is not the current composition inventory; unresolved MCP names stay unresolved, never assigned.',
      eligibleCount: 1,
      observedCount: 1,
      warnings: unresolved > 0 ? [`unresolved-mcp-names:${unresolved}`] : [],
    }],
  }
}

/** M03: reachability evidence classes per attributable MCP server (no probing). */
function m03McpReachability(view: SessionView): { server: string; success: number; recordedFailure: number; unobserved: boolean }[] {
  const byServer = new Map<string, { success: number; recordedFailure: number }>()
  for (const call of view.toolCalls) {
    const server = attributeMcpServer(call.name)
    if (server === undefined) continue
    const entry = byServer.get(server) ?? { success: 0, recordedFailure: 0 }
    if (call.resultSeq === undefined) {
      // pending: no reachability evidence either way
    } else if (call.isError === true) entry.recordedFailure += 1
    else if (call.isError === false) entry.success += 1
    byServer.set(server, entry)
  }
  return [...byServer.entries()].map(([server, counts]) => ({
    server,
    ...counts,
    unobserved: counts.success === 0 && counts.recordedFailure === 0,
  }))
}

// ---- Weighting (metrics.md §3.1) ----

export interface IssueContributionInput {
  /** Total bytes per exclusive bucket for one reconstructed input. */
  readonly bucketBytes: Readonly<Partial<Record<Bucket, number>>>
  /** Bytes involved in issue j per bucket; overlapping intervals must be unioned by the caller. */
  readonly issueBytesByBucket: Readonly<Partial<Record<Bucket, number>>>
}

/**
 * I_j = Σ_k (Wk/ΣW) × (Dkj/Wk) = Σ_k Dkj / Σ_k Wk. The share of the input
 * volume involved in issue j — not an error probability, not a safe-to-delete
 * amount (metrics.md §3.1).
 */
export function issueContribution(input: IssueContributionInput): number | null {
  const total = Object.values(input.bucketBytes).reduce((sum, value) => sum + (value ?? 0), 0)
  if (total === 0) return null
  const involved = Object.values(input.issueBytesByBucket).reduce((sum, value) => sum + (value ?? 0), 0)
  return involved / total
}

export interface CompositionMetrics {
  readonly observedUsage: MetricValue
  readonly compositionShares: readonly MetricValue[]
  readonly exactDuplicates: MetricValue
  readonly repeatedToolResults: MetricValue
  readonly buckets: readonly { readonly bucket: Bucket; readonly bytes: number; readonly chars: number; readonly estTokens: number }[]
}

export interface ToolsMetrics {
  readonly exposure: MetricValue
  readonly usageRatio: MetricValue
  readonly pairing: MetricValue
  readonly ptcFacts: MetricValue
  readonly perTool: readonly { readonly name: string; readonly exposed: boolean; readonly called: boolean }[]
  readonly callShare: readonly { readonly name: string; readonly share: number | null; readonly calls: number }[]
  readonly status: readonly { readonly name: string; readonly success: number; readonly error: number; readonly unknown: number; readonly pending: number }[]
  readonly repeatArgs: readonly { readonly name: string; readonly repeats: number; readonly total: number }[]
  readonly toolBurden: readonly { readonly name: string; readonly definitionBytes: number; readonly definitionChars?: number; readonly resultBytes: number; readonly carryRequests: number }[]
}

export interface ExtensionsMetrics {
  readonly skillCatalog: MetricValue
  readonly skillLoads: MetricValue
  readonly skillReloads: MetricValue
  readonly skillBurden: MetricValue
  readonly mcpComponents: MetricValue
  readonly skillLoadsByPath: readonly { readonly path: 'tool' | 'gesture'; readonly loads: number }[]
  readonly components: readonly { readonly name: string; readonly kind: 'native' | 'mcp' | 'unknown'; readonly server?: string }[]
  readonly mcpReachability: readonly { readonly server: string; readonly success: number; readonly recordedFailure: number; readonly unobserved: boolean }[]
}

export interface CarryingMetrics {
  readonly addRemove: MetricValue
  readonly cumulativeCarry: MetricValue
  readonly cacheReadRatio: MetricValue
  readonly compactionChange: MetricValue
  readonly capabilityChanges: MetricValue
}

/** Structured deterministic diagnostics for one snapshot per DSH context structures. */
export interface SessionMetrics {
  readonly composition: CompositionMetrics
  readonly tools: ToolsMetrics
  readonly extensions: ExtensionsMetrics
  readonly carrying: CarryingMetrics
  readonly issues: readonly IssueLine[]
}

/** Collect every leaf MetricValue for auditability and computability testing. */
export function allMetricValues(metrics: SessionMetrics): readonly MetricValue[] {
  return [
    metrics.composition.observedUsage,
    ...metrics.composition.compositionShares,
    metrics.composition.exactDuplicates,
    metrics.composition.repeatedToolResults,
    metrics.tools.exposure,
    metrics.tools.usageRatio,
    metrics.tools.pairing,
    metrics.tools.ptcFacts,
    metrics.extensions.skillCatalog,
    metrics.extensions.skillLoads,
    metrics.extensions.skillReloads,
    metrics.extensions.skillBurden,
    metrics.extensions.mcpComponents,
    metrics.carrying.addRemove,
    metrics.carrying.cumulativeCarry,
    metrics.carrying.cacheReadRatio,
    metrics.carrying.compactionChange,
    metrics.carrying.capabilityChanges,
  ]
}

/** Compute the full deterministic metric set for one snapshot. */
export function computeSessionMetrics(view: SessionView): SessionMetrics {
  const c01 = c01ObservedUsage(view)
  const c02 = c02Composition(view)
  const c03 = c03AddRemove(view)
  const c04 = c04CumulativeCarry(view)
  const c05 = c05ExactDuplicateExtra(view)
  const c06 = c06RepeatedToolResults(view)
  const c08 = c08CacheReadRatio(view)
  const c10 = c10ToolPairing(view)
  const c12 = c12CompactionChange(view)
  const c14 = c14CapabilityChanges(view)
  const t01 = t01ToolExposure(view)
  const t02 = t02ToolUsage(view)
  const t03 = t03CallShare(view)
  const t04 = t04StatusDistribution(view)
  const t05 = t05RepeatArgs(view)
  const t07 = t07ToolBurden(view)
  const t08 = t08PtcFacts(view)
  const s01 = s01SkillCatalog(view)
  const s02 = s02SkillLoads(view)
  const s03 = s03SkillReloads(view)
  const s04 = s04SkillBurden(view)
  const m01 = m01Components(view)
  const m03 = m03McpReachability(view)

  const issues: IssueLine[] = []
  if (c10.warnings?.some((warning) => warning.startsWith('orphan-results:'))) {
    issues.push({ kind: 'structural', text: '存在未配对的工具结果', evidenceRefs: [] })
  }
  if ((c05.numerator ?? 0) > 0) {
    issues.push({
      kind: 'proxy',
      text: `额外精确副本 ${c05.numerator} bytes（占 ${((c05.value ?? 0) * 100).toFixed(1)}%）`,
      evidenceRefs: [],
    })
  }

  return {
    composition: {
      observedUsage: c01,
      compositionShares: c02.values,
      exactDuplicates: c05,
      repeatedToolResults: c06,
      buckets: c02.buckets,
    },
    tools: {
      exposure: t01,
      usageRatio: t02.values[0]!,
      pairing: c10,
      ptcFacts: t08,
      perTool: t02.perTool,
      callShare: t03,
      status: t04,
      repeatArgs: t05,
      toolBurden: t07,
    },
    extensions: {
      skillCatalog: s01,
      skillLoads: s02.values[0]!,
      skillReloads: s03,
      skillBurden: s04,
      mcpComponents: m01.values[0]!,
      skillLoadsByPath: s02.byPath,
      components: m01.components,
      mcpReachability: m03,
    },
    carrying: {
      addRemove: c03,
      cumulativeCarry: c04,
      cacheReadRatio: c08,
      compactionChange: c12,
      capabilityChanges: c14,
    },
    issues,
  }
}
