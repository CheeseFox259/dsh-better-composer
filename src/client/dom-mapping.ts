/**
 * DOM ↔ draft-offset mapping for the Core-owned contenteditable.
 *
 * Direct port of the canonical DSH harness implementations (MIT, (c) DeepSeek).
 * Maps ordinary Lexical text nodes to UTF-16 draft coordinates so the CSS
 * Highlight API can paint syntax highlights without modifying the DOM.
 * Chip subtrees (contenteditable="false") are omitted from the text stream;
 * inter-block boundaries and intra-block <br> linebreaks project to '\n'.
 */

import type { ComposerNativeRange } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** One ordinary text node mapped to authoritative UTF-16 draft offsets. */
export interface ComposerDomTextRun {
  readonly node: Text
  readonly start: number
  readonly end: number
}

/** One direct Lexical block mapped to authoritative UTF-16 draft offsets. */
export interface ComposerDomBlockRun {
  readonly element: HTMLElement
  readonly start: number
  readonly end: number
  readonly empty: boolean
  readonly containsNativeObject: boolean
  /**
   * True when the block spans more than one source line, either via an
   * internal <br> or via raw '\n' characters kept inside a single text node
   * (DSH Core drops a whole plain-text paste into one <p> this way). Block-
   * level presentation classes assume one block per source line; consumers
   * must not paint them on a multiline block whose lines disagree.
   */
  readonly multiline: boolean
}

/** A DOM point used by CSS Highlight ranges. */
export interface ComposerDomPoint {
  readonly node: Text
  readonly offset: number
}

/** Normalize source line endings for an ephemeral editor document. */
export function normalizeEditorSourceForDocument(source: string): string {
  return source.replace(/\r\n?|\n/gu, '\n')
}

/** Contenteditable may store spaces as U+00A0; compare-insensitive, length-preserving. */
function normalizeForCompare(text: string): string {
  return text.replace(/\u00a0/gu, ' ')
}

interface BlockUnit {
  readonly kind: 'text' | 'br'
  readonly node?: Text
  readonly text: string
}

/**
 * Extract text nodes and explicit linebreaks from one Lexical block, ignoring
 * chip interiors (contenteditable="false"). Trailing empty placeholder breaks
 * are ignored so they don't produce phantom newlines.
 */
function extractBlockUnits(element: HTMLElement): BlockUnit[] {
  const units: BlockUnit[] = []
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (node instanceof HTMLElement && node.getAttribute('contenteditable') === 'false') {
          return NodeFilter.FILTER_REJECT
        }
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT
        if (node instanceof HTMLBRElement) return NodeFilter.FILTER_ACCEPT
        return NodeFilter.FILTER_SKIP
      },
    },
  )

  let current = walker.nextNode()
  while (current !== null) {
    if (current.nodeType === Node.TEXT_NODE) {
      const textNode = current as Text
      if (textNode.data !== '') {
        units.push({ kind: 'text', node: textNode, text: textNode.data })
      }
    } else if (current instanceof HTMLBRElement) {
      units.push({ kind: 'br', text: '\n' })
    }
    current = walker.nextNode()
  }

  // A trailing <br> in an empty block or at the end of a block is Lexical's
  // visual placeholder; it doesn't contribute a real newline to the text.
  if (units.length > 0 && units[units.length - 1]!.kind === 'br') {
    units.pop()
  }
  return units
}

/**
 * Map the ordinary Lexical text projection to draft offsets.
 *
 * Strict: when the rendered DOM text does not equal the ordinary source
 * projection exactly, the whole mapping is refused (undefined) and no
 * highlight is painted. A stale or unsupported DOM must never receive
 * mis-offset paint — unpainted text keeps its default color, mis-painted
 * text can turn invisible or take another construct's style. Contenteditable
 * NBSP variance (U+00A0 for spaces) is tolerated because it preserves
 * UTF-16 length one-to-one.
 */
export function composerDomTextRuns(
  root: HTMLElement,
  source: string,
  nativeRanges: readonly ComposerNativeRange[],
): ComposerDomTextRun[] | undefined {
  const blocks = directBlocks(root)
  if (blocks.length === 0) return undefined

  const ordinary = ordinarySource(source, nativeRanges)
  const blockUnitsList = blocks.map(extractBlockUnits)
  const rendered = blockUnitsList.map(units => units.map(unit => unit.text).join('')).join('\n')
  if (normalizeForCompare(rendered) !== normalizeForCompare(ordinary)) return undefined

  const runs: ComposerDomTextRun[] = []
  let ordinaryPos = 0

  for (const [index, units] of blockUnitsList.entries()) {
    if (index > 0) ordinaryPos += 1 // \n between adjacent direct blocks
    for (const unit of units) {
      if (unit.kind === 'br') {
        ordinaryPos += 1
        continue
      }
      if (unit.node === undefined) continue
      const len = unit.text.length
      const start = sourceOffsetAtOrdinaryIndex(source, nativeRanges, ordinaryPos, 'start')
      const end = sourceOffsetAtOrdinaryIndex(source, nativeRanges, ordinaryPos + len, 'end')
      if (start === undefined || end === undefined || start > end) return undefined
      runs.push({ node: unit.node, start, end })
      ordinaryPos += len
    }
  }

  return ordinaryPos === ordinary.length ? runs : undefined
}

