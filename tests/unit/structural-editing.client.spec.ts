import { describe, expect, it } from 'vitest'
import type { ComposerEditResult } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { runComposerStructuralCommand, armBreakContinuation, settleBreakContinuation, type OrderedRenumberEdit } from '../../src/markdown/structural-editing.ts'

interface Applied {
  readonly edit: ComposerEditResult
  readonly draftRev: number
}

function run(kind: 'enter' | 'shift-enter' | 'indent' | 'outdent', draft: string, caret: number | { start: number; end: number }, options?: {
  readonly nativeRanges?: readonly { start: number; end: number; kind: string }[]
  readonly composing?: boolean
  readonly reject?: boolean
}) {
  const selection = typeof caret === 'number' ? { start: caret, end: caret } : caret
  const applied: Applied[] = []
  const result = runComposerStructuralCommand({
    kind,
    context: { draft, draftRev: 7, selection, nativeRanges: options?.nativeRanges ?? [] },
    composing: options?.composing ?? false,
    apply: (edit, draftRev) => {
      if (options?.reject === true) return false
      applied.push({ edit, draftRev })
      return true
    },
  })
  return { result, applied }
}

function nextDraft(draft: string, edit: ComposerEditResult): string {
  return draft.slice(0, edit.start) + edit.text + draft.slice(edit.end)
}

describe('composer structural editing', () => {
  it('Enter continues list and quote lines; empty list Enter removes the prefix', () => {
    const bullet = '- item'
    const continued = run('enter', bullet, bullet.length)
    expect(continued.result.kind).toBe('applied')
    expect(nextDraft(bullet, continued.applied[0]!.edit)).toBe('- item\n- ')

    const quote = '> quoted'
    const quoted = run('enter', quote, quote.length)
    expect(quoted.result.kind).toBe('applied')
    expect(nextDraft(quote, quoted.applied[0]!.edit)).toBe('> quoted\n> ')

    const empty = '- '
    const exited = run('enter', empty, empty.length)
    expect(exited.result.kind).toBe('applied')
    expect(nextDraft(empty, exited.applied[0]!.edit)).toBe('\n')
  })

  it('Shift+Enter continues a bullet item', () => {
    const draft = '- 无序列表'
    const { result, applied } = run('shift-enter', draft, draft.length)
    expect(result.kind).toBe('applied')
    expect(applied).toHaveLength(1)
    const edit = applied[0]!.edit
    expect(nextDraft(draft, edit)).toBe('- 无序列表\n- ')
    expect(edit.selectionStart).toBe(draft.length + 3)
    expect(applied[0]!.draftRev).toBe(7)
  })

  it('Shift+Enter continues a task item as unchecked', () => {
    const draft = '- [x] done'
    const { result, applied } = run('shift-enter', draft, draft.length)
    expect(result.kind).toBe('applied')
    expect(nextDraft(draft, applied[0]!.edit)).toBe('- [x] done\n- [ ] ')
  })

  it('Shift+Enter continues a blockquote line', () => {
    const draft = '> 引用内容'
    const { result, applied } = run('shift-enter', draft, draft.length)
    expect(result.kind).toBe('applied')
    expect(nextDraft(draft, applied[0]!.edit)).toBe('> 引用内容\n> ')
  })

  it('Shift+Enter in the middle of an ordered item splits and renumbers the run', () => {
    const draft = '1. first\n2. second\n3. third'
    const caret = '1. fir'.length
    const { result, applied } = run('shift-enter', draft, caret)
    expect(result.kind).toBe('applied')
    const edit = applied[0]!.edit
    expect(nextDraft(draft, edit)).toBe('1. fir\n2. st\n3. second\n4. third')
    expect(edit.selectionStart).toBe(caret + '\n2. '.length)
  })

  it('renumbers every following sibling ordered item even when existing numbers drift', () => {
    const draft = '1. first\n4. second\n9. third'
    const caret = '1. fir'.length
    const { result, applied } = run('enter', draft, caret)
    expect(result.kind).toBe('applied')
    expect(nextDraft(draft, applied[0]!.edit)).toBe('1. fir\n2. st\n3. second\n4. third')
  })

  it('does not renumber a nested ordered list as siblings', () => {
    const draft = '1. first\n  1. nested\n2. second'
    const caret = '1. fir'.length
    const { result, applied } = run('enter', draft, caret)
    expect(result.kind).toBe('applied')
    expect(nextDraft(draft, applied[0]!.edit)).toBe('1. fir\n2. st\n  1. nested\n3. second')
  })

  it('Shift+Enter passes on an empty list item so the native newline exits the list', () => {
    expect(run('shift-enter', '- ', 2).result.kind).toBe('pass')
  })

  it('Shift+Enter passes on ordinary text and inside fences', () => {
    expect(run('shift-enter', 'plain line', 5).result.kind).toBe('pass')
    expect(run('shift-enter', '```\ncode\n```', 5).result.kind).toBe('pass')
  })

  it('Shift+Enter passes while composing or over a Context Object barrier', () => {
    const draft = '- item'
    expect(run('shift-enter', draft, draft.length, { composing: true }).result.kind).toBe('pass')
    expect(run('shift-enter', draft, 3, { nativeRanges: [{ start: 2, end: 5, kind: 'reference' }] }).result.kind).toBe('noop')
  })

  it('Tab indents a list line and keeps the caret aligned', () => {
    const draft = '- item'
    const { result, applied } = run('indent', draft, 4)
    expect(result.kind).toBe('applied')
    expect(nextDraft(draft, applied[0]!.edit)).toBe('  - item')
    expect(applied[0]!.edit.selectionStart).toBe(6)
  })

  it('Shift+Tab outdents an indented list line', () => {
    const draft = '  - item'
    const { result, applied } = run('outdent', draft, 6)
    expect(result.kind).toBe('applied')
    expect(nextDraft(draft, applied[0]!.edit)).toBe('- item')
    expect(applied[0]!.edit.selectionStart).toBe(4)
  })

  it('Tab passes on ordinary lines and no-ops on root outdent', () => {
    expect(run('indent', 'plain', 2).result.kind).toBe('pass')
    expect(run('outdent', '- item', 2).result.kind).toBe('noop')
  })

  it('fails open when the bridge rejects the edit', () => {
    const draft = '- item'
    const { result, applied } = run('shift-enter', draft, draft.length, { reject: true })
    expect(result.kind).toBe('noop')
    expect(applied).toHaveLength(0)
  })
})

