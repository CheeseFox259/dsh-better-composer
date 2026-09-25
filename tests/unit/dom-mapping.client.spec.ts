// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { composerDomBlockRuns, composerDomTextRuns } from '../../src/client/dom-mapping.ts'

/**
 * Build a Lexical-shaped block DOM: one <p> per '\n'-separated source line,
 * empty lines rendered as <p><br></p> (placeholder break).
 */
function buildRoot(source: string): HTMLElement {
  const root = document.createElement('div')
  for (const line of source.split('\n')) {
    const block = document.createElement('p')
    if (line === '') block.append(document.createElement('br'))
    else block.append(document.createTextNode(line))
    root.append(block)
  }
  return root
}

describe('composer DOM mapping', () => {
  it('maps every block to its exact source range, including empty lines', () => {
    const draft = 'aq\n\n# Rich Editor 验收'
    const root = buildRoot(draft)

    const textRuns = composerDomTextRuns(root, draft, [])
    expect(textRuns).toBeDefined()
    expect(textRuns?.map(run => [run.start, run.end])).toEqual([[0, 2], [4, 20]])

    const blockRuns = composerDomBlockRuns(root, draft, [])
    expect(blockRuns?.map(run => [run.start, run.end])).toEqual([[0, 2], [3, 3], [4, 20]])
    expect(blockRuns?.every(run => !run.multiline)).toBe(true)
    // The heading range [4, 20] must never intersect the first block.
    const heading = { start: 4, end: 20 }
    expect(blockRuns!.filter(run => run.start < heading.end && heading.start < run.end)).toHaveLength(1)
    expect(blockRuns!.filter(run => run.start < heading.end && heading.start < run.end)[0]!.element)
      .toBe(root.children[2])
  })

  it('maps intra-block soft linebreaks to \\n and ignores the trailing placeholder <br>', () => {
    const draft = 'aa\nbb'
    const root = document.createElement('div')
    const block = document.createElement('p')
    block.append(document.createTextNode('aa'), document.createElement('br'), document.createTextNode('bb'))
    root.append(block)
    // Lexical keeps a visual placeholder break after a trailing linebreak.
    const dangling = document.createElement('p')
    dangling.append(document.createTextNode('cc'), document.createElement('br'))

    expect(composerDomTextRuns(root, 'aa\nbb', [])?.map(run => [run.start, run.end])).toEqual([[0, 2], [3, 5]])
    expect(composerDomBlockRuns(root, draft, [])?.[0]?.multiline).toBe(true)

    const withDangling = document.createElement('div')
    withDangling.append(block.cloneNode(true), dangling)
    // 'cc\n' is not the source; the dangling placeholder must not force a phantom newline.
    expect(composerDomTextRuns(withDangling, 'aa\nbbcc', [])).toBeUndefined()
  })

  it('marks a single block holding raw newlines in one text node as multiline (real paste shape)', () => {
    // DSH Core drops a whole plain-text paste into one <p> as a single text
    // node carrying '\n' characters (no <br> elements); those newlines are
    // real line breaks and must trip the multiline safeguard.
    const draft = '## 标题\n\n| A | B |\n| 1 | 2 |\n\n```js\nconst a = 1;\n```\n\n结束'
    const root = document.createElement('div')
    const block = document.createElement('p')
    block.append(document.createTextNode(draft))
    root.append(block)

    const textRuns = composerDomTextRuns(root, draft, [])
    expect(textRuns).toBeDefined()
    const blockRuns = composerDomBlockRuns(root, draft, [])
    expect(blockRuns).toBeDefined()
    expect(blockRuns?.[0]?.multiline).toBe(true)
    expect(blockRuns?.[0]?.start).toBe(0)
    expect(blockRuns?.[0]?.end).toBe(draft.length)
  })

  it('fails closed on any DOM/source drift instead of guessing offsets', () => {
    const draft = 'aq\n\n# Rich Editor 验收'
    const root = buildRoot(draft)
    // Stale DOM: the first block still shows the previous keystroke.
    root.children[0]!.textContent = 'a'

    expect(composerDomTextRuns(root, draft, [])).toBeUndefined()
    expect(composerDomBlockRuns(root, draft, [])).toBeUndefined()
  })

  it('fails closed when the DOM carries extra trailing text', () => {
    const draft = 'hello'
    const root = buildRoot('hello world')

    expect(composerDomTextRuns(root, draft, [])).toBeUndefined()
    expect(composerDomBlockRuns(root, draft, [])).toBeUndefined()
  })

  it('tolerates contenteditable NBSP variance (length-preserving)', () => {
    const draft = 'a  b'
    const root = document.createElement('div')
    const block = document.createElement('p')
    block.append(document.createTextNode('a\u00a0 b'))
    root.append(block)

    const runs = composerDomTextRuns(root, draft, [])
    expect(runs?.map(run => [run.start, run.end])).toEqual([[0, 4]])
  })

  it('keeps chip interiors out of the text stream', () => {
    const draft = 'before @chip after'
    const nativeRanges = [{ start: 7, end: 12, kind: 'reference' }]
    const root = document.createElement('div')
    const block = document.createElement('p')
    block.append(document.createTextNode('before '))
    const chip = document.createElement('span')
    chip.setAttribute('contenteditable', 'false')
    chip.append(document.createTextNode('@chip'))
    block.append(chip, document.createTextNode(' after'))
    root.append(block)

    const runs = composerDomTextRuns(root, draft, nativeRanges)
    expect(runs?.map(run => [run.start, run.end])).toEqual([[0, 7], [12, 18]])
  })
})
