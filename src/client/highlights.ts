/**
 * Canonical Markdown decoration consumers for the Core-owned contenteditable.
 *
 * Direct port of the canonical DSH harness implementations (MIT, (c) DeepSeek).
 * 1. installComposerDecorationHighlights paints text syntax decorations via
 *    the browser's CSS Highlight API (never touches the DOM or selection).
 * 2. installComposerStructuralDecorations adds class names to direct Lexical
 *    blocks to paint heading scales, code block cards, and list bullets.
 */

import type { ComposerDecorationSegment, ComposerNativeRange } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  composerDomBlockRuns, composerDomPoint, composerDomTextRuns,
} from './dom-mapping.ts'

interface HighlightValue {
  add(range: Range): void
}

interface HighlightRegistry {
  set(name: string, value: HighlightValue): void
  delete(name: string): boolean
}

interface HighlightConstructor {
  new (): HighlightValue
}

interface HighlightGlobals {
  readonly CSS?: { readonly highlights?: HighlightRegistry }
  readonly Highlight?: HighlightConstructor
}

/**
 * Install source-range decorations through the browser's presentation-only
 * CSS Highlight API. The editor DOM and Lexical state remain untouched.
 */
export function installComposerDecorationHighlights(
  root: HTMLElement | null,
  source: string,
  nativeRanges: readonly ComposerNativeRange[],
  segments: readonly ComposerDecorationSegment[] | undefined,
): () => void {
  const globals = globalThis as unknown as HighlightGlobals
  const registry = globals.CSS?.highlights
  const Highlight = globals.Highlight
  if (root === null || registry === undefined || Highlight === undefined || segments === undefined) return () => {}

  const runs = composerDomTextRuns(root, source, nativeRanges)
  if (runs === undefined) return () => {}
  const rangesByToken = new Map<string, Range[]>()
  for (const segment of segments) {
    if (!validSegment(segment, source)) continue
    const start = composerDomPoint(runs, segment.start, 'start')
    const end = composerDomPoint(runs, segment.end, 'end')
    if (start === undefined || end === undefined) continue
    for (const token of segment.className.split(' ')) {
      if (token === '') continue
      const range = document.createRange()
      try {
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
      } catch {
        continue
      }
      const current = rangesByToken.get(token)
      if (current === undefined) rangesByToken.set(token, [range])
      else current.push(range)
    }
  }

  const names: string[] = []
  try {
    for (const [token, ranges] of rangesByToken) {
      const highlight = new Highlight()
      for (const range of ranges) highlight.add(range)
      const name = highlightName(token)
      registry.set(name, highlight)
      names.push(name)
    }
  } catch {
    for (const name of names) registry.delete(name)
    return () => {}
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const name of names) registry.delete(name)
  }
}

/**
 * Install block-level Markdown presentation on Core-owned Lexical elements.
 *
 * This consumer only adds/removes classes. It never enters a Lexical update,
 * writes source, changes selection, or creates history. A source/DOM mismatch
 * or a range that would cross a native Context Object is ignored.
 */
export function installComposerStructuralDecorations(
  root: HTMLElement | null,
  source: string,
  nativeRanges: readonly ComposerNativeRange[],
  segments: readonly ComposerDecorationSegment[] | undefined,
): () => void {
  if (root === null || segments === undefined) return () => {}
  const runs = composerDomBlockRuns(root, source, nativeRanges)
  if (runs === undefined) return () => {}
  const installed = new Map<HTMLElement, Set<string>>()
  for (const segment of segments) {
    if (!validStructuralSegment(segment, source) || crossesNative(segment, nativeRanges)) continue
    const blockClassName = segment.blockClassName
    if (blockClassName === undefined) continue
    for (const run of runs) {
      if (run.containsNativeObject || !blockIntersects(segment, run.start, run.end, run.empty)) continue
      const classes = blockClassName.split(' ')
      for (const className of classes) {
        if (className === '') continue
        const wasPresent = run.element.classList.contains(className)
        run.element.classList.add(className)
        if (wasPresent) continue
        const own = installed.get(run.element)
        if (own === undefined) installed.set(run.element, new Set([className]))
        else own.add(className)
      }
    }
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const [element, classes] of installed) {
      for (const className of classes) element.classList.remove(className)
    }
  }
}

function validSegment(segment: ComposerDecorationSegment, source: string): boolean {
  return Number.isInteger(segment.start) && Number.isInteger(segment.end)
    && segment.start >= 0 && segment.start < segment.end && segment.end <= source.length
    && segment.className.trim() === segment.className && !/\s{2,}/u.test(segment.className)
}

function validStructuralSegment(segment: ComposerDecorationSegment, source: string): boolean {
  return Number.isInteger(segment.start) && Number.isInteger(segment.end)
    && segment.start >= 0 && segment.start < segment.end && segment.end <= source.length
    && surrogateBoundary(source, segment.start) && surrogateBoundary(source, segment.end)
    && segment.blockClassName !== undefined
    && segment.blockClassName.trim() === segment.blockClassName
    && segment.blockClassName.length > 0
    && !/\s{2,}/u.test(segment.blockClassName)
    && segment.blockClassName.split(' ').every((token: string) => /^[A-Za-z0-9_-]+$/u.test(token))
}

function surrogateBoundary(source: string, offset: number): boolean {
  if (offset === 0 || offset === source.length) return true
  const before = source.charCodeAt(offset - 1)
  const after = source.charCodeAt(offset)
  return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF)
}

function crossesNative(
  segment: ComposerDecorationSegment,
  nativeRanges: readonly ComposerNativeRange[],
): boolean {
  return nativeRanges.some(range => Number.isInteger(range.start) && Number.isInteger(range.end)
    && range.start < range.end && segment.start < range.end && range.start < segment.end)
}

function blockIntersects(segment: ComposerDecorationSegment, start: number, end: number, empty: boolean): boolean {
  return empty ? segment.start <= start && start < segment.end : start < segment.end && segment.start < end
}

function highlightName(token: string): string {
  return `dsh-composer-${token.replace(/[^a-zA-Z0-9_-]/gu, '_')}`
}