describe('break continuation (post-hoc Shift+Enter)', () => {
  function arm(draft: string, caret: number | { start: number; end: number }, options?: {
    readonly nativeRanges?: readonly { start: number; end: number; kind: string }[]
  }) {
    const selection = typeof caret === 'number' ? { start: caret, end: caret } : caret
    return armBreakContinuation(draft, selection, options?.nativeRanges ?? [])
  }

  /** Simulate the host's native break, settle the intent, apply the follow-up. */
  function continueAfterBreak(draft: string, caret: number): { readonly final: string; readonly edit: ComposerEditResult | undefined; readonly renumber: readonly OrderedRenumberEdit[] } {
    const armed = arm(draft, caret)
    if (armed === undefined) return { final: draft, edit: undefined, renumber: [] }
    const broken = `${draft.slice(0, caret)}\n${draft.slice(caret)}`
    const settled = settleBreakContinuation(armed, broken)
    if (settled === undefined) return { final: broken, edit: undefined, renumber: [] }
    return { final: nextDraft(broken, settled.edit), edit: settled.edit, renumber: settled.renumber }
  }

  /** Apply the renumber chain in order (it is stored reverse, last line first). */
  function applyRenumber(baseDraft: string, renumber: readonly OrderedRenumberEdit[]): string {
    let draft = baseDraft
    for (const edit of [...renumber].reverse()) {
      expect(draft.slice(edit.start, edit.end)).toBe(edit.expect)
      draft = nextDraft(draft, edit)
    }
    return draft
  }

  it('continues an unordered item with its marker', () => {
    const { final, edit } = continueAfterBreak('- 无序列表', '- 无序列表'.length)
    expect(final).toBe('- 无序列表\n- ')
    expect(edit?.selectionStart).toBe('- 无序列表\n- '.length)
  })

  it('continues a task item as unchecked and a quote with its marker', () => {
    expect(continueAfterBreak('- [x] done', '- [x] done'.length).final).toBe('- [x] done\n- [ ] ')
    expect(continueAfterBreak('> 引用内容', '> 引用内容'.length).final).toBe('> 引用内容\n> ')
  })

  it('continues an ordered item with the next number', () => {
    expect(continueAfterBreak('2. second', '2. second'.length).final).toBe('2. second\n3. ')
  })

  it('renumbers the following ordered run after a mid-list split', () => {
    const draft = '1. first\n2. second\n3. third'
    const caret = '1. fir'.length
    const { final, renumber } = continueAfterBreak(draft, caret)
    expect(final).toBe('1. fir\n2. st\n2. second\n3. third')
    expect(renumber).toHaveLength(2)
    expect(applyRenumber(final, renumber)).toBe('1. fir\n2. st\n3. second\n4. third')
  })

  it('renumbers across drifted numbers and rides over nested items', () => {
    const draft = '1. first\n  1. nested\n4. second'
    const caret = '1. fir'.length
    const { final, renumber } = continueAfterBreak(draft, caret)
    expect(final).toBe('1. fir\n2. st\n  1. nested\n4. second')
    expect(applyRenumber(final, renumber)).toBe('1. fir\n2. st\n  1. nested\n3. second')
  })

  it('produces no renumber when the continued item is the last one', () => {
    const { renumber } = continueAfterBreak('1. a\n2. b', '1. a\n2. b'.length)
    expect(renumber).toEqual([])
  })

  it('splits a mid-line item, keeping the suffix on the new line', () => {
    expect(continueAfterBreak('- item', '- it'.length).final).toBe('- it\n- em')
  })

  it('exits the structure on an emptied item by removing its prefix', () => {
    expect(continueAfterBreak('- ', 2).final).toBe('\n')
    expect(continueAfterBreak('- [ ] ', 6).final).toBe('\n')
    expect(continueAfterBreak('1. ', 3).final).toBe('\n')
  })

  it('keeps the indentation when exiting a quote line', () => {
    expect(continueAfterBreak('  > ', 4).final).toBe('  \n')
  })

  it('arms nothing at the line start of an empty item (the bare break already exits)', () => {
    expect(arm('- ', 0)).toBeUndefined()
  })

  it('arms nothing on ordinary text, inside fences, or over a chip interior', () => {
    expect(arm('plain line', 5)).toBeUndefined()
    expect(arm('```\ncode\n```', 5)).toBeUndefined()
    expect(arm('- item', 3, { nativeRanges: [{ start: 2, end: 5, kind: 'reference' }] })).toBeUndefined()
  })

  it('arms nothing on a non-collapsed selection', () => {
    expect(arm('- item', { start: 2, end: 5 })).toBeUndefined()
  })

  it('drops the intent when the landed draft differs from the bare break', () => {
    const armed = arm('- item', 6)
    expect(armed).toBeDefined()
    expect(settleBreakContinuation(armed!, '- item\nx')).toBeUndefined()
    expect(settleBreakContinuation(armed!, '- item')).toBeUndefined()
  })

  it('yields only newline-free follow-up edits the insertText seam can express', () => {
    for (const draft of ['- a', '1. a', '- [ ] a', '> a', '- ']) {
      const { edit } = continueAfterBreak(draft, draft.length)
      expect(edit).toBeDefined()
      expect(edit!.text).not.toContain('\n')
    }
  })
})
