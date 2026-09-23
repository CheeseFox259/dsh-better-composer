import { grammarLoadCount, parseGfm } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ComposerDecorationContext, ComposerDecorationProvider, ComposerDecorationRange,
  ComposerNativeRange, ComposerTextSegment,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { projectGfm, selectActiveConstructs, type MarkdownConstructRecord } from './ast-ranges.ts'
import { diagnosticsForSegments } from './diagnostics.ts'
import {
  MAX_CACHED_DIAGNOSTICS_LENGTH, MAX_CACHED_PROJECTION_LENGTH, MAX_LIVE_CODE_TOKEN_LENGTH,
  MAX_PROJECTION_CACHE_ENTRIES, MAX_SYNC_PROJECTION_LENGTH,
} from './limits.ts'
import { maskNative } from './native-mask.ts'
import { DEFAULT_SETTINGS, type BetterComposerSettings } from '../settings.ts'

/** Pure Markdown projection provider used by the out-of-tree contribution. */
export function createMarkdownProvider(
  getSettings: () => BetterComposerSettings = () => DEFAULT_SETTINGS,
): ComposerDecorationProvider {
  const inactivePresentation = { focused: false, selectionStart: -1, selectionEnd: -1, activeLineStart: -1, activeLineEnd: -1 } as const
  const projectionCache = new Map<string, { readonly grammar: number; readonly projection: ReturnType<typeof projectGfm> }>()
  // Diagnostics are a pure function of the masked segments; collect runs again
  // on every selection move, so cache the scan exactly like the projection.
  const diagnosticsCache = new Map<string, readonly ComposerDecorationRange[]>()
  return {
    id: 'dsh-better-composer-markdown', order: 0,
    decorate(context: ComposerDecorationContext): readonly ComposerDecorationRange[] {
      const settings = getSettings()
      if (!settings.enabled) return []
      // Optional Markdown paint yields for tail-sized drafts. Core keeps the
      // source document, selection, history, and Send path authoritative.
      if (context.draft.length > MAX_SYNC_PROJECTION_LENGTH) return []
      let ranges: ComposerDecorationRange[] = []
      const segments = context.textSegments ?? [{ start: 0, end: context.draft.length, text: context.draft }]
      if (settings.markdownVisual) {
        const hasPresentation = context.presentation !== undefined
        const presentation = context.presentation ?? inactivePresentation
        // Older Core hosts do not expose composition in the public type yet;
        // the optional field remains a runtime extension for IME-safe reveals.
        const composing = (presentation as typeof presentation & { readonly composing?: boolean }).composing === true
        for (const segment of segments) {
          const masked = maskSegment(segment, context.nativeRanges)
          const projection = projectionFor(projectionCache, String(context.sessionId), masked)
          const selection = selectionInSegment(presentation, segment)
          const active = new Set(presentation.focused
            ? selectActiveConstructs(projection.constructs, selection, composing)
            : [])
          const segmentRanges = [...projection.semanticRanges, ...projection.markerRanges, ...projection.fenceRanges, ...projection.structuralRanges].flatMap(range => {
            if (range.target === 'block') {
              // Reveal policy for content-faking block decorations: while the
              // caret is inside a list item or thematic break, the raw source
              // line must show without the synthetic bullet/checkbox/rule that
              // the block class paints (mirrors the marker-level reveal).
              if (isContentBlockClass(range.className)) {
                const owner = innermostContentConstruct(projection.constructs, range)
                if (owner !== undefined && active.has(owner)) return []
              }
              const base = offsetRange(range, segment.start)
              if (range.className === 'dsh-better-composer-table-separator') {
                if (!hasPresentation || composing) return [base]
                const suffix = sourceRangeIsActive(range, selection) ? 'active' : 'hidden'
                return [base, offsetRange({ ...range, className: `${range.className}-${suffix}` }, segment.start)]
              }
              const sourceVisibility = codeBlockEdgeVisibility(range, projection.constructs, selection, composing)
              if (sourceVisibility.className === range.className) return [base]
              return [base, offsetRange(sourceVisibility, segment.start)]
            }
            if (!isSourceMarker(range.className)) return [offsetRange(range, segment.start)]
            // Generic decoration consumers may not provide editor presentation
            // state. Keep their historical marker class instead of guessing that
            // every complete construct should be hidden.
            if (!hasPresentation) return [offsetRange(range, segment.start)]
            const owner = projection.constructs.find(record =>
              record.complete && record.markers.some(marker => marker.start === range.start && marker.end === range.end))
            const recordActive = owner !== undefined && active.has(owner)
            if (range.className === 'dsh-better-composer-fence-marker' && owner !== undefined && !composing) {
              if (sourceRangeIsActive(range, selection)) return [offsetRange({ ...range, className: `${range.className}-active` }, segment.start)]
              return [offsetRange({ ...range, className: `${range.className}-hidden` }, segment.start)]
            }
            if (range.className === 'dsh-better-composer-thematic-break-marker' && owner !== undefined && !composing) {
              if (sourceRangeIsActive(range, selection)) return [offsetRange({ ...range, className: `${range.className}-active` }, segment.start)]
              return [offsetRange({ ...range, className: `${range.className}-hidden` }, segment.start)]
            }
            if (range.className === 'dsh-better-composer-table-separator' && owner !== undefined && !composing) {
              const suffix = sourceRangeIsActive(range, selection) ? 'active' : 'hidden'
              return [offsetRange({ ...range, className: `${range.className}-${suffix}` }, segment.start)]
            }
            if (recordActive || owner === undefined) {
              return [offsetRange({ ...range, className: `${range.className}-active` }, segment.start)]
            }
            if (range.className === 'dsh-better-composer-fence-language') {
              return [offsetRange({ ...range, className: `${range.className}-visible` }, segment.start)]
            }
            if (owner === undefined || !hasVisibleContent(owner, masked)) return [offsetRange(range, segment.start)]
            return [offsetRange({ ...range, className: `${range.className}-hidden` }, segment.start)]
          })
          ranges.push(...segmentRanges)
        }
      }
      if (settings.diagnostics) {
        ranges.push(...diagnosticsForContext(diagnosticsCache, context, segments))
      }
      return ranges
    },
  }
}

