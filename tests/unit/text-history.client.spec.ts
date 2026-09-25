import { describe, expect, it } from 'vitest'
import { EMPTY_TEXT_HISTORY, recordTextChange, redoTextChange, undoTextChange } from '../../src/client/text-history.ts'

describe('clip text history', () => {
  it('records edits, undoes, and redoes them', () => {
    const changed = recordTextChange(EMPTY_TEXT_HISTORY, 'one', 'two')
    const undone = undoTextChange(changed, 'two')!
    expect(undone.text).toBe('one')
    const redone = redoTextChange(undone.history, undone.text)!
    expect(redone.text).toBe('two')
  })

  it('clears redo history after a new edit', () => {
    const first = recordTextChange(EMPTY_TEXT_HISTORY, 'one', 'two')
    const undone = undoTextChange(first, 'two')!
    const next = recordTextChange(undone.history, undone.text, 'three')
    expect(next.future).toEqual([])
    expect(redoTextChange(next, 'three')).toBeUndefined()
  })
})
