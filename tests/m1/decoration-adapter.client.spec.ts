import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/client/index.ts'

describe('out-of-tree decoration adapter', () => {
  it('disposes every production registration through the fiber cleanup', () => {
    const decorationDispose = vi.fn()
    const actionDisposers = Array.from({ length: 11 }, () => vi.fn())
    const slotDispose = vi.fn()
    let actionIndex = 0
    const once = (dispose: () => void): (() => void) => {
      let done = false
      return () => { if (!done) { done = true; dispose() } }
    }
    const register = vi.fn(() => once(decorationDispose))
    const actionRegister = vi.fn((action: { id: string }) => {
      if (actionIndex >= actionDisposers.length) throw new Error(`unexpected action ${action.id}`)
      return once(actionDisposers[actionIndex++]!)
    })
    const slotRegister = vi.fn(() => once(slotDispose))
    const cleanups: Array<() => void> = []
    const ctx = {
      conversation: { decorations: { register }, actions: { register: actionRegister } },
      slots: { register: slotRegister },
      effect: vi.fn((factory: () => (() => void)) => {
        const cleanup = factory()
        cleanups.push(cleanup)
        return cleanup
      }),
    }

    apply(ctx as never)

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: 'dsh-rich-editor-markdown' }))
    const provider = register.mock.calls[0]?.[0]
    expect(provider?.decorate({ sessionId: 's1' as never, draft: '# x', draftRev: 1, nativeRanges: [] })).toEqual([
      expect.objectContaining({ className: 'dsh-rich-editor-heading' }),
    ])
    expect(actionRegister).toHaveBeenCalledTimes(11)
    expect(slotRegister).toHaveBeenCalledWith(expect.objectContaining({ name: 'conversation.input.editor' }), expect.any(Function))
    for (const cleanup of cleanups) cleanup()
    for (const cleanup of cleanups) cleanup()
    expect(decorationDispose).toHaveBeenCalledOnce()
    for (const dispose of actionDisposers) expect(dispose).toHaveBeenCalledOnce()
    expect(slotDispose).toHaveBeenCalledOnce()
  })
})
