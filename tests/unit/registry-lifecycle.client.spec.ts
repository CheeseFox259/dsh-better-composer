import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/client/index.ts'

describe('plugin registration lifecycle', () => {
  it('keeps every production registration disposer independently reachable', () => {
    const decorationDispose = vi.fn()
    const actionDisposers = Array.from({ length: 11 }, () => vi.fn())
    let actionIndex = 0
    const cleanups: Array<() => void> = []
    const listeners = new Set<() => void>()
    const settingsScope = {
      getSnapshot: () => ({ value: { enabled: true, markdownVisual: true, diagnostics: true, toolbarMode: 'compact' } }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
    }
    const once = (dispose: () => void): (() => void) => {
      let done = false
      return () => { if (!done) { done = true; dispose() } }
    }
    const ctx = {
      conversation: {
        decorations: { register: vi.fn(() => once(decorationDispose)) },
        actions: { register: vi.fn(() => once(actionDisposers[actionIndex++]!)) },
      },
      slots: {
        register: vi.fn(() => once(vi.fn())),
        inject: vi.fn((_name: string, callback: () => (() => void)) => {
          cleanups.push(callback())
          return once(vi.fn())
        }),
      },
      settingsScope: { bind: vi.fn(() => settingsScope) },
      effect: vi.fn((factory: () => () => void) => {
        const cleanup = factory()
        cleanups.push(cleanup)
        return cleanup
      }),
    }
    apply(ctx as never)
    for (const cleanup of cleanups) cleanup()
    for (const cleanup of cleanups) cleanup()
    expect(decorationDispose).toHaveBeenCalledOnce()
    expect(actionDisposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    expect(listeners).toHaveLength(0)
  })

  it('refreshes the decoration registration when live settings change', () => {
    let value = { enabled: true, markdownVisual: true, diagnostics: true, toolbarMode: 'compact' as const }
    const scopeListeners = new Set<() => void>()
    const decorationDisposers = [vi.fn(), vi.fn()]
    let decorationIndex = 0
    const cleanups: Array<() => void> = []
    const once = (dispose: () => void): (() => void) => {
      let done = false
      return () => { if (!done) { done = true; dispose() } }
    }
    const register = vi.fn(() => once(decorationDisposers[decorationIndex++]!))
    const settingsScope = {
      getSnapshot: () => ({ value }),
      subscribe: (listener: () => void) => {
        scopeListeners.add(listener)
        return () => { scopeListeners.delete(listener) }
      },
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
    }
    const ctx = {
      conversation: {
        decorations: { register },
        actions: { register: vi.fn(() => once(vi.fn())) },
      },
      slots: {
        register: vi.fn(() => once(vi.fn())),
        inject: vi.fn((_name: string, callback: () => (() => void)) => {
          cleanups.push(callback())
          return once(vi.fn())
        }),
      },
      settingsScope: { bind: vi.fn(() => settingsScope) },
      effect: vi.fn((factory: () => () => void) => {
        const cleanup = factory()
        cleanups.push(cleanup)
        return cleanup
      }),
    }

    apply(ctx as never)
    expect(register).toHaveBeenCalledOnce()

    value = { ...value, markdownVisual: false }
    for (const listener of scopeListeners) listener()

    expect(decorationDisposers[0]).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledTimes(2)
    expect(register.mock.calls[1]?.[0].decorate({
      sessionId: 's1' as never,
      draft: '# heading',
      draftRev: 2,
      nativeRanges: [],
    })).toEqual([])

    for (const cleanup of cleanups) cleanup()
    expect(decorationDisposers[1]).toHaveBeenCalledOnce()
  })
})
