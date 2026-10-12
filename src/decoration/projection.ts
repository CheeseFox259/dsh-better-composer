import type { ComposerEditResult } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { parseGfm, grammarLoadCount } from './internal/primitives.ts'
import {
  projectGfm, selectActiveConstructs, type MarkdownConstructRecord,
} from './internal/ast-ranges.ts'
import {
  MAX_CACHED_PROJECTION_LENGTH, MAX_LIVE_CODE_TOKEN_LENGTH,
  MAX_PROJECTION_CACHE_ENTRIES, MAX_SYNC_PROJECTION_LENGTH,
} from './internal/limits.ts'
import { tableColumnWidths, tableRows } from './internal/layout.ts'
import {
  validateRange, mergedIntervals, subtractNative, composeClasses, type RangeRecord,
} from './internal/composer.ts'

export interface SelectionRange {
  start: number
  end: number
  focused?: boolean
  composing?: boolean
}

export interface NativeRange {
  start: number
  end: number
  kind?: string
}

export interface ProjectionOptions {
  markdownVisual?: boolean
}

export interface DraftLineDecoration {
  lineIndex: number
  start: number
  end: number
  signature: string
  blockClasses: readonly string[]
}

export interface InlineDecoration {
  start: number
  end: number
  className: string
  hidesSource: boolean
}

export interface TableRowOverlay {
  lineIndex: number
  start: number
  end: number
  cells: readonly string[]
  header: boolean
  last: boolean
}

export interface TableOverlay {
  start: number
  end: number
  active: boolean
  columnWidths: readonly number[]
  rows: readonly TableRowOverlay[]
}

export interface CodeBlockOverlay {
  start: number
  end: number
  headerLineIndex: number
  language: string
  languageRange: { start: number; end: number }
  copyText: string
}

/**
 * One list line whose source marker is hidden and needs a synthetic glyph.
 * The glyph is line-scoped state (bullet shape, checkbox, checked), so it is
 * rendered by the per-line marker overlay; block classes carry only layout.
 * Ordered items keep their source number visible and never appear here.
 */
export interface ListMarkerOverlay {
  lineStart: number
  lineEnd: number
  markerStart: number
  markerEnd: number
  kind: 'bullet' | 'task'
  checked: boolean
  depth: number
}

/** Build one revision-aware source edit for a fenced-code language token. */
export function codeFenceLanguageEdit(
  block: CodeBlockOverlay,
  language: string,
): ComposerEditResult {
  const caret = block.languageRange.start + language.length
  return {
    start: block.languageRange.start,
    end: block.languageRange.end,
    text: language,
    selectionStart: caret,
    selectionEnd: caret,
  }
}

export interface DecorationPlan {
  draft: string
  lines: readonly DraftLineDecoration[]
  inlines: readonly InlineDecoration[]
  overlays: {
    tables: readonly TableOverlay[]
    codeBlocks: readonly CodeBlockOverlay[]
    listMarkers: readonly ListMarkerOverlay[]
  }
  nativeRanges?: readonly NativeRange[]
}

const projectionCache = new Map<string, { readonly grammar: number; readonly projection: ReturnType<typeof projectGfm> }>()

function partitionDraftLines(draft: string): Array<{ lineIndex: number; start: number; end: number }> {
  const lines: Array<{ lineIndex: number; start: number; end: number }> = []
  let cursor = 0
  let lineIndex = 0
  while (cursor <= draft.length) {
    const nextNewline = draft.indexOf('\n', cursor)
    const end = nextNewline < 0 ? draft.length : nextNewline + 1
    lines.push({ lineIndex, start: cursor, end })
    lineIndex += 1
    if (nextNewline < 0) break
    cursor = end
  }
  return lines
}

