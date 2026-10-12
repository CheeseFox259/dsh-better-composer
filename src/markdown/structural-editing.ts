/**
 * Structural keyboard editing over the authoritative draft.
 *
 * Direct port of the canonical DSH harness `composer-structural-editing.ts`
 * (MIT, (c) DeepSeek), with protected-range remapping inlined from
 * `composer-edit.ts`. The pure command utility calculates Shift+Enter and
 * Enter continuation edits for callers with a paragraph-break seam; the
 * plugin keymap admits Tab/Shift+Tab through it directly.
 *
 * Line-break continuation cannot use that atomic path: the official
 * InputActions seam cannot create a paragraph while preserving the caret
 * (`insertText` splices raw text, `setDraft` strips reference chips and
 * forces the caret to the end). The plugin therefore splits continuation
 * into a post-hoc pair: `armBreakContinuation` runs at keydown (before the
 * host's native break) and records the intent; `settleBreakContinuation`
 * runs once the break lands in the draft and yields a newline-free
 * follow-up edit (insert the prefix, or delete the prefix of an emptied
 * item) that the insertText seam CAN express. All admitted edits go through
 * the revision-guarded transaction bridge; anything unsafe passes back to
 * the native composer path untouched.
 *
 * Known deviations from the atomic path: an emptied item exits the list on
 * Shift+Enter, where the atomic path passes Shift+Enter through; and the
 * ordered-run renumber trails the prefix insert as a chain of within-line
 * digit edits (one undo step each), because one atomic rewrite would span
 * newlines the seam cannot express.
 */

import type { ComposerEditResult, ComposerNativeRange } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Structural commands the capture keymap can admit. */
export type ComposerStructuralCommandKind = 'enter' | 'shift-enter' | 'indent' | 'outdent'

/** Result of one deterministic structural keyboard admission attempt. */
export type ComposerStructuralCommandResult =
  | { readonly kind: 'applied'; readonly edit: ComposerEditResult }
  | { readonly kind: 'pass' }
  | { readonly kind: 'noop'; readonly reason: string }

/** Request for one source-only structural command. */
export interface ComposerStructuralCommandRequest {
  /** Structural command selected after completion arbitration. */
  readonly kind: ComposerStructuralCommandKind
  /** Revision-paired authoritative composer snapshot. */
  readonly context: {
    readonly draft: string
    readonly draftRev: number
    readonly selection: { readonly start: number; readonly end: number }
    readonly nativeRanges: readonly ComposerNativeRange[]
  }
  /** Whether an IME composition owns the current key. */
  readonly composing: boolean
  /** Core transaction seam used for the accepted edit. */
  readonly apply: (edit: ComposerEditResult, draftRev: number) => boolean
}

interface SourceLine {
  readonly start: number
  readonly contentEnd: number
  readonly end: number
  readonly eol: string
  readonly text: string
}

type StructuralLine =
  | { readonly kind: 'unordered'; readonly prefix: string; readonly empty: boolean }
  | { readonly kind: 'task'; readonly prefix: string; readonly empty: boolean }
  | {
    readonly kind: 'ordered'
    readonly prefix: string
    readonly sourcePrefix: string
    readonly indentation: string
    readonly delimiter: string
    readonly spacing: string
    readonly number: number
    readonly empty: boolean
  }
  | { readonly kind: 'blockquote'; readonly prefix: string; readonly empty: boolean }
  | { readonly kind: 'ordinary' }

interface FenceMarker {
  readonly character: '`' | '~'
  readonly length: number
}

/**
 * Admit Shift+Enter, Tab, and Shift+Tab using only source text. A successful
 * result is one edit through the Core transaction bridge; all other results
 * leave the native composer path in control.
 *
 * Non-structural lines and code fences pass through unchanged to preserve the
 * host's native Enter, submit, and Shift+Enter semantics.
 */
