import type {
  ComposerDecorationContext, ComposerDecorationProvider, ComposerDecorationSegment,
  ComposerNativeRange,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { collectDecorationSegments } from './decoration-composer.ts'
import { composerDomBlockRuns, composerDomTextRuns, type ComposerDomBlockRun } from './dom-mapping.ts'

interface HighlightValue { add(range: Range): void }
interface HighlightRegistry { set(name: string, value: HighlightValue): void; delete(name: string): boolean }
interface HighlightConstructor { new (): HighlightValue }
interface HighlightGlobals {
  readonly CSS?: { readonly highlights?: HighlightRegistry }
  readonly Highlight?: HighlightConstructor
}

interface PendingUpdate {
  readonly provider: ComposerDecorationProvider
  readonly context: ComposerDecorationContext
}

interface OwnedBlockClasses {
  readonly element: HTMLElement
  readonly classes: Set<string>
}

/**
 * Keeps one presentation transaction alive for the lifetime of one input.
 * Updates are committed after Core's DOM mutation, and a failed mapping keeps
 * the last valid paint instead of tearing it down for one frame.
 */
export interface ComposerVisualController {
  update(provider: ComposerDecorationProvider, context: ComposerDecorationContext): void
  dispose(): void
}

export function createComposerVisualController(root: HTMLElement): ComposerVisualController {
  const globals = globalThis as unknown as HighlightGlobals
  const registry = globals.CSS?.highlights
  const Highlight = globals.Highlight
  const ownedHighlights = new Set<string>()
  const ownedClasses = new Map<HTMLElement, OwnedBlockClasses>()
  let pending: PendingUpdate | undefined
  let frame = 0
  let retries = 0
  let disposed = false
  let observer: MutationObserver | undefined

  root.setAttribute('data-better-composer-visual-root', 'true')
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => schedule())
    observer.observe(root, { childList: true, characterData: true, subtree: true })
  }

  const schedule = (): void => {
    if (disposed || frame !== 0) return
    if (typeof requestAnimationFrame === 'function') {
      frame = 1
      const id = requestAnimationFrame(() => {
        frame = 0
        commit()
      })
      if (frame !== 0) frame = id
    } else {
      frame = 1
      queueMicrotask(() => {
        frame = 0
        commit()
      })
    }
  }

  const commit = (): void => {
    const next = pending
    if (next === undefined || disposed) return
    const segments = collectDecorationSegments(next.provider, next.context)
    if (segments === undefined) return
    const runs = composerDomTextRuns(root, next.context.draft, next.context.nativeRanges)
    const blocks = composerDomBlockRuns(root, next.context.draft, next.context.nativeRanges)
    if (runs === undefined || blocks === undefined) {
      if (retries < 4) {
        retries += 1
        schedule()
      }
      return
    }
    retries = 0
    const conflicting = new Set(blocks.filter(block => block.multiline
      && blockClassesConflict(block, next.context.draft, segments)).map(block => block.element))
    commitHighlights(runs, next.context.draft, segments, conflicting)
    commitStructural(blocks, next.context.draft, next.context.nativeRanges, segments, conflicting)
  }

  const commitHighlights = (
    runs: NonNullable<ReturnType<typeof composerDomTextRuns>>,
    source: string,
    segments: readonly ComposerDecorationSegment[],
    conflicting: ReadonlySet<HTMLElement>,
  ): void => {
    if (registry === undefined || Highlight === undefined) return
    const next = new Map<string, Range[]>()
    for (const segment of segments) {
      if (!validTextSegment(segment, source)) continue
      for (const run of runs) {
        const start = Math.max(segment.start, run.start)
        const end = Math.min(segment.end, run.end)
        if (start >= end) continue
        const unsafe = [...conflicting].some(block => block.contains(run.node))
        for (const token of segment.className.split(' ')) {
          if (token === '' || (unsafe && hidesSource(token))) continue
          const range = document.createRange()
          range.setStart(run.node, start - run.start)
          range.setEnd(run.node, end - run.start)
          const values = next.get(token)
          if (values === undefined) next.set(token, [range])
          else values.push(range)
        }
      }
    }

    const installed = new Set<string>()
    try {
      for (const [token, ranges] of next) {
        const highlight = new Highlight()
        for (const range of ranges) highlight.add(range)
        const name = highlightName(token)
        registry.set(name, highlight)
        installed.add(name)
      }
    } catch {
      return
    }
    for (const name of ownedHighlights) {
      if (!installed.has(name)) registry.delete(name)
    }
    ownedHighlights.clear()
    for (const name of installed) ownedHighlights.add(name)
  }

  const commitStructural = (
    blocks: NonNullable<ReturnType<typeof composerDomBlockRuns>>,
    source: string,
    nativeRanges: readonly ComposerNativeRange[],
    segments: readonly ComposerDecorationSegment[],
    conflicting: ReadonlySet<HTMLElement>,
  ): void => {
    const desired = new Map<HTMLElement, Set<string>>()
    for (const segment of segments) {
      if (!validBlockSegment(segment, source) || crossesNative(segment, nativeRanges)) continue
      if (segment.blockClassName === undefined) continue
      for (const block of blocks) {
        if (block.containsNativeObject || conflicting.has(block.element)
          || !blockIntersects(segment, block.start, block.end, block.empty)) continue
        const classes = desired.get(block.element) ?? new Set<string>()
        for (const className of segment.blockClassName.split(' ')) {
          if (className !== '') classes.add(className)
        }
        desired.set(block.element, classes)
      }
    }

    for (const [element, classes] of desired) {
      const owned = ownedClasses.get(element)?.classes ?? new Set<string>()
      for (const className of classes) {
        element.classList.add(className)
        owned.add(className)
      }
      ownedClasses.set(element, { element, classes: owned })
    }
    for (const [element, owned] of ownedClasses) {
      const wanted = desired.get(element) ?? new Set<string>()
      for (const className of [...owned.classes]) {
        if (wanted.has(className)) continue
        element.classList.remove(className)
        owned.classes.delete(className)
      }
      if (owned.classes.size === 0) ownedClasses.delete(element)
    }
  }

  return {
    update(provider, context) {
      if (disposed) return
      pending = { provider, context }
      retries = 0
      schedule()
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      frame = 0
      observer?.disconnect()
      if (registry !== undefined) {
        for (const name of ownedHighlights) registry.delete(name)
      }
      for (const { element, classes } of ownedClasses.values()) {
        for (const className of classes) element.classList.remove(className)
      }
      ownedHighlights.clear()
      ownedClasses.clear()
      root.removeAttribute('data-better-composer-visual-root')
    },
  }
}

