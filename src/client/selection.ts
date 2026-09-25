/**
 * Track editor presentation (focus, IME composition, selection) from DOM
 * signals on the Core-owned contenteditable and express the selection in
 * draft coordinates for the Markdown engine.
 */

import { useEffect, useState } from 'react'
import type { ComposerNativeRange, ComposerPresentationState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { composerDomTextRuns } from './dom-mapping.ts'

/** Latest draft/native-range pair used to map DOM selection to draft offsets. */
export interface PresentationSource {
  readonly draft: string
  readonly nativeRanges: readonly ComposerNativeRange[]
}

const FALLBACK: ComposerPresentationState = {
  focused: false,
  selectionStart: -1,
  selectionEnd: -1,
  activeLineStart: -1,
  activeLineEnd: -1,
}

function lineBounds(draft: string, offset: number): { readonly start: number; readonly end: number } {
  if (offset < 0) return { start: -1, end: -1 }
  const start = draft.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  const newline = draft.indexOf('\n', offset)
  return { start, end: newline === -1 ? draft.length : newline }
}

/** Map one DOM selection endpoint to a draft offset; undefined when unmappable. */
function domPointToDraftOffset(
  node: Node | null,
  offset: number,
  input: HTMLElement,
  source: PresentationSource,
): number | undefined {
  if (node === null) return undefined
  if (node === input) {
    // Element endpoint: bias to the first/last ordinary text position.
    const runs = composerDomTextRuns(input, source.draft, source.nativeRanges)
    if (runs === undefined || runs.length === 0) return undefined
    return offset <= 0 ? runs[0]!.start : runs.at(-1)!.end
  }
  const text = node.nodeType === Node.TEXT_NODE
    ? node as Text
    : ((): Text | undefined => {
      // Element endpoint inside the editable: use the nearest ordinary text.
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      const first = walker.nextNode()
      if (first === null) return undefined
      return first as Text
    })()
  if (text === undefined) return undefined
  const runs = composerDomTextRuns(input, source.draft, source.nativeRanges)
  if (runs === undefined) return undefined
  const run = runs.find(candidate => candidate.node === text)
  if (run === undefined) return undefined
  return run.start + Math.min(Math.max(0, offset), text.data.length)
}

/**
 * Subscribe to focus/composition/selection changes on the contenteditable.
 * @param input - the Core-owned contenteditable, or null while unresolved.
 * @param sourceRef - mutable read of the current draft/native-range pair.
 * @returns the tracked presentation state.
 */
export function useComposerPresentation(
  input: HTMLElement | null,
  sourceRef: { readonly current: PresentationSource },
): ComposerPresentationState {
  const [state, setState] = useState<ComposerPresentationState>(FALLBACK)

  useEffect(() => {
    if (input === null) {
      setState(FALLBACK)
      return () => {}
    }
    let composing = false
    let focused = document.activeElement === input || input.contains(document.activeElement)

    const publish = (): void => {
      const source = sourceRef.current
      const selection = document.getSelection()
      let start = -1
      let end = -1
      if (selection !== null && selection.anchorNode !== null
        && input.contains(selection.anchorNode)) {
        const anchor = domPointToDraftOffset(selection.anchorNode, selection.anchorOffset, input, source)
        const focus = domPointToDraftOffset(selection.focusNode, selection.focusOffset, input, source)
        if (anchor !== undefined && focus !== undefined) {
          start = Math.min(anchor, focus)
          end = Math.max(anchor, focus)
        }
      }
      const line = lineBounds(source.draft, start)
      setState((previous: ComposerPresentationState) => {
        const next: ComposerPresentationState = {
          focused,
          composing: composing || undefined,
          selectionStart: start,
          selectionEnd: end,
          activeLineStart: line.start,
          activeLineEnd: line.end,
        }
        return previous.focused === next.focused
          && previous.composing === next.composing
          && previous.selectionStart === next.selectionStart
          && previous.selectionEnd === next.selectionEnd
          && previous.activeLineStart === next.activeLineStart
          && previous.activeLineEnd === next.activeLineEnd
          ? previous
          : next
      })
    }

    const onFocus = (): void => { focused = true; publish() }
    const onBlur = (): void => { focused = false; publish() }
    const onCompositionStart = (): void => { composing = true; publish() }
    const onCompositionEnd = (): void => { composing = false; publish() }
    const onSelectionChange = (): void => { publish() }

    input.addEventListener('focus', onFocus)
    input.addEventListener('blur', onBlur)
    input.addEventListener('compositionstart', onCompositionStart)
    input.addEventListener('compositionend', onCompositionEnd)
    document.addEventListener('selectionchange', onSelectionChange)
    publish()
    return () => {
      input.removeEventListener('focus', onFocus)
      input.removeEventListener('blur', onBlur)
      input.removeEventListener('compositionstart', onCompositionStart)
      input.removeEventListener('compositionend', onCompositionEnd)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [input, sourceRef])

  return state
}
