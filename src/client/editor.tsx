import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  ComposerEditResult, ComposerNativeRange,
  ComposerSurfaceExtensionPresentation, ComposerTextSegment,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { BetterComposerSettingsStore } from './settings-store.ts'
import { PasteClipController, type ClipSessionInput } from './clip-controller.ts'
import { createMarkdownSurfaceExtension } from './surface-extension.ts'
import { applyComposerEdit } from './edit-apply.ts'
import { installComposerKeymap } from './keys.ts'
import { useComposerPresentation } from './selection.ts'
import { settleBreakContinuation, type ArmedBreakContinuation, type OrderedRenumberEdit } from '../markdown/structural-editing.ts'
import {
  codeFenceLanguageEdit, install, project, subscribeGrammarReload,
  type CodeBlockOverlay, type DecorationInstallation, type InstallationResult,
  type ListMarkerOverlay, type MeasuredRect,
  type TableOverlay,
} from '../decoration/index.ts'

const useSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Coalesce burst event sources (resize/ResizeObserver) into one measure
 * per frame: each measure walks the full input DOM, so unthrottled bursts on
 * long drafts cause layout thrash.
 */
function rafSchedule(measure: () => void): { schedule: () => void; cancel: () => void } {
  let frame = 0
  return {
    schedule: () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    },
    cancel: () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}

/** Skip the React commit when a re-measure produced identical geometry. */
function samePositions<T>(previous: readonly T[], next: readonly T[], signature: (position: T) => string): boolean {
  return previous.length === next.length
    && previous.every((position, index) => signature(position) === signature(next[index]!))
}

/** Standard session props the overlay slot receives from the renderer. */
export interface BetterComposerOverlayProps {
  readonly sessionId: string
  readonly useInput: SnapshotSelectorHook<InputState>
  readonly inputActions: InputActions
}

/**
 * Find the Core-owned contenteditable from one overlay layer. The slot root
 * is a sibling of `[data-composer-input]` (not its ancestor), and Core may
 * wrap slot content in arbitrary containers, so climb until an ancestor
 * contains the input.
 */
export function findComposerInput(layer: HTMLElement | null): HTMLElement | null {
  let node = layer?.parentElement ?? null
  while (node !== null) {
    const input = node.querySelector<HTMLElement>('[data-composer-input]')
    if (input !== null) return input
    node = node.parentElement
  }
  return null
}

/** Place the visual layer beside the input, inside Core's scrolling content. */
function useComposerFrame(input: HTMLElement | null): HTMLElement | null {
  const [frame, setFrame] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const candidate = input?.parentElement ?? null
    setFrame(candidate)
    if (candidate === null) return
    const hadAttribute = candidate.hasAttribute('data-better-composer-visual-anchor')
    candidate.setAttribute('data-better-composer-visual-anchor', 'true')
    return () => {
      if (!hadAttribute) candidate.removeAttribute('data-better-composer-visual-anchor')
    }
  }, [input])
  return frame
}

/** Resolve the contenteditable, tolerating first-commit sibling ordering. */
function useComposerInput(layer: HTMLElement | null): HTMLElement | null {
  const [input, setInput] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (layer === null) {
      setInput(null)
      return
    }
    const found = findComposerInput(layer)
    setInput(previous => (previous === found ? previous : found))
    if (found !== null) return
    const host = layer.closest('[data-composer-card]') ?? layer.parentElement
    if (host === null) return
    const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => {
      const candidate = findComposerInput(layer)
      if (candidate !== null) {
        setInput(candidate)
        observer?.disconnect()
      }
    })
    observer?.observe(host, { childList: true, subtree: true })
    return () => { observer?.disconnect() }
  }, [layer])
  return input
}

/** Resolve the per-session input facade (state/setDraft/notify) once per session. */
function useSessionInput(ctx: ClientContext, sessionId: string): ClipSessionInput | undefined {
  return useMemo(() => {
    try {
      const sessions = ctx.sessions as { scope?: (id: never) => unknown } | undefined
      const actx = sessions?.scope?.(sessionId as never)
      if (actx === undefined || actx === null) return undefined
      const conversation = ctx.conversation as { input?: { for?: (scope: unknown) => ClipSessionInput } } | undefined
      return conversation?.input?.for?.(actx)
    } catch {
      return undefined
    }
  }, [ctx, sessionId])
}