export function runComposerStructuralCommand(
  request: ComposerStructuralCommandRequest,
): ComposerStructuralCommandResult {
  if (request.composing) return { kind: 'pass' }
  const { context } = request
  if (!validSelection(context.draft, context.selection)) {
    return { kind: 'noop', reason: 'invalid-selection' }
  }
  if (crossesNativeRange(context.nativeRanges, context.selection)) {
    return { kind: 'noop', reason: 'context-object-barrier' }
  }

  const line = lineAt(context.draft, context.selection.start)
  if (line === undefined) return { kind: 'noop', reason: 'source-line-unavailable' }
  const decision = request.kind === 'shift-enter' || request.kind === 'enter'
    ? lineBreakEdit(context.draft, line, context.selection, request.kind)
    : listIndentationEdit(context.draft, request.kind, context.selection)
  if (decision.kind !== 'edit') return decision
  if (!validStructuralEdit(decision.value, context)) {
    return { kind: 'noop', reason: 'invalid-structural-edit' }
  }

  try {
    return request.apply(decision.value, context.draftRev)
      ? { kind: 'applied', edit: decision.value }
      : { kind: 'noop', reason: 'stale-revision-or-rejected-edit' }
  } catch {
    return { kind: 'noop', reason: 'structural-apply-failed' }
  }
}

type EditDecision = { readonly kind: 'edit'; readonly value: ComposerEditResult }
  | { readonly kind: 'pass' }
  | { readonly kind: 'noop'; readonly reason: string }

/**
 * List/quote continuation intent recorded at Shift+Enter keydown, before
 * the host's native line break lands in the draft.
 */
export interface ArmedBreakContinuation {
  /** Draft text the intent was computed against. */
  readonly draft: string
  /** Collapsed caret the intent was computed against. */
  readonly caret: number
  /** The newline-free follow-up edit the break makes applicable. */
  readonly followUp:
    | {
      readonly kind: 'insert-prefix'
      readonly prefix: string
      /** Present for ordered items: the new item's own number context. */
      readonly ordered?: { readonly indentation: string; readonly delimiter: string; readonly number: number }
    }
    | { readonly kind: 'remove-prefix'; readonly start: number; readonly end: number }
}

/** One within-line digit rewrite, in post-insert draft coordinates. */
export interface OrderedRenumberEdit {
  readonly start: number
  readonly end: number
  readonly text: string
  /** The digits expected at [start, end); a mismatch means the draft moved on. */
  readonly expect: string
}

/** The follow-up edit plus any ordered-run renumber trailing it. */
export interface SettledBreakContinuation {
  readonly edit: ComposerEditResult
  /**
   * Sibling renumber edits for an ordered continuation, in REVERSE document
   * order so digit-length changes never shift a pending edit's coordinates.
   * Each is newline-free and must be applied against `baseDraft` evolved by
   * the previously applied edits.
   */
  readonly renumber: readonly OrderedRenumberEdit[]
  /** The draft after `edit` is applied; the renumber edits' coordinate base. */
  readonly baseDraft: string
}

/**
 * Arm a list/quote continuation for one Shift+Enter. Returns undefined when
 * the caret is not on a continuable line (ordinary text, fenced code,
 * non-collapsed selection, chip interior), leaving the native break bare.
 */
export function armBreakContinuation(
  draft: string,
  selection: { readonly start: number; readonly end: number },
  nativeRanges: readonly ComposerNativeRange[],
): ArmedBreakContinuation | undefined {
  if (!validSelection(draft, selection) || selection.start !== selection.end) return undefined
  if (crossesNativeRange(nativeRanges, selection)) return undefined
  if (isInsideFence(draft, selection.start)) return undefined
  const line = lineAt(draft, selection.start)
  if (line === undefined) return undefined
  const continuation = continuationForLine(line.text)
  if (continuation.kind === 'ordinary') return undefined
  const caret = selection.start
  if (continuation.empty) {
    // A caret at the very line start needs no follow-up: the native break
    // alone pushes the empty item down, leaving the desired plain line.
    if (caret === line.start) return undefined
    // Exiting the structure drops the marker of the emptied item; a quote
    // line keeps its indentation, a list item drops it (canonical parity).
    const start = continuation.kind === 'blockquote'
      ? line.start + line.text.length - line.text.trimStart().length
      : line.start
    return { draft, caret, followUp: { kind: 'remove-prefix', start, end: caret } }
  }
  return {
    draft,
    caret,
    followUp: {
      kind: 'insert-prefix',
      prefix: continuation.prefix,
      ...(continuation.kind === 'ordered'
        ? { ordered: { indentation: continuation.indentation, delimiter: continuation.delimiter, number: continuation.number } }
        : {}),
    },
  }
}

/**
 * Settle an armed continuation against the draft observed after the native
 * break. The draft must differ by exactly one `\n` at the armed caret — any
 * other shape means the break did not land as expected (or something else
 * edited first) and the intent is dropped. The returned edit contains no
 * newline, so the official insertText seam can express it.
 */
