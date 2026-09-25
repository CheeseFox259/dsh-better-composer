import type { InputActions, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'

export type PasteAction =
  | { readonly kind: 'clip'; readonly text: string; readonly span: TokenSpan }
  | { readonly kind: 'set-draft'; readonly text: string }
  | { readonly kind: 'pass' }

export interface PasteActionInput {
  readonly draft: string
  readonly occurrences: number
  readonly phase: string
  readonly composing: boolean
  readonly text: string
  readonly hasFiles: boolean
  readonly threshold: number
  readonly span: TokenSpan
}

/** Decide the only paste operations that are safe to perform before Core sees the event. */
export function planPasteAction(input: PasteActionInput): PasteAction {
  if (input.composing || input.phase !== 'plain' || input.text === '' || input.hasFiles) return { kind: 'pass' }
  const validSpan = input.span.start >= 0 && input.span.start <= input.span.end && input.span.end <= input.draft.length
  if (input.threshold > 0 && input.text.length >= input.threshold && validSpan) {
    return { kind: 'clip', text: input.text, span: input.span }
  }
  if (input.text.includes('\n') && input.occurrences === 0) {
    const start = input.span.start
    const end = input.span.end
    if (start >= 0 && start <= end && end <= input.draft.length) {
      return {
        kind: 'set-draft',
        text: input.draft.slice(0, start) + input.text + input.draft.slice(end),
      }
    }
  }
  return { kind: 'pass' }
}

/** Read plain clipboard text and whether the browser clipboard carries files. */
export function readPasteEvent(event: ClipboardEvent): { readonly text: string; readonly hasFiles: boolean } {
  return {
    text: event.clipboardData?.getData('text/plain') ?? '',
    hasFiles: (event.clipboardData?.files.length ?? 0) > 0,
  }
}

/** Attach the pre-Core paste seam. */
export function installPasteInterceptor(options: {
  readonly input: HTMLElement
  readonly actions: InputActions
  readonly readState: () => Omit<PasteActionInput, 'text' | 'hasFiles' | 'span'>
  readonly onClip: (text: string, span: TokenSpan) => boolean
}): () => void {
  const onPaste = (event: ClipboardEvent): void => {
    const clipboard = readPasteEvent(event)
    const action = planPasteAction({ ...options.readState(), ...clipboard, span: options.actions.captureInsertion() })
    if (action.kind === 'pass') return
    if (action.kind === 'clip') {
      if (!options.onClip(action.text, action.span)) return
    } else {
      options.actions.setDraft(action.text)
    }
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  options.input.addEventListener('paste', onPaste, { capture: true })
  return () => { options.input.removeEventListener('paste', onPaste, { capture: true }) }
}
