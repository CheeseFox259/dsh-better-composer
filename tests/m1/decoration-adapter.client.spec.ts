import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/client/index.ts'

describe('out-of-tree decoration adapter', () => {
  it('disposes every production registration through the fiber cleanup', () => {
    const decorationDispose = vi.fn()
    const actionDisposers = Array.from({ length: 11 }, () => vi.fn())
    const editorSlotDispose = vi.fn()
    const settingsSlotDispose = vi.fn()
    let actionIndex = 0
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
    const cleanups: Array<() => void> = []
    const register = vi.fn(() => once(decorationDispose))
    const actionRegister = vi.fn((action: { id: string }) => {
      if (actionIndex >= actionDisposers.length) throw new Error(`unexpected action ${action.id}`)
      return once(actionDisposers[actionIndex++]!)
    })
    let slotIndex = 0
    const slotRegister = vi.fn(() => once(slotIndex++ === 0 ? editorSlotDispose : settingsSlotDispose))
    const ctx = {
      conversation: { decorations: { register }, actions: { register: actionRegister } },
      slots: {
        register: slotRegister,
        inject: vi.fn((_name: string, callback: () => (() => void)) => {
          cleanups.push(callback())
          return once(vi.fn())
        }),
      },
      settingsScope: { bind: vi.fn(() => settingsScope) },
      effect: vi.fn((factory: () => (() => void)) => {
        const cleanup = factory()
        cleanups.push(cleanup)
        return cleanup
      }),
    }

    apply(ctx as never)

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: 'dsh-better-composer-markdown' }))
    const provider = register.mock.calls[0]?.[0]
    expect(provider?.decorate({ sessionId: 's1' as never, draft: '# x', draftRev: 1, nativeRanges: [] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-heading' }),
      expect.objectContaining({ className: 'dsh-better-composer-marker', start: 0, end: 2 }),
    ]))
    expect(actionRegister).toHaveBeenCalledTimes(11)
    expect(slotRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'conversation.input.editor' }), expect.any(Function))
    expect(slotRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'settings.plugin.item', key: 'dsh-better-composer' }), expect.any(Function))
    for (const cleanup of cleanups) cleanup()
    for (const cleanup of cleanups) cleanup()
    expect(decorationDispose).toHaveBeenCalledOnce()
    for (const dispose of actionDisposers) expect(dispose).toHaveBeenCalledOnce()
    expect(editorSlotDispose).toHaveBeenCalledOnce()
    expect(settingsSlotDispose).toHaveBeenCalledOnce()
  })
})
