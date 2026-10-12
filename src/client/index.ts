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
import { composerSessions } from './session-face.ts'
import { CLIP_SOURCE, PasteClipController } from './clip-controller.ts'
import { CLIP_TAB_ID, CLIP_TAB_KIND, clipTabDefinition, ClipPanel } from './clip-panel.tsx'
import { ContextDoctorButton, DOCTOR_TAB_ID, doctorTabDefinition } from './context-doctor/panel.tsx'
import { DoctorClient } from './context-doctor/doctor-client.ts'
import type { ScanReport, ScanScope } from '../doctor/host/jobs.ts'
import type { ObservedModes } from '../doctor/host/observe.ts'
import {
  CONTEXT_MAP_TAB_ID, CONTEXT_MAP_TAB_KIND, contextMapTabDefinition,
  publishContextMapOpener, type ContextMapProbe,
} from './context-map-panel.tsx'
import { ContextWorkspaceTab, LegacyDoctorTab } from './context-workspace-tab.tsx'
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
  const sessions = composerSessions(ctx)
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
  const binding = composerSessions(ctx)?.binding(sessionId as never)
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
export function createContextMapProbe(ctx: ClientContext, sessionId: string): ContextMapProbe {
  let version = 0
  const listeners = new Set<() => void>()
  const notify = (): void => {
    if (listeners.size > 0 && subscribedBinding !== bindingNow()) rebindSources()
    version += 1
    for (const listener of listeners) listener()
  }

  const sessions = composerSessions(ctx)
  const bindingNow = () => sessions?.binding(sessionId as never)
  const projectionsOf = (binding: ReturnType<NonNullable<typeof sessions>['binding']>) => (binding?.session.projections ?? undefined) as {
    readonly faceOf?: (key: string) => ProbeSource | undefined
  } | undefined
  const inputStateNow = (): ProbeSource | undefined => {
    const scope = sessions?.scope(sessionId as never)
    if (scope === undefined) return undefined
    try {
      return (ctx.conversation.input.for(scope) as { readonly state?: ProbeSource }).state
    } catch {
      return undefined
    }
  }

  let sourceUnsubs: (() => void)[] | undefined
  let subscribedBinding: ReturnType<NonNullable<typeof sessions>['binding']>
  let retainUnsub: (() => void) | undefined
  let historyRequested = false
  let historyBinding: ReturnType<NonNullable<typeof sessions>['binding']>
  let historyDone = true
  const loadHistory = (): void => {
    const binding = bindingNow()
    if (!historyRequested || !binding) return
    const state = (binding.session as { readonly getSnapshot?: () => unknown }).getSnapshot?.() as {
      readonly openState?: string
      readonly loadingOlder?: boolean
    } | undefined
    // Desktop creates the binding before its tail page opens. loadThrough()
    // silently does nothing until then, so wait for the session notification.
    if (typeof state?.openState === 'string' && state.openState !== 'open') {
      historyBinding = undefined
      historyDone = state.openState === 'error'
      return
    }
    if (state?.loadingOlder && historyBinding !== binding) {
      historyDone = false
      return
    }
    if (historyBinding === binding) return
    historyBinding = binding
    historyDone = true
    const loader = (binding.session as { readonly loadThrough?: (seq: never) => Promise<void> }).loadThrough
    if (typeof loader !== 'function') return
    historyDone = false
    void loader.call(binding.session, 1 as never).catch(() => {}).finally(() => {
      if (historyBinding !== binding) return
      historyDone = true
      notify()
    })
  }
  const rebindSources = (): void => {
    const binding = bindingNow()
    if (sourceUnsubs !== undefined && subscribedBinding === binding) return
    for (const unsubscribe of sourceUnsubs ?? []) unsubscribe()
    subscribedBinding = binding
    const unsubs: (() => void)[] = []
    const projections = projectionsOf(binding)
    for (const key of ['contextPressure', 'contextBreakdown', 'tokenUsage'] as const) {
      try {
        const face = projections?.faceOf?.(key)
        if (face?.subscribe !== undefined) unsubs.push(face.subscribe(notify))
      } catch {
        // Older hosts: the projection is absent; the map falls back to estimates.
      }
    }
    try {
      const feed = binding?.eventSource as ProbeSource | undefined
      if (feed?.subscribe !== undefined) unsubs.push(feed.subscribe(notify))
    } catch { /* fail open */ }
    try {
      const session = binding?.session as ProbeSource | undefined
      if (session?.subscribe !== undefined) unsubs.push(session.subscribe(() => {
        loadHistory()
        notify()
      }))
    } catch { /* fail open */ }
    try {
      const inputState = inputStateNow()
      if (inputState?.subscribe !== undefined) unsubs.push(inputState.subscribe(notify))
    } catch { /* fail open */ }
    sourceUnsubs = unsubs
    loadHistory()
  }
  const ensureSources = (): void => {
    if (sourceUnsubs !== undefined) return
    try {
      retainUnsub = sessions?.retainInfo?.(sessionId as never).subscribe(() => {
        rebindSources()
        notify()
      })
    } catch { /* fail open */ }
    rebindSources()
  }
  const dropSources = (): void => {
    for (const unsubscribe of sourceUnsubs ?? []) unsubscribe()
    sourceUnsubs = undefined
    subscribedBinding = undefined
    retainUnsub?.()
    retainUnsub = undefined
  }

  const loadAllHistory = (): void => {
    if (!historyRequested) {
      historyRequested = true
      historyDone = false
    }
    loadHistory()
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
    historyLoading: () => historyRequested && !historyDone,
    loadAllHistory,
    projection: (key) => {
      try {
        return projectionsOf(bindingNow())?.faceOf?.(key)?.getSnapshot?.()
      } catch {
        return undefined
      }
    },
    events: () => {
      const snapshot = bindingNow()?.eventSource?.getSnapshot?.() as { readonly entries?: readonly unknown[]; readonly revision?: number } | undefined
      return { entries: snapshot?.entries ?? [], revision: snapshot?.revision ?? 0 }
    },
    draftClips: () => {
      const snapshot = inputStateNow()?.getSnapshot?.() as { readonly occurrences?: readonly { readonly source?: string }[] } | undefined
      let count = 0
      for (const occurrence of snapshot?.occurrences ?? []) {
        if (occurrence?.source === CLIP_SOURCE) count += 1
      }
      return count
    },
    compact: async () => {
      const face = bindingNow()?.session as { readonly command?: (line: string) => Promise<unknown> } | undefined
      if (typeof face?.command !== 'function') throw new Error('当前宿主不支持会话命令')
      const result = await face.command('/compact')
      const matched = (result as { readonly matched?: unknown } | undefined)?.matched
      if (matched === false) throw new Error('会话未接纳 /compact 命令（可能正在运行中）')
    },
    forkAt: async (atSeq: number) => {
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

  // Pasted-text clips controller: store + interceptor + submit-time serializer + toast.
  const clipController = new PasteClipController({
    ctx,
    getRemote: getRemoteFace,
    openPanel: (id) => {
      optionalService<{ openTab: (kind: string, options?: unknown) => void }>(ctx, 'sidebarRight')
        ?.openTab(CLIP_TAB_KIND, { params: { id } })
    },
    resolveCwd: (sessionId) => {
      const sessions = composerSessions(ctx)
      if (sessions === undefined) return ''
      const list = sessions.list.getSnapshot() as { readonly byId?: Readonly<Record<string, { readonly cwd?: string }>> }
      const sessionCwd = list.byId?.[sessionId]?.cwd
      if (sessionCwd) return sessionCwd
      const cwds = new Set(Object.values(list.byId ?? {})
        .map(session => session?.cwd)
        .filter((cwd): cwd is string => typeof cwd === 'string' && cwd !== ''))
      return cwds.size === 1 ? [...cwds][0]! : ''
    },
  })

  // Markdown overlay: presentation, self-painted highlights, structural
  // block decorations, capture keymap, and long-paste conversion.
  const editor = createEditorContribution(ctx, settings, clipController)
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'dsh-better-composer.overlay',
  }, editor))

  if (ctx.inputTriggers !== undefined) {
    ctx.effect(() => ctx.inputTriggers.registerSource(clipController.source), 'dsh-better-composer: clip source')
  }

  // Right-sidebar clip editor and context map.
  const sidebarRightTabs = optionalService<{ register: (definition: unknown) => () => void }>(ctx, 'sidebarRightTabs')
  if (sidebarRightTabs !== undefined) {
    ctx.effect(() => sidebarRightTabs.register(clipTabDefinition()), 'dsh-better-composer: clip tab type')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: CLIP_TAB_ID,
      inject: (sessionId: unknown) => ({
        clips: clipController.store,
        remote: getRemoteFace,
        resolveModel: (id: string) => resolveClipModel(ctx, id),
        fetchContext: (id: string) => recentSessionMessages(ctx, id),
        sessionId: String(sessionId),
      }),
    }, ClipPanel))
    const loadDoctorReport = async (scope: ScanScope, signal?: AbortSignal): Promise<ScanReport | undefined> => {
      const remote = await getRemoteFace()
      if (remote === undefined) throw new Error('Context Doctor 服务不可用')
      return new DoctorClient(remote).scan.run(scope, { signal })
    }
    const watchDoctorSnapshot = (sessionId: string) => (listener: () => void): (() => void) => {
      const sessions = composerSessions(ctx)
      let feed: ReturnType<NonNullable<typeof sessions>['binding']>['eventSource']
      let stopFeed: (() => void) | undefined
      const bindFeed = (): void => {
        const next = sessions?.binding(sessionId as never)?.eventSource
        if (next === feed) return
        stopFeed?.()
        feed = next
        stopFeed = next?.subscribe?.(() => {
          const snapshot = next.getSnapshot() as { change?: { kind: string; entries?: readonly { type: string }[]; entry?: unknown } }
          const change = snapshot.change
          if (change?.kind === 'append' && !change.entries?.some((entry) => entry.type === 'event')) return
          if (change?.kind === 'settle-assistant' && change.entry === undefined) return
          listener()
        })
        listener()
      }
      const stopRetention = sessions?.retainInfo?.(sessionId as never).subscribe(bindFeed)
      bindFeed()
      return () => { stopRetention?.(); stopFeed?.() }
    }

    const probes = new Map<string, ContextMapProbe>()
    const sharedProbe = (id: string) => {
      let probe = probes.get(id)
      if (!probe) { probe = createContextMapProbe(ctx, id); probes.set(id, probe) }
      return probe
    }
    ctx.effect(() => sidebarRightTabs.register(contextMapTabDefinition()), 'dsh-better-composer: context workspace')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab', key: CONTEXT_MAP_TAB_ID,
      inject: (sessionId: unknown) => ({
        sessionId: String(sessionId), probe: sharedProbe(String(sessionId)), faceLoader: getRemoteFace,
        resolveModel: (id: string) => resolveClipModel(ctx, id), loadReport: loadDoctorReport,
        subscribe: watchDoctorSnapshot(String(sessionId)),
        modes: async (): Promise<ObservedModes> => {
          const remote = await getRemoteFace()
          if (!remote) return { available: false, reason: 'remote-unavailable', modes: [] }
          return new DoctorClient(remote).modes.modes()
        },
      }),
    }, ContextWorkspaceTab))
    ctx.effect(() => sidebarRightTabs.register(doctorTabDefinition()), 'dsh-better-composer: legacy doctor address')
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: DOCTOR_TAB_ID }, LegacyDoctorTab))
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
      name: 'conversation.input.right', id: 'dsh-better-composer.contextmap', order: 20,
      inject: (sessionId: unknown) => ({ probe: sharedProbe(String(sessionId)),
        onOpen: () => optionalService<{ openTab(kind: string, options?: unknown): void }>(ctx, 'sidebarRight')?.openTab(CONTEXT_MAP_TAB_KIND, { params: { page: 'overview' } }),
      }),
    }, ContextDoctorButton))

    // Composer toolbar entries: expand button and context map button.
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
      name: 'conversation.input.right',
      id: 'dsh-better-composer.expand',
      order: 10,
    }, ComposerExpandButton))
    publishContextMapOpener(() => {
      optionalService<{ openTab: (kind: string, options?: unknown) => void }>(ctx, 'sidebarRight')
        ?.openTab(CONTEXT_MAP_TAB_KIND, { params: { page: 'overview' } })
    })

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
