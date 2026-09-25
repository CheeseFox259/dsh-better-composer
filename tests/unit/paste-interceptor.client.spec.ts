import { describe, expect, it } from 'vitest'
import { planPasteAction } from '../../src/client/paste-interceptor.ts'

const span = { start: 2, end: 4, draftRev: 7 }
const base = {
  draft: 'abXYcd', occurrences: 0, phase: 'plain', composing: false,
  hasFiles: false, threshold: 4000, span,
}

describe('paste interceptor planning', () => {
  it('turns a long plain paste into a pre-Core clip action', () => {
    expect(planPasteAction({ ...base, text: 'long text', threshold: 4 })).toEqual({ kind: 'clip', text: 'long text', span })
  })

  it('rebuilds an ordinary multiline paste through setDraft', () => {
    expect(planPasteAction({ ...base, text: 'one\ntwo' })).toEqual({
      kind: 'set-draft', text: 'abone\ntwocd',
    })
  })

  it('passes through chips, files, composition, and non-plain phases', () => {
    expect(planPasteAction({ ...base, text: 'one\ntwo', occurrences: 1 }).kind).toBe('pass')
    expect(planPasteAction({ ...base, text: 'one\ntwo', hasFiles: true }).kind).toBe('pass')
    expect(planPasteAction({ ...base, text: 'one\ntwo', composing: true }).kind).toBe('pass')
    expect(planPasteAction({ ...base, text: 'one\ntwo', phase: 'claimed' }).kind).toBe('pass')
  })

  it('passes an invalid captured span instead of creating a dead clip', () => {
    expect(planPasteAction({ ...base, text: 'long text', span: { start: 99, end: 100, draftRev: 7 } }).kind).toBe('pass')
    expect(planPasteAction({ ...base, text: 'one\ntwo', span: { start: 99, end: 100, draftRev: 7 } }).kind).toBe('pass')
  })
})
