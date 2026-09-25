/**
 * Capture-phase keymap over the Core-owned contenteditable.
 *
 * Lexical registers its command dispatch on the root element's bubble phase,
 * so a capture listener strictly precedes every host handler. Keys are
 * consumed only while this plugin owns the interaction: an open completion
 * popup/ghost or list indentation. Formatting shortcuts are deliberately
 * left to the official Core so they keep their native scope and caret.
 * Everything else passes through untouched (host slash menu, IME, Enter and
 * native Shift+Enter editing).
 */

import type {
  ComposerEditResult, ComposerSurfaceExtension,
  ComposerSurfaceExtensionContext, ComposerSurfaceExtensionPresentation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { runComposerStructuralCommand, type ComposerStructuralCommandKind } from '../markdown/structural-editing.ts'

/** Live faces the keymap reads per event. */
export interface ComposerKeymapHooks {
  /** The contenteditable the listener attaches to. */
  readonly input: () => HTMLElement | null
  /** Latest surface context (draft, selection, native ranges, composing). */
  readonly surfaceContext: () => ComposerSurfaceExtensionContext
  /** Latest computed surface presentation, when the plugin is enabled. */
  readonly presentation: () => ComposerSurfaceExtensionPresentation | undefined
  /** The deterministic Markdown surface extension. */
  readonly extension: ComposerSurfaceExtension
  /** Apply one edit through the revision-guarded input actions. */
  readonly apply: (edit: ComposerEditResult, draftRev: number) => boolean
  /** Synchronous enabled read; inert while disabled. */
  readonly isEnabled: () => boolean
}

interface NormalizedKey {
  readonly key: string
  readonly shift: boolean
}

function normalizeKey(event: KeyboardEvent): NormalizedKey {
  switch (event.key) {
    case 'Escape': return { key: 'escape', shift: event.shiftKey }
    case 'Tab': return { key: 'tab', shift: event.shiftKey }
    case 'Enter': return { key: 'enter', shift: event.shiftKey }
    case 'ArrowUp': return { key: 'up', shift: event.shiftKey }
    case 'ArrowDown': return { key: 'down', shift: event.shiftKey }
    default: return { key: event.key.toLowerCase(), shift: event.shiftKey }
  }
}

/**
 * Attach the capture keydown listener; returns an idempotent cleanup.
 * @param hooks - live faces read per event.
 * @returns cleanup function.
 */
export function installComposerKeymap(hooks: ComposerKeymapHooks): () => void {
  const element = hooks.input()
  if (element === null) return () => {}

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!hooks.isEnabled()) return
    if (event.isComposing || (event as KeyboardEvent & { keyCode: number }).keyCode === 229) return
    const key = normalizeKey(event)
    const presentation = hooks.presentation()
    const context = hooks.surfaceContext()

    // Completion popup/ghost owns its keys while visible.
    if (presentation !== undefined && (presentation.popup !== undefined || presentation.ghost !== undefined)) {
      const outcome = hooks.extension.handleKey?.({
        key: key.key,
        shift: key.shift,
        context,
        presentation,
        apply: hooks.apply,
      })
      if (outcome === 'consumed') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }

    // Structural editing owns Tab/Shift+Tab (list indent/outdent). Enter,
    // including Shift+Enter, stays with Core's native editor path: the public
    // InputActions seam cannot split a paragraph while preserving the caret.
    // Sending a newline through insertText would corrupt the official Core's
    // single-paragraph text model, so fail open rather than doing that.
    const structuralKind: ComposerStructuralCommandKind | undefined = key.key === 'tab'
      ? (key.shift ? 'outdent' : 'indent')
      : undefined
    if (structuralKind !== undefined) {
      const outcome = runComposerStructuralCommand({
        kind: structuralKind,
        context,
        composing: context.composing,
        apply: hooks.apply,
      })
      if (outcome.kind === 'applied') {
        event.preventDefault()
        event.stopPropagation()
        return
      }
    }
  }

  element.addEventListener('keydown', onKeyDown, { capture: true })
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    element.removeEventListener('keydown', onKeyDown, { capture: true })
  }
}
