/**
 * PasteClipController: Unified cohesive controller for the pasted-text clip subsystem (Candidate 5).
 * Encapsulates pre-Core paste capture, threshold planning, Lexical reference chip insertion,
 * failure fallback, instance-scoped toast notifications, store access, and submit-time serialization.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InputActions, ReferenceInsert, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { composerSessions } from './session-face.ts'
import { ClipStore, type ClipEntry } from './clip-store.ts'
import type { BetterComposerRemoteFace } from './remote.ts'
import { DEFAULT_PASTE_FILE_EXTENSION, type PasteFileExtension } from '../file-extensions.ts'

export const CLIP_SOURCE = 'clip'

export function clipMention(id: string): string {
  return `@clip:${id}`
}

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

export interface ClipOccurrence {
  readonly source: string
  readonly ref: string
  readonly offset: number
  readonly length: number
}

export interface ClipSessionInput {
  readonly state: { getSnapshot(): { readonly draft: string; readonly draftRev: number; readonly occurrences: readonly ClipOccurrence[] } }
  setDraft(text: string): void
  notify(level: 'info' | 'error', text: string): void
}

export interface ClipSessionInfo {
  readonly sessionId: string
  readonly sessionInput?: ClipSessionInput
  readonly readState: () => {
    readonly draft: string
    readonly occurrences: number
    readonly phase: string
    readonly composing: boolean
    readonly threshold: number
    readonly fileExtension?: PasteFileExtension
  }
}

export interface PasteClipControllerOptions {
  readonly ctx?: ClientContext
  readonly store?: ClipStore
  readonly getRemote?: () => BetterComposerRemoteFace | undefined | Promise<BetterComposerRemoteFace | undefined>
  readonly openPanel?: (id: string) => void
  readonly resolveCwd?: (sessionId: string) => string
  readonly scopeResolver?: (sessionId: string) => { bail(name: string, request: unknown): unknown } | undefined
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

export class PasteClipController {
  readonly store: ClipStore
  readonly source: InputTriggerSource
  private currentToast: string | null = null
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private readonly toastListeners = new Set<() => void>()

  private readonly ctx?: ClientContext
  private readonly getRemote?: () => BetterComposerRemoteFace | undefined | Promise<BetterComposerRemoteFace | undefined>
  private readonly resolveCwd?: (sessionId: string) => string
  private readonly scopeResolver?: (sessionId: string) => { bail(name: string, request: unknown): unknown } | undefined

  constructor(options: PasteClipControllerOptions = {}) {
    this.ctx = options.ctx
    this.getRemote = options.getRemote
    this.resolveCwd = options.resolveCwd
    this.scopeResolver = options.scopeResolver

    this.store = options.store ?? new ClipStore({
      store: (entry) => {
        if (!this.getRemote) return
        void Promise.resolve(this.getRemote()).then((face) => {
          if (face === undefined) return
          void face.storePaste({
            id: entry.id,
            text: entry.text,
            mode: entry.mode,
            createdAt: entry.createdAt,
            cwd: entry.cwd,
            fileExtension: entry.fileExtension,
          })
        }, () => {})
      },
      load: async (id) => {
        if (!this.getRemote) return undefined
        const face = await this.getRemote()
        if (face === undefined) return undefined
        const result = await face.loadPaste({ id })
        if (!result.ok || result.value.text === undefined) return undefined
        return {
          text: result.value.text,
          mode: result.value.mode,
          createdAt: result.value.createdAt,
          cwd: result.value.cwd,
          fileExtension: result.value.fileExtension,
        }
      },
    })

    this.source = {
      trigger: '@',
      name: CLIP_SOURCE,
      showGroupTitle: false,
      candidates: () => Promise.resolve([]),
      onPick: () => undefined,
      codec: {
        clipboardText: (ref) => clipMention(ref),
        serialize: async (ref) => {
          const entry = await this.store.resolve(ref)
          if (entry === undefined) throw new Error(`pasted text clip ${JSON.stringify(ref)} is no longer available`)
          return entry.mode === 'file' ? this.serializeAsFile(entry) : entry.text
        },
      },
      openReference: (_session, reference) => {
        options.openPanel?.(reference.ref)
        return true
      },
    }
  }

  showToast(message: string, durationMs = 4000): void {
    this.currentToast = message
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.currentToast = null
      this.toastTimer = undefined
      this.notifyToast()
    }, durationMs)
    this.notifyToast()
  }

  dismissToast(): void {
    if (this.toastTimer !== undefined) {
      clearTimeout(this.toastTimer)
      this.toastTimer = undefined
    }
    this.currentToast = null
    this.notifyToast()
  }

  getToast = (): string | null => {
    return this.currentToast
  }

  subscribeToast = (listener: () => void): () => void => {
    this.toastListeners.add(listener)
    return () => {
      this.toastListeners.delete(listener)
    }
  }

  private notifyToast(): void {
    for (const listener of this.toastListeners) listener()
  }

  private sessionCwd(sessionId: string): string {
    if (this.resolveCwd) {
      const resolved = this.resolveCwd(sessionId)
      if (resolved) return resolved
    }
    if (this.ctx) {
      const sessions = composerSessions(this.ctx)
      if (sessions !== undefined) {
        const list = sessions.list.getSnapshot() as { readonly byId?: Readonly<Record<string, { readonly cwd?: string }>> }
        return list.byId?.[sessionId]?.cwd ?? ''
      }
    }
    return ''
  }

  private async serializeAsFile(entry: ClipEntry): Promise<string> {
    const cwd = entry.cwd !== '' ? entry.cwd : this.sessionCwd(entry.id)
    if (cwd === '') throw new Error('file-mode delivery needs the session workspace path, which is unknown')
    const face = await this.getRemote?.()
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

  private convertCapturedPasteToClip(
    sessionInfo: ClipSessionInfo,
    text: string,
    span: TokenSpan,
  ): boolean {
    const input = sessionInfo.sessionInput
    if (!input) return false
    const snapshot = input.state.getSnapshot()
    if (span.draftRev !== snapshot.draftRev) return false
    if (span.start < 0 || span.start > span.end || span.end > snapshot.draft.length) return false
    if (snapshot.occurrences.some((occurrence) =>
      occurrence.offset < span.end && span.start < occurrence.offset + occurrence.length)) {
      return false
    }

    let actx: { bail(name: string, request: unknown): unknown } | undefined
    if (this.scopeResolver) {
      actx = this.scopeResolver(sessionInfo.sessionId)
    } else if (this.ctx) {
      const sessions = composerSessions(this.ctx)
      actx = sessions?.scope(sessionInfo.sessionId as never) as never
    }
    if (actx === undefined) return false

    const state = sessionInfo.readState()
    const fileExtension = state.fileExtension ?? DEFAULT_PASTE_FILE_EXTENSION
    const entry = this.store.create(text, this.sessionCwd(sessionInfo.sessionId), fileExtension, false)
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
        readonly span: TokenSpan
      }): true | undefined
    }

    const applied = dispatcher.bail('slash/input-insert-reference', { reference, span }) === true
    if (!applied) {
      this.showToast('超长粘贴转引用受阻，已保留原始输入。')
      return false
    }

    this.store.persist(entry)
    this.showToast('超长粘贴已转为引用：点击可查看和编辑；⌘Z 撤销本次粘贴。')
    return true
  }

  attach(
    input: HTMLElement,
    actions: InputActions,
    sessionInfo: ClipSessionInfo,
  ): () => void {
    const onPaste = (event: ClipboardEvent): void => {
      const clipboard = readPasteEvent(event)
      const action = planPasteAction({ ...sessionInfo.readState(), ...clipboard, span: actions.captureInsertion() })
      if (action.kind === 'pass') return
      if (action.kind === 'clip') {
        if (!this.convertCapturedPasteToClip(sessionInfo, action.text, action.span)) return
      } else {
        actions.setDraft(action.text)
      }
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    input.addEventListener('paste', onPaste, { capture: true })
    return () => {
      input.removeEventListener('paste', onPaste, { capture: true })
    }
  }
}