/** Ordinary text segments between chip occurrences, in source order. */
function textSegmentsFor(draft: string, nativeRanges: readonly ComposerNativeRange[]): readonly ComposerTextSegment[] {
  const segments: ComposerTextSegment[] = []
  let cursor = 0
  for (const range of [...nativeRanges].sort((left, right) => left.start - right.start)) {
    if (range.start > cursor) segments.push({ start: cursor, end: range.start, text: draft.slice(cursor, range.start) })
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < draft.length) segments.push({ start: cursor, end: draft.length, text: draft.slice(cursor) })
  return segments
}

/**
 * Build the session-scoped `conversation.input.overlay` contribution. The
 * returned component derives the decoration projection from the draft and
 * selection, holds an installation on the editor root, consumes its own keys
 * in the capture phase, and converts long pastes into clips.
 */
export function createEditorContribution(
  ctx: ClientContext,
  settings: BetterComposerSettingsStore,
  controller: PasteClipController,
): SlotComponent<BetterComposerOverlayProps> {
  return function EditorContribution(props: BetterComposerOverlayProps) {
    return <EditorOverlay {...props} ctx={ctx} settings={settings} controller={controller} />
  }
}

function EditorOverlay({ sessionId, useInput, inputActions, ctx, settings, controller }: BetterComposerOverlayProps & {
  readonly ctx: ClientContext
  readonly settings: BetterComposerSettingsStore
  readonly controller: PasteClipController
}) {
  const current = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.get(),
    () => settings.get(),
  )
  const inputState = useInput((state: InputState) => state)

  const layerRef = useRef<HTMLDivElement | null>(null)
  const [layer, setLayer] = useState<HTMLDivElement | null>(null)
  const setLayerRef = useCallback((element: HTMLDivElement | null) => {
    layerRef.current = element
    setLayer(previous => (previous === element ? previous : element))
  }, [])
  const input = useComposerInput(layer)
  const sessionInput = useSessionInput(ctx, sessionId)

  const nativeRanges = useMemo<readonly ComposerNativeRange[]>(() =>
    inputState.occurrences.map((occurrence: { readonly offset: number; readonly length: number; readonly source: string }) => ({
      start: occurrence.offset,
      end: occurrence.offset + occurrence.length,
      kind: occurrence.source,
    })), [inputState.occurrences])
  const textSegments = useMemo(() => textSegmentsFor(inputState.draft, nativeRanges),
    [inputState.draft, nativeRanges])

  const sourceRef = useRef({ draft: inputState.draft, nativeRanges })
  sourceRef.current = { draft: inputState.draft, nativeRanges }
  const presentation = useComposerPresentation(input, sourceRef)

  const surfaceContext = useMemo(() => ({
    draft: inputState.draft,
    draftRev: inputState.draftRev,
    selection: { start: presentation.selectionStart, end: presentation.selectionEnd },
    nativeRanges,
    composing: presentation.composing === true,
    triggerOwner: inputState.phase === 'claimed' ? 'slash' as const : 'none' as const,
    textSegments,
  }), [inputState.draft, inputState.draftRev, inputState.phase, nativeRanges, textSegments, presentation])

  const extension = useMemo(() => createMarkdownSurfaceExtension(settings), [settings])
  const surfacePresentation = current.enabled ? extension.present(surfaceContext) : undefined

  const apply = useCallback((edit: ComposerEditResult, draftRev: number): boolean =>
    applyComposerEdit(inputActions, inputState.occurrences, edit, draftRev),
  [inputActions, inputState.occurrences])

  // Paste capture runs before Core's default insertion.
  useEffect(() => {
    if (!current.enabled || input === null || sessionInput === undefined) return () => {}
    return controller.attach(input, inputActions, {
      sessionId: String(sessionId),
      sessionInput,
      readState: () => ({
        draft: inputState.draft,
        occurrences: inputState.occurrences.length,
        phase: inputState.phase,
        composing: presentation.composing === true,
        threshold: current.pasteClipThreshold,
      }),
    })
  }, [controller, sessionId, sessionInput, input, inputActions, inputState.draft, inputState.occurrences.length, inputState.phase, presentation.composing, current.enabled, current.pasteClipThreshold])

  // Track grammar reloads for live Shiki token projection.
  const [grammarTick, setGrammarTick] = useState(0)
  useEffect(() => subscribeGrammarReload(() => { setGrammarTick(tick => tick + 1) }), [])

  const selection = useMemo(() => ({
    start: presentation.selectionStart,
    end: presentation.selectionEnd,
    focused: presentation.focused,
    composing: presentation.composing === true,
  }), [presentation.selectionStart, presentation.selectionEnd, presentation.focused, presentation.composing])

  const plan = useMemo(
    () => current.enabled
      ? project(inputState.draft, selection, nativeRanges, {
        markdownVisual: current.markdownVisual,
      })
      : undefined,
    [current.enabled, inputState.draft, selection, nativeRanges, current.markdownVisual, grammarTick],
  )

  const installationRef = useRef<DecorationInstallation | null>(null)
  const [installationResult, setInstallationResult] = useState<InstallationResult>({
    synchronized: false,
    tableRowElements: new Map(),
    codeBlockElements: new Map(),
    listMarkers: [],
  })
  const measureRange = useCallback((start: number, end: number): MeasuredRect | null =>
    installationRef.current?.measureRange(start, end) ?? null, [])

  useSafeLayoutEffect(() => {
    if (input === null || !current.enabled) {
      installationRef.current?.dispose()
      installationRef.current = null
      setInstallationResult({ synchronized: false, tableRowElements: new Map(), codeBlockElements: new Map(), listMarkers: [] })
      return () => {}
    }
    const installation = install(input, result => {
      setInstallationResult(result)
    })
    installationRef.current = installation
    return () => {
      if (installationRef.current === installation) installationRef.current = null
      installation.dispose()
    }
  }, [input, current.enabled])

  useSafeLayoutEffect(() => {
    const installation = installationRef.current
    if (installation === null || plan === undefined) return
    const result = installation.update(plan)
    setInstallationResult(result)
  }, [plan])

  // Inactive source markers are transparent by default; the fade mode keeps
  // them visible in a muted color so users can see the syntax they typed.
  useEffect(() => {
    if (input === null || !current.enabled) return () => {}
    input.setAttribute('data-better-composer-inactive-markers', current.inactiveMarkerDisplay)
    return () => { input.removeAttribute('data-better-composer-inactive-markers') }
  }, [input, current.enabled, current.inactiveMarkerDisplay])

  // Capture only completion and list-structure keys; formatting shortcuts stay with Core.
  // Shift+Enter is not consumed: the keymap arms a continuation intent that the
  // settle effect below applies once the host's native break lands in the draft.
  const pendingBreakRef = useRef<ArmedBreakContinuation | null>(null)
  useEffect(() => {
    if (input === null) return () => {}
    return installComposerKeymap({
      input: () => input,
      surfaceContext: () => surfaceContext,
      presentation: () => surfacePresentation,
      extension,
      apply,
      noteBreakContinuation: armed => {
        pendingBreakRef.current = armed ?? null
      },
      isEnabled: () => settings.get().enabled,
    })
  }, [input, surfaceContext, surfacePresentation, extension, apply, settings])

  // Settle one armed Shift+Enter continuation against the draft the host's
  // native break produced. The follow-up edit (insert or remove the list
  // prefix) contains no newline, so the revision-guarded insertText seam can
  // express it; a draft that differs by anything but the break drops the
  // intent untouched.
  const renumberQueueRef = useRef<{ readonly armedRev: number; readonly baseDraft: string; readonly edits: readonly OrderedRenumberEdit[] } | null>(null)
  useEffect(() => {
    const armed = pendingBreakRef.current
    if (armed === null) return
    pendingBreakRef.current = null
    renumberQueueRef.current = null
    if (!current.enabled) return
    const settled = settleBreakContinuation(armed, inputState.draft)
    if (settled === undefined) return
    if (!apply(settled.edit, inputState.draftRev)) return
    if (settled.renumber.length > 0) {
      renumberQueueRef.current = { armedRev: inputState.draftRev, baseDraft: settled.baseDraft, edits: settled.renumber }
    }
  }, [inputState.draft, inputState.draftRev, current.enabled, apply])

  // Drain the ordered-run renumber one within-line digit edit per draft
  // revision. Each step is verified against its expected digits and the
  // evolving base draft; any outside edit abandons the rest of the chain.
  useEffect(() => {
    const queue = renumberQueueRef.current
    if (queue === null || queue.edits.length === 0) return
    if (inputState.draft !== queue.baseDraft) {
      // The settle effect's own prefix insert has not landed yet; wait one
      // revision. Anything later means outside interference.
      if (inputState.draftRev > queue.armedRev + 1) renumberQueueRef.current = null
      return
    }
    const next = queue.edits[0]!
    if (inputState.draft.slice(next.start, next.end) !== next.expect) {
      renumberQueueRef.current = null
      return
    }
    const caret = next.start + next.text.length
    if (!apply({ start: next.start, end: next.end, text: next.text, selectionStart: caret, selectionEnd: caret }, inputState.draftRev)) {
      renumberQueueRef.current = null
      return
    }
    renumberQueueRef.current = {
      armedRev: queue.armedRev,
      baseDraft: inputState.draft.slice(0, next.start) + next.text + inputState.draft.slice(next.end),
      edits: queue.edits.slice(1),
    }
  }, [inputState.draft, inputState.draftRev, apply])

  // Toast feedback: auto-dismisses after 4 seconds.
  const toastMessage = useSyncExternalStore(controller.subscribeToast, controller.getToast, () => null)

  if (!current.enabled) return null
  return <EditorSurface
    surfacePresentation={surfacePresentation}
    toastMessage={toastMessage}
    setLayerRef={setLayerRef}
    input={input}
    draftRev={inputState.draftRev}
    apply={apply}
    tables={plan?.overlays.tables ?? []}
    codeBlocks={plan?.overlays.codeBlocks ?? []}
    listMarkers={installationResult.listMarkers}
    measureRange={measureRange}
    tableRowElements={installationResult.tableRowElements}
    codeBlockElements={installationResult.codeBlockElements}
  />
}

