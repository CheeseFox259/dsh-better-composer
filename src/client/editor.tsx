import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ComposerEditorProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ComposerDecorationContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { BetterComposerSettingsStore } from './settings-store.ts'
import { detectLongInsertion, type InsertionDetection } from './paste-watch.ts'
import { createMarkdownSurfaceExtension } from './surface-extension.ts'
import {
  codeCopyBlockAnchors, codeCopyBlocksForSegments, codeFenceLanguageEdit, tableLayoutsForSegments,
  tableRowAnchors, type MarkdownCodeCopyAnchor, type MarkdownCodeCopyBlock, type MarkdownTableLayout,
  type MarkdownTableRow,
} from './presentation-layout.ts'

const useSafeLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

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

/**
 * Coalesce burst event sources (scroll/resize/ResizeObserver) into one measure
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

/** Automatic projection and diagnostic status for the shared native editor. */
export function createEditorContribution(
  settings: BetterComposerSettingsStore,
  convertPaste: (context: ComposerDecorationContext, detection: InsertionDetection) => boolean = () => false,
): SlotComponent<ComposerEditorProps> {
  return function EditorContribution(props: ComposerEditorProps) {
    return <EditorView {...props} settings={settings} convertPaste={convertPaste} />
  }
}

function EditorView({ registerSurfaceExtension, surfacePresentation, surfaceKey, decorationContext, applyEdit, settings, convertPaste }: ComposerEditorProps & {
  settings: BetterComposerSettingsStore
  convertPaste: (context: ComposerDecorationContext, detection: InsertionDetection) => boolean
}) {
  const current = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.get(),
    () => settings.get(),
  )
  const extension = useMemo(() => createMarkdownSurfaceExtension(settings), [
    settings, surfaceKey, current.enabled, current.diagnostics, current.deterministicAssistance,
  ])
  useEffect(() => registerSurfaceExtension?.(extension), [extension, registerSurfaceExtension])

  // Long-paste detection: a single-revision jump over the threshold converts
  // the inserted span into a clip chip. The conversion itself shrinks the
  // draft, so it never re-triggers.
  const previousDraftRef = useRef<{ draft: string; rev: number } | undefined>(undefined)
  useEffect(() => {
    const context = decorationContext
    if (context === undefined) return
    const previous = previousDraftRef.current
    previousDraftRef.current = { draft: context.draft, rev: context.draftRev }
    if (previous === undefined || previous.rev !== context.draftRev - 1) return
    if (context.presentation?.composing === true) return
    const threshold = current.pasteClipThreshold
    const detection = detectLongInsertion(previous.draft, context.draft, threshold)
    if (detection === undefined) return
    convertPaste(context, detection)
  }, [decorationContext, current.pasteClipThreshold, convertPaste])

  if (!current.enabled) return null
  return <EditorSurface
    current={current}
    surfaceKey={surfaceKey}
    surfacePresentation={surfacePresentation}
    decorationContext={decorationContext}
    applyEdit={applyEdit}
  />
}

function EditorSurface({
  current, surfaceKey, surfacePresentation, decorationContext, applyEdit,
}: {
  readonly current: ReturnType<BetterComposerSettingsStore['get']>
  readonly surfaceKey?: string
  readonly surfacePresentation: ComposerEditorProps['surfacePresentation']
  readonly decorationContext: ComposerEditorProps['decorationContext']
  readonly applyEdit: ComposerEditorProps['applyEdit']
}) {
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null)
  const context = decorationContext
  const tableLayouts = useMemo(
    () => current.markdownVisual && context !== undefined
      ? tableLayoutsForSegments(context.textSegments ?? [])
      : [],
    [context, current.markdownVisual],
  )
  const codeBlocks = useMemo(
    () => current.markdownVisual && context !== undefined
      ? codeCopyBlocksForSegments(context.textSegments ?? [])
      : [],
    [context, current.markdownVisual],
  )
  const diagnostics = surfacePresentation?.diagnostics ?? []
  const popup = surfacePresentation?.popup
  const ghost = surfacePresentation?.ghost
  const hints = surfacePresentation?.hints ?? []
  const activeOptionId = popup !== undefined && popup.candidates[popup.selectedIndex] !== undefined
    ? completionOptionId(popup.revision, popup.selectedIndex)
    : undefined
  return (
    <div ref={editorSurfaceRef} className="dsh-better-composer-editor" data-better-composer>
      {popup !== undefined ? <ul className="dsh-better-composer-completion-popup" role="listbox" aria-label="Markdown completion" aria-activedescendant={activeOptionId} tabIndex={-1} data-better-composer-completion-popup data-revision={popup.revision}>
        {popup.candidates.map((candidate, index) => <li id={completionOptionId(popup.revision, index)} key={`${candidate.label}-${index}`} role="option" aria-selected={index === popup.selectedIndex} data-completion-index={index}>
          <span>{candidate.label}</span>
        </li>)}
      </ul> : null}
      {ghost !== undefined ? <span className="dsh-better-composer-completion-ghost" aria-hidden data-better-composer-completion-ghost data-revision={ghost.revision} data-from={ghost.from} data-to={ghost.to}>{ghost.insertText}</span> : null}
      {diagnostics.length > 0 ? <ul className="dsh-better-composer-diagnostics" role="status" aria-live="polite" aria-atomic="false" aria-label="Markdown 诊断">
        {diagnostics.map((diagnostic, index) => <li key={`${diagnostic.className}-${diagnostic.start}-${index}`} data-diagnostic-start={diagnostic.start} data-diagnostic-end={diagnostic.end}>
          {diagnostic.message}
        </li>)}
      </ul> : null}
      {hints.length > 0 ? <ul className="dsh-better-composer-assistance" aria-label="确定性写作辅助" data-better-composer-assistance>
        {hints.map((hint, index) => <li key={`${hint.kind}-${hint.start}-${index}`} data-assistance-kind={hint.kind} data-revision={hint.revision} data-assistance-start={hint.start} data-assistance-end={hint.end}>
          {hint.message}
        </li>)}
        </ul> : null}
      {context !== undefined && tableLayouts.length > 0
        ? <TableVisualRows context={context} layouts={tableLayouts} surfaceKey={surfaceKey} />
        : null}
      {context !== undefined && codeBlocks.length > 0
        ? <CodeBlockControls context={context} blocks={codeBlocks} applyEdit={applyEdit} />
        : null}
    </div>
  )
}

