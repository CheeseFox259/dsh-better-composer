import type {
  DecorationPlan, InlineDecoration, ListMarkerOverlay,
} from './projection.ts'
import {
  composerDomBlockRuns, composerDomPoint, composerDomTextRuns, type ComposerDomBlockRun, type ComposerDomTextRun,
} from '../client/dom-mapping.ts'

interface HighlightValue { add(range: Range): void }
interface HighlightRegistry { set(name: string, value: HighlightValue): void; delete(name: string): boolean }
interface HighlightConstructor { new (): HighlightValue }
interface HighlightGlobals {
  readonly CSS?: { readonly highlights?: HighlightRegistry }
  readonly Highlight?: HighlightConstructor
}

/** One frame-rect measurement of a draft range, in viewport coordinates. */
export interface MeasuredRect {
  readonly top: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

export interface InstallationResult {
  synchronized: boolean
  tableRowElements: ReadonlyMap<number, HTMLElement>
  codeBlockElements: ReadonlyMap<number, HTMLElement>
  /** Hidden list markers whose block is decorated; each needs an overlay glyph. */
  listMarkers: readonly ListMarkerOverlay[]
}

export interface DecorationInstallation {
  update(plan: DecorationPlan): InstallationResult
  findBlockElement(draftOffset: number): HTMLElement | null
  /** Measure one draft range against the last synchronized DOM, or null when stale. */
  measureRange(start: number, end: number): MeasuredRect | null
  dispose(): void
}

const EMPTY_RESULT: InstallationResult = {
  synchronized: false,
  tableRowElements: new Map(),
  codeBlockElements: new Map(),
  listMarkers: [],
}

export function install(
  domRoot: HTMLElement,
  onCommit?: (result: InstallationResult) => void,
): DecorationInstallation {
  const globals = globalThis as unknown as HighlightGlobals
  const registry = globals.CSS?.highlights
  const Highlight = globals.Highlight

  const ownedHighlights = new Set<string>()
  const ownedClasses = new Map<HTMLElement, Set<string>>()
  let lastValidBlocks: readonly ComposerDomBlockRun[] = []
  let lastValidRuns: readonly ComposerDomTextRun[] = []
  let lastResult: InstallationResult = EMPTY_RESULT
  let currentPlan: DecorationPlan | undefined
  let frame = 0
  let retries = 0
  let disposed = false
  let observer: MutationObserver | undefined

  domRoot.setAttribute('data-better-composer-visual-root', 'true')

  const schedule = (): void => {
    if (disposed || frame !== 0) return
    if (typeof requestAnimationFrame === 'function') {
      frame = 1
      const id = requestAnimationFrame(() => {
        frame = 0
        if (currentPlan !== undefined && !disposed) {
          commit(currentPlan)
        }
      })
      if (frame !== 0) frame = id
    } else {
      frame = 1
      queueMicrotask(() => {
        frame = 0
        if (currentPlan !== undefined && !disposed) {
          commit(currentPlan)
        }
      })
    }
  }

  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => schedule())
    observer.observe(domRoot, { childList: true, characterData: true, subtree: true })
  }

  const commit = (plan: DecorationPlan): InstallationResult => {
    if (disposed) {
      return EMPTY_RESULT
    }

    const nativeRanges = plan.nativeRanges ?? []
    const runs = composerDomTextRuns(domRoot, plan.draft, nativeRanges)
    const blocks = composerDomBlockRuns(domRoot, plan.draft, nativeRanges)

    if (runs === undefined || blocks === undefined) {
      if (retries < 4) {
        retries += 1
        schedule()
      }
      return {
        synchronized: false,
        tableRowElements: lastResult.tableRowElements,
        codeBlockElements: lastResult.codeBlockElements,
        listMarkers: lastResult.listMarkers,
      }
    }

    retries = 0
    lastValidBlocks = blocks
    lastValidRuns = runs

    const conflictingBlocks = new Set<HTMLElement>()
    const desiredClasses = new Map<HTMLElement, Set<string>>()

    for (const block of blocks) {
      const enclosedLines = plan.lines.filter(line => {
        if (block.empty) {
          if (line.end > line.start) {
            return line.start <= block.start && block.start < line.end
          }
          return block.start === line.start
        }
        return line.start < block.end && block.start < line.end
      })

      const nonEmptyLines = enclosedLines.filter(line => {
        const lineText = plan.draft.slice(line.start, line.end).replace(/\r?\n$/u, '')
        return lineText.trim() !== ''
      })

      if (block.containsNativeObject) {
        conflictingBlocks.add(block.element)
        desiredClasses.set(block.element, new Set())
        continue
      }

      if (nonEmptyLines.length === 0) {
        desiredClasses.set(block.element, new Set())
        continue
      }

      const firstSig = nonEmptyLines[0]!.signature
      const isUniform = firstSig !== '' && nonEmptyLines.every(l => l.signature === firstSig)

      if (isUniform) {
        desiredClasses.set(block.element, new Set(nonEmptyLines[0]!.blockClasses))
      } else {
        const hasDiffering = nonEmptyLines.some(l => l.signature !== firstSig)
        if (hasDiffering) {
          conflictingBlocks.add(block.element)
        }
        desiredClasses.set(block.element, new Set())
      }
    }

    for (const [element, classes] of desiredClasses) {
      const owned = ownedClasses.get(element) ?? new Set<string>()
      for (const className of classes) {
        element.classList.add(className)
        owned.add(className)
      }
      ownedClasses.set(element, owned)
    }

    for (const [element, owned] of ownedClasses) {
      const wanted = desiredClasses.get(element) ?? new Set<string>()
      for (const className of [...owned]) {
        if (wanted.has(className)) continue
        element.classList.remove(className)
        owned.delete(className)
      }
      if (owned.size === 0) ownedClasses.delete(element)
    }

    if (registry !== undefined && Highlight !== undefined) {
      const nextHighlights = new Map<string, Range[]>()

      for (const inline of plan.inlines) {
        if (!validInline(inline, plan.draft)) continue

        if (inline.hidesSource) {
          const touchesConflicting = blocks.some(block =>
            conflictingBlocks.has(block.element)
              && rangesIntersect(inline.start, inline.end, block.start, block.end)
          )
          if (touchesConflicting) continue
        }

        for (const run of runs) {
          const start = Math.max(inline.start, run.start)
          const end = Math.min(inline.end, run.end)
          if (start >= end) continue

          if (inline.hidesSource && [...conflictingBlocks].some(b => b.contains(run.node))) {
            continue
          }

          for (const token of inline.className.split(' ')) {
            if (token === '') continue
            const range = document.createRange()
            range.setStart(run.node, start - run.start)
            range.setEnd(run.node, end - run.start)
            const ranges = nextHighlights.get(token) ?? []
            ranges.push(range)
            nextHighlights.set(token, ranges)
          }
        }
      }

      const installed = new Set<string>()
      try {
        for (const [token, ranges] of nextHighlights) {
          const highlight = new Highlight()
          for (const range of ranges) highlight.add(range)
          const name = highlightName(token)
          registry.set(name, highlight)
          installed.add(name)
        }
      } catch {
        // Ignore Highlight registration error
      }

      for (const name of ownedHighlights) {
        if (!installed.has(name)) registry.delete(name)
      }
      ownedHighlights.clear()
      for (const name of installed) ownedHighlights.add(name)
    }

    const tableRowElements = new Map<number, HTMLElement>()
    for (const table of plan.overlays.tables) {
      for (const row of table.rows) {
        const run = blocks.find(candidate =>
          candidate.start <= row.start && row.end <= candidate.end
            && candidate.element.classList.contains('dsh-better-composer-table-row')
        )
        if (run !== undefined) {
          tableRowElements.set(row.lineIndex, run.element)
        }
      }
    }

    const codeBlockElements = new Map<number, HTMLElement>()
    for (const codeBlock of plan.overlays.codeBlocks) {
      const run = blocks.find(candidate =>
        candidate.start <= codeBlock.start && codeBlock.start < candidate.end
          && candidate.element.classList.contains('dsh-better-composer-code-block')
      )
      if (run !== undefined) {
        codeBlockElements.set(codeBlock.start, run.element)
      }
    }

    // A marker glyph is painted only where the hidden-marker highlight could
    // actually land: the block must be decorated (list-item class applied) and
    // free of signature conflicts.
    const listMarkers = plan.overlays.listMarkers.filter((marker) => {
      const block = blocks.find(candidate =>
        !candidate.empty && candidate.start <= marker.markerStart && marker.markerStart < candidate.end)
      if (block === undefined || conflictingBlocks.has(block.element)) return false
      return desiredClasses.get(block.element)?.has('dsh-better-composer-list-item') === true
    })

    lastResult = {
      synchronized: true,
      tableRowElements,
      codeBlockElements,
      listMarkers,
    }

    onCommit?.(lastResult)
    return lastResult
  }

  return {
    update(plan: DecorationPlan): InstallationResult {
      if (disposed) {
        return EMPTY_RESULT
      }
      currentPlan = plan
      return commit(plan)
    },

    findBlockElement(draftOffset: number): HTMLElement | null {
      if (disposed || lastValidBlocks.length === 0 || draftOffset < 0) return null
      for (const block of lastValidBlocks) {
        if (draftOffset >= block.start && draftOffset < block.end) {
          return block.element
        }
      }
      const last = lastValidBlocks.at(-1)
      if (last !== undefined && draftOffset === last.end) {
        return last.element
      }
      return null
    },

    measureRange(start: number, end: number): MeasuredRect | null {
      if (disposed || lastValidRuns.length === 0) return null
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end) return null
      const from = composerDomPoint(lastValidRuns, start, 'start')
      const to = composerDomPoint(lastValidRuns, end, 'end')
      if (from === undefined || to === undefined) return null
      const range = document.createRange()
      range.setStart(from.node, from.offset)
      range.setEnd(to.node, to.offset)
      const rect = range.getBoundingClientRect()
      range.detach()
      return { top: rect.top, left: rect.left, right: rect.right, width: rect.width, height: rect.height }
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frame)
      }
      frame = 0
      observer?.disconnect()
      if (registry !== undefined) {
        for (const name of ownedHighlights) registry.delete(name)
      }
      for (const [element, classes] of ownedClasses) {
        for (const className of classes) element.classList.remove(className)
      }
      ownedHighlights.clear()
      ownedClasses.clear()
      domRoot.removeAttribute('data-better-composer-visual-root')
    },
  }
}

function validInline(inline: InlineDecoration, source: string): boolean {
  return Number.isInteger(inline.start) && Number.isInteger(inline.end)
    && inline.start >= 0 && inline.start < inline.end && inline.end <= source.length
    && inline.className.trim() === inline.className && !/\s{2,}/u.test(inline.className)
}

function rangesIntersect(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end
}

function highlightName(token: string): string {
  return `dsh-composer-${token.replace(/[^a-zA-Z0-9_-]/gu, '_')}`
}
