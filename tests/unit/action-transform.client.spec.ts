import { describe, expect, it } from 'vitest'
import type { ComposerActionContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { composerActions } from '../../src/commands/actions.ts'

const context = (draft: string, start: number, end: number): ComposerActionContext => ({
  draft, draftRev: 4, selection: { start, end }, nativeRanges: [],
})

describe('composer actions', () => {
  it('returns the expected single replacement for every Beta command', () => {
    const draft = 'one\ntwo'
    const expected: Readonly<Record<string, string>> = {
      strong: '**one\ntwo**', emphasis: '*one\ntwo*', 'inline-code': '`one\ntwo`',
      link: '[one\ntwo](url)', quote: '> one\n> two', bullet: '- one\n- two',
      ordered: '1. one\n1. two', task: '- [ ] one\n- [ ] two',
      'code-fence': '```\none\ntwo\n```', indent: '    one\n    two', outdent: 'one\ntwo',
    }
    for (const action of composerActions) {
      const result = action.transform(context(draft, 0, draft.length))
      expect(result, action.id).toBeDefined()
      expect(result?.start).toBe(0)
      expect(result?.end).toBe(draft.length)
      expect(result?.text, action.id).toBe(expected[action.id])
      expect(result?.selectionEnd).toBeGreaterThanOrEqual(result?.selectionStart ?? 0)
    }
  })

  it('wraps an inline selection without mutating its input', () => {
    const input = context('hello', 1, 4)
    const result = composerActions.find(action => action.id === 'strong')!.transform(input)
    expect(result).toEqual({ start: 1, end: 4, text: '**ell**', selectionStart: 3, selectionEnd: 6 })
    expect(input.draft).toBe('hello')
  })
})
