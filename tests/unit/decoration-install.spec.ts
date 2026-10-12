// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { install, project, type DecorationPlan } from '../../src/decoration/index.ts'

const highlightMap = new Map<string, FakeHighlight>()
class FakeHighlight {
  ranges: Range[] = []
  add(range: Range) { this.ranges.push(range) }
}

function buildSeparateParagraphs(lines: readonly string[]): { root: HTMLElement; blocks: HTMLElement[] } {
  const root = document.createElement('div')
  const blocks: HTMLElement[] = []
  for (const line of lines) {
    const p = document.createElement('p')
    if (line === '') p.append(document.createElement('br'))
    else p.append(document.createTextNode(line))
    root.append(p)
    blocks.push(p)
  }
  document.body.append(root)
  return { root, blocks }
}

function buildSingleParagraphWithBreaks(lines: readonly string[]): { root: HTMLElement; block: HTMLElement } {
  const root = document.createElement('div')
  const block = document.createElement('p')
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) block.append(document.createElement('br'))
    const line = lines[index]!
    if (line !== '') block.append(document.createTextNode(line))
  }
  root.append(block)
  document.body.append(root)
  return { root, block }
}

describe('Decoration Installation (DOM adapter)', () => {
  let originalHighlight: PropertyDescriptor | undefined
  let originalCss: PropertyDescriptor | undefined

  beforeEach(() => {
    highlightMap.clear()
    document.body.replaceChildren()
    originalHighlight = Object.getOwnPropertyDescriptor(globalThis, 'Highlight')
    originalCss = Object.getOwnPropertyDescriptor(globalThis, 'CSS')
    Object.defineProperty(globalThis, 'Highlight', { configurable: true, value: FakeHighlight })
    Object.defineProperty(globalThis, 'CSS', { configurable: true, value: { highlights: highlightMap } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    highlightMap.clear()
    document.body.replaceChildren()
    vi.restoreAllMocks()
    if (originalHighlight === undefined) Reflect.deleteProperty(globalThis, 'Highlight')
    else Object.defineProperty(globalThis, 'Highlight', originalHighlight)
    if (originalCss === undefined) Reflect.deleteProperty(globalThis, 'CSS')
    else Object.defineProperty(globalThis, 'CSS', originalCss)
  })

  it('decorates uniform lists with blockClasses in both separate <p> and single <p> with <br> shapes', () => {
    const draft = '- item 1\n- item 2'
    const plan = project(draft, { start: -1, end: -1, focused: false })

    // Shape (a): one <p> per line (typed shape)
    const shapeA = buildSeparateParagraphs(['- item 1', '- item 2'])
    const installA = install(shapeA.root)
    const resultA = installA.update(plan)

    expect(resultA.synchronized).toBe(true)
    expect(shapeA.blocks[0]?.classList.contains('dsh-better-composer-list-item')).toBe(true)
    expect(shapeA.blocks[0]?.classList.contains('dsh-better-composer-list-depth-1')).toBe(true)
    expect(shapeA.blocks[1]?.classList.contains('dsh-better-composer-list-item')).toBe(true)
    expect(shapeA.blocks[1]?.classList.contains('dsh-better-composer-list-depth-1')).toBe(true)
    expect(highlightMap.has('dsh-composer-dsh-better-composer-list-marker-depth-1-hidden')).toBe(true)
    expect(resultA.listMarkers).toHaveLength(2)
    installA.dispose()

    highlightMap.clear()

    // Shape (b): single <p> with <br> separators (pasted shape)
    const shapeB = buildSingleParagraphWithBreaks(['- item 1', '- item 2'])
    const installB = install(shapeB.root)
    const resultB = installB.update(plan)

    expect(resultB.synchronized).toBe(true)
    // The uniform multiline block gets full blockClasses — fixing the typed-vs-pasted asymmetry!
    expect(shapeB.block.classList.contains('dsh-better-composer-list-item')).toBe(true)
    expect(shapeB.block.classList.contains('dsh-better-composer-list-depth-1')).toBe(true)
    expect(highlightMap.has('dsh-composer-dsh-better-composer-list-marker-depth-1-hidden')).toBe(true)
    // Both lines get an overlay glyph even though the block can only host one ::before.
    expect(resultB.listMarkers).toHaveLength(2)
    installB.dispose()
  })

  it('decorates a mixed bullet/task multiline block with per-line glyphs', () => {
    const draft = '- [x] done\n- plain'
    const plan = project(draft, { start: -1, end: -1, focused: false })

    const shape = buildSingleParagraphWithBreaks(['- [x] done', '- plain'])
    const installation = install(shape.root)
    const result = installation.update(plan)

    expect(result.synchronized).toBe(true)
    expect(shape.block.classList.contains('dsh-better-composer-list-item')).toBe(true)
    expect(result.listMarkers).toHaveLength(2)
    expect(result.listMarkers[0]).toMatchObject({ kind: 'task', checked: true })
    expect(result.listMarkers[1]).toMatchObject({ kind: 'bullet', checked: false })
    installation.dispose()
  })

  it('installs decorations for drafts containing reference chips', () => {
    const draft = 'intro @clip:ab\n- item'
    const nativeRanges = [{ start: 6, end: 14, kind: 'clip' }]
    const plan = project(draft, { start: -1, end: -1, focused: false }, nativeRanges)

    const root = document.createElement('div')
    const p1 = document.createElement('p')
    p1.append(document.createTextNode('intro '))
    const chip = document.createElement('span')
    chip.setAttribute('contenteditable', 'false')
    chip.textContent = '@clip:ab'
    p1.append(chip)
    const p2 = document.createElement('p')
    p2.append(document.createTextNode('- item'))
    root.append(p1, p2)
    document.body.append(root)

    const installation = install(root)
    const result = installation.update(plan)

    expect(result.synchronized).toBe(true)
    expect(p2.classList.contains('dsh-better-composer-list-item')).toBe(true)
    expect(highlightMap.has('dsh-composer-dsh-better-composer-list-marker-depth-1-hidden')).toBe(true)
    installation.dispose()
  })

  it('gives an empty paragraph after a list no list blockClasses', () => {
    const draft = '- item\n\nnext'
    const plan = project(draft, { start: -1, end: -1, focused: false })

    const { root, blocks } = buildSeparateParagraphs(['- item', '', 'next'])
    const installation = install(root)
    const result = installation.update(plan)

    expect(result.synchronized).toBe(true)
    expect(blocks[0]?.classList.contains('dsh-better-composer-list-item')).toBe(true)
    expect(blocks[1]?.classList.contains('dsh-better-composer-list-item')).toBe(false)
    expect(blocks[1]?.classList.contains('dsh-better-composer-list-depth-1')).toBe(false)
    expect(blocks[2]?.classList.length).toBe(0)
    installation.dispose()
  })

  it('suppresses blockClasses and hidesSource highlights on a mixed-signature single <p> block', () => {
    const draft = 'plain text\n- list item'
    const plan = project(draft, { start: -1, end: -1, focused: false })

    // A single <p> with <br> containing mixed signatures
    const { root, block } = buildSingleParagraphWithBreaks(['plain text', '- list item'])
    const installation = install(root)
    const result = installation.update(plan)

    expect(result.synchronized).toBe(true)
    // Mixed block must receive NO blockClasses
    expect(block.classList.contains('dsh-better-composer-list-item')).toBe(false)
    expect(block.classList.contains('dsh-better-composer-list-depth-1')).toBe(false)

    // The marker highlight having hidesSource: true must be suppressed so native text stays visible
    expect(highlightMap.has('dsh-composer-dsh-better-composer-list-marker-depth-1-hidden')).toBe(false)
    // No glyph over a visible raw marker.
    expect(result.listMarkers).toHaveLength(0)

    installation.dispose()
  })

  it('degrades a single-block paste whose newlines live inside one text node (real Core paste shape)', () => {
    const draft = '## 标题\n\n| A | B |\n\n```js\nconst a = 1;\n```\n\n结束'
    const plan = project(draft, { start: -1, end: -1, focused: false })

    const root = document.createElement('div')
    const block = document.createElement('p')
    block.append(document.createTextNode(draft))
    root.append(block)
    document.body.append(root)

    const installation = install(root)
    const result = installation.update(plan)

    expect(result.synchronized).toBe(true)
    expect(block.classList.contains('dsh-better-composer-heading')).toBe(false)
    expect(block.classList.contains('dsh-better-composer-table-row')).toBe(false)
    expect(block.classList.contains('dsh-better-composer-code-block')).toBe(false)

    // Hidden source highlights are suppressed so text remains visible
    expect(highlightMap.has('dsh-composer-dsh-better-composer-table-separator-hidden')).toBe(false)
    expect(highlightMap.has('dsh-composer-dsh-better-composer-fence-marker-hidden')).toBe(false)

    installation.dispose()
  })

  it('pairs table rows and code fences even when line text spans multiple text nodes', () => {
    const draft = '| A | B |\n| --- | --- |\n| C | D |\n```js\ncode\n```'
    const plan = project(draft, { start: -1, end: -1, focused: false })

    const root = document.createElement('div')
    const lines = draft.split('\n')
    const blocks: HTMLElement[] = []
    for (const line of lines) {
      const p = document.createElement('p')
      const mid = Math.ceil(line.length / 2)
      p.append(document.createTextNode(line.slice(0, mid)), document.createTextNode(line.slice(mid)))
      root.append(p)
      blocks.push(p)
    }
    document.body.append(root)

    const installation = install(root)
    const result = installation.update(plan)

    expect(result.synchronized).toBe(true)
    expect(result.tableRowElements.get(0)).toBe(blocks[0])
    expect(result.tableRowElements.get(2)).toBe(blocks[2])
    expect(result.codeBlockElements.get(plan.overlays.codeBlocks[0]!.start)).toBe(blocks[3])

    installation.dispose()
  })

  it('handles transient DOM/draft desync without tearing down the last valid paint', () => {
    const draft1 = '# Title'
    const plan1 = project(draft1)
    const { root, block } = buildSingleParagraphWithBreaks(['# Title'])

    const installation = install(root)
    const result1 = installation.update(plan1)
    expect(result1.synchronized).toBe(true)
    expect(block.classList.contains('dsh-better-composer-heading')).toBe(true)

    // Transient mismatch: draft changed to draft2, but DOM has not updated yet
    const draft2 = '# Title\n\n- new item'
    const plan2 = project(draft2)
    const result2 = installation.update(plan2)

    expect(result2.synchronized).toBe(false)
    // Keeps last valid paint instead of clearing
    expect(block.classList.contains('dsh-better-composer-heading')).toBe(true)

    // DOM catches up
    root.replaceChildren()
    const p1 = document.createElement('p')
    p1.textContent = '# Title'
    const p2 = document.createElement('p')
    p2.append(document.createElement('br'))
    const p3 = document.createElement('p')
    p3.textContent = '- new item'
    root.append(p1, p2, p3)

    const result3 = installation.update(plan2)
    expect(result3.synchronized).toBe(true)
    expect(p1.classList.contains('dsh-better-composer-heading')).toBe(true)
    expect(p3.classList.contains('dsh-better-composer-list-item')).toBe(true)

    installation.dispose()
    expect(p1.classList.contains('dsh-better-composer-heading')).toBe(false)
    expect(p3.classList.contains('dsh-better-composer-list-item')).toBe(false)
  })

  it('populates tableRowElements, codeBlockElements and supports findBlockElement', () => {
    const draft = '| A |\n| --- |\n| 1 |\n```js\ncode\n```'
    const plan = project(draft, { start: -1, end: -1, focused: false })

    const { root, blocks } = buildSeparateParagraphs(['| A |', '| --- |', '| 1 |', '```js', 'code', '```'])
    const installation = install(root)
    const result = installation.update(plan)

    expect(result.synchronized).toBe(true)
    expect(result.tableRowElements.size).toBeGreaterThanOrEqual(1)
    expect(result.codeBlockElements.size).toBe(1)
    expect(result.codeBlockElements.get(plan.overlays.codeBlocks[0]!.start)).toBe(blocks[3])

    // findBlockElement
    expect(installation.findBlockElement(0)).toBe(blocks[0])
    expect(installation.findBlockElement(draft.indexOf('code'))).toBe(blocks[4])
    expect(installation.findBlockElement(draft.length)).toBe(blocks[5])
    expect(installation.findBlockElement(9999)).toBeNull()

    installation.dispose()
    expect(installation.findBlockElement(0)).toBeNull()
  })
})
