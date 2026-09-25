import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { ClipEntry, ClipStore } from './clip-store.ts'
import type { BetterComposerRemoteFace } from './remote.ts'

/** Reference source name for pasted-text clips; submit-time serialization routes by it. */
export const CLIP_SOURCE = 'clip'

/** The `@clip:<id>` mention text carrying one clip in the draft. */
export function clipMention(id: string): string {
  return `@clip:${id}`
}

/** Provider that returns the mounted remote face synchronously or asynchronously. */
export type RemoteProvider = () => BetterComposerRemoteFace | undefined | Promise<BetterComposerRemoteFace | undefined>

/** Serialize one file-mode clip: materialize it as a workspace file and hand the model the path. */
async function serializeAsFile(
  entry: ClipEntry,
  remote: RemoteProvider,
  resolveCwd?: () => string,
): Promise<string> {
  const cwd = entry.cwd !== '' ? entry.cwd : (resolveCwd?.() ?? '')
  if (cwd === '') throw new Error('file-mode delivery needs the session workspace path, which is unknown')
  const face = await remote()
  if (face === undefined) throw new Error('file-mode delivery needs the Remote service, which is unavailable')
  if (typeof face.storePaste === 'function') {
    const stored = await face.storePaste({
      id: entry.id,
      text: entry.text,
      mode: entry.mode,
      createdAt: entry.createdAt,
      cwd,
      fileExtension: entry.fileExtension,
    })
    if (!stored.ok) throw new Error(`file-mode delivery storage failed: ${remoteErrorMessage(stored.error)}`)
  }
  const published = await face.publishPaste({ id: entry.id, cwd })
  if (!published.ok) throw new Error(`file-mode delivery failed: ${remoteErrorMessage(published.error)}`)
  return `@${published.value.relativePath}`
}

function remoteErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'string' && error !== '') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * The pasted-text clip trigger source. It never joins the `@` menu (empty
 * candidates, no pick outcomes); it exists so Core renders the chips and
 * routes submit-time serialization through this codec.
 */
export function createClipSource(
  clips: ClipStore,
  openPanel: (id: string) => void,
  remote: RemoteProvider,
  resolveCwd?: () => string,
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
        return entry.mode === 'file' ? serializeAsFile(entry, remote, resolveCwd) : entry.text
      },
    },
    openReference: (_session, reference) => {
      openPanel(reference.ref)
      return true
    },
  }
}
