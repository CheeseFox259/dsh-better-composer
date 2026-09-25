import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/client/index.ts'
import { createMarkdownProvider } from '../../src/markdown/provider.ts'

function makeCtx(cleanups: Array<() => void>) {
  const once = (dispose: () => void): (() => void) => {
    let done = false
    return () => { if (!done) { done = true; dispose() } }
  }
  const settingsScope = {
    getSnapshot: () => ({ value: { enabled: true, markdownVisual: true, diagnostics: true, toolbarMode: 'compact' } }),
    subscribe: () => () => {},
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
  }
  const slots = {
    register: vi.fn(() => once(vi.fn())),
    inject: vi.fn((_name: string, callback: () => (() => void)) => {
      cleanups.push(callback())
      return once(vi.fn())
    }),
  }
  const ctx = {
    conversation: {},
    slots,
    settingsScope: { bind: vi.fn(() => settingsScope) },
    configForms: { get: vi.fn(() => settingsScope) },
    effect: vi.fn((factory: () => () => void) => {
      const cleanup = factory()
      cleanups.push(cleanup)
      return cleanup
    }),
  }
  return { ctx, slots, once }
}

describe('official seam adapter', () => {
  it('registers only official slots and never touches host-private registries', () => {
    const cleanups: Array<() => void> = []
    const { ctx, slots } = makeCtx(cleanups)

    apply(ctx as never)

    expect(ctx.conversation).toEqual({})
    const injectedNames = slots.inject.mock.calls.map(call => call[0])
    expect(injectedNames).toContain('settings.plugins.tab')
    expect(injectedNames).toContain('conversation.input.overlay')
    expect(slots.register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'settings.plugins.tab',
      id: 'dsh-better-composer',
      label: 'Better Composer',
    }), expect.any(Function))
    expect(slots.register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'conversation.input.overlay',
      id: 'dsh-better-composer.overlay',
    }), expect.any(Function))
  })

  it('disposes every registration through the fiber cleanup, idempotently', () => {
    const cleanups: Array<() => void> = []
    const slotDisposers: ReturnType<typeof vi.fn>[] = []
    const settingsListeners = new Set<() => void>()
    const once = (dispose: () => void): (() => void) => {
      let done = false
      return () => { if (!done) { done = true; dispose() } }
    }
    const settingsScope = {
      getSnapshot: () => ({ value: {} }),
      subscribe: (listener: () => void) => { settingsListeners.add(listener); return () => { settingsListeners.delete(listener) } },
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
    }
    const ctx = {
      conversation: {},
      slots: {
        register: vi.fn(() => {
          const dispose = vi.fn()
          slotDisposers.push(dispose)
          return once(dispose)
        }),
        inject: vi.fn((_name: string, callback: () => (() => void)) => {
          cleanups.push(callback())
          return once(vi.fn())
        }),
      },
      settingsScope: { bind: vi.fn(() => settingsScope) },
      configForms: { get: vi.fn(() => settingsScope) },
      effect: vi.fn((factory: () => () => void) => {
        const cleanup = factory()
        cleanups.push(cleanup)
        return cleanup
      }),
    }

    apply(ctx as never)
    for (const cleanup of cleanups) cleanup()
    for (const cleanup of cleanups) cleanup()
    expect(slotDisposers.length).toBeGreaterThan(0)
    for (const dispose of slotDisposers) expect(dispose).toHaveBeenCalledOnce()
    expect(settingsListeners).toHaveLength(0)
  })

  it('keeps the pure Markdown provider decoration contract intact', () => {
    const provider = createMarkdownProvider(() => ({ enabled: true, markdownVisual: true, diagnostics: false, toolbarMode: 'compact', pasteClipThreshold: 4000 }))
    expect(provider.decorate({
      sessionId: 's1' as never,
      draft: '# x',
      draftRev: 1,
      nativeRanges: [],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-heading' }),
      expect.objectContaining({ className: 'dsh-better-composer-marker', start: 0, end: 2 }),
    ]))
  })
})
