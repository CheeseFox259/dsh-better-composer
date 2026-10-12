import { expect, it, vi } from 'vitest'
import { createContextMapProbe } from '../../src/client/index.ts'
import { readContextMapData } from '../../src/client/context-map-data.ts'

function eventSource(entries: readonly unknown[]) {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ entries, revision: entries.length }),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    notify() { for (const listener of listeners) listener() },
  }
}

it('reads the current session event source after Desktop replaces a binding', () => {
  const oldFeed = eventSource([])
  const currentFeed = eventSource([
    { type: 'event', event: { type: 'turn/start', seq: 1, data: { turn: 1 } } },
    { type: 'event', event: { type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: 'current message' }] } } },
  ])
  const projectionListeners = new Set<() => void>()
  const retentionListeners = new Set<() => void>()
  const projections = { faceOf: () => ({
    getSnapshot: () => ({ projectedTokens: 120 }),
    subscribe(listener: () => void) { projectionListeners.add(listener); return () => { projectionListeners.delete(listener) } },
  }) }
  let current = { session: { projections }, eventSource: oldFeed }
  const ctx = { sessions: {
    binding: () => current,
    scope: () => undefined,
    retainInfo: () => ({ subscribe(listener: () => void) {
      retentionListeners.add(listener)
      return () => { retentionListeners.delete(listener) }
    } }),
  } }
  const probe = createContextMapProbe(ctx as never, 'session-1')
  let notifications = 0
  const unsubscribe = probe.subscribe(() => { notifications += 1 })
  expect(probe.events().entries).toHaveLength(0)

  current = { session: { projections }, eventSource: currentFeed }
  for (const listener of retentionListeners) listener()

  expect(notifications).toBeGreaterThan(0)
  expect(probe.events().entries).toHaveLength(2)
  const afterRebind = notifications
  oldFeed.notify()
  expect(notifications).toBe(afterRebind)
  currentFeed.notify()
  expect(notifications).toBe(afterRebind + 1)
  expect(projectionListeners.size).toBe(1)
  unsubscribe()
  expect(retentionListeners.size).toBe(0)
  expect(projectionListeners.size).toBe(0)
})

it('loads history when a Desktop session is bound after the map opens', async () => {
  const retentionListeners = new Set<() => void>()
  const feed = eventSource([
    { type: 'event', event: { type: 'turn/start', seq: 1, data: { turn: 1 } } },
    { type: 'event', event: { type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: 'hello' }] } } },
  ])
  const loadThrough = vi.fn(async () => {})
  let current: { session: { loadThrough: typeof loadThrough }; eventSource: typeof feed } | undefined
  const ctx = { sessions: {
    binding: () => current,
    scope: () => undefined,
    retainInfo: () => ({ subscribe(listener: () => void) {
      retentionListeners.add(listener)
      return () => { retentionListeners.delete(listener) }
    } }),
  } }
  const probe = createContextMapProbe(ctx as never, 'session-1')
  const unsubscribe = probe.subscribe(() => {})
  probe.loadAllHistory()
  expect(probe.events().entries).toHaveLength(0)

  current = { session: { loadThrough }, eventSource: feed }
  for (const listener of retentionListeners) listener()
  expect(probe.events().entries).toHaveLength(2)
  expect(readContextMapData(probe).summary.turns).toHaveLength(1)
  expect(readContextMapData(probe).summary.userMessages).toBe(1)
  expect(loadThrough).toHaveBeenCalledExactlyOnceWith(1)
  await vi.waitFor(() => expect(probe.historyLoading()).toBe(false))
  probe.loadAllHistory()
  expect(probe.historyLoading()).toBe(false)
  expect(loadThrough).toHaveBeenCalledTimes(1)
  unsubscribe()
  expect(retentionListeners.size).toBe(0)
  const unsubscribeAgain = probe.subscribe(() => {})
  expect(probe.historyLoading()).toBe(false)
  expect(loadThrough).toHaveBeenCalledTimes(1)
  unsubscribeAgain()
})

it('waits for the Desktop tail page before requesting older history', async () => {
  const feed = eventSource([])
  const sessionListeners = new Set<() => void>()
  const loadThrough = vi.fn(async () => {})
  let openState = 'loading'
  const session = {
    getSnapshot: () => ({ openState, loadingOlder: false }),
    subscribe(listener: () => void) { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
    loadThrough,
  }
  const binding = { session, eventSource: feed }
  const ctx = { sessions: {
    binding: () => binding,
    scope: () => undefined,
  } }
  const probe = createContextMapProbe(ctx as never, 'session-1')
  const unsubscribe = probe.subscribe(() => {})
  probe.loadAllHistory()
  expect(probe.historyLoading()).toBe(true)
  expect(loadThrough).not.toHaveBeenCalled()

  openState = 'open'
  for (const listener of sessionListeners) listener()
  expect(loadThrough).toHaveBeenCalledExactlyOnceWith(1)
  await vi.waitFor(() => expect(probe.historyLoading()).toBe(false))
  unsubscribe()
  expect(sessionListeners.size).toBe(0)
})
