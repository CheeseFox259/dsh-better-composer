import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  ComposerDecorationContext, ComposerEditResult, ComposerNativeRange,
  ComposerSurfaceExtensionPresentation, ComposerTextSegment,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { BetterComposerSettingsStore } from './settings-store.ts'
import { createDecorationProvider } from './decoration-provider.ts'
import { createComposerVisualController } from './visual-controller.ts'
import { convertCapturedPasteToClip, type ClipSessionInput } from './clip-convert.ts'
import { installPasteInterceptor } from './paste-interceptor.ts'
import type { ClipStore } from './clip-store.ts'
import { createMarkdownSurfaceExtension } from './surface-extension.ts'
import { applyComposerEdit } from './edit-apply.ts'
import { installComposerKeymap } from './keys.ts'
import { subscribeGrammarLoaded } from '../markdown/primitives.ts'
import { useComposerPresentation } from './selection.ts'
import { getClipToast, subscribeClipToast } from './clip-toast.ts'
import {
  codeCopyBlockAnchors, codeCopyBlocksForSegments, codeFenceLanguageEdit, tableLayoutsForSegments,
  tableRowAnchors, type MarkdownCodeCopyAnchor, type MarkdownCodeCopyBlock, type MarkdownTableLayout,
  type MarkdownTableRow,
} from './presentation-layout.ts'

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
 * returned component derives the whole decoration context from the official
 * input state, tracks presentation from DOM signals, self-paints Markdown
 * highlights, consumes its own keys in the capture phase, and converts long
 * pastes into clips.
 */
export function createEditorContribution(
  ctx: ClientContext,
  settings: BetterComposerSettingsStore,
  clips: ClipStore,
): SlotComponent<BetterComposerOverlayProps> {
  return function EditorContribution(props: BetterComposerOverlayProps) {
    return <EditorOverlay {...props} ctx={ctx} settings={settings} clips={clips} />
  }
}

