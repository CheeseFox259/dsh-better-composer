import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/client/index.ts'

describe('out-of-tree decoration adapter', () => {
  it('registers and disposes through the public conversation face', () => {
    const dispose = vi.fn()
    let disposed = false
    const unregister = () => {
      if (disposed) return
      disposed = true
      dispose()
    }
    const register = vi.fn(() => unregister)
    let cleanup: (() => void) | undefined
    const ctx = {
      conversation: { decorations: { register } },
      effect: vi.fn((factory: () => (() => void)) => {
        cleanup = factory()
        return cleanup
      }),
    }

    apply(ctx as never)

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ id: 'dsh-rich-editor' }))
    const provider = register.mock.calls[0]?.[0]
    expect(provider?.decorate({ sessionId: 's1' as never, draft: 'x', draftRev: 1, nativeRanges: [] })).toEqual([])
    cleanup?.()
    cleanup?.()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
