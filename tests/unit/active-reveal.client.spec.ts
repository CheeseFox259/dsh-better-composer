import { describe, expect, it } from 'vitest'
import { createMarkdownProvider } from '../../src/markdown/provider.ts'
import { DEFAULT_SETTINGS } from '../../src/settings.ts'

function decorate(draft: string, caret: number) {
  return createMarkdownProvider(() => DEFAULT_SETTINGS).decorate({
    sessionId: 'active-reveal' as never,
    draft,
    draftRev: 1,
    nativeRanges: [],
    presentation: {
      focused: true,
      selectionStart: caret,
      selectionEnd: caret,
      activeLineStart: 0,
      activeLineEnd: draft.length,
    },
  })
}

function blockClasses(ranges: readonly { readonly target?: string; readonly className: string }[]): readonly string[] {
  return ranges.filter(range => range.target === 'block').map(range => range.className)
}

describe('active construct block reveal', () => {
  it('drops the synthetic bullet of a transient nested empty item while typing `1. *`', () => {
    const draft = '1. *'
    const ranges = decorate(draft, draft.length)

    expect(blockClasses(ranges)).not.toContain('dsh-better-composer-bullet')
    expect(blockClasses(ranges)).toContain('dsh-better-composer-ordered')
  })

  it('restores the bullet decoration once the caret leaves the item', () => {
    const draft = '# t\n\n1. *'
    const ranges = decorate(draft, 1)

    expect(blockClasses(ranges)).toContain('dsh-better-composer-bullet')
  })

  it('drops the thematic-break rule while typing `***`', () => {
    const draft = '***'
    const ranges = decorate(draft, draft.length)

    expect(blockClasses(ranges)).not.toContain('dsh-better-composer-thematic-break')
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-thematic-break-marker-active' }),
    ]))
  })

  it('keeps the thematic-break rule when the caret is elsewhere', () => {
    const draft = 'intro\n\n***'
    const ranges = decorate(draft, 0)

    expect(blockClasses(ranges)).toContain('dsh-better-composer-thematic-break')
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-thematic-break-marker-hidden' }),
    ]))
  })

  it('drops the task checkbox glyph while editing the item source', () => {
    const draft = '- [ ] todo'
    const ranges = decorate(draft, draft.length)

    expect(blockClasses(ranges)).not.toContain('dsh-better-composer-task')
  })
})
