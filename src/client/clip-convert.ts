import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ComposerDecorationContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClipStore } from './clip-store.ts'
import { CLIP_SOURCE, clipMention } from './clip-source.ts'
import type { InsertionDetection } from './paste-watch.ts'

/** The session's workspace cwd, read from the session list projection. */
function sessionCwd(ctx: ClientContext, sessionId: ComposerDecorationContext['sessionId']): string {
  const sessions = ctx.sessions
  if (sessions === undefined) return ''
  const list = sessions.list.getSnapshot() as { readonly byId?: Readonly<Record<string, { readonly cwd?: string }>> }
  return list.byId?.[String(sessionId)]?.cwd ?? ''
}

/**
 * Replace one detected long insertion with a clip reference chip, preserving
 * every existing reference's offset. Returns false when the session scope is
 * unavailable or the insertion overlaps an existing chip.
 */
export function convertInsertionToClip(
  ctx: ClientContext,
  clips: ClipStore,
  context: ComposerDecorationContext,
  detection: InsertionDetection,
): boolean {
  const sessions = ctx.sessions
  if (sessions === undefined) return false
  const actx = sessions.scope(context.sessionId as never)
  if (actx === undefined) return false
  const input = ctx.conversation.input.for(actx)
  const occurrences = input.state.getSnapshot().occurrences
  const overlaps = occurrences.some((occurrence: { readonly offset: number; readonly length: number }) =>
    occurrence.offset < detection.end && detection.start < occurrence.offset + occurrence.length)
  if (overlaps) return false
  const entry = clips.create(detection.text, sessionCwd(ctx, context.sessionId))
  const mention = clipMention(entry.id)
  const next = context.draft.slice(0, detection.start) + mention + context.draft.slice(detection.end)
  const shift = mention.length - (detection.end - detection.start)
  const references = [
    ...occurrences.map((occurrence: {
      readonly source: string
      readonly ref: string
      readonly label: string
      readonly appearance?: string
      readonly clipboardText: string
      readonly offset: number
      readonly length: number
      readonly invalid?: boolean
    }) => ({
      source: occurrence.source,
      ref: occurrence.ref,
      label: occurrence.label,
      ...(occurrence.appearance === undefined ? {} : { appearance: occurrence.appearance }),
      clipboardText: occurrence.clipboardText,
      offset: occurrence.offset >= detection.end ? occurrence.offset + shift : occurrence.offset,
      length: occurrence.length,
      ...(occurrence.invalid === undefined ? {} : { invalid: occurrence.invalid }),
    })),
    {
      source: CLIP_SOURCE,
      ref: entry.id,
      label: '粘贴文本',
      appearance: 'file' as const,
      clipboardText: mention,
      offset: detection.start,
      length: mention.length,
    },
  ].sort((left, right) => left.offset - right.offset)
  // The published input face may predate reference-aware setDraft; the host
  // runtime accepts (text, references).
  ;(input.setDraft as (text: string, refs?: readonly unknown[]) => void)(next, references)
  input.notify('info', '超长粘贴已转为引用：点击可查看和编辑；⌘Z 撤销本次粘贴。')
  return true
}
