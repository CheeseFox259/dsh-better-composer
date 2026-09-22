import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ClipEntry, ClipStore } from './clip-store.ts'
import type { BetterComposerRemoteFace } from './remote.ts'

/** Reference source name for pasted-text clips; submit-time serialization routes by it. */
export const CLIP_SOURCE = 'clip'

/** The `@clip:<id>` mention text carrying one clip in the draft. */
export function clipMention(id: string): string {
  return `@clip:${id}`
}

/** Serialize one file-mode clip: materialize it as a workspace file and hand the model the path. */
async function serializeAsFile(
  entry: ClipEntry,
  remote: () => BetterComposerRemoteFace | undefined,
): Promise<string> {
  if (entry.cwd === '') throw new Error('file-mode delivery needs the session workspace path, which is unknown')
  const face = remote()
  if (face === undefined) throw new Error('file-mode delivery needs the Remote service, which is unavailable')
  const published = await face.publishPaste({ id: entry.id, cwd: entry.cwd })
  if (!published.ok) throw new Error(`file-mode delivery failed: ${JSON.stringify(published.error)}`)
  const name = `pasted-text-${entry.id}.md`
  return `File "${name}" (${published.value.bytes} bytes): verbatim read-only copy saved at "${published.value.path}". Read that path with your file tools when its contents are needed.`
}

/**
 * The pasted-text clip trigger source. It never joins the `@` menu (empty
 * candidates, no pick outcomes); it exists so Core renders the chips and
 * routes submit-time serialization through this codec.
 */
export function createClipSource(
  clips: ClipStore,
  openPanel: (id: string) => void,
  remote: () => BetterComposerRemoteFace | undefined,
): InputTriggerSource {
  return {
    trigger: '@',
    name: CLIP_SOURCE,
    showGroupTitle: false,
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    codec: {
      clipboardText: ref => clipMention(ref),
      serialize: async ref => {
        const entry = await clips.resolve(ref)
        if (entry === undefined) throw new Error(`pasted text clip ${JSON.stringify(ref)} is no longer available`)
        return entry.mode === 'file' ? serializeAsFile(entry, remote) : entry.text
      },
    },
    openReference: (_session, reference) => {
      openPanel(reference.ref)
      return true
    },
  }
}
