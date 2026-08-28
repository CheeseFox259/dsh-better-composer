import { describe, expect, it } from 'vitest'
import type { ComposerActionContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { composerActions } from '../../src/commands/actions.ts'

const context = (draft: string, start: number, end: number): ComposerActionContext => ({
  draft, draftRev: 4, selection: { start, end }, nativeRanges: [],
})

describe('composer actions', () => {
  it('returns one selection-preserving result for every Beta command', () => {
    const draft = 'one\ntwo'
    for (const action of composerActions) {
      const result = action.transform(context(draft, 0, draft.length))
      expect(result, action.id).toBeDefined()
      expect(result?.start).toBe(0)
      expect(result?.end).toBe(draft.length)
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