/**
 * Map direct Lexical blocks to source ranges for block-level presentation.
 */
export function composerDomBlockRuns(
  root: HTMLElement,
  source: string,
  nativeRanges: readonly ComposerNativeRange[],
): ComposerDomBlockRun[] | undefined {
  const blocks = directBlocks(root)
  if (blocks.length === 0) return undefined
  // Block classes paint whole Lexical elements; only install them when the
  // text projection is exact, so a stale DOM never takes a wrong class.
  if (composerDomTextRuns(root, source, nativeRanges) === undefined) return undefined
  const ordinaryLength = ordinarySource(source, nativeRanges).length
  const runs: ComposerDomBlockRun[] = []
  let ordinaryStart = 0
  for (const [index, element] of blocks.entries()) {
    if (index > 0) ordinaryStart += 1
    const units = extractBlockUnits(element)
    const length = units.reduce((total, u) => total + u.text.length, 0)
    const start = sourceOffsetAtOrdinaryIndex(source, nativeRanges, ordinaryStart, 'start')
    const end = length === 0
      ? start
      : sourceOffsetAtOrdinaryIndex(source, nativeRanges, ordinaryStart + length, 'end')
    if (start === undefined || end === undefined || start > end) return undefined
    const containsNativeObject = element.querySelector('[contenteditable="false"]') !== null
    const multiline = units.some(unit => unit.kind === 'br' || unit.text.includes('\n'))
    runs.push({ element, start, end, empty: length === 0, containsNativeObject, multiline })
    ordinaryStart += length
  }
  return ordinaryStart === ordinaryLength ? runs : undefined
}

/**
 * Resolve one draft offset to a text node without crossing a Core-owned chip.
 */
export function composerDomPoint(
  runs: readonly ComposerDomTextRun[],
  offset: number,
  bias: 'start' | 'end',
): ComposerDomPoint | undefined {
  if (bias === 'start') {
    for (const run of runs) {
      if (offset >= run.start && offset < run.end) return { node: run.node, offset: offset - run.start }
      if (offset === run.start) return { node: run.node, offset: 0 }
    }
    const last = runs.at(-1)
    return last !== undefined && offset === last.end ? { node: last.node, offset: last.node.data.length } : undefined
  }
  for (const run of runs) {
    if (offset > run.start && offset <= run.end) return { node: run.node, offset: offset - run.start }
    if (offset === run.start) return { node: run.node, offset: 0 }
  }
  return undefined
}

function directBlocks(root: HTMLElement): HTMLElement[] {
  return [...root.children].filter((child): child is HTMLElement => child instanceof HTMLElement)
}

function ordinarySource(source: string, nativeRanges: readonly ComposerNativeRange[]): string {
  const ranges = sortedNativeRanges(source, nativeRanges)
  let cursor = 0
  let result = ''
  for (const range of ranges) {
    if (range.start > cursor) result += normalizeEditorSourceForDocument(source.slice(cursor, range.start))
    cursor = Math.max(cursor, range.end)
  }
  return result + normalizeEditorSourceForDocument(source.slice(cursor))
}

function sourceOffsetAtOrdinaryIndex(
  source: string,
  nativeRanges: readonly ComposerNativeRange[],
  ordinaryIndex: number,
  bias: 'start' | 'end',
): number | undefined {
  const projection = ordinaryProjection(source, nativeRanges)
  if (ordinaryIndex < 0 || ordinaryIndex > projection.text.length) return undefined
  if (bias === 'start') {
    if (ordinaryIndex === projection.text.length) return projection.after.at(-1) ?? source.length
    return projection.before[ordinaryIndex]
  }
  if (ordinaryIndex === 0) return 0
  return projection.after[ordinaryIndex - 1]
}

interface OrdinaryProjection {
  readonly text: string
  readonly before: readonly number[]
  readonly after: readonly number[]
}

function ordinaryProjection(source: string, nativeRanges: readonly ComposerNativeRange[]): OrdinaryProjection {
  const before: number[] = []
  const after: number[] = []
  let text = ''
  let cursor = 0
  const append = (start: number, end: number): void => {
    let index = start
    while (index < end) {
      const current = source[index]
      if (current === '\r' && source[index + 1] === '\n' && index + 1 < end) {
        text += '\n'
        before.push(index)
        after.push(index + 2)
        index += 2
      } else if (current === '\r') {
        text += '\n'
        before.push(index)
        after.push(index + 1)
        index += 1
      } else {
        text += current ?? ''
        before.push(index)
        after.push(index + 1)
        index += 1
      }
    }
  }
  for (const range of sortedNativeRanges(source, nativeRanges)) {
    if (range.start > cursor) append(cursor, range.start)
    cursor = Math.max(cursor, range.end)
  }
  append(cursor, source.length)
  return { text, before, after }
}

function sortedNativeRanges(
  source: string,
  nativeRanges: readonly ComposerNativeRange[],
): ComposerNativeRange[] {
  return nativeRanges
    .filter(range => Number.isInteger(range.start) && Number.isInteger(range.end)
      && range.start >= 0 && range.start < range.end && range.end <= source.length)
    .sort((left, right) => left.start - right.start || left.end - right.end)
}
