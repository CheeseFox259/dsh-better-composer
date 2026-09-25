/**
 * Convert one detected long paste into a clip reference chip.
 *
 * First tries the session-scoped cordis event `slash/input-insert-reference`
 * (`@mode bail`) to create an interactive ReferenceChipNode. If that path
 * refuses (due to busy phase or revision skew), it falls back to
 * `inputActions.insertText(mention, span)` to replace the large inserted span
 * with a mention text while preserving every surrounding chip.
 * Feedback uses a transient 4-second toast rather than a persistent notice.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClipStore } from './clip-store.ts'
import { CLIP_SOURCE, clipMention } from './clip-source.ts'
import { showClipToast } from './clip-toast.ts'
import { DEFAULT_PASTE_FILE_EXTENSION, type PasteFileExtension } from '../file-extensions.ts'

/** The session input facade the overlay resolves per session. */
export interface ClipSessionInput {
  readonly state: { getSnapshot(): { readonly draft: string; readonly draftRev: number; readonly occurrences: readonly ClipOccurrence[] } }
  setDraft(text: string): void
  notify(level: 'info' | 'error', text: string): void
}

export interface ClipOccurrence {
  readonly source: string
  readonly ref: string
  readonly offset: number
  readonly length: number
}

/** The session's workspace cwd, read from the session list projection. */
function sessionCwd(ctx: ClientContext, sessionId: string): string {
  const sessions = ctx.sessions
  if (sessions === undefined) return ''
  const list = sessions.list.getSnapshot() as { readonly byId?: Readonly<Record<string, { readonly cwd?: string }>> }
  return list.byId?.[sessionId]?.cwd ?? ''
}

/**
 * Replace one detected long insertion with a clip reference chip.
 * @param ctx - client context (resolves the session scope).
 * @param clips - the clip store.
 * @param sessionId - target session.
 * @param detection - detected insertion in clipboard coordinates.
 * @param input - the session input facade.
 * @param inputActions - the session's official input actions.
 * @returns whether the conversion landed (chip or fallback text).
 */
export function convertCapturedPasteToClip(
  ctx: ClientContext,
  clips: ClipStore,
  sessionId: string,
  text: string,
  span: { readonly start: number; readonly end: number; readonly draftRev: number },
  input: ClipSessionInput,
  fileExtension: PasteFileExtension = DEFAULT_PASTE_FILE_EXTENSION,
): boolean {
  const snapshot = input.state.getSnapshot()
  if (span.draftRev !== snapshot.draftRev) return false
  if (span.start < 0 || span.start > span.end || span.end > snapshot.draft.length) return false
  if (snapshot.occurrences.some(occurrence =>
    occurrence.offset < span.end && span.start < occurrence.offset + occurrence.length)) return false
  const sessions = ctx.sessions
  if (sessions === undefined) return false
  const actx = sessions.scope(sessionId as never)
  if (actx === undefined) return false
  const entry = clips.create(text, sessionCwd(ctx, sessionId), fileExtension, false)
  const reference: ReferenceInsert = {
    source: CLIP_SOURCE,
    ref: entry.id,
    label: '粘贴文本',
    appearance: 'file',
    clipboardText: clipMention(entry.id),
  }
  const dispatcher = actx as unknown as {
    bail(name: 'slash/input-insert-reference', request: {
      readonly reference: ReferenceInsert
      readonly span: { readonly start: number; readonly end: number; readonly draftRev: number }
    }): true | undefined
  }
  const applied = dispatcher.bail('slash/input-insert-reference', { reference, span }) === true
  if (!applied) {
    showClipToast('超长粘贴转引用受阻，已保留原始输入。')
    return false
  }
  clips.persist(entry)
  showClipToast('超长粘贴已转为引用：点击可查看和编辑；⌘Z 撤销本次粘贴。')
  return true
}