export function project(
  draft: string,
  selection?: SelectionRange | null,
  nativeRanges?: readonly NativeRange[],
  options?: ProjectionOptions,
): DecorationPlan {
  const rawLines = partitionDraftLines(draft)

  if (draft.length > MAX_SYNC_PROJECTION_LENGTH || options?.markdownVisual === false) {
    return {
      draft,
      lines: rawLines.map(line => ({ ...line, signature: '', blockClasses: [] })),
      inlines: [],
      overlays: { tables: [], codeBlocks: [], listMarkers: [] },
      nativeRanges,
    }
  }

  // Markdown is never inferred across a Context Object: parse each ordinary
  // segment on its own and offset the projections back to draft coordinates.
  const segments: { start: number; text: string }[] = []
  {
    let cursor = 0
    for (const range of mergedIntervals(nativeRanges ?? [], draft.length)) {
      if (range.start > cursor) segments.push({ start: cursor, text: draft.slice(cursor, range.start) })
      cursor = Math.max(cursor, range.end)
    }
    if (cursor < draft.length) segments.push({ start: cursor, text: draft.slice(cursor) })
  }

  const grammar = grammarLoadCount()
  const projection = mergeProjections(segments.map(segment => {
    const cached = projectionCache.get(segment.text)
    let local: ReturnType<typeof projectGfm>
    if (cached !== undefined && cached.grammar === grammar) {
      local = cached.projection
      projectionCache.delete(segment.text)
      projectionCache.set(segment.text, cached)
    } else {
      local = projectGfm(parseGfm(segment.text), segment.text, {
        includeCodeTokens: segment.text.length <= MAX_LIVE_CODE_TOKEN_LENGTH,
      })
      if (segment.text.length <= MAX_CACHED_PROJECTION_LENGTH) {
        projectionCache.set(segment.text, { grammar, projection: local })
        while (projectionCache.size > MAX_PROJECTION_CACHE_ENTRIES) {
          const oldest = projectionCache.keys().next().value
          if (oldest !== undefined) projectionCache.delete(oldest)
          else break
        }
      }
    }
    return offsetProjection(local, segment.start)
  }))

  const hasPresentation = selection !== null && selection !== undefined
  const focused = selection?.focused ?? false
  const composing = selection?.composing ?? false
  const sel = selection !== null && selection !== undefined && selection.start >= 0 && selection.end >= 0
    ? { start: Math.min(selection.start, selection.end), end: Math.max(selection.start, selection.end) }
    : { start: -1, end: -1 }
  const active = new Set(focused ? selectActiveConstructs(projection.constructs, sel, composing) : [])

  const rawRanges = [...projection.semanticRanges, ...projection.markerRanges, ...projection.fenceRanges, ...projection.structuralRanges].flatMap(range => {
    if (range.target === 'block') {
      if (isContentBlockClass(range.className)) {
        const owner = innermostContentConstruct(projection.constructs, range)
        if (owner !== undefined && active.has(owner)) return []
      }
      if (range.className === 'dsh-better-composer-table-separator') {
        if (!hasPresentation || composing) return [range]
        const suffix = sourceRangeIsActive(range, sel) ? 'active' : 'hidden'
        return [range, { ...range, className: `${range.className}-${suffix}` }]
      }
      const sourceVisibility = codeBlockEdgeVisibility(range, projection.constructs, sel, composing)
      if (sourceVisibility.className === range.className) return [range]
      return [range, sourceVisibility]
    }
    if (!isSourceMarker(range.className)) return [range]
    if (!hasPresentation) return [range]
    const owner = projection.constructs.find(record =>
      record.markers.some(marker => marker.start === range.start && marker.end === range.end)
        && (record.complete || record.kind === 'list' || record.kind === 'task'))
    const recordActive = owner !== undefined && active.has(owner)
    if (range.className === 'dsh-better-composer-fence-marker' && owner !== undefined && !composing) {
      if (sourceRangeIsActive(range, sel)) return [{ ...range, className: `${range.className}-active` }]
      return [{ ...range, className: `${range.className}-hidden` }]
    }
    if (range.className === 'dsh-better-composer-thematic-break-marker' && owner !== undefined && !composing) {
      if (sourceRangeIsActive(range, sel)) return [{ ...range, className: `${range.className}-active` }]
      return [{ ...range, className: `${range.className}-hidden` }]
    }
    if (range.className === 'dsh-better-composer-table-separator' && owner !== undefined && !composing) {
      const suffix = sourceRangeIsActive(range, sel) ? 'active' : 'hidden'
      return [{ ...range, className: `${range.className}-${suffix}` }]
    }
    if (isListMarkerClass(range.className) && (recordActive || emptyListItemFollowsList(draft, range.start, range.end))) {
      return [{ ...range, className: `${range.className}-hidden` }]
    }
    if (recordActive || owner === undefined) {
      return [{ ...range, className: `${range.className}-active` }]
    }
    if (!owner.complete && (owner.kind === 'list' || owner.kind === 'task') && isListMarkerClass(range.className)) {
      return [{ ...range, className: `${range.className}-hidden` }]
    }
    if (range.className === 'dsh-better-composer-fence-language') {
      return [{ ...range, className: `${range.className}-visible` }]
    }
    if (owner === undefined || !hasVisibleContent(owner, draft)) return [range]
    return [{ ...range, className: `${range.className}-hidden` }]
  })

  const native = nativeRanges !== undefined && nativeRanges.length > 0
    ? mergedIntervals(nativeRanges, draft.length)
    : []
  const validRanges: RangeRecord[] = []
  for (let ordinal = 0; ordinal < rawRanges.length; ordinal += 1) {
    const range = validateRange(rawRanges[ordinal], draft, 0, ordinal)
    if (range !== undefined) {
      validRanges.push(...subtractNative(range, native))
    }
  }

  const blockRanges = validRanges.filter(r => r.target === 'block')
  const textRanges = validRanges.filter(r => r.target !== 'block')

  const lines: DraftLineDecoration[] = rawLines.map(line => {
    const lineContent = draft.slice(line.start, line.end).replace(/\r?\n$/u, '')
    if (lineContent.trim() === '') {
      return { ...line, signature: '', blockClasses: [] }
    }
    const classNames = new Set<string>()
    for (const r of blockRanges) {
      if (r.start < line.end && r.end > line.start) {
        for (const token of r.className.split(' ')) {
          if (token !== '') classNames.add(token)
        }
      }
    }
    const blockClasses = Array.from(classNames).sort()
    const signature = blockClasses.join(' ')
    return { ...line, signature, blockClasses }
  })

  const inlines: InlineDecoration[] = []
  if (textRanges.length > 0) {
    const points = [...new Set(textRanges.flatMap(r => [r.start, r.end]))].sort((a, b) => a - b)
    for (let index = 0; index + 1 < points.length; index += 1) {
      const start = points[index]!
      const end = points[index + 1]!
      const activeTextRanges = textRanges.filter(r => r.start <= start && end <= r.end)
      const classes = composeClasses(activeTextRanges, false)
      for (const token of classes) {
        const hidesSource = isHidesSourceClass(token)
        const previous = inlines.at(-1)
        if (previous !== undefined && previous.className === token && previous.hidesSource === hidesSource && previous.end === start) {
          inlines[inlines.length - 1] = { ...previous, end }
        } else {
          inlines.push({ start, end, className: token, hidesSource })
        }
      }
    }
  }

  const tables: TableOverlay[] = []
  for (const construct of projection.constructs) {
    if (construct.kind !== 'table' || !construct.complete) continue
    const raw = draft.slice(construct.sourceStart, construct.sourceEnd)
    const columnWidths = tableColumnWidths(raw)
    if (columnWidths.length === 0) continue
    const start = construct.sourceStart
    const end = construct.sourceEnd
    const activeTable = isTableActive(start, end, selection)
    const rows: TableRowOverlay[] = tableRows(raw, start).map(row => {
      const lineIndex = findLineIndexForOffset(lines, row.start)
      return {
        lineIndex,
        start: row.start,
        end: row.end,
        cells: row.cells,
        header: row.header,
        last: row.last,
      }
    })
    tables.push({ start, end, active: activeTable, columnWidths, rows })
  }

  const codeBlocks: CodeBlockOverlay[] = []
  for (const construct of projection.constructs) {
    if (construct.kind !== 'fence' || !construct.complete) continue
    const raw = draft.slice(construct.sourceStart, construct.sourceEnd)
    const firstNewline = raw.indexOf('\n')
    if (firstNewline < 0) continue
    const openingLine = raw.slice(0, firstNewline).replace(/\r$/u, '')
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(openingLine)
    if (opening === null) continue
    const marker = opening[1] ?? ''
    const markerStart = openingLine.indexOf(marker)
    const infoStart = markerStart + marker.length
    const infoSource = openingLine.slice(infoStart)
    const languageMatch = /\S+/u.exec(infoSource)
    const language = languageMatch?.[0] ?? ''
    const languageLocalStart = infoStart + (languageMatch?.index ?? infoSource.length)
    const closingLineStart = raw.lastIndexOf('\n') + 1
    if (closingLineStart <= firstNewline) continue
    const copyText = raw.slice(firstNewline + 1, closingLineStart).replace(/\r?\n$/u, '')
    const sourceStart = construct.sourceStart
    const sourceEnd = construct.sourceEnd
    const headerLineIndex = findLineIndexForOffset(lines, sourceStart)
    const languageRange = {
      start: sourceStart + languageLocalStart,
      end: sourceStart + languageLocalStart + language.length,
    }
    codeBlocks.push({
      start: sourceStart,
      end: sourceEnd,
      headerLineIndex,
      language,
      languageRange,
      copyText,
    })
  }

  // A hidden bullet/task marker needs a synthetic glyph at its own line; the
  // overlay renders one per line, so multi-line DOM blocks (Shift+Enter
  // linebreaks) decorate exactly like one-block-per-line pastes. Ordered
  // markers use a different class and stay visible as source numbers.
  const listMarkers: ListMarkerOverlay[] = []
  for (const inline of inlines) {
    const match = /^dsh-better-composer-list-marker-depth-(\d+)-hidden$/u.exec(inline.className)
    if (match === null) continue
    const markerText = draft.slice(inline.start, inline.end)
    const line = lines[findLineIndexForOffset(lines, inline.start)]
    if (line === undefined) continue
    listMarkers.push({
      lineStart: line.start,
      lineEnd: line.end,
      markerStart: inline.start,
      markerEnd: inline.end,
      kind: /\[[ xX]\]/u.test(markerText) ? 'task' : 'bullet',
      checked: /\[[xX]\]/u.test(markerText),
      depth: Math.min(6, Math.max(1, Number(match[1]))),
    })
  }

  return {
    draft,
    lines,
    inlines,
    overlays: { tables, codeBlocks, listMarkers },
    nativeRanges,
  }
}

