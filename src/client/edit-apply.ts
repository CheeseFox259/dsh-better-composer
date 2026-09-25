/**
 * Apply source edits through the official InputActions face.
 *
 * The Markdown transforms compute edits in draft (clipboard-projection)
 * coordinates, where every chip occupies its full clipboard text. The
 * official `insertText` span uses detect coordinates, where every chip
 * counts as one U+FFFC. Edits that touch a chip interior are refused —
 * plain text cannot represent them.
 */

import type { ComposerEditResult } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The occurrence fields the coordinate conversion needs. */
export interface OccurrenceOffset {
  readonly offset: number
  readonly length: number
}

/**
 * Convert one clipboard-projection offset to a detect-projection offset.
 * @returns the detect offset, or undefined when the offset falls inside a chip.
 */
export function clipboardToDetectOffset(
  occurrences: readonly OccurrenceOffset[],
  position: number,
): number | undefined {
  let detect = position
  for (const occurrence of [...occurrences].sort((left, right) => left.offset - right.offset)) {
    if (occurrence.offset + occurrence.length <= position) {
      detect -= occurrence.length - 1
    } else if (occurrence.offset < position) {
      return undefined
    }
  }
  return detect
}

/** The stable public input actions face the overlay receives as a slot prop. */
export interface EditApplyActions {
  insertText(text: string, span: { readonly start: number; readonly end: number; readonly draftRev: number }): boolean
}

/**
 * Apply one Markdown edit over the draft without destroying reference chips.
 * @param actions - the session's official input actions.
 * @param occurrences - current chip occurrences in clipboard coordinates.
 * @param edit - source edit in clipboard coordinates.
 * @param draftRev - the draft revision the edit was computed against.
 * @returns whether the edit landed.
 */
export function applyComposerEdit(
  actions: EditApplyActions,
  occurrences: readonly OccurrenceOffset[],
  edit: ComposerEditResult,
  draftRev: number,
): boolean {
  const start = clipboardToDetectOffset(occurrences, edit.start)
  const end = clipboardToDetectOffset(occurrences, edit.end)
  if (start === undefined || end === undefined || start > end) return false
  return actions.insertText(edit.text, { start, end, draftRev })
}