function EditorOverlay({ sessionId, useInput, inputActions, ctx, settings, clips }: BetterComposerOverlayProps & {
  readonly ctx: ClientContext
  readonly settings: BetterComposerSettingsStore
  readonly clips: ClipStore
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

  const provider = useMemo(() => createDecorationProvider(() => settings.get()), [settings])

  const apply = useCallback((edit: ComposerEditResult, draftRev: number): boolean =>
    applyComposerEdit(inputActions, inputState.occurrences, edit, draftRev),
  [inputActions, inputState.occurrences])

  // Paste capture runs before Core's default insertion. Long pastes become a
  // real reference chip while the captured revision/span is still current;
  // ordinary multiline text uses Core's public setDraft seam to rebuild one
  // paragraph per line.
  useEffect(() => {
    if (!current.enabled || input === null || sessionInput === undefined) return () => {}
    return installPasteInterceptor({
      input,
      actions: inputActions,
      readState: () => ({
        draft: inputState.draft,
        occurrences: inputState.occurrences.length,
        phase: inputState.phase,
        composing: presentation.composing === true,
        threshold: current.pasteClipThreshold,
      }),
      onClip: (text, span) => convertCapturedPasteToClip(
        ctx,
        clips,
        String(sessionId),
        text,
        span,
        sessionInput,
      ),
    })
  }, [ctx, clips, sessionId, sessionInput, input, inputActions, inputState.draft, inputState.occurrences.length, inputState.phase, presentation.composing, current.enabled, current.pasteClipThreshold])

  // Self-paint: compute text and block decoration segments and install them
  // onto the editor root and direct Lexical blocks.
  const [grammarTick, setGrammarTick] = useState(0)
  useEffect(() => subscribeGrammarLoaded(() => { setGrammarTick(tick => tick + 1) }), [])
  const decorationContext = useMemo<ComposerDecorationContext>(() => ({
    sessionId: String(sessionId) as ComposerDecorationContext['sessionId'],
    draft: inputState.draft,
    draftRev: inputState.draftRev,
    nativeRanges,
    textSegments,
    presentation,
  }), [sessionId, inputState.draft, inputState.draftRev, nativeRanges, textSegments, presentation])

  const visualControllerRef = useRef<ReturnType<typeof createComposerVisualController> | null>(null)
  useSafeLayoutEffect(() => {
    if (input === null || !current.enabled) {
      visualControllerRef.current?.dispose()
      visualControllerRef.current = null
      return () => {}
    }
    const controller = createComposerVisualController(input)
    visualControllerRef.current = controller
    return () => {
      if (visualControllerRef.current === controller) visualControllerRef.current = null
      controller.dispose()
    }
  }, [input, current.enabled])

  useSafeLayoutEffect(() => {
    const controller = visualControllerRef.current
    if (controller === null || !current.enabled) return
    controller.update(provider, decorationContext)
  }, [provider, decorationContext, current.enabled, current.markdownVisual, current.diagnostics, grammarTick])

  // Capture only completion and list-structure keys; formatting shortcuts stay with Core.
  useEffect(() => {
    if (input === null) return () => {}
    return installComposerKeymap({
      input: () => input,
      surfaceContext: () => surfaceContext,
      presentation: () => surfacePresentation,
      extension,
      apply,
      isEnabled: () => settings.get().enabled,
    })
  }, [input, surfaceContext, surfacePresentation, extension, apply, settings])

  // Toast feedback: auto-dismisses after 4 seconds.
  const toastMessage = useSyncExternalStore(subscribeClipToast, getClipToast, () => null)

  // Floating presentation layers (table grid, code controls) derived from the
  // same authoritative segments; they mount only when Markdown paint is on.
  const tableLayouts = useMemo(
    () => current.enabled && current.markdownVisual ? tableLayoutsForSegments(textSegments) : [],
    [current.enabled, current.markdownVisual, textSegments],
  )
  const codeBlocks = useMemo(
    () => current.enabled && current.markdownVisual ? codeCopyBlocksForSegments(textSegments) : [],
    [current.enabled, current.markdownVisual, textSegments],
  )

  if (!current.enabled) return null
  return <EditorSurface
    surfacePresentation={surfacePresentation}
    toastMessage={toastMessage}
    setLayerRef={setLayerRef}
    input={input}
    context={decorationContext}
    apply={apply}
    tableLayouts={tableLayouts}
    codeBlocks={codeBlocks}
  />
}

/**
 * Live caret position in frame content coordinates, measured from the DOM
 * selection. Because the frame rides inside the scrolling content, these
 * coordinates stay valid while the scrollport scrolls; re-measure on
 * selection change, resize, and frame geometry change.
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
      const selection = document.getSelection()
      if (selection === null || selection.rangeCount === 0) return
      let rect = selection.getRangeAt(0).getBoundingClientRect()
      if (rect.height === 0 && rect.width === 0) {
        const anchor = selection.anchorNode
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
 * The popup opens below the caret line and flips above it when the scrollport
 * would clip it; the ghost rides inline at the caret.
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
      aria-label="Markdown completion"
      aria-activedescendant={activeOptionId}
      tabIndex={-1}
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
  surfacePresentation, toastMessage, setLayerRef, input, context, apply, tableLayouts, codeBlocks,
}: {
  readonly surfacePresentation: ComposerSurfaceExtensionPresentation | undefined
  readonly toastMessage: string | null
  readonly setLayerRef: (element: HTMLDivElement | null) => void
  readonly input: HTMLElement | null
  readonly context: ComposerDecorationContext
  readonly apply: (edit: ComposerEditResult, draftRev: number) => boolean
  readonly tableLayouts: readonly MarkdownTableLayout[]
  readonly codeBlocks: readonly MarkdownCodeCopyBlock[]
}) {
  const frame = useComposerFrame(input)
  const diagnostics = surfacePresentation?.diagnostics ?? []
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
      {diagnostics.length > 0 ? (
        <ul className="dsh-better-composer-diagnostics" role="status" aria-live="polite" aria-atomic="false" aria-label="Markdown 诊断">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.className}-${diagnostic.start}-${index}`} data-diagnostic-start={diagnostic.start} data-diagnostic-end={diagnostic.end}>
              {diagnostic.message}
            </li>
          ))}
        </ul>
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
      {frame !== null && input !== null && (tableLayouts.length > 0 || codeBlocks.length > 0)
        ? createPortal(
          <div className="dsh-better-composer-visual-layer" data-better-composer-visual-layer aria-hidden={codeBlocks.length === 0}>
            {tableLayouts.length > 0 ? <TableVisualRows frame={frame} input={input} context={context} layouts={tableLayouts} /> : null}
            {codeBlocks.length > 0 ? <CodeBlockControls frame={frame} input={input} context={context} blocks={codeBlocks} apply={apply} /> : null}
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
  readonly row: MarkdownTableRow
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly columns: string
  readonly columnCount: number
}

/**
 * Presentation-only table grid. Rows are cloned geometry over the Core-owned
 * source lines inside the input's scrolling content. The scrollport clips
 * rows without a scroll-event re-measure.
 */
function TableVisualRows({
  frame, input, context, layouts,
}: {
  readonly frame: HTMLElement
  readonly input: HTMLElement
  readonly context: ComposerDecorationContext
  readonly layouts: readonly MarkdownTableLayout[]
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [positions, setPositions] = useState<readonly TableRowPosition[]>([])

  useSafeLayoutEffect(() => {
    if (layerRef.current === null) return () => {}
    const measure = (): void => {
      const inactiveLayouts = layouts.filter(layout => !tableIsActive(context, layout))
      const anchors = tableRowAnchors(input, context.draft, context.nativeRanges, inactiveLayouts)
      if (anchors === undefined) return
      if (anchors.length === 0) {
        setPositions(previous => previous.length === 0 ? previous : [])
        return
      }
      const frameRect = frame.getBoundingClientRect()
      const next = anchors.flatMap(anchor => {
        const rect = anchor.element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return []
        const layout = inactiveLayouts.find(candidate => candidate.start === anchor.layoutStart)
        if (layout === undefined) return []
        return [{
          layoutStart: anchor.layoutStart,
          row: anchor.row,
          top: rect.top - frameRect.top,
          left: rect.left - frameRect.left,
          width: rect.width,
          height: rect.height,
          columns: layout.columnWidths.map(width => `minmax(0, ${width}fr)`).join(' '),
          columnCount: layout.columnWidths.length,
        }]
      })
      setPositions(previous => samePositions(previous, next, position =>
        `${position.row.start}:${position.top}:${position.left}:${position.width}:${position.height}:${position.columns}`) ? previous : next)
    }
    measure()
    const { schedule, cancel } = rafSchedule(measure)
    // The structural table-row classes land in the parent's layout effect,
    // after this child effect; re-measure once per frame to catch them.
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
  }, [frame, input, context, layouts])

  return <div ref={layerRef}>
    {positions.map(position => {
      const cells = Array.from({ length: position.columnCount }, (_, index) => position.row.cells[index] ?? '')
      return <div
        key={`${position.layoutStart}-${position.row.start}`}
        className="dsh-better-composer-table-visual-row"
        data-header={position.row.header ? 'true' : undefined}
        data-last={position.row.last ? 'true' : undefined}
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

function tableIsActive(context: ComposerDecorationContext, layout: MarkdownTableLayout): boolean {
  const presentation = context.presentation
  if (presentation?.focused !== true) return false
  const { selectionStart, selectionEnd } = presentation
  if (selectionStart === selectionEnd) return layout.start <= selectionStart && selectionStart < layout.end
  return selectionStart < layout.end && layout.start < selectionEnd
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
 * scrolling content and clipped by the scrollport. The select rewrites the
 * fence info string through the revision-guarded transaction bridge; the copy
 * button reads the precomputed body and never touches the draft.
 */
function CodeBlockControls({
  frame, input, context, blocks, apply,
}: {
  readonly frame: HTMLElement
  readonly input: HTMLElement
  readonly context: ComposerDecorationContext
  readonly blocks: readonly MarkdownCodeCopyBlock[]
  readonly apply: (edit: ComposerEditResult, draftRev: number) => boolean
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const anchorsRef = useRef<readonly MarkdownCodeCopyAnchor[]>([])
  const [positions, setPositions] = useState<readonly CodeControlPosition[]>([])
  const [hoveredStart, setHoveredStart] = useState<number | undefined>()
  const [copiedStart, setCopiedStart] = useState<number | undefined>()

  useSafeLayoutEffect(() => {
    if (layerRef.current === null) return () => {}
    const measure = (): void => {
      const anchors = codeCopyBlockAnchors(input, context.draft, context.nativeRanges, blocks)
      if (anchors === undefined) return
      anchorsRef.current = anchors
      if (anchors.length === 0) {
        setPositions(previous => previous.length === 0 ? previous : [])
        return
      }
      const frameRect = frame.getBoundingClientRect()
      const next = anchors.flatMap(anchor => {
        const rect = anchor.element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return []
        return [{
          start: anchor.start,
          top: rect.top - frameRect.top + 8,
          languageLeft: rect.left - frameRect.left + 12,
          copyLeft: rect.right - frameRect.left - 36,
        }]
      })
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
  }, [frame, input, blocks, context])

  useEffect(() => {
    const layer = layerRef.current
    if (layer === null) return () => {}
    const onPointerOver = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const block = target.closest<HTMLElement>('.dsh-better-composer-code-block')
      const anchor = anchorsRef.current.find(candidate => candidate.element === block)
      if (anchor !== undefined) setHoveredStart(anchor.start)
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
  }, [input, blocks, context])

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
            const accepted = apply(codeFenceLanguageEdit(block, event.currentTarget.value), context.draftRev)
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