type SegmentProjection = ReturnType<typeof projectGfm>

/** Shift one segment-local projection into authoritative draft coordinates. */
function offsetProjection(projection: SegmentProjection, offset: number): SegmentProjection {
  if (offset === 0) return projection
  const shift = <T extends { readonly start: number; readonly end: number }>(range: T): T => ({
    ...range, start: range.start + offset, end: range.end + offset,
  })
  return {
    semanticRanges: projection.semanticRanges.map(shift),
    markerRanges: projection.markerRanges.map(shift),
    fenceRanges: projection.fenceRanges.map(shift),
    structuralRanges: projection.structuralRanges.map(shift),
    constructs: projection.constructs.map(record => ({
      ...record,
      sourceStart: record.sourceStart + offset,
      sourceEnd: record.sourceEnd + offset,
      semanticStart: record.semanticStart + offset,
      semanticEnd: record.semanticEnd + offset,
      markers: record.markers.map(shift),
    })),
    htmlRanges: projection.htmlRanges.map(shift),
  }
}

function mergeProjections(projections: readonly SegmentProjection[]): SegmentProjection {
  if (projections.length === 1) return projections[0]!
  return {
    semanticRanges: projections.flatMap(p => p.semanticRanges),
    markerRanges: projections.flatMap(p => p.markerRanges),
    fenceRanges: projections.flatMap(p => p.fenceRanges),
    structuralRanges: projections.flatMap(p => p.structuralRanges),
    constructs: projections.flatMap(p => p.constructs),
    htmlRanges: projections.flatMap(p => p.htmlRanges),
  }
}

