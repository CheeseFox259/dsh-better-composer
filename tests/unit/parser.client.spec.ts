import { describe, expect, it } from 'vitest'
import { parseGfm } from '@deepseek-ai/dsh-client-ui-primitives'
import { rangesFromGfm } from '../../src/markdown/ast-ranges.ts'
import { maskNative } from '../../src/markdown/native-mask.ts'

describe('Markdown projection', () => {
  it('maps the existing GFM tree and preserves UTF-16 offsets', () => {
    const draft = '# 标题 **😀** and `code`'
    const ranges = rangesFromGfm(parseGfm(draft))
    expect(ranges).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-rich-editor-heading', start: 0 }),
      expect.objectContaining({ className: 'dsh-rich-editor-strong' }),
      expect.objectContaining({ className: 'dsh-rich-editor-inline-code' }),
    ]))
    const emojiStart = draft.indexOf('😀')
    expect(emojiStart).toBe(7)
    expect(draft.slice(emojiStart, emojiStart + 2)).toBe('😀')
  })

  it('masks native ranges without changing draft length or newlines', () => {
    const draft = 'before @src/\nafter'
    const masked = maskNative(draft, [{ start: 7, end: 12, kind: 'text-reference' }])
    expect(masked.length).toBe(draft.length)
    expect(masked).toBe('before      \nafter')
  })
})
