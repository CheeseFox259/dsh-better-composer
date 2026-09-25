import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/client/index.ts'

function makeCtx(cleanups: Array<() => void>) {
  const once = (dispose: () => void): (() => void) => {
    let done = false
    return () => { if (!done) { done = true; dispose() } }
  }
  const listeners = new Set<() => void>()
  const settingsScope = {
    getSnapshot: () => ({ value: { enabled: true, markdownVisual: true, diagnostics: true, toolbarMode: 'compact' } }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
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
  return { ctx, slots, listeners, once }
}

describe('plugin registration lifecycle', () => {
  it('keeps every production registration disposer independently reachable', () => {
    const cleanups: Array<() => void> = []
    const { ctx, listeners } = makeCtx(cleanups)

    apply(ctx as never)
    for (const cleanup of cleanups) cleanup()
    for (const cleanup of cleanups) cleanup()
    expect(listeners).toHaveLength(0)
  })

  it('registers the settings card as one official Plugins tab and the markdown overlay as the only composer slot', () => {
    const cleanups: Array<() => void> = []
    const { ctx, slots } = makeCtx(cleanups)

    apply(ctx as never)
    const injectedNames = slots.inject.mock.calls.map(call => call[0])
    expect(injectedNames.filter(name => name === 'settings.plugins.tab')).toHaveLength(1)
    expect(injectedNames.filter(name => name === 'conversation.input.overlay')).toHaveLength(1)
    expect(slots.register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'settings.plugins.tab',
      id: 'dsh-better-composer',
      order: expect.any(Number),
      label: 'Better Composer',
    }), expect.any(Function))
    expect(slots.register).toHaveBeenCalledWith(expect.objectContaining({
      name: 'conversation.input.overlay',
      id: 'dsh-better-composer.overlay',
    }), expect.any(Function))
  })

  it('mounts the Remote contribution and publishes the remote face', async () => {
    const cleanups: Array<() => void> = []
    const { ctx } = makeCtx(cleanups)
    let mountedContribution: unknown
    const mockRemoteService = {
      publishPaste: vi.fn(),
      storePaste: vi.fn(),
      loadPaste: vi.fn(),
      editText: vi.fn(),
    }
    const remote = {
      $mount: vi.fn(async (contribution: unknown) => {
        mountedContribution = contribution
        return async () => {}
      }),
    }
    const fullCtx = {
      ...ctx,
      remote,
      get: vi.fn((name: string) => (name === 'remote.betterComposer' ? mockRemoteService : undefined)),
    }

    apply(fullCtx as never)
    expect(remote.$mount).toHaveBeenCalled()
    expect(mountedContribution).toMatchObject({
      package: '@cheesefox/dsh-better-composer',
    })
  })
})