export function settleBreakContinuation(
  armed: ArmedBreakContinuation,
  nextDraft: string,
): SettledBreakContinuation | undefined {
  const expected = armed.draft.slice(0, armed.caret) + '\n' + armed.draft.slice(armed.caret)
  if (nextDraft !== expected) return undefined
  const { followUp } = armed
  if (followUp.kind === 'insert-prefix') {
    const at = armed.caret + 1
    const edit: ComposerEditResult = { start: at, end: at, text: followUp.prefix, selectionStart: at + followUp.prefix.length, selectionEnd: at + followUp.prefix.length }
    const baseDraft = expected.slice(0, at) + followUp.prefix + expected.slice(at)
    return {
      edit,
      renumber: followUp.ordered === undefined ? [] : orderedRunRenumber(baseDraft, at, followUp.ordered),
      baseDraft,
    }
  }
  return {
    edit: { start: followUp.start, end: followUp.end, text: '', selectionStart: followUp.start, selectionEnd: followUp.start },
    renumber: [],
    baseDraft: expected.slice(0, followUp.start) + expected.slice(followUp.end),
  }
}

const MAX_RENUMBER_EDITS = 200

/**
 * Digit rewrites that renumber the ordered run following a freshly continued
 * item. Returned in reverse document order; digit-length changes then never
 * shift a pending edit. Siblings are same-depth same-delimiter ordered lines;
 * deeper lines ride along untouched, anything else ends the run.
 */
function orderedRunRenumber(
  postInsert: string,
  newItemLineStart: number,
  ordered: { readonly indentation: string; readonly delimiter: string; readonly number: number },
): readonly OrderedRenumberEdit[] {
  const lines = sourceLines(postInsert)
  const newItemIndex = lines.findIndex(line => line.start === newItemLineStart)
  if (newItemIndex < 0) return []
  const edits: OrderedRenumberEdit[] = []
  let expectedNumber = ordered.number + 2
  for (const line of lines.slice(newItemIndex + 1)) {
    const item = continuationForLine(line.text)
    if (item.kind === 'ordered' && item.indentation === ordered.indentation && item.delimiter === ordered.delimiter) {
      const oldDigits = /^ *\d+/u.exec(line.text)?.[0].trim() ?? ''
      const digitStart = line.start + item.indentation.length
      if (oldDigits !== String(expectedNumber)) {
        edits.push({ start: digitStart, end: digitStart + oldDigits.length, text: String(expectedNumber), expect: oldDigits })
      }
      expectedNumber += 1
      if (edits.length >= MAX_RENUMBER_EDITS) break
      continue
    }
    if (leadingWhitespace(line.text).length > ordered.indentation.length && line.text.trim() !== '') continue
    break
  }
  return edits.reverse()
}