function findLineIndexForOffset(lines: readonly DraftLineDecoration[], offset: number): number {  for (const line of lines) {
    if (offset >= line.start && offset < line.end) return line.lineIndex
  }
  const last = lines.at(-1)
  if (last !== undefined && offset >= last.start && offset <= last.end) return last.lineIndex
  return 0
}

function isTableActive(start: number, end: number, selection?: SelectionRange | null): boolean {
  if (selection?.focused !== true) return false
  const { start: selStart, end: selEnd } = selection
  if (selStart === selEnd) return start <= selStart && selStart < end
  return selStart < end && start < selEnd
}

export function isHidesSourceClass(token: string): boolean {
  return token.endsWith('-hidden')
    || token === 'dsh-better-composer-fence-language-visible'
    || token === 'dsh-better-composer-table-separator'
    || token === 'dsh-better-composer-table-divider'
    || token === 'dsh-better-composer-table-divider-active'
}

function isContentBlockClass(className: string): boolean {
  return className === 'dsh-better-composer-thematic-break'
}

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

function codeBlockEdgeVisibility(
  range: { readonly start: number; readonly end: number; readonly className: string },
  constructs: readonly MarkdownConstructRecord[],
  selection: { readonly start: number; readonly end: number },
  composing: boolean,
): { readonly start: number; readonly end: number; readonly className: string; readonly target: 'block' } {
  const isEdge = range.className === 'dsh-better-composer-code-block-start'
    || range.className === 'dsh-better-composer-code-block-end'
  if (!isEdge) return { ...range, target: 'block' }
  const owner = constructs.find(record => record.kind === 'fence'
    && range.start >= record.sourceStart
    && range.end <= record.sourceEnd)
  if (owner === undefined || composing || owner.markers.some(marker =>
    marker.start >= range.start && marker.end <= range.end && sourceRangeIsActive(marker, selection))) {
    return { ...range, target: 'block' }
  }
  return { ...range, className: `${range.className}-source-hidden`, target: 'block' }
}

function isListMarkerClass(className: string): boolean {
  return /^dsh-better-composer-(?:list|ordered)-marker-depth-\d+$/u.test(className)
}

function emptyListItemFollowsList(source: string, start: number, end: number): boolean {
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const lineEnd = source.indexOf('\n', end)
  const current = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd)
  if (current.slice(0, end - lineStart).trim() !== current.trim() || current.replace(/^(?:[ \t]*)(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/u, '').trim() !== '') return false
  if (lineStart === 0) return false
  const previousEnd = lineStart - 1
  const previousStart = source.lastIndexOf('\n', Math.max(0, previousEnd - 1)) + 1
  return /^(?:[ \t]*)(?:[-+*]|\d+[.)])[ \t]+\S/u.test(source.slice(previousStart, previousEnd))
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
