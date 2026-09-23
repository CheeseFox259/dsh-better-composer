import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { subscribeGrammarLoaded } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { createDecorationProvider } from './decoration-provider.ts'
import { createEnabledActions } from '../commands/actions.ts'
import { BetterComposerSettingsCard } from './settings-card.tsx'
import { createEditorContribution } from './editor.tsx'
import { SETTINGS_NAMESPACE } from '../settings.ts'
import { BetterComposerSettingsStore } from './settings-store.ts'
import { installStyles } from './styles.ts'
import { betterComposerRemote, betterComposerRemoteContribution, publishRemoteState, remoteSnapshot } from './remote.ts'
import { ClipStore } from './clip-store.ts'
import { convertInsertionToClip } from './clip-convert.ts'
import { createClipSource, CLIP_SOURCE } from './clip-source.ts'
import { CLIP_TAB_ID, CLIP_TAB_KIND, clipTabDefinition, ClipPanel } from './clip-panel.tsx'
import {
  CONTEXT_MAP_TAB_ID, CONTEXT_MAP_TAB_KIND, contextMapTabDefinition, ContextMapButton, ContextMapPanel,
  publishContextMapOpener, type ContextMapProbe,
} from './context-map-panel.tsx'

/** Required client services for the generic composer contribution. */
export const inject = ['conversation', 'slots', 'settingsScope', 'remote', 'inputTriggers', 'sessions']

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
): Promise<{ readonly provider: string; readonly model: string } | undefined> {
  const sessions = ctx.sessions
  if (sessions === undefined) return undefined
  const binding = sessions.binding(sessionId as never)
  const projections = binding?.session.projections as {
    readonly faceOf?: (key: string) => {
      getSnapshot?: () => {
        readonly next?: { readonly provider: string; readonly model: string } | null
        readonly lastUsed?: { readonly provider: string; readonly model: string } | null
      } | undefined
    } | undefined
  } | undefined
  const projected = projections?.faceOf?.('modelSelection')?.getSnapshot?.()
  const route = projected?.next ?? projected?.lastUsed
  if (route !== null && route !== undefined) return route
  const sessionRemote = optionalService<{
    modelCatalog: () => Promise<{ readonly ok: boolean; readonly value?: { readonly default?: { readonly provider: string; readonly model: string } } }>
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

  // Full-history pull: the event window opens on the session tail. Paging back
  // to seq 1 prepends every earlier page; each prepend notifies subscribers,
  // so the map repaints as history arrives. Older hosts without loadThrough
  // report a settled (empty) load.
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
  const settings = new BetterComposerSettingsStore(ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }))
  ctx.effect(() => () => { settings.dispose() }, 'dsh-better-composer: settings store')
  // The settings card needs only settingsScope and slots, so it registers
  // before the composer-registry gate below.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: SETTINGS_NAMESPACE,
    inject: () => ({ settings }),
  }, BetterComposerSettingsCard))
  // Older hosts may not expose the optional composer registries yet. Keep the
  // native composer usable while the contribution is absent. The published
  // conversation face may predate the decoration/action registries; the host
  // runtime provides them on current harness versions.
  const conversation = ctx.conversation as unknown as {
    decorations?: { register(provider: unknown): () => void }
    actions?: { register(action: unknown): () => void }
  }
  if (conversation.decorations === undefined || conversation.actions === undefined) return
  const provider = createDecorationProvider(() => settings.get())
  ctx.effect(() => {
    let current = settings.get()
    let dispose = conversation.decorations!.register(provider)
    // Re-registering bumps Core's registry version, which re-collects ranges
    // for the current draft: settings toggles and lazy Shiki grammar loads
    // (which unlock token ranges the projection cache now re-derives) both
    // repaint through this one path.
    const reregister = () => {
      dispose()
      dispose = conversation.decorations!.register(provider)
    }
    const unsubscribe = settings.subscribe(() => {
      const next = settings.get()
      const changed = next.enabled !== current.enabled
        || next.markdownVisual !== current.markdownVisual
        || next.diagnostics !== current.diagnostics
      current = next
      if (!changed) return
      reregister()
    })
    const unsubscribeGrammar = subscribeGrammarLoaded(reregister)
    return () => {
      unsubscribe()
      unsubscribeGrammar()
      dispose()
    }
  }, 'dsh-better-composer: markdown decorations')
  for (const action of createEnabledActions(() => settings.get().enabled)) {
    ctx.effect(() => conversation.actions!.register(action), `dsh-better-composer: action ${action.id}`)
  }
  const editor = createEditorContribution(settings, (context, detection) => {
    if (!settings.get().enabled) return false
    return convertInsertionToClip(ctx, clips, context, detection)
  })
  ctx.slots.inject('conversation.input.editor', () => ctx.slots.register({ name: 'conversation.input.editor' }, editor))
  // Pasted-text clips: store + submit-time serializer + chip click → panel (M2).
  // Older hosts may lack the Remote service or the input-trigger registry;
  // each capability stays off there while the rest of the plugin works.
  const clips = new ClipStore({
    store: (entry) => {
      const face = remoteSnapshot().face
      if (face === undefined) return
      void face.storePaste({ id: entry.id, text: entry.text, mode: entry.mode, createdAt: entry.createdAt, cwd: entry.cwd })
    },
    load: async (id) => {
      const face = remoteSnapshot().face
      if (face === undefined) return undefined
      const result = await face.loadPaste({ id })
      return result.ok ? result.value.text : undefined
    },
  })
  if (ctx.inputTriggers !== undefined) {
    ctx.effect(() => ctx.inputTriggers.registerSource(createClipSource(clips, (id) => {
      optionalService<{ openTab: (kind: string, options?: unknown) => void }>(ctx, 'sidebarRight')
        ?.openTab(CLIP_TAB_KIND, { params: { id } })
    }, () => remoteSnapshot().face)), 'dsh-better-composer: clip source')
  }
  // Right-sidebar clip editor: type definition first, body under its key.
  const sidebarRightTabs = optionalService<{ register: (definition: unknown) => () => void }>(ctx, 'sidebarRightTabs')
  if (sidebarRightTabs !== undefined) {
    ctx.effect(() => sidebarRightTabs.register(clipTabDefinition()), 'dsh-better-composer: clip tab type')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: CLIP_TAB_ID,
      inject: () => ({
        clips,
        remote: () => remoteSnapshot().face,
        resolveModel: (sessionId: string) => resolveClipModel(ctx, sessionId),
        fetchContext: (sessionId: string) => recentSessionMessages(ctx, sessionId),
      }),
    }, ClipPanel))
    ctx.effect(() => sidebarRightTabs.register(contextMapTabDefinition()), 'dsh-better-composer: context map tab type')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: CONTEXT_MAP_TAB_ID,
      inject: (sessionId: unknown) => ({ probe: createContextMapProbe(ctx, String(sessionId)) }),
    }, ContextMapPanel))
    // Composer toolbar entry: an icon button beside the send controls.
    publishContextMapOpener(() => {
      optionalService<{ openTab: (kind: string, options?: unknown) => void }>(ctx, 'sidebarRight')
        ?.openTab(CONTEXT_MAP_TAB_KIND, { params: {} })
    })
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
      name: 'conversation.input.right',
      id: 'dsh-better-composer.contextmap',
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
