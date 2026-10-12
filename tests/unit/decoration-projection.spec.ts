import { describe, expect, it } from 'vitest'
import { project } from '../../src/decoration/index.ts'
import { tableColumnWidths } from '../../src/decoration/internal/layout.ts'

describe('Decoration Projection (pure)', () => {
  it('produces identical line signatures for pasted-shape and typed-shape drafts', () => {
    const draft = '- a\n- b'
    const plan = project(draft)

    expect(plan.draft).toBe(draft)
    expect(plan.lines).toHaveLength(2)
    expect(plan.lines[0]?.signature).toBeTruthy()
    expect(plan.lines[0]?.signature).toBe(plan.lines[1]?.signature)
    expect(plan.lines[0]?.blockClasses).toEqual(plan.lines[1]?.blockClasses)
  })

  it('yields differing signatures for mixed lines and equal signatures for uniform lines', () => {
    const mixedDraft = 'plain line\n- list item'
    const mixedPlan = project(mixedDraft)
    expect(mixedPlan.lines).toHaveLength(2)
    expect(mixedPlan.lines[0]?.signature).toBe('')
    expect(mixedPlan.lines[0]?.blockClasses).toEqual([])
    expect(mixedPlan.lines[1]?.signature).toContain('dsh-better-composer-list-item')
    expect(mixedPlan.lines[0]?.signature).not.toBe(mixedPlan.lines[1]?.signature)

    const uniformDraft = '- item 1\n- item 2\n- item 3'
    const uniformPlan = project(uniformDraft)
    expect(uniformPlan.lines).toHaveLength(3)
    const sig0 = uniformPlan.lines[0]?.signature
    expect(sig0).toBeTruthy()
    expect(uniformPlan.lines[1]?.signature).toBe(sig0)
    expect(uniformPlan.lines[2]?.signature).toBe(sig0)

    const diffDepthDraft = '- depth 1\n  - depth 2'
    const diffDepthPlan = project(diffDepthDraft)
    expect(diffDepthPlan.lines[0]?.signature).not.toBe(diffDepthPlan.lines[1]?.signature)
    expect(diffDepthPlan.lines[0]?.signature).toContain('list-depth-1')
    expect(diffDepthPlan.lines[1]?.signature).toContain('list-depth-2')
  })

  it('hides markers when caret is outside and keeps list glyphs while editing', () => {
    const draft = '- a'

    // Caret outside (not focused or selection outside)
    const planOutside = project(draft, { start: -1, end: -1, focused: false })
    const markerHidden = planOutside.inlines.find(i => i.start === 0 && i.end === 2)
    expect(markerHidden).toBeDefined()
    expect(markerHidden?.className).toMatch(/dsh-better-composer-list-marker-depth-1-hidden/)
    expect(markerHidden?.hidesSource).toBe(true)

    // List markers stay hidden while editing: the synthetic bullet glyph is
    // the reveal for lists, not the raw marker.
    const planInside = project(draft, { start: 2, end: 2, focused: true })
    const markerInside = planInside.inlines.find(i => i.start === 0 && i.end === 2)
    expect(markerInside).toBeDefined()
    expect(markerInside?.className).toMatch(/dsh-better-composer-list-marker-depth-1-hidden/)
    expect(markerInside?.hidesSource).toBe(true)
  })

  it('emits one marker overlay entry per hidden bullet/task marker, with one layout signature across kinds', () => {
    const draft = '- a\n- [x] b\n- [ ] c\n1. d'
    const plan = project(draft, { start: -1, end: -1, focused: false })

    const markers = plan.overlays.listMarkers
    // The ordered item keeps its visible source number and gets no glyph.
    expect(markers).toHaveLength(3)
    expect(markers[0]).toMatchObject({ kind: 'bullet', checked: false, depth: 1, markerStart: 0, markerEnd: 2, lineStart: 0 })
    expect(markers[1]).toMatchObject({ kind: 'task', checked: true, depth: 1 })
    expect(markers[2]).toMatchObject({ kind: 'task', checked: false, depth: 1 })
    expect(draft.slice(markers[1]!.markerStart, markers[1]!.markerEnd)).toBe('- [x] ')

    // Bullet, task, checked-task and ordered lines share one layout signature,
    // so a mixed DOM block stays decoratable instead of falling back raw.
    const signatures = new Set(plan.lines.map(line => line.signature))
    expect(signatures.size).toBe(1)
    expect(plan.lines[0]?.signature).toContain('dsh-better-composer-list-item')
    expect(plan.lines[0]?.signature).toContain('dsh-better-composer-list-depth-1')
  })

  it('projects code blocks and tables with exact overlay and separator semantics', () => {
    const codeDraft = '```ts\nconst x = 1;\n```'
    const codePlan = project(codeDraft, { start: -1, end: -1, focused: false })

    // Code block overlays
    expect(codePlan.overlays.codeBlocks).toHaveLength(1)
    const codeBlock = codePlan.overlays.codeBlocks[0]!
    expect(codeBlock.language).toBe('ts')
    expect(codeBlock.copyText).toBe('const x = 1;')
    expect(codeBlock.headerLineIndex).toBe(0)
    expect(codeDraft.slice(codeBlock.languageRange.start, codeBlock.languageRange.end)).toBe('ts')

    // Fence markers are hidden when unfocused
    const fenceMarkers = codePlan.inlines.filter(i => i.className.includes('fence-marker-hidden'))
    expect(fenceMarkers.length).toBeGreaterThanOrEqual(1)
    expect(fenceMarkers.every(i => i.hidesSource)).toBe(true)

    // Table
    const tableDraft = '| Name | Age |\n| --- | --- |\n| Alice | 30 |'
    const tablePlan = project(tableDraft, { start: -1, end: -1, focused: false })

    expect(tablePlan.overlays.tables).toHaveLength(1)
    const table = tablePlan.overlays.tables[0]!
    expect(table.active).toBe(false)
    expect(table.columnWidths).toEqual(tableColumnWidths(tableDraft))
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0]?.header).toBe(true)
    expect(table.rows[0]?.cells).toEqual(['Name', 'Age'])
    expect(table.rows[0]?.lineIndex).toBe(0)
    expect(table.rows[1]?.header).toBe(false)
    expect(table.rows[1]?.last).toBe(true)
    expect(table.rows[1]?.cells).toEqual(['Alice', '30'])
    expect(table.rows[1]?.lineIndex).toBe(2)

    // Separator line (line 1) signature/class per current behavior
    const separatorLine = tablePlan.lines[1]!
    expect(separatorLine.blockClasses).toContain('dsh-better-composer-table-separator')
    expect(separatorLine.signature).toContain('dsh-better-composer-table-separator')
  })

  it('projects table layouts and code copy text with native range masking', () => {
    const draft = '| Name | Value |\n| --- | --- |\n| A | 1 |\n```js\nconsole.log(1)\n```'
    const plan = project(draft, null, [{ start: 0, end: 5, kind: 'chip' }])
    expect(plan.overlays.codeBlocks).toHaveLength(1)
    expect(plan.overlays.codeBlocks[0]?.copyText).toBe('console.log(1)')
  })

  it('degrades cleanly for over-length drafts (>50_000)', () => {
    const longDraft = 'a\n'.repeat(26_000) // 52_000 chars > 50_000
    expect(longDraft.length).toBeGreaterThan(50_000)

    const plan = project(longDraft)
    expect(plan.draft).toBe(longDraft)
    expect(plan.inlines).toEqual([])
    expect(plan.overlays.tables).toEqual([])
    expect(plan.overlays.codeBlocks).toEqual([])

    // Lines must still partition the draft contiguously
    expect(plan.lines.length).toBeGreaterThan(0)
    expect(plan.lines[0]?.start).toBe(0)
    expect(plan.lines.at(-1)?.end).toBe(longDraft.length)
    for (let index = 0; index + 1 < plan.lines.length; index += 1) {
      expect(plan.lines[index]!.end).toBe(plan.lines[index + 1]!.start)
      expect(plan.lines[index]!.signature).toBe('')
      expect(plan.lines[index]!.blockClasses).toEqual([])
    }
  })

  it('partitions draft lines contiguously for various line endings and edge cases', () => {
    for (const testCase of ['', 'single line', 'line 1\nline 2', 'line 1\r\nline 2\nline 3\n', '\n\n']) {
      const plan = project(testCase)
      expect(plan.lines.length).toBeGreaterThan(0)
      expect(plan.lines[0]?.start).toBe(0)
      expect(plan.lines.at(-1)?.end).toBe(testCase.length)
      for (let i = 0; i + 1 < plan.lines.length; i += 1) {
        expect(plan.lines[i]!.end).toBe(plan.lines[i + 1]!.start)
      }
    }
  })
})
