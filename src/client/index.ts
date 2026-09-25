import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { BetterComposerSettingsCard } from './settings-card.tsx'
import { createEditorContribution } from './editor.tsx'
import { SETTINGS_NAMESPACE } from '../settings.ts'
import { BetterComposerSettingsStore } from './settings-store.ts'
import { installStyles } from './styles.ts'
import { betterComposerRemote, betterComposerRemoteContribution, getRemoteFace, publishRemoteState, remoteSnapshot } from './remote.ts'
import { ClipStore } from './clip-store.ts'
import { createClipSource, CLIP_SOURCE } from './clip-source.ts'
import { CLIP_TAB_ID, CLIP_TAB_KIND, clipTabDefinition, ClipPanel } from './clip-panel.tsx'
import {
  CONTEXT_MAP_TAB_ID, CONTEXT_MAP_TAB_KIND, contextMapTabDefinition, ContextMapButton, ContextMapPanel,
  publishContextMapOpener, type ContextMapProbe,
} from './context-map-panel.tsx'
import { ComposerExpandButton } from './expand-button.tsx'

/** Required client services for the composer contribution. */
export const inject = ['conversation', 'slots', 'configForms', 'remote', 'inputTriggers', 'sessions']

/** Optional services older hosts may not provide; absent in bare test contexts. */
function optionalService<T>(ctx: ClientContext, name: string): T | undefined {
  const get = (ctx as { readonly get?: (name: string, strict?: boolean) => unknown }).get
  if (typeof get !== 'function') return undefined
  const value = get.call(ctx, name, false)
  return value === undefined || value === null ? undefined : value as T
}

/** The session's effective model route: pending projection, then last used, then the catalog default. */
async function resolveClipModel(
  ctx: ClientContext,
  sessionId: string,
): Promise<{ readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | undefined> {
  const sessions = ctx.sessions
  if (sessions === undefined) return undefined
  const binding = sessions.binding(sessionId as never)
  const projections = binding?.session.projections as {
    readonly faceOf?: (key: string) => {
      getSnapshot?: () => {
        readonly next?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
        readonly lastUsed?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
      } | undefined
    } | undefined
  } | undefined
  const projected = projections?.faceOf?.('modelSelection')?.getSnapshot?.()
  const route = projected?.next ?? projected?.lastUsed
  if (route !== null && route !== undefined) return route
  const sessionRemote = optionalService<{
    modelCatalog: () => Promise<{ readonly ok: boolean; readonly value?: { readonly default?: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } } }>
  }>(ctx, 'remote.session')
  const catalog = await sessionRemote?.modelCatalog()
  return catalog?.ok === true ? catalog.value?.default : undefined
}

/** Recent user/assistant message texts of one session, defensive over the event window shape. */
function recentSessionMessages(
  ctx: ClientContext,
  sessionId: string,
): readonly { readonly role: string; readonly text: string }[] {
  const binding = ctx.sessions?.binding(sessionId as never)
  const source = binding?.eventSource
  const entries = (source?.getSnapshot() as { readonly entries?: readonly unknown[] } | undefined)?.entries ?? []
  const messages: { role: string; text: string }[] = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const candidate = entry as { readonly type?: string; readonly event?: { readonly type?: string; readonly data?: unknown } }
    if (candidate.type !== 'event') continue
    const event = candidate.event
    if (event?.type !== 'user/message' && event?.type !== 'assistant/message') continue
    const data = event.data as { readonly role?: string; readonly content?: unknown } | undefined
    if (!Array.isArray(data?.content)) continue
    const text = (data.content as readonly unknown[])
      .filter((block): block is { readonly type: 'text'; readonly text: string } =>
        block !== null && typeof block === 'object'
        && (block as { readonly type?: unknown }).type === 'text'
        && typeof (block as { readonly text?: unknown }).text === 'string')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text === '') continue
    messages.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text: text.slice(0, 2000) })
  }
  return messages.slice(-6)
}

interface ProbeSource {
  readonly getSnapshot?: () => unknown
  readonly subscribe?: (listener: () => void) => () => void
}

/**
 * Push-only probe for the context map. Source subscriptions exist only while
 * the panel has listeners; an unmounted map costs nothing.
 */