function lineBreakEdit(
  source: string,
  line: SourceLine,
  selection: { readonly start: number; readonly end: number },
  kind: 'enter' | 'shift-enter',
): EditDecision {
  const eol = sourceEol(source, line)
  if (selection.start !== selection.end || isInsideFence(source, selection.start)) return { kind: 'pass' }
  const continuation = continuationForLine(line.text)
  if (continuation.kind === 'ordinary') return { kind: 'pass' }
  if (continuation.empty) {
    if (kind === 'shift-enter') return { kind: 'pass' }
    const prefixLength = line.text.length - line.text.trimStart().length
    if (continuation.kind === 'blockquote') {
      return { kind: 'edit', value: replacement(line.start + prefixLength, selection.start, eol) }
    }
    const marker = /^( *)(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/u.exec(line.text)?.[0]
    return marker === undefined
      ? { kind: 'pass' }
      : { kind: 'edit', value: replacement(line.start, selection.start, eol) }
  }
  const text = eol + continuation.prefix
  if (continuation.kind === 'ordered') {
    const run = renumberFollowingOrderedRun(source, line)
    if (run !== undefined) {
      const suffix = source.slice(selection.end, line.contentEnd)
      const replacementText = text + suffix + line.eol + run.text
      const selectionOffset = text.length
      return {
        kind: 'edit',
        value: {
          start: selection.start,
          end: run.end,
          text: replacementText,
          selectionStart: selection.start + selectionOffset,
          selectionEnd: selection.start + selectionOffset,
        },
      }
    }
  }
  return { kind: 'edit', value: replacement(selection.start, selection.end, text) }
}

interface OrderedRunRewrite {
  readonly end: number
  readonly text: string
}

function renumberFollowingOrderedRun(source: string, currentLine: SourceLine): OrderedRunRewrite | undefined {
  const lines = sourceLines(source)
  const currentIndex = lines.findIndex(line => line.start === currentLine.start)
  const current = continuationForLine(currentLine.text)
  if (currentIndex < 0 || current.kind !== 'ordered') return undefined

  const following = lines.slice(currentIndex + 1)
  const rewritten: string[] = []
  let siblingCount = 0
  let lastIncluded: SourceLine | undefined
  for (const line of following) {
    const item = continuationForLine(line.text)
    const indentation = leadingWhitespace(line.text)
    const isChild = indentation.length > current.indentation.length
    if (item.kind === 'ordered'
      && item.indentation === current.indentation
      && item.delimiter === current.delimiter) {
      const number = current.number + 2 + siblingCount
      const sourceText = line.text.slice(item.sourcePrefix.length)
      rewritten.push(`${item.indentation}${number}${item.delimiter}${item.spacing}${sourceText}${line.eol}`)
      siblingCount += 1
      lastIncluded = line
      continue
    }
    if (isChild) {
      rewritten.push(line.text + line.eol)
      lastIncluded = line
      continue
    }
    break
  }
  if (siblingCount === 0 || lastIncluded === undefined) return undefined
  return { end: lastIncluded.end, text: rewritten.join('') }
}

function leadingWhitespace(line: string): string {
  return /^( *)/u.exec(line)?.[1] ?? ''
}

function listIndentationEdit(
  source: string,
  kind: 'indent' | 'outdent',
  selection: { readonly start: number; readonly end: number },
): EditDecision {
  const lines = sourceLines(source)
  const span = linesForSelection(lines, selection.start, selection.end)
  if (span === undefined) return { kind: 'noop', reason: 'source-line-unavailable' }
  const selected = lines.slice(span.first, span.last + 1)
  const classified = selected.map(line => ({ line, value: continuationForLine(line.text) }))
  if (classified.every(item => item.value.kind === 'ordinary')) return { kind: 'pass' }
  if (classified.some(item => item.value.kind !== 'unordered'
    && item.value.kind !== 'task' && item.value.kind !== 'ordered')) {
    return { kind: 'noop', reason: 'mixed-non-list-selection' }
  }
  if (kind === 'outdent' && classified.some(item => !item.line.text.startsWith('  '))) {
    return { kind: 'noop', reason: 'root-list-outdent' }
  }

  const first = selected[0]
  const last = selected.at(-1)
  if (first === undefined || last === undefined) return { kind: 'noop', reason: 'source-line-unavailable' }
  if (selection.start === selection.end) {
    const start = first.start
    const editEnd = kind === 'indent' ? start : start + 2
    const delta = kind === 'indent' ? 2 : -2
    return {
      kind: 'edit',
      value: {
        start,
        end: editEnd,
        text: kind === 'indent' ? '  ' : '',
        selectionStart: mapCollapsedSelection(selection.start, start, editEnd, delta),
        selectionEnd: mapCollapsedSelection(selection.end, start, editEnd, delta),
      },
    }
  }

  const text = selected.map((item) => {
    const next = kind === 'indent' ? `  ${item.text}` : item.text.slice(2)
    return next + item.eol
  }).join('')
  const end = last.end
  const caret = first.start + text.length
  return { kind: 'edit', value: replacement(first.start, end, text, caret) }
}

/** Recognize only the fixed list/quote prefixes needed by structural input. */
function continuationForLine(line: string): StructuralLine {
  const task = /^( *)([-*+])([ \t]+)\[([ xX])\]([ \t]*)(.*)$/u.exec(line)
  if (task !== null) {
    const indentation = task[1] ?? ''
    const marker = task[2] ?? '-'
    const markerSpacing = task[3] ?? ' '
    const contentSpacing = task[5] ?? ''
    return {
      kind: 'task',
      prefix: `${indentation}${marker}${markerSpacing}[ ]${contentSpacing}`,
      empty: (task[6] ?? '').trim() === '',
    }
  }

  const blockquote = /^( *)(>)([ \t]?)(.*)$/u.exec(line)
  if (blockquote !== null) {
    const indentation = blockquote[1] ?? ''
    const spacing = blockquote[3] === '' ? ' ' : blockquote[3]
    return {
      kind: 'blockquote',
      prefix: `${indentation}>${spacing}`,
      empty: (blockquote[4] ?? '').trim() === '',
    }
  }

  const unordered = /^( *)([-*+])([ \t]+)(.*)$/u.exec(line)
  if (unordered !== null) {
    const indentation = unordered[1] ?? ''
    const marker = unordered[2] ?? '-'
    const spacing = unordered[3] ?? ' '
    return {
      kind: 'unordered',
      prefix: `${indentation}${marker}${spacing}`,
      empty: (unordered[4] ?? '').trim() === '',
    }
  }

  const ordered = /^( *)(\d+)([.)])([ \t]+)(.*)$/u.exec(line)
  if (ordered !== null) {
    const indentation = ordered[1] ?? ''
    const numberText = ordered[2] ?? ''
    const number = Number(numberText)
    const delimiter = ordered[3] ?? '.'
    const spacing = ordered[4] ?? ' '
    if (Number.isSafeInteger(number) && number < Number.MAX_SAFE_INTEGER) {
      return {
        kind: 'ordered',
        prefix: `${indentation}${number + 1}${delimiter}${spacing}`,
        sourcePrefix: `${indentation}${numberText}${delimiter}${spacing}`,
        indentation,
        delimiter,
        spacing,
        number,
        empty: (ordered[5] ?? '').trim() === '',
      }
    }
  }
  return { kind: 'ordinary' }
}