function validTextSegment(segment: ComposerDecorationSegment, source: string): boolean {
  return Number.isInteger(segment.start) && Number.isInteger(segment.end)
    && segment.start >= 0 && segment.start < segment.end && segment.end <= source.length
    && segment.className.trim() === segment.className && !/\s{2,}/u.test(segment.className)
}

function validBlockSegment(segment: ComposerDecorationSegment, source: string): boolean {
  return validTextSegment(segment, source)
    && segment.blockClassName !== undefined
    && segment.blockClassName.trim() === segment.blockClassName
    && segment.blockClassName.length > 0
    && !/\s{2,}/u.test(segment.blockClassName)
    && segment.blockClassName.split(' ').every(token => /^[A-Za-z0-9_-]+$/u.test(token))
}

function crossesNative(segment: ComposerDecorationSegment, ranges: readonly ComposerNativeRange[]): boolean {
  return ranges.some(range => range.start < range.end && segment.start < range.end && range.start < segment.end)
}

function blockIntersects(segment: ComposerDecorationSegment, start: number, end: number, empty: boolean): boolean {
  return empty ? segment.start <= start && start < segment.end : start < segment.end && segment.start < end
}

function blockClassesConflict(
  block: ComposerDomBlockRun,
  source: string,
  segments: readonly ComposerDecorationSegment[],
): boolean {
  const lines = source.slice(block.start, block.end).split('\n')
  let offset = block.start
  let expected: string | undefined
  for (const line of lines) {
    const end = offset + line.replace(/\r$/u, '').length
    if (source.slice(offset, end).trim() !== '') {
      const classes = new Set<string>()
      for (const segment of segments) {
        if (segment.blockClassName === undefined || segment.start >= end || segment.end <= offset) continue
        for (const token of segment.blockClassName.split(' ')) if (token !== '') classes.add(token)
      }
      const signature = [...classes].sort().join(' ')
      if (expected !== undefined && signature !== expected) return true
      expected = signature
    }
    offset += line.length + 1
  }
  return false
}

function hidesSource(token: string): boolean {
  return token.endsWith('-hidden') || token === 'dsh-better-composer-fence-language-visible'
    || /^dsh-better-composer-table-divider(?:-active)?$/u.test(token)
    || token === 'dsh-better-composer-table-separator'
}

function highlightName(token: string): string {
  return `dsh-composer-${token.replace(/[^a-zA-Z0-9_-]/gu, '_')}`
}
