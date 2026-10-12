import { describe, expect, it } from 'vitest'
import { decorateViaPlan } from '../helpers/project-ranges.ts'

function decorate(draft: string, caret: number) {
  return decorateViaPlan({
    draft,
    nativeRanges: [],
    presentation: {
      focused: true,
      selectionStart: caret,
      selectionEnd: caret,
    },
  })
}

function blockClasses(ranges: readonly { readonly target?: string; readonly className: string }[]): readonly string[] {
  return ranges.filter(range => range.target === 'block').map(range => range.className)
}

describe('active construct block reveal', () => {
  it('keeps the list glyph of a transient nested empty item while typing `1. *`', () => {
    const draft = '1. *'
    const ranges = decorate(draft, draft.length)

    expect(blockClasses(ranges)).toContain('dsh-better-composer-list-item')
    expect(blockClasses(ranges)).toContain('dsh-better-composer-list-depth-1')
  })

  it('restores the bullet decoration once the caret leaves the item', () => {
    const draft = '# t\n\n1. *'
    const ranges = decorate(draft, 1)

    expect(blockClasses(ranges)).toContain('dsh-better-composer-list-item')
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

  it('keeps the task checkbox glyph while editing the item source', () => {
    const draft = '- [ ] todo'
    const ranges = decorate(draft, draft.length)

    expect(blockClasses(ranges)).toContain('dsh-better-composer-list-item')
  })
})