function replacement(
  start: number,
  end: number,
  text: string,
  selection = start + text.length,
): ComposerEditResult {
  return { start, end, text, selectionStart: selection, selectionEnd: selection }
}

function mapCollapsedSelection(caret: number, start: number, end: number, delta: number): number {
  if (caret <= start) return caret
  if (caret >= end) return caret + delta
  return start
}

function linesForSelection(
  lines: readonly SourceLine[],
  start: number,
  end: number,
): { readonly first: number; readonly last: number } | undefined {
  const firstLine = lineAtFrom(lines, start)
  const lastLine = lineAtFrom(lines, end)
  if (firstLine === undefined || lastLine === undefined) return undefined
  const first = lines.indexOf(firstLine)
  let last = lines.indexOf(lastLine)
  if (first < 0 || last < first) return undefined
  if (last > first && lastLine.start === end) last -= 1
  return { first, last }
}

function sourceLines(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = []
  let start = 0
  while (start <= source.length) {
    let contentEnd = start
    while (contentEnd < source.length && source[contentEnd] !== '\r' && source[contentEnd] !== '\n') contentEnd += 1
    let end = contentEnd
    if (source[contentEnd] === '\r' && source[contentEnd + 1] === '\n') end += 2
    else if (source[contentEnd] === '\r' || source[contentEnd] === '\n') end += 1
    lines.push({ start, contentEnd, end, eol: source.slice(contentEnd, end), text: source.slice(start, contentEnd) })
    if (end >= source.length) {
      if (end === source.length && end > contentEnd) lines.push({ start: end, contentEnd: end, end, eol: '', text: '' })
      break
    }
    start = end
  }
  return lines
}

function lineAt(source: string, offset: number): SourceLine | undefined {
  return lineAtFrom(sourceLines(source), offset)
}

function lineAtFrom(lines: readonly SourceLine[], offset: number): SourceLine | undefined {
  return lines.find(line => line.start <= offset && offset <= line.contentEnd)
    ?? lines.find(line => line.start === offset)
    ?? lines.at(-1)
}

function sourceEol(source: string, line: SourceLine): string {
  if (line.eol !== '') return line.eol
  return /\r\n|\r|\n/u.exec(source)?.[0] ?? '\n'
}

function validSelection(
  source: string,
  selection: { readonly start: number; readonly end: number },
): boolean {
  return Number.isInteger(selection.start) && Number.isInteger(selection.end)
    && selection.start >= 0 && selection.start <= selection.end && selection.end <= source.length
    && utf16Boundary(source, selection.start) && utf16Boundary(source, selection.end)
}

function utf16Boundary(source: string, offset: number): boolean {
  if (offset === 0 || offset === source.length) return true
  const before = source.charCodeAt(offset - 1)
  const after = source.charCodeAt(offset)
  return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF)
}

function crossesNativeRange(
  ranges: readonly ComposerNativeRange[],
  selection: { readonly start: number; readonly end: number },
): boolean {
  return ranges.some(range => Number.isInteger(range.start) && Number.isInteger(range.end)
    && range.start >= 0 && range.start < range.end
    && (selection.start === selection.end
      ? range.start < selection.start && selection.start < range.end
      : selection.start < range.end && range.start < selection.end))
}

