import { describe, expect, it, vi } from 'vitest'
import { grammarLoadCount } from '@deepseek-ai/dsh-client-ui-primitives'
import { findComposerInput } from '../../src/client/editor.tsx'
import { decorateViaPlan } from '../helpers/project-ranges.ts'

describe('composer overlay input lookup', () => {
  const input = { name: 'input' }
  const wrapper = (inner: unknown): unknown => ({
    parentElement: inner,
    querySelector: () => null,
  })
  const grow = {
    parentElement: null,
    querySelector: (selector: string) => selector === '[data-composer-input]' ? input : null,
  }

  it('climbs arbitrary slot wrappers to the ancestor containing the input', () => {
    const layer = { parentElement: wrapper(wrapper(grow)) }
    expect(findComposerInput(layer as never)).toBe(input)
  })

  it('returns null when no ancestor contains the input', () => {
    const layer = { parentElement: wrapper(wrapper(null)) }
    expect(findComposerInput(layer as never)).toBeNull()
    expect(findComposerInput(null)).toBeNull()
  })
})

describe('lazy grammar re-projection', () => {
  it('paints python tokens once the lazy Shiki grammar registers', async () => {
    const draft = '```python\ndef greet(name):\n    return name\n```'
    const input = { draft, nativeRanges: [] }
    const hasTokens = (ranges: readonly { className: string }[]): boolean =>
      ranges.some(range => range.className.startsWith('dsh-better-composer-shiki-token-'))

    // The first projection runs while the python grammar is still importing,
    // so it carries no token ranges and must not pin the cache.
    expect(hasTokens(decorateViaPlan(input))).toBe(false)
    await vi.waitFor(() => { expect(grammarLoadCount()).toBeGreaterThan(0) })
    expect(hasTokens(decorateViaPlan(input))).toBe(true)
  })
})