/**
 * Live caret position in frame content coordinates, measured from the DOM
 * selection.
 */
function useCaretAnchor(
  frame: HTMLElement | null,
  active: boolean,
): { readonly top: number; readonly left: number } | undefined {
  const [position, setPosition] = useState<{ top: number; left: number } | undefined>(undefined)
  useSafeLayoutEffect(() => {
    if (!active || frame === null) {
      setPosition(previous => (previous === undefined ? previous : undefined))
      return () => {}
    }
    const measure = (): void => {
      const domSelection = document.getSelection()
      if (domSelection === null || domSelection.rangeCount === 0) return
      let rect = domSelection.getRangeAt(0).getBoundingClientRect()
      if (rect.height === 0 && rect.width === 0) {
        const anchor = domSelection.anchorNode
        const element = anchor instanceof HTMLElement ? anchor : anchor?.parentElement
        if (element === null || element === undefined) return
        rect = element.getBoundingClientRect()
      }
      const frameRect = frame.getBoundingClientRect()
      const next = { top: rect.bottom - frameRect.top, left: rect.left - frameRect.left }
      setPosition(previous => previous !== undefined && previous.top === next.top && previous.left === next.left
        ? previous
        : next)
    }
    measure()
    const { schedule, cancel } = rafSchedule(measure)
    schedule()
    window.addEventListener('resize', schedule)
    document.addEventListener('selectionchange', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(frame)
    return () => {
      cancel()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('selectionchange', schedule)
      observer?.disconnect()
    }
  }, [frame, active])
  return active ? position : undefined
}

/**
 * Completion presentation anchored at the caret inside the scrolling content.
 */
function CompletionLayer({
  frame, popup, ghost, activeOptionId,
}: {
  readonly frame: HTMLElement
  readonly popup: CompletionPopupState | undefined
  readonly ghost: CompletionGhostState | undefined
  readonly activeOptionId: string | undefined
}) {
  const active = popup !== undefined || ghost !== undefined
  const anchor = useCaretAnchor(frame, active)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [popupTop, setPopupTop] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!active) setPopupTop(undefined)
  }, [active])
  useSafeLayoutEffect(() => {
    const layer = layerRef.current
    if (layer === null || anchor === undefined) return
    const scroller = (frame.closest('[data-input-scroll]') as HTMLElement | null) ?? frame
    const limit = scroller.getBoundingClientRect().bottom - frame.getBoundingClientRect().top
    let height = 0
    for (const child of layer.children) {
      height = Math.max(height, child.getBoundingClientRect().height)
    }
    const below = anchor.top + 2
    const next = below + height > limit ? Math.max(0, anchor.top - height - 4) : below
    setPopupTop(previous => (previous === next ? previous : next))
  }, [frame, anchor, popup, ghost])

  if (!active || anchor === undefined) return null
  return (
    <div ref={layerRef} className="dsh-better-composer-completion-layer" data-better-composer-completion-layer>
      {ghost !== undefined ? <CompletionGhost ghost={ghost} top={anchor.top} left={anchor.left} /> : null}
      {popup !== undefined ? (
        <CompletionPopup popup={popup} top={popupTop ?? anchor.top + 2} left={anchor.left} activeOptionId={activeOptionId} />
      ) : null}
    </div>
  )
}