function createContextMapProbe(ctx: ClientContext, sessionId: string): ContextMapProbe {
  let version = 0
  const listeners = new Set<() => void>()
  const notify = (): void => {
    version += 1
    for (const listener of listeners) listener()
  }

  const binding = ctx.sessions?.binding(sessionId as never)
  const projections = (binding?.session.projections ?? undefined) as {
    readonly faceOf?: (key: string) => ProbeSource | undefined
  } | undefined
  const eventSource = binding?.eventSource as ProbeSource | undefined
  const inputState = ((): ProbeSource | undefined => {
    const scope = ctx.sessions?.scope(sessionId as never)
    if (scope === undefined) return undefined
    try {
      return (ctx.conversation.input.for(scope) as { readonly state?: ProbeSource }).state
    } catch {
      return undefined
    }
  })()

  let sourceUnsubs: (() => void)[] | undefined
  const ensureSources = (): void => {
    if (sourceUnsubs !== undefined) return
    const unsubs: (() => void)[] = []
    for (const key of ['contextPressure', 'contextBreakdown', 'tokenUsage'] as const) {
      try {
        const face = projections?.faceOf?.(key)
        if (face?.subscribe !== undefined) unsubs.push(face.subscribe(notify))
      } catch {
        // Older hosts: the projection is absent; the map falls back to estimates.
      }
    }
    try {
      if (eventSource?.subscribe !== undefined) unsubs.push(eventSource.subscribe(notify))
    } catch { /* fail open */ }
    try {
      if (inputState?.subscribe !== undefined) unsubs.push(inputState.subscribe(notify))
    } catch { /* fail open */ }
    sourceUnsubs = unsubs
  }
  const dropSources = (): void => {
    for (const unsubscribe of sourceUnsubs ?? []) unsubscribe()
    sourceUnsubs = undefined
  }

  let historyStarted = false
  let historyDone = false
  const loadAllHistory = (): void => {
    if (historyStarted) return
    historyStarted = true
    const loader = (binding?.session as { readonly loadThrough?: (seq: never) => Promise<void> } | undefined)?.loadThrough
    if (typeof loader !== 'function') {
      historyDone = true
      return
    }
    void loader.call(binding?.session, 1 as never).catch(() => {}).finally(() => {
      historyDone = true
      notify()
    })
  }

  return {
    version: () => version,
    subscribe: (listener) => {
      listeners.add(listener)
      ensureSources()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) dropSources()
      }
    },
    historyLoading: () => historyStarted && !historyDone,
    loadAllHistory,
    projection: (key) => {
      try {
        return projections?.faceOf?.(key)?.getSnapshot?.()
      } catch {
        return undefined
      }
    },
    events: () => {
      const snapshot = eventSource?.getSnapshot?.() as { readonly entries?: readonly unknown[]; readonly revision?: number } | undefined
      return { entries: snapshot?.entries ?? [], revision: snapshot?.revision ?? 0 }
    },
    draftClips: () => {
      const snapshot = inputState?.getSnapshot?.() as { readonly occurrences?: readonly { readonly source?: string }[] } | undefined
      let count = 0
      for (const occurrence of snapshot?.occurrences ?? []) {
        if (occurrence?.source === CLIP_SOURCE) count += 1
      }
      return count
    },
    compact: async () => {
      const face = binding?.session as { readonly command?: (line: string) => Promise<unknown> } | undefined
      if (typeof face?.command !== 'function') throw new Error('当前宿主不支持会话命令')
      const result = await face.command('/compact')
      const matched = (result as { readonly matched?: unknown } | undefined)?.matched
      if (matched === false) throw new Error('会话未接纳 /compact 命令（可能正在运行中）')
    },
    forkAt: async (atSeq: number) => {
      const sessions = ctx.sessions
      if (sessions === undefined || typeof sessions.fork !== 'function') throw new Error('当前宿主不支持会话分叉')
      await sessions.fork({ sessionId: sessionId as never, atSeq: atSeq as never })
    },
  }
}

