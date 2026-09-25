import type { ComposerDecorationRange } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { parseGfm } from './primitives.ts'
import { projectGfm } from './ast-ranges.ts'
import { MAX_OPTIONAL_SCAN_LENGTH } from './limits.ts'

/** One ordinary source segment separated from Context Object anchors. */
export interface DiagnosticTextSegment {
  /** Segment start in authoritative source UTF-16 coordinates. */
  readonly sourceStart: number
  /** Segment text; Markdown is never inferred across another segment. */
  readonly text: string
}

/** Input for a revision-paired, segment-local diagnostic scan. */
export interface DiagnosticsForSegmentsInput {
  /** Revision associated with the source segments. */
  readonly draftRev: number
  /** Core-derived ordinary source segments. */
  readonly segments: readonly DiagnosticTextSegment[]
}

/** Return the three deterministic authoring diagnostics supported by Beta. */
export function diagnosticsFor(draft: string): readonly ComposerDecorationRange[] {
  const ranges: ComposerDecorationRange[] = []
  // Code ranges come from the mdast projection, not a line regex: only the
  // parser knows block context (HTML blocks, indented code), which decides
  // whether a ``` line is a fence at all. mdast types indented code as `code`
  // too, so a source-prefix check keeps those from posing as unclosed fences.
  const projection = projectGfm(parseGfm(draft), draft, { includeCodeTokens: false })
  const fencedRanges: Array<{ start: number; end: number }> = []
  for (const record of projection.constructs) {
    if (record.kind !== 'fence') continue
    fencedRanges.push({ start: record.sourceStart, end: record.sourceEnd })
    const indentedCode = !/^ {0,3}(`{3,}|~{3,})/u.test(draft.slice(record.sourceStart, record.sourceStart + 16))
    if (!record.complete && !indentedCode) {
      ranges.push({
        start: record.sourceStart, end: record.sourceEnd,
        className: 'dsh-better-composer-diagnostic-fence', layer: 'diagnostic', priority: 10,
      })
    }
  }
  // Raw HTML blocks carry literal text; their backticks and brackets are never
  // Markdown delimiters.
  for (const html of projection.htmlRanges) fencedRanges.push({ start: html.start, end: html.end })
  // Fallback constructs are appended after parsed ones; the cursor walk below
  // consumes ranges in ascending order.
  fencedRanges.sort((left, right) => left.start - right.start)
  const ticks = /`+/gu
  const pending = new Map<number, number[]>()
  let fencedCursor = 0
  for (const match of draft.matchAll(ticks)) {
    const start = match.index ?? 0
    while (fencedCursor < fencedRanges.length && (fencedRanges[fencedCursor]?.end ?? 0) <= start) fencedCursor += 1
    const fenced = fencedRanges[fencedCursor]
    if (fenced !== undefined && start >= fenced.start && start < fenced.end) continue
    const length = match[0].length
    const starts = pending.get(length)
    if (starts === undefined) pending.set(length, [start])
    else if (starts.length === 0) starts.push(start)
    else starts.pop()
  }
  for (const [length, starts] of pending) {
    for (const start of starts) {
      ranges.push({ start, end: Math.min(draft.length, start + length), className: 'dsh-better-composer-diagnostic-inline-code', layer: 'diagnostic', priority: 10 })
    }
  }
  const malformed = /\[[^\]\n]*\]\([^\)\n]*$/gu.exec(draft)
  if (malformed !== null && !fencedRanges.some(range => malformed.index >= range.start && malformed.index < range.end)) {
    ranges.push({ start: malformed.index, end: draft.length, className: 'dsh-better-composer-diagnostic-link', layer: 'diagnostic', priority: 10 })
  }
  return ranges
}

/**
 * Scan each ordinary source segment independently and translate its ranges to source offsets.
 * `draftRev` is intentionally consumed by the call contract while ranges remain presentation-only.
 * @param input - revision and Core-derived segments.
 * @returns diagnostic ranges in authoritative UTF-16 source coordinates.
 */
export function diagnosticsForSegments(input: DiagnosticsForSegmentsInput): readonly ComposerDecorationRange[] {
  const ranges: ComposerDecorationRange[] = []
  let scanned = 0
  for (const segment of input.segments) {
    if (!Number.isInteger(segment.sourceStart) || segment.sourceStart < 0 || typeof segment.text !== 'string') continue
    if (segment.text.length > MAX_OPTIONAL_SCAN_LENGTH || scanned + segment.text.length > MAX_OPTIONAL_SCAN_LENGTH) break
    scanned += segment.text.length
    for (const range of diagnosticsFor(segment.text)) {
      ranges.push({ ...range, start: range.start + segment.sourceStart, end: range.end + segment.sourceStart })
    }
  }
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end)
}