type CompletionPopupState = NonNullable<ComposerSurfaceExtensionPresentation['popup']>
type CompletionGhostState = NonNullable<ComposerSurfaceExtensionPresentation['ghost']>

/** The caret-anchored candidate list; positions are frame content coordinates. */
export function CompletionPopup({
  popup, top, left, activeOptionId,
}: {
  readonly popup: CompletionPopupState
  readonly top: number
  readonly left: number
  readonly activeOptionId: string | undefined
}) {
  return (
    <ul
      className="dsh-better-composer-completion-popup"
      role="listbox"
      aria-label="Markdown 补全候选项"
      aria-activedescendant={activeOptionId}
      data-better-composer-completion-popup
      data-revision={popup.revision}
      style={{ top, left }}
    >
      {popup.candidates.map((candidate, index) => (
        <li id={completionOptionId(popup.revision, index)} key={`${candidate.label}-${index}`} role="option" aria-selected={index === popup.selectedIndex} data-completion-index={index}>
          <span>{candidate.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** The caret-anchored inline suffix suggestion; aria-hidden presentation only. */
export function CompletionGhost({
  ghost, top, left,
}: {
  readonly ghost: CompletionGhostState
  readonly top: number
  readonly left: number
}) {
  return (
    <span
      className="dsh-better-composer-completion-ghost"
      aria-hidden
      data-better-composer-completion-ghost
      data-revision={ghost.revision}
      data-from={ghost.from}
      data-to={ghost.to}
      style={{ top, left }}
    >
      {ghost.insertText}
    </span>
  )
}

export function EditorSurface({
  surfacePresentation, toastMessage, setLayerRef, input, draftRev, apply,
  tables, codeBlocks, listMarkers, measureRange, tableRowElements, codeBlockElements,
}: {
  readonly surfacePresentation: ComposerSurfaceExtensionPresentation | undefined
  readonly toastMessage: string | null
  readonly setLayerRef: (element: HTMLDivElement | null) => void
  readonly input: HTMLElement | null
  readonly draftRev: number
  readonly apply: (edit: ComposerEditResult, draftRev: number) => boolean
  readonly tables: readonly TableOverlay[]
  readonly codeBlocks: readonly CodeBlockOverlay[]
  readonly listMarkers: readonly ListMarkerOverlay[]
  readonly measureRange: (start: number, end: number) => MeasuredRect | null
  readonly tableRowElements: ReadonlyMap<number, HTMLElement>
  readonly codeBlockElements: ReadonlyMap<number, HTMLElement>
}) {
  const frame = useComposerFrame(input)
  const popup = surfacePresentation?.popup
  const ghost = surfacePresentation?.ghost
  const hints = surfacePresentation?.hints ?? []
  const activeOptionId = popup !== undefined && popup.candidates[popup.selectedIndex] !== undefined
    ? completionOptionId(popup.revision, popup.selectedIndex)
    : undefined

  return (
    <div ref={setLayerRef} className="dsh-better-composer-editor" data-better-composer>
      {toastMessage !== null ? (
        <div className="dsh-better-composer-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
      {hints.length > 0 ? (
        <ul className="dsh-better-composer-hints" aria-label="编辑器提示" data-better-composer-hints>
          {hints.map((hint, index) => (
            <li key={`${hint.kind}-${hint.start}-${index}`} data-hint-kind={hint.kind} data-revision={hint.revision} data-hint-start={hint.start} data-hint-end={hint.end}>
              {hint.message}
            </li>
          ))}
        </ul>
      ) : null}
      {frame !== null && input !== null && (tables.length > 0 || codeBlocks.length > 0 || listMarkers.length > 0)
        ? createPortal(
          <div className="dsh-better-composer-visual-layer" data-better-composer-visual-layer aria-hidden={codeBlocks.length === 0}>
            {tables.length > 0 ? <TableVisualRows frame={frame} tables={tables} tableRowElements={tableRowElements} /> : null}
            {listMarkers.length > 0 ? <ListMarkerGlyphs frame={frame} markers={listMarkers} measureRange={measureRange} /> : null}
            {codeBlocks.length > 0 ? <CodeBlockControls frame={frame} input={input} draftRev={draftRev} blocks={codeBlocks} codeBlockElements={codeBlockElements} apply={apply} /> : null}
          </div>,
          frame,
        )
        : null}
      {frame !== null && (popup !== undefined || ghost !== undefined)
        ? createPortal(
          <CompletionLayer frame={frame} popup={popup} ghost={ghost} activeOptionId={activeOptionId} />,
          frame,
        )
        : null}
    </div>
  )
}

function completionOptionId(revision: number, index: number): string {
  return `dsh-better-composer-completion-option-${revision}-${index}`
}

interface TableRowPosition {
  readonly layoutStart: number
  readonly rowStart: number
  readonly cells: readonly string[]
  readonly header: boolean
  readonly last: boolean
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly columns: string
  readonly columnCount: number
}

/**
 * Presentation-only table grid. Rows are cloned geometry over the Core-owned
 * source lines inside the input's scrolling content.
 */
function TableVisualRows({
  frame, tables, tableRowElements,
}: {
  readonly frame: HTMLElement
  readonly tables: readonly TableOverlay[]
  readonly tableRowElements: ReadonlyMap<number, HTMLElement>
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [positions, setPositions] = useState<readonly TableRowPosition[]>([])

  useSafeLayoutEffect(() => {
    if (layerRef.current === null) return () => {}
    const measure = (): void => {
      const inactiveTables = tables.filter(table => !table.active)
      const frameRect = frame.getBoundingClientRect()
      const next: TableRowPosition[] = []
      for (const table of inactiveTables) {
        for (const row of table.rows) {
          const element = tableRowElements.get(row.lineIndex)
          if (element === undefined) continue
          const rect = element.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) continue
          next.push({
            layoutStart: table.start,
            rowStart: row.start,
            cells: row.cells,
            header: row.header,
            last: row.last,
            top: rect.top - frameRect.top,
            left: rect.left - frameRect.left,
            width: rect.width,
            height: rect.height,
            columns: table.columnWidths.map(width => `minmax(0, ${width}fr)`).join(' '),
            columnCount: table.columnWidths.length,
          })
        }
      }
      setPositions(previous => samePositions(previous, next, position =>
        `${position.rowStart}:${position.top}:${position.left}:${position.width}:${position.height}:${position.columns}`) ? previous : next)
    }
    measure()
    const { schedule, cancel } = rafSchedule(measure)
    schedule()
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(frame)
    return () => {
      cancel()
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [frame, tables, tableRowElements])

  return <div ref={layerRef}>
    {positions.map(position => {
      const cells = Array.from({ length: position.columnCount }, (_, index) => position.cells[index] ?? '')
      return <div
        key={`${position.layoutStart}-${position.rowStart}`}
        className="dsh-better-composer-table-visual-row"
        data-header={position.header ? 'true' : undefined}
        data-last={position.last ? 'true' : undefined}
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          height: position.height,
          gridTemplateColumns: position.columns,
        }}
      >
        {cells.map((cell, index) => <span key={index} className="dsh-better-composer-table-visual-cell">{cell}</span>)}
      </div>
    })}
  </div>
}

const BULLET_GLYPHS = ['•', '◦', '▪', '–', '⁃', '‣'] as const

/** The glyph one list marker overlay entry paints, mirroring the retired ::before table. */
export function listMarkerGlyph(marker: Pick<ListMarkerOverlay, 'kind' | 'checked' | 'depth'>): string {
  if (marker.kind === 'task') return marker.checked ? '☑' : '☐'
  return BULLET_GLYPHS[Math.min(6, Math.max(1, marker.depth)) - 1] ?? '•'
}

interface ListGlyphPosition {
  readonly key: string
  readonly top: number
  readonly left: number
  readonly height: number
  readonly glyph: string
  readonly kind: 'bullet' | 'task'
  readonly checked: boolean
  readonly depth: number
}

/**
 * Per-line bullet/checkbox glyphs over the Core-owned source lines. List
 * glyphs are line-scoped (a DOM block may hold several draft lines), so they
 * measure the hidden marker range itself instead of relying on a block-level
 * pseudo-element that can only exist once per block.
 */
function ListMarkerGlyphs({
  frame, markers, measureRange,
}: {
  readonly frame: HTMLElement
  readonly markers: readonly ListMarkerOverlay[]
  readonly measureRange: (start: number, end: number) => MeasuredRect | null
}) {
  const [positions, setPositions] = useState<readonly ListGlyphPosition[]>([])

  useSafeLayoutEffect(() => {
    const measure = (): void => {
      const frameRect = frame.getBoundingClientRect()
      const next: ListGlyphPosition[] = []
      for (const marker of markers) {
        const rect = measureRange(marker.markerStart, marker.markerEnd)
        if (rect === null || (rect.width === 0 && rect.height === 0)) continue
        next.push({
          key: `${marker.markerStart}:${marker.kind}:${marker.checked}`,
          top: rect.top - frameRect.top,
          left: rect.right - frameRect.left,
          height: rect.height,
          glyph: listMarkerGlyph(marker),
          kind: marker.kind,
          checked: marker.checked,
          depth: marker.depth,
        })
      }
      setPositions(previous => samePositions(previous, next, position =>
        `${position.key}:${position.top}:${position.left}:${position.height}`) ? previous : next)
    }
    measure()
    const { schedule, cancel } = rafSchedule(measure)
    schedule()
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(frame)
    return () => {
      cancel()
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [frame, markers, measureRange])

  return <div data-better-composer-list-markers>
    {positions.map(position => (
      <span
        key={position.key}
        className="dsh-better-composer-list-marker-glyph"
        data-kind={position.kind}
        data-checked={position.checked ? 'true' : undefined}
        data-depth={position.depth}
        style={{ top: position.top, left: position.left, lineHeight: `${position.height}px` }}
      >
        {position.glyph}
      </span>
    ))}
  </div>
}

const CODE_LANGUAGES = [
  { value: '', label: '纯文本' },
  { value: 'js', label: 'JavaScript' },
  { value: 'ts', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
] as const

interface CodeControlPosition {
  readonly start: number
  readonly top: number
  readonly languageLeft: number
  readonly copyLeft: number
}

/**
 * Code-block language select and copy button, positioned in the input's
 * scrolling content and clipped by the scrollport.
 */
function CodeBlockControls({
  frame, input, draftRev, blocks, codeBlockElements, apply,
}: {
  readonly frame: HTMLElement
  readonly input: HTMLElement
  readonly draftRev: number
  readonly blocks: readonly CodeBlockOverlay[]
  readonly codeBlockElements: ReadonlyMap<number, HTMLElement>
  readonly apply: (edit: ComposerEditResult, draftRev: number) => boolean
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [positions, setPositions] = useState<readonly CodeControlPosition[]>([])
  const [hoveredStart, setHoveredStart] = useState<number | undefined>()
  const [copiedStart, setCopiedStart] = useState<number | undefined>()

  useSafeLayoutEffect(() => {
    if (layerRef.current === null) return () => {}
    const measure = (): void => {
      const frameRect = frame.getBoundingClientRect()
      const next: CodeControlPosition[] = []
      for (const block of blocks) {
        const element = codeBlockElements.get(block.start)
        if (element === undefined) continue
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        next.push({
          start: block.start,
          top: rect.top - frameRect.top + 8,
          languageLeft: rect.left - frameRect.left + 12,
          copyLeft: rect.right - frameRect.left - 36,
        })
      }
      setPositions(previous => samePositions(previous, next, position =>
        `${position.start}:${position.top}:${position.languageLeft}:${position.copyLeft}`) ? previous : next)
    }
    measure()
    const { schedule, cancel } = rafSchedule(measure)
    schedule()
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(input)
    observer?.observe(frame)
    return () => {
      cancel()
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [frame, input, blocks, codeBlockElements])

  useEffect(() => {
    const layer = layerRef.current
    if (layer === null) return () => {}
    const onPointerOver = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const blockEl = target.closest<HTMLElement>('.dsh-better-composer-code-block')
      for (const block of blocks) {
        if (codeBlockElements.get(block.start) === blockEl) {
          setHoveredStart(block.start)
          break
        }
      }
    }
    const onPointerOut = (event: Event): void => {
      const related = (event as PointerEvent).relatedTarget
      if (related instanceof Node && (input.contains(related) || layer.contains(related))) return
      setHoveredStart(undefined)
    }
    input.addEventListener('pointerover', onPointerOver)
    input.addEventListener('pointerout', onPointerOut)
    return () => {
      input.removeEventListener('pointerover', onPointerOver)
      input.removeEventListener('pointerout', onPointerOut)
    }
  }, [input, blocks, codeBlockElements])

  return <div ref={layerRef} className="dsh-better-composer-code-copy-layer">
    {positions.map(position => {
      const block = blocks.find(candidate => candidate.start === position.start)
      if (block === undefined) return null
      const visible = hoveredStart === position.start
      const options = CODE_LANGUAGES.some(option => option.value === block.language)
        ? CODE_LANGUAGES
        : [...CODE_LANGUAGES, { value: block.language, label: block.language }]
      return <div key={position.start}>
        <select
          className="dsh-better-composer-code-language-select"
          aria-label="代码块语言"
          data-code-language-select
          value={block.language}
          style={{ top: position.top, left: position.languageLeft }}
          onPointerDown={event => { event.stopPropagation() }}
          onKeyDown={event => { event.stopPropagation() }}
          onChange={event => {
            const accepted = apply(codeFenceLanguageEdit(block, event.currentTarget.value), draftRev)
            if (!accepted) event.currentTarget.value = block.language
          }}
        >
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button
          type="button"
          className="dsh-better-composer-code-copy-button"
          aria-label={copiedStart === position.start ? '已复制代码' : '复制代码'}
          data-code-copy-button
          data-visible={visible || copiedStart === position.start ? 'true' : undefined}
          style={{ top: position.top, left: position.copyLeft }}
          onMouseDown={event => { event.preventDefault() }}
          onPointerEnter={() => { setHoveredStart(position.start) }}
          onClick={() => {
            void writeClipboard(block.copyText).then(ok => {
              if (!ok) return
              setCopiedStart(position.start)
              window.setTimeout(() => { setCopiedStart(current => current === position.start ? undefined : current) }, 1000)
            })
          }}
        >
          {copiedStart === position.start ? '✓' : '⧉'}
        </button>
      </div>
    })}
  </div>
}