/** Register production contributions through independent effect-owned disposers. */
export function apply(ctx: ClientContext): void {
  installStyles(ctx)
  const settings = new BetterComposerSettingsStore(ctx.configForms.get(SETTINGS_NAMESPACE))
  ctx.effect(() => () => { settings.dispose() }, 'dsh-better-composer: settings store')

  // Settings page: one tab inside the official Plugins section.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: SETTINGS_NAMESPACE,
    order: 20,
    label: 'Better Composer',
    inject: () => ({ settings }),
  }, BetterComposerSettingsCard))

  // Pasted-text clips: store + submit-time serializer + chip click → panel.
  const clips = new ClipStore({
    store: (entry) => {
      void getRemoteFace().then((face) => {
        if (face === undefined) return
        void face.storePaste({ id: entry.id, text: entry.text, mode: entry.mode, createdAt: entry.createdAt, cwd: entry.cwd, fileExtension: entry.fileExtension })
      }, () => {})
    },
    load: async (id) => {
      const face = await getRemoteFace()
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

  // Markdown overlay: presentation, self-painted highlights, structural
  // block decorations, capture keymap, and long-paste conversion.
  const editor = createEditorContribution(ctx, settings, clips)
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'dsh-better-composer.overlay',
  }, editor))

  if (ctx.inputTriggers !== undefined) {
    ctx.effect(() => ctx.inputTriggers.registerSource(createClipSource(
      clips,
      (id) => {
        optionalService<{ openTab: (kind: string, options?: unknown) => void }>(ctx, 'sidebarRight')
          ?.openTab(CLIP_TAB_KIND, { params: { id } })
      },
      getRemoteFace,
      () => {
        const sessions = ctx.sessions
        if (sessions === undefined) return ''
        const list = sessions.list.getSnapshot() as { readonly byId?: Readonly<Record<string, { readonly cwd?: string }>> }
        const cwds = new Set(Object.values(list.byId ?? {})
          .map(session => session?.cwd)
          .filter((cwd): cwd is string => typeof cwd === 'string' && cwd !== ''))
        return cwds.size === 1 ? [...cwds][0]! : ''
      },
    )), 'dsh-better-composer: clip source')
  }

  // Right-sidebar clip editor and context map.
  const sidebarRightTabs = optionalService<{ register: (definition: unknown) => () => void }>(ctx, 'sidebarRightTabs')
  if (sidebarRightTabs !== undefined) {
    ctx.effect(() => sidebarRightTabs.register(clipTabDefinition()), 'dsh-better-composer: clip tab type')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: CLIP_TAB_ID,
      inject: (sessionId: unknown) => ({
        clips,
        remote: getRemoteFace,
        resolveModel: (id: string) => resolveClipModel(ctx, id),
        fetchContext: (id: string) => recentSessionMessages(ctx, id),
        sessionId: String(sessionId),
      }),
    }, ClipPanel))
    ctx.effect(() => sidebarRightTabs.register(contextMapTabDefinition()), 'dsh-better-composer: context map tab type')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: CONTEXT_MAP_TAB_ID,
      inject: (sessionId: unknown) => ({ probe: createContextMapProbe(ctx, String(sessionId)) }),
    }, ContextMapPanel))

    // Composer toolbar entries: expand button and context map button.
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
      name: 'conversation.input.right',
      id: 'dsh-better-composer.expand',
      order: 10,
    }, ComposerExpandButton))
    publishContextMapOpener(() => {
      optionalService<{ openTab: (kind: string, options?: unknown) => void }>(ctx, 'sidebarRight')
        ?.openTab(CONTEXT_MAP_TAB_KIND, { params: {} })
    })
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
      name: 'conversation.input.right',
      id: 'dsh-better-composer.contextmap',
      order: 20,
    }, ContextMapButton))
  }

  if (ctx.remote === undefined) return
  const mounted: Promise<() => Promise<void>> = ctx.remote.$mount(betterComposerRemoteContribution as never)
  void mounted.then((disposer) => {
    publishRemoteState({ face: betterComposerRemote(ctx) })
    return disposer
  }, (error: unknown) => {
    publishRemoteState({ error: String(error) })
  })
  ctx.effect(() => () => { void mounted.then(dispose => dispose(), () => {}) }, 'dsh-better-composer: remote mount')
}
