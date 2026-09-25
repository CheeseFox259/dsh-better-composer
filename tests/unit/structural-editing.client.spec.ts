import { describe, expect, it } from 'vitest'
import type { ComposerEditResult } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { runComposerStructuralCommand } from '../../src/markdown/structural-editing.ts'

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
