// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposerDecorationProvider } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createComposerVisualController } from '../../src/client/visual-controller.ts'

const highlightMap = new Map<string, unknown>()
class FakeHighlight {
  ranges: Range[] = []
  add(range: Range) { this.ranges.push(range) }
}

const provider = (start: number, end: number, className: string, blockClassName?: string): ComposerDecorationProvider => ({
  id: 'test', order: 0,
  decorate: () => [{ start, end, className: blockClassName ?? className, ...(blockClassName === undefined ? {} : { target: 'block' as const }) }],
})

function context(draft: string, rev = 1) {
  return { sessionId: 's' as never, draft, draftRev: rev, nativeRanges: [] }
}

function editor(text: string) {
  const root = document.createElement('div')
  const block = document.createElement('p')
  block.append(document.createTextNode(text))
  root.append(block)
  document.body.append(root)
  return { root, block }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  highlightMap.clear()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('composer visual controller', () => {
  it('keeps last valid paint on transient DOM/source mismatch and commits after Lexical catches up', async () => {
    const originalHighlight = Object.getOwnPropertyDescriptor(globalThis, 'Highlight')
    const originalCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
    Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: FakeHighlight })
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights: highlightMap } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    try {
      const { root, block } = editor('# A')
      const controller = createComposerVisualController(root)
      expect(root.getAttribute('data-better-composer-visual-root')).toBe('true')
      controller.update(provider(0, 3, 'heading', 'block-heading'), context('# A'))
      await flush()
      expect(block.classList.contains('block-heading')).toBe(true)
      expect(highlightMap.has('dsh-composer-block-heading')).toBe(true)

      controller.update(provider(0, 5, 'strong', 'block-strong'), context('# AB!'))
      await flush()
      expect(block.classList.contains('block-heading')).toBe(true)
      expect(block.classList.contains('block-strong')).toBe(false)

      block.textContent = '# AB!'
      controller.update(provider(0, 5, 'strong', 'block-strong'), context('# AB!', 2))
      await flush()
      expect(block.classList.contains('block-heading')).toBe(false)
      expect(block.classList.contains('block-strong')).toBe(true)
      expect(highlightMap.has('dsh-composer-block-heading')).toBe(false)
      expect(highlightMap.has('dsh-composer-block-strong')).toBe(true)
      controller.dispose()
      expect(block.classList.contains('block-strong')).toBe(false)
      expect(highlightMap.size).toBe(0)
      expect(root.hasAttribute('data-better-composer-visual-root')).toBe(false)
    } finally {
      if (originalHighlight === undefined) Reflect.deleteProperty(globalThis, 'Highlight')
      else Object.defineProperty(globalThis, 'Highlight', originalHighlight)
      if (originalCss === undefined) Reflect.deleteProperty(globalThis, 'CSS')
      else Object.defineProperty(globalThis, 'CSS', originalCss)
    }
  })

  it('degrades a single-block paste whose newlines live inside one text node (real Core paste shape)', async () => {
    const originalHighlight = Object.getOwnPropertyDescriptor(globalThis, 'Highlight')
    const originalCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
    Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: FakeHighlight })
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights: highlightMap } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    try {
      // DSH Core puts the whole paste into one <p> as one text node with raw
      // '\n' characters — no <br> elements. Line classes disagree, so the
      // block must receive no structural classes and no hiding highlights.
      const draft = '## 标题\n\n| A | B |\n\n```js\nconst a = 1;\n```\n\n结束'
      const { root, block } = editor(draft)
      const decoration: ComposerDecorationProvider = {
        id: 'paste', order: 0,
        decorate: () => [
          { start: 0, end: 5, className: 'dsh-better-composer-heading', target: 'block' },
          { start: 8, end: 15, className: 'dsh-better-composer-table-row', target: 'block' },
          { start: 8, end: 15, className: 'dsh-better-composer-table-separator-hidden', target: 'block' },
          { start: 18, end: 38, className: 'dsh-better-composer-code-block-start-source-hidden', target: 'block' },
          { start: 18, end: 38, className: 'dsh-better-composer-code-block', target: 'block' },
          { start: 0, end: 5, className: 'dsh-better-composer-heading-markup' },
          { start: 27, end: 38, className: 'shiki-token' },
        ],
      }
      const controller = createComposerVisualController(root)
      controller.update(decoration, context(draft))
      await flush()
      expect(block.classList.contains('dsh-better-composer-heading')).toBe(false)
      expect(block.classList.contains('dsh-better-composer-table-row')).toBe(false)
      expect(block.classList.contains('dsh-better-composer-code-block')).toBe(false)
      expect(block.classList.contains('dsh-better-composer-code-block-start-source-hidden')).toBe(false)
      expect(highlightMap.has('dsh-composer-dsh-better-composer-table-separator-hidden')).toBe(false)
      expect(highlightMap.has('dsh-composer-dsh-better-composer-heading-markup')).toBe(true)
      expect(highlightMap.has('dsh-composer-shiki-token')).toBe(true)
      controller.dispose()
    } finally {
      if (originalHighlight === undefined) Reflect.deleteProperty(globalThis, 'Highlight')
      else Object.defineProperty(globalThis, 'Highlight', originalHighlight)
      if (originalCss === undefined) Reflect.deleteProperty(globalThis, 'CSS')
      else Object.defineProperty(globalThis, 'CSS', originalCss)
    }
  })

  it('keeps pasted multiline text visible while preserving uniform soft-line block styling', async () => {
    const originalHighlight = Object.getOwnPropertyDescriptor(globalThis, 'Highlight')
    const originalCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
    Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: FakeHighlight })
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights: highlightMap } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    try {
      const { root, block } = editor('heading')
      block.append(document.createElement('br'), document.createTextNode('| --- |'))
      const draft = 'heading\n| --- |'
      const decoration: ComposerDecorationProvider = {
        id: 'multiline', order: 0,
        decorate: () => [
          { start: 0, end: 7, className: 'heading', target: 'block' },
          { start: 8, end: draft.length, className: 'dsh-better-composer-table-separator', target: 'block' },
          { start: 8, end: draft.length, className: 'dsh-better-composer-table-separator-hidden' },
          { start: 0, end: 7, className: 'semantic' },
        ],
      }
      const controller = createComposerVisualController(root)
      controller.update(decoration, context(draft))
      await flush()
      expect(block.classList.contains('dsh-better-composer-table-separator')).toBe(false)
      expect(block.classList.contains('heading')).toBe(false)
      expect(highlightMap.has('dsh-composer-dsh-better-composer-table-separator-hidden')).toBe(false)
      expect(highlightMap.has('dsh-composer-dsh-better-composer-table-separator')).toBe(false)
      expect(highlightMap.has('dsh-composer-semantic')).toBe(true)

      const uniform: ComposerDecorationProvider = {
        id: 'uniform', order: 0,
        decorate: () => [{ start: 0, end: draft.length, className: 'quote', target: 'block' }],
      }
      controller.update(uniform, context(draft, 2))
      await flush()
      expect(block.classList.contains('quote')).toBe(true)
      controller.dispose()
    } finally {
      if (originalHighlight === undefined) Reflect.deleteProperty(globalThis, 'Highlight')
      else Object.defineProperty(globalThis, 'Highlight', originalHighlight)
      if (originalCss === undefined) Reflect.deleteProperty(globalThis, 'CSS')
      else Object.defineProperty(globalThis, 'CSS', originalCss)
    }
  })
})
