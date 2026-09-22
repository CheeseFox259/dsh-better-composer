import type { ComposerEditResult } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ComposerNativeRange } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MAX_COMPLETION_SCAN_LENGTH } from './limits.ts'

/** Native interaction owner that has priority over Markdown completion. */
export type MarkdownCompletionTriggerOwner = 'none' | 'at' | 'slash' | 'native'

/** One source segment available to the Markdown scanner. */
export interface MarkdownCompletionSegment {
  /** Segment start in the authoritative source, measured in UTF-16 units. */
  readonly sourceStart: number
  /** Ordinary source text between Context Object barriers. */
  readonly text: string
}

/** Read-only input used to derive one deterministic Markdown completion. */
export interface MarkdownCompletionInput {
  /** Full authoritative draft, used for range validation and legacy callers. */
  readonly draft: string
  /** InputMachine revision associated with `draft`. */
  readonly draftRev: number
  /** Authoritative source selection. Completion only considers a collapsed caret. */
  readonly selection: { readonly start: number; readonly end: number }
  /** Native ranges that completion must not enter or cross. */
  readonly nativeRanges: readonly ComposerNativeRange[]
  /** True while the browser owns the composing transaction. */
  readonly composing: boolean
  /** Existing native trigger owner, when `@` or `/` has priority. */
  readonly triggerOwner: MarkdownCompletionTriggerOwner
  /** Core-derived ordinary text segments; absent only for legacy source-only callers. */
  readonly segments?: readonly MarkdownCompletionSegment[]
}

/** One fixed candidate in a Markdown popup. */
export interface MarkdownCompletionCandidate {
  /** Stable display label. */
  readonly label: string
  /** Complete replacement text for the candidate span. */
  readonly insertText: string
}

/** A deterministic candidate popup projected at one source range. */
export interface MarkdownCompletionPopup {
  readonly revision: number
  readonly kind: 'popup'
  readonly from: number
  readonly to: number
  readonly candidates: readonly MarkdownCompletionCandidate[]
}

/** A deterministic suffix projected after the source caret. */
export interface MarkdownCompletionGhost {
  readonly revision: number
  readonly kind: 'ghost'
  readonly from: number
  readonly to: number
  readonly insertText: string
  readonly label: string
}

/** The presentation-only Markdown completion state. */
export type MarkdownCompletionState = MarkdownCompletionPopup | MarkdownCompletionGhost

const FENCE_LANGUAGES = ['bash', 'json', 'python', 'ts'] as const
const SECTION_NAMES = ['Goal', 'Task', 'Context', 'Constraints', 'Requirements', 'Validation', 'Acceptance Criteria'] as const

/**
 * Derive the fixed Markdown candidate or ghost state for one source snapshot.
 * The function is synchronous, source-only, and never performs an edit.
 * @param input - revision-paired source, selection, barriers, and arbitration state.
 * @returns a popup/ghost projection, or `undefined` when Markdown does not own presentation.
 */
export function markdownCompletion(input: MarkdownCompletionInput): MarkdownCompletionState | undefined {
  if (input.composing || input.triggerOwner !== 'none') return undefined
  if (!validCollapsedSelection(input.draft, input.selection)) return undefined

  const segment = segmentAtCaret(input)
  if (segment === undefined) return undefined
  const localCaret = input.selection.start - segment.sourceStart
  if (localCaret < 0 || localCaret > segment.text.length) return undefined

  const lineStart = segment.text.lastIndexOf('\n', Math.max(0, localCaret - 1)) + 1
  if (localCaret - lineStart > MAX_COMPLETION_SCAN_LENGTH) return undefined
  const linePrefix = segment.text.slice(lineStart, localCaret).replace(/\r$/u, '')
  const lineSourceStart = segment.sourceStart + lineStart
  const lineCaret = localCaret - lineStart
  const revision = input.draftRev

  if (insideFenceBeforeLine(segment.text, lineStart)) return undefined

  const fencePopup = fenceLanguagePopup(linePrefix, lineSourceStart, lineCaret, revision)
  if (fencePopup !== undefined && !nativeRangeIntersects(input, fencePopup.from, fencePopup.to)) return fencePopup

  const taskPopup = taskMarkerPopup(linePrefix, lineSourceStart, lineCaret, revision)
  if (taskPopup !== undefined) return taskPopup

  if (/^[ \t]{0,3}#{1,6}$/u.test(linePrefix)) {
    return {
      revision,
      kind: 'popup',
      from: input.selection.start,
      to: input.selection.end,
      candidates: [{ label: '标题空格', insertText: ' ' }],
    }
  }

  const ghost = sectionGhost(linePrefix, input.selection.start, revision)
  return ghost === undefined || nativeRangeIntersects(input, ghost.from, ghost.to) ? undefined : ghost
}

/**
 * Accept one previously projected completion only when its revision is still current.
 * The supplied callback is the caller's EditorTransactionBridge path; this helper never
 * mutates an editor or calls a provider.
 * @param input - completion, current revision snapshot, and bridge-backed apply callback.
 * @returns acceptance status; stale or rejected requests are fail-open.
 */