function TableVisualRows({
  context, layouts, surfaceKey,
}: {
  readonly context: ComposerDecorationContext
  readonly layouts: readonly MarkdownTableLayout[]
  readonly surfaceKey?: string
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [positions, setPositions] = useState<readonly {
    readonly layoutStart: number
    readonly row: MarkdownTableRow
    readonly top: number
    readonly left: number
    readonly width: number
    readonly height: number
    readonly columns: string
    readonly columnCount: number
  }[]>([])

  useSafeLayoutEffect(() => {
    const layer = layerRef.current
    const input = findComposerInput(layer)
    if (layer === null || input === null) return () => {}
    const measure = (): void => {
      const inactiveLayouts = layouts.filter(layout => !tableIsActive(context, layout))
      const anchors = tableRowAnchors(input, context.draft, context.nativeRanges, inactiveLayouts)
      if (anchors === undefined) {
        setPositions(previous => previous.length === 0 ? previous : [])
        return
      }
      const layerRect = layer.getBoundingClientRect()
      const next = anchors.flatMap(anchor => {
        const rect = anchor.element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return []
        const layout = inactiveLayouts.find(candidate => candidate.start === anchor.layoutStart)
        if (layout === undefined) return []
        return [{
          layoutStart: anchor.layoutStart,
          row: anchor.row,
          top: rect.top - layerRect.top,
          left: rect.left - layerRect.left,
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
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(input)
    return () => {
      cancel()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      observer?.disconnect()
    }
  }, [context, layouts, surfaceKey])

  return <div ref={layerRef} className="dsh-better-composer-table-visual-layer" aria-hidden>
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
  if (context.presentation?.focused !== true) return false
  const { selectionStart, selectionEnd } = context.presentation
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

function CodeBlockControls({
  context, blocks, applyEdit,
}: {
  readonly context: ComposerDecorationContext
  readonly blocks: readonly MarkdownCodeCopyBlock[]
  readonly applyEdit: ComposerEditorProps['applyEdit']
}) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const anchorsRef = useRef<readonly MarkdownCodeCopyAnchor[]>([])
  const [positions, setPositions] = useState<readonly {
    readonly start: number
    readonly top: number
    readonly languageLeft: number
    readonly copyLeft: number
  }[]>([])
  const [hoveredStart, setHoveredStart] = useState<number | undefined>()
  const [copiedStart, setCopiedStart] = useState<number | undefined>()

  useSafeLayoutEffect(() => {
    const layer = layerRef.current
    const input = findComposerInput(layer)
    if (layer === null || input === null) return () => {}
    const measure = (): void => {
      const anchors = codeCopyBlockAnchors(input, context.draft, context.nativeRanges, blocks) ?? []
      anchorsRef.current = anchors
      const layerRect = layer.getBoundingClientRect()
      const next = anchors.flatMap(anchor => {
        const rect = anchor.element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) return []
        return [{
          start: anchor.start,
          top: Math.max(0, rect.top - layerRect.top + 8),
          languageLeft: Math.max(0, rect.left - layerRect.left + 12),
          copyLeft: Math.max(0, rect.right - layerRect.left - 36),
        }]
      })
      setPositions(previous => samePositions(previous, next, position =>
        `${position.start}:${position.top}:${position.languageLeft}:${position.copyLeft}`) ? previous : next)
    }
    measure()
    const { schedule, cancel } = rafSchedule(measure)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(input)
    return () => {
      cancel()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      observer?.disconnect()
    }
  }, [blocks, context])

  useEffect(() => {
    const layer = layerRef.current
    const input = findComposerInput(layer)
    if (layer === null || input === null) return () => {}
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
  }, [context, blocks])

  return <div ref={layerRef} className="dsh-better-composer-code-copy-layer" aria-hidden={false}>
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
            const accepted = applyEdit(codeFenceLanguageEdit(block, event.currentTarget.value), context.draftRev)
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

function completionOptionId(revision: number, index: number): string {
  return `dsh-better-composer-completion-option-${revision}-${index}`
}
