// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  codeCopyBlockAnchors, codeCopyBlocksForSegments, tableLayoutsForSegments, tableRowAnchors,
} from '../../src/client/presentation-layout.ts'

/**
 * Build a Lexical-shaped block DOM from a source draft. Every line is split
 * into two text nodes: the anchor walk must join node CONTENTS, and a
 * regression that stringifies the nodes themselves must fail here.
 */
function buildRoot(source: string): HTMLElement {
  const root = document.createElement('div')
  for (const line of source.split('\n')) {
    const block = document.createElement('p')
    const mid = Math.ceil(line.length / 2)
    block.append(document.createTextNode(line.slice(0, mid)), document.createTextNode(line.slice(mid)))
    root.append(block)
  }
  return root
}

describe('presentation anchors over the source DOM', () => {
  it('pairs table rows with their blocks when text spans multiple text nodes', () => {
    const draft = '| A | B |\n| --- | --- |\n| C | D |'
    const root = buildRoot(draft)
    for (const block of root.children) block.classList.add('dsh-better-composer-table-row')
    const layouts = tableLayoutsForSegments([{ start: 0, text: draft }])

    const anchors = tableRowAnchors(root, draft, [], layouts)

    expect(anchors).toHaveLength(2)
    expect(anchors?.[0]?.element).toBe(root.children[0])
    expect(anchors?.[1]?.element).toBe(root.children[2])
  })

  it('pairs code fences with their opening block', () => {
    const draft = '```js\nconst a = 1\n```'
    const root = buildRoot(draft)
    const blocks = codeCopyBlocksForSegments([{ start: 0, text: draft }])

    const anchors = codeCopyBlockAnchors(root, draft, [], blocks)

    expect(anchors).toHaveLength(1)
    expect(anchors?.[0]?.element).toBe(root.children[0])
  })

  it('fails closed when the rendered text drifts from the source', () => {
    const draft = '| A | B |\n| --- | --- |\n| C | D |'
    const root = buildRoot(draft)
    root.children[2]!.textContent = '| C | changed |'
    const layouts = tableLayoutsForSegments([{ start: 0, text: draft }])

    expect(tableRowAnchors(root, draft, [], layouts)).toBeUndefined()
  })
})
