import { parseGfm } from '../markdown/primitives.ts'
import type {
  ComposerEditResult, ComposerNativeRange, ComposerTextSegment,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { projectGfm } from '../markdown/ast-ranges.ts'
import { composerDomBlockRuns } from './dom-mapping.ts'

const MIN_TABLE_COLUMN_WIDTH = 6
const MAX_TABLE_COLUMN_WIDTH = 48

/** One table's source range and deterministic presentation column model. */
export interface MarkdownTableLayout {
  readonly start: number
  readonly end: number
  readonly columnWidths: readonly number[]
  readonly rows: readonly MarkdownTableRow[]
}

/** One visible table row derived from authoritative Markdown source. */
export interface MarkdownTableRow {
  readonly start: number
  readonly end: number
  readonly cells: readonly string[]
  readonly header: boolean
  readonly last: boolean
}

/** One table row paired with its Core-owned source DOM element. */
export interface MarkdownTableRowAnchor {
  readonly layoutStart: number
  readonly row: MarkdownTableRow
  readonly element: HTMLElement
}

/** One fenced block that may expose a presentation-only copy action. */
export interface MarkdownCodeCopyBlock {
  readonly start: number
  readonly end: number
  readonly language: string
  readonly languageStart: number
  readonly languageEnd: number
  readonly copyText: string
}

/** A code copy block paired with its Core-owned source DOM element. */
export interface MarkdownCodeCopyAnchor {
  readonly start: number
  readonly element: HTMLElement
}

/**
 * Calculate one shared display-width model for every row in a Markdown table.
 * The result is derived from the current source and is never written back to
 * the draft.
 * @param source - one source-local Markdown table.
 * @returns minimum-padded display widths in columns.
 */
export function tableColumnWidths(source: string): readonly number[] {
  const widths: number[] = []
  for (const line of source.split(/\r?\n/u)) {
    if (isTableSeparator(line)) continue
    for (const [index, cell] of tableCells(line).entries()) {
      widths[index] = Math.max(widths[index] ?? 0, displayWidth(cell))
    }
  }
  return widths.map(width => Math.min(MAX_TABLE_COLUMN_WIDTH, Math.max(MIN_TABLE_COLUMN_WIDTH, width + 2)))
}

/**
 * Derive all table layout models from Core's ordinary text segments.
 * Context Object-separated segments are intentionally parsed independently.
 * @param segments - Core-projected ordinary source segments.
 * @returns table layout models in source order.
 */
export function tableLayoutsForSegments(segments: readonly ComposerTextSegment[]): readonly MarkdownTableLayout[] {
  const layouts: MarkdownTableLayout[] = []
  for (const segment of segments) {
    const projection = projectGfm(parseGfm(segment.text), segment.text, { includeCodeTokens: false })
    for (const construct of projection.constructs) {
      if (construct.kind !== 'table' || !construct.complete) continue
      const raw = segment.text.slice(construct.sourceStart, construct.sourceEnd)
      const columnWidths = tableColumnWidths(raw)
      if (columnWidths.length === 0) continue
      const start = segment.start + construct.sourceStart
      layouts.push({
        start,
        end: segment.start + construct.sourceEnd,
        columnWidths,
        rows: tableRows(raw, start),
      })
    }
  }
  return layouts
}

/**
 * Derive copyable code bodies from Core's ordinary text segments.
 * @param segments - Core-projected ordinary source segments.
 * @returns complete fenced blocks in source order.
 */
export function codeCopyBlocksForSegments(segments: readonly ComposerTextSegment[]): readonly MarkdownCodeCopyBlock[] {
  const blocks: MarkdownCodeCopyBlock[] = []
  for (const segment of segments) {
    const projection = projectGfm(parseGfm(segment.text), segment.text, { includeCodeTokens: false })
    for (const construct of projection.constructs) {
      if (construct.kind !== 'fence' || !construct.complete) continue
      const raw = segment.text.slice(construct.sourceStart, construct.sourceEnd)
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
      const body = raw.slice(firstNewline + 1, closingLineStart).replace(/\r?\n$/u, '')
      const sourceStart = segment.start + construct.sourceStart
      blocks.push({
        start: sourceStart,
        end: segment.start + construct.sourceEnd,
        language,
        languageStart: sourceStart + languageLocalStart,
        languageEnd: sourceStart + languageLocalStart + language.length,
        copyText: body,
      })
    }
  }
  return blocks
}

/**
 * Build one source replacement for a fenced-code language token.
 * @param block - current source-ranged fenced block.
 * @param language - replacement language identifier.
 * @returns a source edit for Core's revision-aware transaction bridge.
 */
export function codeFenceLanguageEdit(
  block: MarkdownCodeCopyBlock,
  language: string,
): ComposerEditResult {
  const caret = block.languageStart + language.length
  return {
    start: block.languageStart,
    end: block.languageEnd,
    text: language,
    selectionStart: caret,
    selectionEnd: caret,
  }
}

/**
 * Map code-fence starts to direct Lexical blocks without crossing a native
 * range. A stale or non-isomorphic DOM returns no anchors.
 * @param root - Core-owned contenteditable root.
 * @param source - authoritative UTF-16 source.
 * @param nativeRanges - Context Object ranges excluded from ordinary text.
 * @param blocks - source-ranged complete code fences.
 * @returns code anchors, or undefined when the DOM projection is stale.
 */
export function codeCopyBlockAnchors(
  root: HTMLElement | null,
  source: string,
  nativeRanges: readonly ComposerNativeRange[],
  blocks: readonly MarkdownCodeCopyBlock[],
): readonly MarkdownCodeCopyAnchor[] | undefined {
  if (root === null || blocks.length === 0) return []
  const runs = composerDomBlockRuns(root, source, nativeRanges)
  if (runs === undefined) return undefined
  return blocks.flatMap(block => {
    const run = runs.find(candidate => candidate.start <= block.start && block.start < candidate.end)
    return run === undefined || !run.element.classList.contains('dsh-better-composer-code-block')
      ? [] : [{ start: block.start, element: run.element }]
  })
}

/**
 * Pair every visible table row with its Core-owned source block.
 * @param root - Core-owned contenteditable root.
 * @param source - authoritative UTF-16 source.
 * @param nativeRanges - Context Object ranges that are presentation barriers.
 * @param layouts - source-ranged table models.
 * @returns row anchors, or undefined when the DOM projection is stale.
 */
export function tableRowAnchors(
  root: HTMLElement | null,
  source: string,
  nativeRanges: readonly ComposerNativeRange[],
  layouts: readonly MarkdownTableLayout[],
): readonly MarkdownTableRowAnchor[] | undefined {
  if (root === null || layouts.length === 0) return []
  const runs = composerDomBlockRuns(root, source, nativeRanges)
  if (runs === undefined) return undefined
  const anchors: MarkdownTableRowAnchor[] = []
  for (const layout of layouts) {
    if (crossesNative(layout.start, layout.end, nativeRanges)) continue
    for (const row of layout.rows) {
      const run = runs.find(candidate => candidate.start === row.start && candidate.end === row.end)
      if (run === undefined || !run.element.classList.contains('dsh-better-composer-table-row')) return undefined
      anchors.push({ layoutStart: layout.start, row, element: run.element })
    }
  }
  return anchors
}

function tableRows(source: string, sourceStart: number): readonly MarkdownTableRow[] {
  const rows: Array<Omit<MarkdownTableRow, 'last'>> = []
  let cursor = 0
  while (cursor <= source.length) {
    const newline = source.indexOf('\n', cursor)
    const rawEnd = newline < 0 ? source.length : newline
    const lineEnd = rawEnd > cursor && source[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd
    const line = source.slice(cursor, lineEnd)
    if (!isTableSeparator(line) && line.trim() !== '') {
      rows.push({
        start: sourceStart + cursor,
        end: sourceStart + lineEnd,
        cells: tableCells(line),
        header: rows.length === 0,
      })
    }
    if (newline < 0) break
    cursor = newline + 1
  }
  return rows.map((row, index) => ({ ...row, last: index === rows.length - 1 }))
}

function tableCells(line: string): readonly string[] {
  const trimmed = line.trim()
  const withoutLeading = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutEdge = withoutLeading.endsWith('|') ? withoutLeading.slice(0, -1) : withoutLeading
  return withoutEdge.split('|').map(cell => cell.trim())
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/u.test(line)
}

function displayWidth(value: string): number {
  let width = 0
  for (const character of value) {
    if (/\p{Mark}/u.test(character)) continue
    if (character === '\t') {
      width += 4
      continue
    }
    const codePoint = character.codePointAt(0) ?? 0
    width += isWideCodePoint(codePoint) ? 2 : 1
  }
  return width
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  )
}

function crossesNative(start: number, end: number, ranges: readonly ComposerNativeRange[]): boolean {
  return ranges.some(range => start < range.end && range.start < end)
}
