import { describe, expect, it } from 'vitest'
import { parseGfm } from '@deepseek-ai/dsh-client-ui-primitives'
import { projectGfm, rangesFromGfm } from '../../src/markdown/ast-ranges.ts'
import { maskNative } from '../../src/markdown/native-mask.ts'
import { createMarkdownProvider } from '../../src/markdown/provider.ts'

describe('Markdown projection', () => {
  it('maps the existing GFM tree and preserves UTF-16 offsets', () => {
    const draft = '# 标题 **😀** and `code`'
    const ranges = rangesFromGfm(parseGfm(draft))
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-heading', start: 0 }),
      expect.objectContaining({ className: 'dsh-better-composer-strong' }),
      expect.objectContaining({ className: 'dsh-better-composer-inline-code' }),
    ]))
    const emojiStart = draft.indexOf('😀')
    expect(emojiStart).toBe(7)
    expect(draft.slice(emojiStart, emojiStart + 2)).toBe('😀')
  })

  it('emits separate source marker ranges for agent-oriented Markdown', () => {
    const draft = '## Task\n- [ ] Fix `parseExpression`\n> **important**'
    const markers = rangesFromGfm(parseGfm(draft), draft).filter(range => range.className === 'dsh-better-composer-marker'
      || range.className.startsWith('dsh-better-composer-list-marker-depth-'))
    expect(markers.map(range => draft.slice(range.start, range.end))).toEqual(expect.arrayContaining(['## ', '- [ ] ', '`', '**']))
    expect(markers.every(range => range.layer === 'syntax')).toBe(true)
  })

  it('keeps fence delimiters in their own source range', () => {
    const draft = '```ts\nparseExpression()\n```'
    const fences = rangesFromGfm(parseGfm(draft), draft).filter(range => range.className === 'dsh-better-composer-fence-marker' || range.className === 'dsh-better-composer-fence-language')
    expect(fences.map(range => draft.slice(range.start, range.end))).toEqual(['```', 'ts', '```'])
  })

  it('keeps fenced-code layout visible beneath its source markers', () => {
    const draft = '```ts\nparseExpression()\n```'
    const code = projectGfm(parseGfm(draft), draft).semanticRanges.find(range => range.className === 'dsh-better-composer-fenced-code')
    expect(code).toEqual(expect.objectContaining({ start: 0, end: draft.length, priority: 10 }))
  })

  it('projects level-aware headings and block-level fence metadata', () => {
    const draft = '# H1\r\n## H2\r\n### H3 😀\r\n```ts\r\nconst answer = 42\r\n```'
    const projection = projectGfm(parseGfm(draft), draft)
    const headings = projection.structuralRanges.filter(range => range.className.includes('dsh-better-composer-heading-level-'))
    expect(headings.map(range => range.className)).toEqual(expect.arrayContaining([
      'dsh-better-composer-heading-level-1',
      'dsh-better-composer-heading-level-2',
      'dsh-better-composer-heading-level-3',
    ]))
    expect(headings.every(range => range.target === 'block')).toBe(true)
    const fence = projection.structuralRanges.filter(range => range.className.includes('dsh-better-composer-code-block'))
    expect(fence.map(range => range.className)).toEqual(expect.arrayContaining([
      expect.stringContaining('dsh-better-composer-code-block-start'),
      expect.stringContaining('dsh-better-composer-code-block-middle'),
      expect.stringContaining('dsh-better-composer-code-block-end'),
    ]))
    expect(fence.every(range => range.target === 'block')).toBe(true)
    expect(draft.slice(headings[0]!.start, headings[0]!.end)).toBe('# H1')
  })

  it('projects table rows and nested list depth as block metadata while cells stay text paint', () => {
    const draft = '| Name | Value |\n| --- | --- |\n| A | 1 |\n- one\n  1. two\n    - 三'
    const projection = projectGfm(parseGfm(draft), draft)
    expect(projection.structuralRanges.map(range => range.className)).toEqual(expect.arrayContaining([
      'dsh-better-composer-table-row',
      'dsh-better-composer-table-header-row',
      'dsh-better-composer-table-body-row',
      'dsh-better-composer-table-separator',
      'dsh-better-composer-bullet',
      'dsh-better-composer-ordered',
      'dsh-better-composer-list-depth-1',
      'dsh-better-composer-list-depth-2',
      'dsh-better-composer-list-depth-3',
    ]))
    expect(projection.semanticRanges.map(range => range.className)).toEqual(expect.arrayContaining([
      'dsh-better-composer-table-header-cell',
      'dsh-better-composer-table-cell',
    ]))
    expect(projection.structuralRanges.every(range => range.target === 'block')).toBe(true)
    expect(draft).toBe('| Name | Value |\n| --- | --- |\n| A | 1 |\n- one\n  1. two\n    - 三')
  })

  it('fails open for an incomplete table instead of inventing block metadata', () => {
    const draft = '| header |\n| value |'
    const projection = projectGfm(parseGfm(draft), draft)
    expect(projection.structuralRanges.filter(range => range.className.includes('table'))).toEqual([])
    expect(projection.semanticRanges.filter(range => range.className.includes('table'))).toEqual([])
  })

  it('keeps semantic and syntax projections independently addressable', () => {
    const draft = '**important**'
    const projection = projectGfm(parseGfm(draft), draft)
    expect(projection.semanticRanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-strong', start: 0, end: draft.length }),
    ]))
    expect(projection.markerRanges.map(range => draft.slice(range.start, range.end))).toEqual(['**', '**'])
    expect(projection.fenceRanges).toEqual([])
  })

  it('gives source markers precedence over enclosing semantic ranges', () => {
    const draft = '**important**'
    const projection = projectGfm(parseGfm(draft), draft)
    const semantic = projection.semanticRanges.find(range => range.className === 'dsh-better-composer-strong')
    const markers = projection.markerRanges.filter(range => range.className === 'dsh-better-composer-marker')
    expect(semantic).toBeDefined()
    expect(markers).toHaveLength(2)
    expect(markers.every(range => (range.priority ?? 0) > (semantic?.priority ?? 0))).toBe(true)
  })

  it('keeps GFM email autolinks as ordinary composer text', () => {
    const draft = 'email@example.com and https://example.com'
    const links = rangesFromGfm(parseGfm(draft), draft)
      .filter(range => range.className === 'dsh-better-composer-link')
    expect(links).toEqual([])
  })

  it('separates an explicit link label from its source punctuation and destination', () => {
    const draft = '[测试链接](https://example.com)'
    const projection = projectGfm(parseGfm(draft), draft)
    expect(projection.semanticRanges
      .filter(range => range.className === 'dsh-better-composer-link')
      .map(range => draft.slice(range.start, range.end))).toEqual(['测试链接'])
    expect(projection.markerRanges
      .filter(range => range.className === 'dsh-better-composer-marker')
      .map(range => draft.slice(range.start, range.end))).toEqual(['[', '](https://example.com)'])
  })

  it('projects images and GFM tables as source-preserving constructs', () => {
    const draft = [
      '![图片](https://picsum.photos/120/60)',
      '',
      '| 项目 | 值 |',
      '| --- | --- |',
      '| A | 1 |',
    ].join('\n')
    const projection = projectGfm(parseGfm(draft), draft)
    expect(projection.semanticRanges.map(range => range.className)).toEqual(expect.arrayContaining([
      'dsh-better-composer-image',
      'dsh-better-composer-table',
      'dsh-better-composer-table-cell',
      'dsh-better-composer-table-header-cell',
    ]))
    expect(projection.structuralRanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-image-card', target: 'block' }),
    ]))
    expect(projection.markerRanges.map(range => draft.slice(range.start, range.end))).toEqual(expect.arrayContaining([
      '![', '](https://picsum.photos/120/60)', '|', '| --- | --- |',
    ]))
    expect(projection.constructs.map(record => record.kind)).toEqual(expect.arrayContaining(['image', 'table']))
  })

  it('projects thematic breaks as source-preserving visual cards', () => {
    const draft = 'before\n\n---\nafter'
    const projection = projectGfm(parseGfm(draft), draft)
    expect(projection.structuralRanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-thematic-break', target: 'block' }),
    ]))
    const provider = createMarkdownProvider()
    const ranges = provider.decorate({
      sessionId: 'thematic-break' as never,
      draft,
      draftRev: 1,
      nativeRanges: [],
      presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: 6 },
    })
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-thematic-break-marker-hidden' }),
      expect.objectContaining({ className: 'dsh-better-composer-thematic-break', target: 'block' }),
    ]))
  })

  it('hides complete strikethrough markers outside the active selection', () => {
    const draft = '~~删除线~~'
    const ranges = createMarkdownProvider().decorate({
      sessionId: 'strike' as never,
      draft,
      draftRev: 2,
      nativeRanges: [],
      presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: draft.length },
    })
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-marker-hidden', start: 0, end: 2 }),
      expect.objectContaining({ className: 'dsh-better-composer-marker-hidden', start: draft.length - 2, end: draft.length }),
    ]))
  })

  it('does not invent inline markers inside code or ordinary identifiers', () => {
    const draft = '`snake_case` and snake_case'
    const markers = projectGfm(parseGfm(draft), draft).markerRanges
      .filter(range => range.className === 'dsh-better-composer-marker')
      .map(range => draft.slice(range.start, range.end))
    expect(markers).toEqual(['`', '`'])
  })

  it('masks native ranges without changing draft length or newlines', () => {
    const draft = 'before @src/\nafter'
    const masked = maskNative(draft, [{ start: 7, end: 12, kind: 'text-reference' }])
    expect(masked.length).toBe(draft.length)
    expect(masked).toBe('before      \nafter')
  })

  it('marks only the active physical line for marker reveal', () => {
    const provider = createMarkdownProvider()
    const draft = '# One\n## Two'
    const ranges = provider.decorate({
      sessionId: 's' as never, draft, draftRev: 1, nativeRanges: [],
      presentation: { focused: true, selectionStart: 8, selectionEnd: 8, activeLineStart: 6, activeLineEnd: draft.length },
    })
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-marker-active', start: 6, end: 9 }),
    ]))
    expect(ranges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-marker-active', start: 0 }),
    ]))
  })

  it('keeps marker-only Markdown lines dimmed when the caret leaves them', () => {
    const provider = createMarkdownProvider()
    for (const source of ['1. ', '- ', '# ']) {
      const draft = `${source}\nplain`
      const ranges = provider.decorate({
        sessionId: 's' as never, draft, draftRev: draft.length, nativeRanges: [],
        presentation: { focused: true, selectionStart: draft.length, selectionEnd: draft.length, activeLineStart: source.length + 1, activeLineEnd: draft.length },
      })
      const className = source === '# '
        ? 'dsh-better-composer-marker'
        : source === '- '
          ? 'dsh-better-composer-list-marker-depth-1'
          : 'dsh-better-composer-ordered-marker-depth-1'
      expect(ranges).toEqual(expect.arrayContaining([
        expect.objectContaining({ start: 0, end: source.length, className }),
      ]))
    }
  })

  it('retains unordered-list depth on inactive source markers', () => {
    const draft = '- parent\n  - child\n    - grandchild'
    const ranges = createMarkdownProvider().decorate({
      sessionId: 's' as never,
      draft,
      draftRev: 17,
      nativeRanges: [],
      presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: 0 },
    })

    expect(ranges.filter(range => range.className.startsWith('dsh-better-composer-list-marker-depth-')).map(range => range.className)).toEqual([
      'dsh-better-composer-list-marker-depth-1-hidden',
      'dsh-better-composer-list-marker-depth-2-hidden',
      'dsh-better-composer-list-marker-depth-3-hidden',
    ])
  })

  it('marks an inactive table separator separately from ordinary table punctuation', () => {
    const draft = '| Name | Value |\n| --- | --- |\n| A | 1 |'
    const ranges = createMarkdownProvider().decorate({
      sessionId: 's' as never,
      draft,
      draftRev: 18,
      nativeRanges: [],
      presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: 0 },
    })

    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        start: draft.indexOf('| ---'),
        end: draft.indexOf('| ---') + '| --- | --- |'.length,
        className: 'dsh-better-composer-table-separator-hidden',
      }),
      expect.objectContaining({
        start: draft.indexOf('| ---'),
        end: draft.indexOf('| ---') + '| --- | --- |\n'.length,
        className: 'dsh-better-composer-table-separator-hidden',
        target: 'block',
      }),
    ]))
  })

  it('keeps the table separator row present only while its source is active', () => {
    const draft = '| Name | Value |\n| --- | --- |\n| A | 1 |'
    const separatorStart = draft.indexOf('| ---')
    const provider = createMarkdownProvider()

    const active = provider.decorate({
      sessionId: 'table-separator-active' as never,
      draft,
      draftRev: 181,
      nativeRanges: [],
      presentation: {
        focused: true,
        selectionStart: separatorStart,
        selectionEnd: separatorStart,
        activeLineStart: separatorStart,
        activeLineEnd: separatorStart + '| --- | --- |'.length,
      },
    })

    expect(active).toEqual(expect.arrayContaining([
      expect.objectContaining({
        start: separatorStart,
        end: separatorStart + '| --- | --- |\n'.length,
        className: 'dsh-better-composer-table-separator-active',
        target: 'block',
      }),
    ]))
  })

  it('keeps table dividers visible and exposes a language header for inactive fences', () => {
    const tableDraft = '| Name | Value |\n| --- | --- |\n| A | 1 |'
    const tableProjection = projectGfm(parseGfm(tableDraft), tableDraft)
    expect(tableProjection.markerRanges.filter(range => range.className === 'dsh-better-composer-table-divider').length).toBe(6)

    const fenceDraft = 'plain\n```javascript\nconsole.log("ok")\n```'
    const ranges = createMarkdownProvider().decorate({
      sessionId: 'header' as never,
      draft: fenceDraft,
      draftRev: 19,
      nativeRanges: [],
      presentation: { focused: true, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: 5 },
    })
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-fence-language-visible' }),
      expect.objectContaining({ className: 'dsh-better-composer-fence-marker-hidden' }),
    ]))
  })

  it('adds bounded syntax token ranges for a short known fence', () => {
    const draft = '```javascript\nconsole.log("ok")\n```'
    const ranges = createMarkdownProvider().decorate({
      sessionId: 'tokens' as never,
      draft,
      draftRev: 20,
      nativeRanges: [],
      presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: 0 },
    })
    expect(ranges.some(range => range.className.startsWith('dsh-better-composer-shiki-token-'))).toBe(true)
  })

  it('marks a language-bearing code header for presentation only', () => {
    const withLanguage = projectGfm(parseGfm('```javascript\ncode\n```'), '```javascript\ncode\n```')
    expect(withLanguage.structuralRanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-code-block-language', target: 'block' }),
    ]))

    const withoutLanguage = projectGfm(parseGfm('```\ncode\n```'), '```\ncode\n```')
    expect(withoutLanguage.structuralRanges.some(range => range.className === 'dsh-better-composer-code-block-language')).toBe(false)
  })

  it('projects Shiki token categories back onto fenced source offsets', () => {
    const draft = '```ts\nconst answer = 42\n```'
    const tokens = rangesFromGfm(parseGfm(draft), draft).filter(range => range.className.startsWith('dsh-better-composer-shiki-token-'))
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.every(range => range.priority === 20)).toBe(true)
    expect(tokens.every(range => draft.slice(range.start, range.end).length > 0)).toBe(true)
  })

  it('can build the live projection without synchronously tokenizing fences', () => {
    const draft = '```python\nprint("ok")\n```'
    const projection = projectGfm(parseGfm(draft), draft, { includeCodeTokens: false })
    expect(projection.fenceRanges.filter(range => range.className.startsWith('dsh-better-composer-shiki-token-'))).toEqual([])
    expect(projection.fenceRanges.map(range => draft.slice(range.start, range.end))).toEqual(['```', 'python', '```'])
  })

  it('fails open for unknown fence languages', () => {
    const draft = '```made-up\nconst answer = 42\n```'
    const tokens = rangesFromGfm(parseGfm(draft), draft).filter(range => range.className.startsWith('dsh-better-composer-shiki-token-'))
    expect(tokens).toEqual([])
  })

  it('reveals only the selected construct and keeps incomplete syntax source-visible', () => {
    const draft = '**bold** and *italic* `open'
    const provider = createMarkdownProvider()
    const ranges = provider.decorate({
      sessionId: 's' as never, draft, draftRev: 12, nativeRanges: [],
      presentation: { focused: true, selectionStart: 2, selectionEnd: 4, activeLineStart: 0, activeLineEnd: draft.length },
    })
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-marker-active', start: 0, end: 2 }),
      expect.objectContaining({ className: 'dsh-better-composer-marker-hidden', start: 13, end: 14 }),
    ]))
    expect(ranges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-marker-hidden', start: draft.lastIndexOf('`') }),
    ]))
  })

  it('keeps the complete fence language visible as an inactive code header', () => {
    const draft = 'plain\n```python\nprint(1)\n```'
    const provider = createMarkdownProvider()
    const inactive = provider.decorate({
      sessionId: 's' as never, draft, draftRev: 13, nativeRanges: [],
      presentation: { focused: true, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: 5 },
    })
    expect(inactive).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-fence-language-visible' }),
    ]))
  })

  it('marks inactive fence edges for source-free visual spacing while preserving active editing', () => {
    const draft = '```javascript\nconsole.log("ok")\n```'
    const provider = createMarkdownProvider()
    const inactive = provider.decorate({
      sessionId: 'fence-edges' as never,
      draft,
      draftRev: 21,
      nativeRanges: [],
      presentation: { focused: false, selectionStart: -1, selectionEnd: -1, activeLineStart: -1, activeLineEnd: -1 },
    })
    expect(inactive).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-code-block-start-source-hidden', target: 'block' }),
      expect.objectContaining({ className: 'dsh-better-composer-code-block-end-source-hidden', target: 'block' }),
    ]))

    const active = provider.decorate({
      sessionId: 'fence-edges',
      draft,
      draftRev: 22,
      nativeRanges: [],
      presentation: {
        focused: true,
        selectionStart: 1,
        selectionEnd: 1,
        activeLineStart: 0,
        activeLineEnd: 14,
      },
    })
    expect(active).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-code-block-start', target: 'block' }),
      expect.objectContaining({ className: 'dsh-better-composer-code-block-end-source-hidden', target: 'block' }),
    ]))
  })

  it('keeps fence markers hidden while the caret is inside code content', () => {
    const draft = '```javascript\nconsole.log("ok")\n```'
    const provider = createMarkdownProvider()
    const bodyStart = draft.indexOf('console')
    const ranges = provider.decorate({
      sessionId: 'fence-marker-visibility' as never,
      draft,
      draftRev: 23,
      nativeRanges: [],
      presentation: { focused: true, selectionStart: bodyStart, selectionEnd: bodyStart, activeLineStart: bodyStart, activeLineEnd: bodyStart + 'console.log("ok")'.length },
    })
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-fence-marker-hidden', start: 0 }),
      expect.objectContaining({ className: 'dsh-better-composer-fence-marker-hidden', start: draft.lastIndexOf('```') }),
    ]))
  })

  it('does not mark a construct active while the editor is unfocused', () => {
    const provider = createMarkdownProvider()
    const ranges = provider.decorate({
      sessionId: 's' as never,
      draft: '**bold**\nplain',
      draftRev: 14,
      nativeRanges: [],
      presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: 0 },
    })
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-marker-hidden' }),
    ]))
    expect(ranges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-marker-active' }),
    ]))
  })

  it('keeps complete Markdown markers source-visible during composition', () => {
    const provider = createMarkdownProvider()
    const ranges = provider.decorate({
      sessionId: 's' as never,
      draft: '**bold**',
      draftRev: 15,
      nativeRanges: [],
      presentation: {
        focused: true,
        composing: true,
        selectionStart: 10,
        selectionEnd: 10,
        activeLineStart: 0,
        activeLineEnd: 14,
      },
    })
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-marker-active', start: 0, end: 2 }),
      expect.objectContaining({ className: 'dsh-better-composer-marker-active', start: 6, end: 8 }),
    ]))
  })

  it('projects every frozen block and inline construct with source markers', () => {
    const draft = [
      '# Heading',
      '**strong** *emphasis* `inline` [link](https://example.test)',
      '> quote',
      '- bullet',
      '1. ordered',
      '- [x] task',
      '```python',
      'print("ok")',
      '```',
    ].join('\n')
    const projection = projectGfm(parseGfm(draft), draft)
    const semanticClasses = projection.semanticRanges.map(range => range.className)
    expect(semanticClasses).toEqual(expect.arrayContaining([
      'dsh-better-composer-heading',
      'dsh-better-composer-strong',
      'dsh-better-composer-emphasis',
      'dsh-better-composer-inline-code',
      'dsh-better-composer-link',
      'dsh-better-composer-quote',
      'dsh-better-composer-bullet',
      'dsh-better-composer-ordered',
      'dsh-better-composer-task',
      'dsh-better-composer-fenced-code',
    ]))
    expect(projection.fenceRanges.map(range => draft.slice(range.start, range.end))).toEqual(expect.arrayContaining(['```', 'python', '```']))
    expect(projection.markerRanges.map(range => draft.slice(range.start, range.end))).toEqual(expect.arrayContaining([
      '# ', '**', '*', '`', '[', '](https://example.test)', '> ', '- ', '1. ', '- [x] ',
    ]))
    expect(projection.constructs.filter(record => record.complete).map(record => record.kind)).toEqual(expect.arrayContaining([
      'heading', 'strong', 'emphasis', 'inline-code', 'link', 'blockquote', 'list', 'task', 'fence',
    ]))
  })

  it('keeps an unclosed parsed fence source-visible', () => {
    const draft = '```python\nprint("ok")'
    const projection = projectGfm(parseGfm(draft), draft)
    expect(projection.constructs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fence', complete: false }),
    ]))
    const provider = createMarkdownProvider()
    const ranges = provider.decorate({
      sessionId: 's' as never,
      draft,
      draftRev: 16,
      nativeRanges: [],
      presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: draft.length },
    })
    expect(ranges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-fence-marker-hidden' }),
      expect.objectContaining({ className: 'dsh-better-composer-fence-language-hidden' }),
    ]))
  })

})