/** Cached diagnostics scan; keyed by session and masked text, LRU-evicted. */
function diagnosticsForContext(
  cache: Map<string, readonly ComposerDecorationRange[]>,
  context: ComposerDecorationContext,
  segments: readonly ComposerTextSegment[],
): readonly ComposerDecorationRange[] {
  const masked = segments.map(segment => ({
    sourceStart: segment.start,
    text: maskSegment(segment, context.nativeRanges),
  }))
  const key = `${String(context.sessionId)}${masked.map(segment => segment.text).join('\0')}`
  const cached = cache.get(key)
  if (cached !== undefined) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const ranges = diagnosticsForSegments({ draftRev: context.draftRev, segments: masked })
  if (key.length <= MAX_CACHED_DIAGNOSTICS_LENGTH) {
    cache.set(key, ranges)
    while (cache.size > MAX_PROJECTION_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  return ranges
}

function codeBlockEdgeVisibility(
  range: ComposerDecorationRange,
  constructs: readonly MarkdownConstructRecord[],
  selection: { readonly start: number; readonly end: number },
  composing: boolean,
): ComposerDecorationRange {
  const isEdge = range.className === 'dsh-better-composer-code-block-start'
    || range.className === 'dsh-better-composer-code-block-end'
  if (!isEdge) return range
  const owner = constructs.find(record => record.kind === 'fence'
    && range.start >= record.sourceStart
    && range.end <= record.sourceEnd)
  if (owner === undefined || composing || owner.markers.some(marker =>
    marker.start >= range.start && marker.end <= range.end && sourceRangeIsActive(marker, selection))) return range
  return { ...range, className: `${range.className}-source-hidden` }
}

/** Block classes that paint synthetic content (bullets, checkboxes, rules). */
function isContentBlockClass(className: string): boolean {
  return className === 'dsh-better-composer-bullet'
    || className === 'dsh-better-composer-ordered'
    || className === 'dsh-better-composer-task'
    || className === 'dsh-better-composer-thematic-break'
}

/** The deepest list/task/thematic-break construct fully containing one block range. */
function innermostContentConstruct(
  constructs: readonly MarkdownConstructRecord[],
  range: { readonly start: number; readonly end: number },
): MarkdownConstructRecord | undefined {
  const containing = constructs.filter(record =>
    (record.kind === 'list' || record.kind === 'task' || record.kind === 'thematic-break')
    && record.sourceStart <= range.start && range.end <= record.sourceEnd)
  return containing.sort((a, b) =>
    (a.sourceEnd - a.sourceStart) - (b.sourceEnd - b.sourceStart) || b.depth - a.depth)[0]
}

function sourceRangeIsActive(
  range: { readonly start: number; readonly end: number },
  selection: { readonly start: number; readonly end: number },
): boolean {
  if (selection.start < 0 || selection.end < 0) return false
  if (selection.start !== selection.end) return selection.start < range.end && range.start < selection.end
  return selection.start >= range.start && selection.start <= range.end
}

function projectionFor(
  cache: Map<string, { readonly grammar: number; readonly projection: ReturnType<typeof projectGfm> }>,
  sessionKey: string,
  masked: string,
): ReturnType<typeof projectGfm> {
  const key = `${sessionKey}\u0000${masked}`
  const grammar = grammarLoadCount()
  const cached = cache.get(key)
  // Lazy Shiki grammars register asynchronously: a projection computed before
  // one loads carries no token ranges, so a stale-grammar entry is a miss.
  if (cached !== undefined && cached.grammar === grammar) {
    cache.delete(key)
    cache.set(key, cached)
    return cached.projection
  }
  const projection = projectGfm(parseGfm(masked), masked, {
    includeCodeTokens: masked.length <= MAX_LIVE_CODE_TOKEN_LENGTH,
  })
  if (masked.length <= MAX_CACHED_PROJECTION_LENGTH) {
    cache.set(key, { grammar, projection })
    while (cache.size > MAX_PROJECTION_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  return projection
}

function maskSegment(segment: ComposerTextSegment, nativeRanges: readonly ComposerNativeRange[]): string {
  const localRanges = nativeRanges.flatMap(range => {
    const start = Math.max(segment.start, range.start)
    const end = Math.min(segment.end, range.end)
    return start < end ? [{ start: start - segment.start, end: end - segment.start, kind: range.kind }] : []
  })
  return maskNative(segment.text, localRanges)
}

function offsetRange(range: ComposerDecorationRange, offset: number): ComposerDecorationRange {
  return { ...range, start: range.start + offset, end: range.end + offset }
}

function selectionInSegment(
  presentation: { readonly selectionStart: number; readonly selectionEnd: number },
  segment: ComposerTextSegment,
): { readonly start: number; readonly end: number } {
  if (presentation.selectionStart < 0 || presentation.selectionEnd < 0) return { start: -1, end: -1 }
  const start = Math.max(0, Math.min(segment.text.length, presentation.selectionStart - segment.start))
  const end = Math.max(start, Math.min(segment.text.length, presentation.selectionEnd - segment.start))
  return { start, end }
}

function isSourceMarker(className: string): boolean {
  return className === 'dsh-better-composer-marker'
    || className === 'dsh-better-composer-fence-marker'
    || className === 'dsh-better-composer-fence-language'
    || className === 'dsh-better-composer-thematic-break-marker'
    || className === 'dsh-better-composer-table-divider'
    || className === 'dsh-better-composer-table-separator'
    || /^dsh-better-composer-list-marker-depth-\d+$/u.test(className)
    || /^dsh-better-composer-ordered-marker-depth-\d+$/u.test(className)
}

function hasVisibleContent(
  record: { readonly sourceStart: number; readonly sourceEnd: number; readonly markers: readonly { readonly start: number; readonly end: number }[] },
  source: string,
): boolean {
  let visible = ''
  let cursor = record.sourceStart
  for (const marker of [...record.markers].sort((left, right) => left.start - right.start)) {
    visible += source.slice(cursor, marker.start)
    cursor = Math.max(cursor, marker.end)
  }
  visible += source.slice(cursor, record.sourceEnd)
  return visible.trim().length > 0
}