/** Validate a structural edit whose caret may land after a prefix insertion. */
function validStructuralEdit(
  edit: ComposerEditResult,
  context: ComposerStructuralCommandRequest['context'],
): boolean {
  if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)
    || edit.start < 0 || edit.start > edit.end || edit.end > context.draft.length
    || !utf16Boundary(context.draft, edit.start) || !utf16Boundary(context.draft, edit.end)) return false
  const nextDraft = context.draft.slice(0, edit.start) + edit.text + context.draft.slice(edit.end)
  if (!Number.isInteger(edit.selectionStart) || !Number.isInteger(edit.selectionEnd)
    || edit.selectionStart < 0 || edit.selectionStart > edit.selectionEnd || edit.selectionEnd > nextDraft.length
    || !utf16Boundary(nextDraft, edit.selectionStart) || !utf16Boundary(nextDraft, edit.selectionEnd)) return false
  for (const range of context.nativeRanges) {
    if (range.kind !== 'reference' && intersects(edit, range)) return false
  }
  return remapProtectedRanges(
    context.draft,
    edit,
    context.nativeRanges.filter(range => range.kind === 'reference'),
  ) !== undefined
}

function intersects(
  edit: Pick<ComposerEditResult, 'start' | 'end'>,
  range: Pick<ComposerNativeRange, 'start' | 'end'>,
): boolean {
  return edit.start === edit.end
    ? range.start < edit.start && edit.start < range.end
    : edit.start < range.end && range.start < edit.end
}

/**
 * Map every protected range through an edit that preserves each exact text once.
 * Ported from the canonical `composer-edit.ts` validation path.
 */
function remapProtectedRanges(
  draft: string,
  edit: Pick<ComposerEditResult, 'start' | 'end' | 'text'>,
  ranges: readonly Pick<ComposerNativeRange, 'start' | 'end'>[],
): readonly number[] | undefined {
  const delta = edit.text.length - (edit.end - edit.start)
  const mapped = new Array<number>(ranges.length)
  const contained: Array<{ index: number; text: string }> = []
  let previousEnd = 0

  for (const [index, range] of ranges.entries()) {
    if (range.start < previousEnd || range.start < 0 || range.start >= range.end || range.end > draft.length) return undefined
    previousEnd = range.end
    if (range.end <= edit.start) {
      mapped[index] = range.start
      continue
    }
    if (range.start >= edit.end) {
      mapped[index] = range.start + delta
      continue
    }
    if (edit.start > range.start || edit.end < range.end) return undefined
    contained.push({ index, text: draft.slice(range.start, range.end) })
  }

  const expectedCounts = new Map<string, number>()
  for (const range of contained) expectedCounts.set(range.text, (expectedCounts.get(range.text) ?? 0) + 1)
  for (const [text, expected] of expectedCounts) {
    if (nonOverlappingCount(edit.text, text) !== expected) return undefined
  }

  let cursor = 0
  for (const range of contained) {
    const at = edit.text.indexOf(range.text, cursor)
    if (at < 0) return undefined
    mapped[range.index] = edit.start + at
    cursor = at + range.text.length
  }
  return mapped
}

function nonOverlappingCount(haystack: string, needle: string): number {
  let count = 0
  let cursor = 0
  while (cursor <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, cursor)
    if (at < 0) break
    count += 1
    cursor = at + needle.length
  }
  return count
}

function isInsideFence(source: string, caret: number): boolean {
  let open: { readonly line: SourceLine; readonly marker: FenceMarker } | undefined
  for (const line of sourceLines(source)) {
    if (line.start > caret) break
    if (open === undefined) {
      const marker = fenceMarkerOf(line.text)
      if (marker === undefined) continue
      open = { line, marker }
      if (caret <= line.contentEnd) return true
      continue
    }
    if (!closesFence(line.text, open.marker)) continue
    if (caret < line.end) return true
    open = undefined
  }
  return open !== undefined
}

function fenceMarkerOf(line: string): FenceMarker | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  const character = match[1][0]
  if ((character !== '`' && character !== '~') || character === '`' && match[2].includes('`')) return undefined
  return { character, length: match[1].length }
}

function closesFence(line: string, marker: FenceMarker): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line)
  return match !== null && match[1] !== undefined && match[1][0] === marker.character && match[1].length >= marker.length
}