export function acceptMarkdownCompletion(input: {
  readonly completion: {
    readonly revision: number
    readonly from: number
    readonly to: number
    readonly insertText: string
  }
  readonly snapshot: { readonly draftRev: number; readonly draft?: string }
  readonly apply: (edit: ComposerEditResult, draftRev: number) => boolean | void
}): { readonly accepted: true } | { readonly accepted: false; readonly reason: 'stale' | 'invalid' | 'rejected' } {
  const { completion, snapshot } = input
  if (completion.revision !== snapshot.draftRev) return { accepted: false, reason: 'stale' }
  if (snapshot.draft !== undefined
    && (!validRange(snapshot.draft, completion.from, completion.to)
      || !isUtf16Boundary(snapshot.draft, completion.from)
      || !isUtf16Boundary(snapshot.draft, completion.to))) {
    return { accepted: false, reason: 'invalid' }
  }
  const edit: ComposerEditResult = {
    start: completion.from,
    end: completion.to,
    text: completion.insertText,
    selectionStart: completion.from + completion.insertText.length,
    selectionEnd: completion.from + completion.insertText.length,
  }
  try {
    return input.apply(edit, completion.revision) === false
      ? { accepted: false, reason: 'rejected' }
      : { accepted: true }
  } catch {
    return { accepted: false, reason: 'rejected' }
  }
}

function segmentAtCaret(input: MarkdownCompletionInput): MarkdownCompletionSegment | undefined {
  const segments = input.segments === undefined || input.segments.length === 0
    ? [{ sourceStart: 0, text: input.draft }]
    : input.segments
  const caret = input.selection.start
  return segments.find(segment => segment.sourceStart === caret)
    ?? segments.find(segment => segment.sourceStart < caret && caret <= segment.sourceStart + segment.text.length)
}

function fenceLanguagePopup(
  linePrefix: string,
  lineSourceStart: number,
  localCaret: number,
  revision: number,
): MarkdownCompletionPopup | undefined {
  const match = /^([ \t]{0,3})(`{3,}|~{3,})([A-Za-z0-9_-]*)$/u.exec(linePrefix)
  if (match === null) return undefined
  const query = match[3] ?? ''
  const candidates = FENCE_LANGUAGES
    .filter(language => language.startsWith(query.toLowerCase()) && language !== query.toLowerCase())
    .map(label => ({ label, insertText: label }))
  if (candidates.length === 0) return undefined
  return {
    revision,
    kind: 'popup',
    from: lineSourceStart + localCaret - query.length,
    to: lineSourceStart + localCaret,
    candidates,
  }
}

function taskMarkerPopup(
  linePrefix: string,
  lineSourceStart: number,
  localCaret: number,
  revision: number,
): MarkdownCompletionPopup | undefined {
  const match = /^([ \t]{0,3}[-+*][ \t]+)\[([ xX]?)$/u.exec(linePrefix)
  if (match === null) return undefined
  const state = match[2] ?? ''
  const candidates = state === '' || state === ' '
    ? [{ label: '[ ]', insertText: ' ] ' }]
    : [{ label: '[x]', insertText: 'x] ' }]
  return {
    revision,
    kind: 'popup',
    from: lineSourceStart + localCaret - state.length,
    to: lineSourceStart + localCaret,
    candidates,
  }
}

function sectionGhost(linePrefix: string, caret: number, revision: number): MarkdownCompletionGhost | undefined {
  if (linePrefix.endsWith(' ')) return undefined
  const match = /^[ \t]{0,3}#{1,6}[ \t]+([^ \t].*?)$/u.exec(linePrefix)
  if (match === null) return undefined
  const typed = match[1]?.trimEnd() ?? ''
  if (typed === '') return undefined
  const label = SECTION_NAMES.find(name => name.toLowerCase().startsWith(typed.toLowerCase()) && name.length > typed.length)
  if (label === undefined) return undefined
  return {
    revision,
    kind: 'ghost',
    from: caret,
    to: caret,
    insertText: label.slice(typed.length),
    label,
  }
}

function insideFenceBeforeLine(source: string, lineStart: number): boolean {
  if (lineStart > MAX_COMPLETION_SCAN_LENGTH) return true
  let open: { readonly character: '`' | '~'; readonly length: number } | undefined
  for (const line of source.slice(0, lineStart).split('\n')) {
    const marker = /^[ \t]{0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (marker === undefined) continue
    if (open === undefined) {
      open = { character: marker[0] as '`' | '~', length: marker.length }
    } else if (marker[0] === open.character && marker.length >= open.length) {
      open = undefined
    }
  }
  return open !== undefined
}

function nativeRangeIntersects(input: MarkdownCompletionInput, start: number, end: number): boolean {
  return input.nativeRanges.some(range => range.start < end && start < range.end)
}

function validCollapsedSelection(
  draft: string,
  selection: { readonly start: number; readonly end: number },
): boolean {
  return selection.start === selection.end
    && validRange(draft, selection.start, selection.end)
    && isUtf16Boundary(draft, selection.start)
}

function validRange(draft: string, start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end <= draft.length
}

function isUtf16Boundary(source: string, offset: number): boolean {
  if (offset <= 0 || offset >= source.length) return true
  const before = source.charCodeAt(offset - 1)
  const after = source.charCodeAt(offset)
  return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF)
}
