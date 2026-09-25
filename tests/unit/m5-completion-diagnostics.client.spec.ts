import { describe, expect, it } from 'vitest'
import { createEnabledActions } from '../../src/commands/actions.ts'
import { createMarkdownSurfaceExtension } from '../../src/client/surface-extension.ts'
import { DEFAULT_SETTINGS } from '../../src/settings.ts'
import { createMarkdownProvider } from '../../src/markdown/provider.ts'

describe('M5 deterministic completion and diagnostics', () => {
  it('does not register printable Markdown input actions that compete with M4 pairing', () => {
    const actions = createEnabledActions(() => true, () => true)

    expect(actions.filter(action => action.input !== undefined)).toEqual([])
  })

  it('projects a deterministic fence-language popup without changing source', async () => {
    const completionModule = await import('../../src/markdown/completion.ts')
    const markdownCompletion = Reflect.get(completionModule, 'markdownCompletion')
    expect(markdownCompletion).toEqual(expect.any(Function))
    if (typeof markdownCompletion !== 'function') return

    const state = markdownCompletion({
      draft: '```',
      draftRev: 7,
      selection: { start: 3, end: 3 },
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none',
    })

    expect(state).toEqual(expect.objectContaining({ revision: 7, kind: 'popup', from: 3, to: 3 }))
    expect(state.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'ts', insertText: 'ts' }),
      expect.objectContaining({ label: 'bash', insertText: 'bash' }),
      expect.objectContaining({ label: 'json', insertText: 'json' }),
      expect.objectContaining({ label: 'python', insertText: 'python' }),
    ]))

    expect(markdownCompletion({
      draft: '```ts',
      draftRev: 8,
      selection: { start: 5, end: 5 },
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none',
    })).toBeUndefined()

    expect(markdownCompletion({
      draft: '```\nbody\n```',
      draftRev: 9,
      selection: { start: 12, end: 12 },
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none',
    })).toBeUndefined()

    expect(markdownCompletion({
      draft: 'prefix\n```',
      draftRev: 10,
      selection: { start: 10, end: 10 },
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none',
    })).toEqual(expect.objectContaining({ from: 10, to: 10 }))
  })

  it('does not render a passive completion for a bare heading marker', async () => {
    const completionModule = await import('../../src/markdown/completion.ts')
    const markdownCompletion = Reflect.get(completionModule, 'markdownCompletion')
    expect(markdownCompletion).toEqual(expect.any(Function))
    if (typeof markdownCompletion !== 'function') return

    expect(markdownCompletion({
      draft: '#',
      draftRev: 12,
      selection: { start: 1, end: 1 },
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none',
    })).toBeUndefined()
  })

  it('projects a revision-bound deterministic ghost without owning source', async () => {
    const completionModule = await import('../../src/markdown/completion.ts')
    const markdownCompletion = Reflect.get(completionModule, 'markdownCompletion')
    expect(markdownCompletion).toEqual(expect.any(Function))
    if (typeof markdownCompletion !== 'function') return

    const state = markdownCompletion({
      draft: '## Val',
      draftRev: 9,
      selection: { start: 6, end: 6 },
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none',
    })

    expect(state).toEqual(expect.objectContaining({
      revision: 9,
      kind: 'ghost',
      from: 6,
      to: 6,
      insertText: 'idation',
      label: 'Validation',
    }))
  })

  it('suppresses Markdown completion while IME or native trigger ownership is active', async () => {
    const completionModule = await import('../../src/markdown/completion.ts')
    const markdownCompletion = Reflect.get(completionModule, 'markdownCompletion')
    expect(markdownCompletion).toEqual(expect.any(Function))
    if (typeof markdownCompletion !== 'function') return

    const base = {
      draft: '## Val',
      draftRev: 11,
      selection: { start: 6, end: 6 },
      nativeRanges: [],
    }
    expect(markdownCompletion({ ...base, composing: true, triggerOwner: 'none' })).toBeUndefined()
    expect(markdownCompletion({ ...base, composing: false, triggerOwner: 'at' })).toBeUndefined()
    expect(markdownCompletion({ ...base, composing: false, triggerOwner: 'slash' })).toBeUndefined()
  })

  it('scans each authoritative text segment independently across a Context Object barrier', async () => {
    const diagnosticsModule = await import('../../src/markdown/diagnostics.ts')
    const diagnosticsForSegments = Reflect.get(diagnosticsModule, 'diagnosticsForSegments')
    expect(diagnosticsForSegments).toEqual(expect.any(Function))
    if (typeof diagnosticsForSegments !== 'function') return

    const diagnostics = diagnosticsForSegments({
      draftRev: 13,
      segments: [
        { sourceStart: 0, text: '😀``' },
        { sourceStart: 6, text: '`' },
      ],
    })

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ start: 2, end: 4, layer: 'diagnostic' }),
      expect.objectContaining({ start: 6, end: 7, layer: 'diagnostic' }),
    ]))
  })

  it('reports incomplete inline-code and explicit-link diagnostics with translated UTF-16 ranges', async () => {
    const diagnosticsModule = await import('../../src/markdown/diagnostics.ts')
    const diagnosticsForSegments = Reflect.get(diagnosticsModule, 'diagnosticsForSegments')
    expect(diagnosticsForSegments).toEqual(expect.any(Function))
    if (typeof diagnosticsForSegments !== 'function') return

    const diagnostics = diagnosticsForSegments({
      draftRev: 14,
      segments: [
        { sourceStart: 2, text: 'inline `code' },
        { sourceStart: 20, text: '[label](url' },
      ],
    })

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        start: 9,
        end: 10,
        className: 'dsh-better-composer-diagnostic-inline-code',
        layer: 'diagnostic',
      }),
      expect.objectContaining({
        start: 20,
        end: 31,
        className: 'dsh-better-composer-diagnostic-link',
        layer: 'diagnostic',
      }),
    ]))
  })

  it('rejects stale completion acceptance before calling the Core transaction bridge', async () => {
    const completionModule = await import('../../src/markdown/completion.ts')
    const acceptMarkdownCompletion = Reflect.get(completionModule, 'acceptMarkdownCompletion')
    expect(acceptMarkdownCompletion).toEqual(expect.any(Function))
    if (typeof acceptMarkdownCompletion !== 'function') return

    let dispatches = 0
    const result = acceptMarkdownCompletion({
      completion: { revision: 17, from: 6, to: 6, insertText: 'idation' },
      snapshot: { draftRev: 18 },
      apply: () => { dispatches += 1 },
    })

    expect(result).toEqual({ accepted: false, reason: 'stale' })
    expect(dispatches).toBe(0)
  })

  it('accepts one popup candidate through the bridge callback and fail-opens when the presentation is stale', () => {
    const settings = { get: () => DEFAULT_SETTINGS } as never
    const extension = createMarkdownSurfaceExtension(settings)
    const context = {
      draft: '```',
      draftRev: 21,
      selection: { start: 3, end: 3 },
      textSegments: [{ start: 0, end: 3, text: '```' }],
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none' as const,
    }
    const presentation = extension.present(context)
    expect(presentation?.popup?.candidates.length).toBeGreaterThan(0)
    if (presentation === undefined || presentation.popup === undefined) return

    const edits: unknown[] = []
    expect(extension.handleKey?.({
      key: 'tab', shift: false, context, presentation,
      apply: (edit) => { edits.push(edit); return true },
    })).toBe('consumed')
    expect(edits).toEqual([expect.objectContaining({ start: 3, end: 3, text: 'bash' })])

    const staleContext = { ...context, draftRev: 22 }
    expect(extension.handleKey?.({
      key: 'tab', shift: false, context: staleContext, presentation,
      apply: () => { edits.push('stale'); return true },
    })).toBe('pass')
    expect(edits).not.toContain('stale')
  })

  it('dismisses the active completion presentation on Escape without editing source', () => {
    const settings = { get: () => DEFAULT_SETTINGS } as never
    const extension = createMarkdownSurfaceExtension(settings)
    const context = {
      draft: '## Val',
      draftRev: 24,
      selection: { start: 6, end: 6 },
      textSegments: [{ start: 0, end: 6, text: '## Val' }],
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none' as const,
    }
    const presentation = extension.present(context)
    expect(presentation?.ghost?.insertText).toBe('idation')
    if (presentation === undefined) return

    expect(extension.handleKey?.({
      key: 'escape', shift: false, context, presentation,
      apply: () => { throw new Error('Escape must not edit source') },
    })).toBe('consumed')
    expect(extension.present(context)?.ghost).toBeUndefined()
  })

  it('passes popup Enter through instead of accepting the passive first candidate', () => {
    const settings = { get: () => DEFAULT_SETTINGS } as never
    const extension = createMarkdownSurfaceExtension(settings)
    const context = {
      draft: '```',
      draftRev: 25,
      selection: { start: 3, end: 3 },
      textSegments: [{ start: 0, end: 3, text: '```' }],
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none' as const,
    }
    const presentation = extension.present(context)
    expect(presentation?.popup).toBeDefined()
    expect(extension.handleKey?.({
      key: 'enter', shift: false, context, presentation: presentation!,
      apply: () => { throw new Error('Enter must remain native') },
    })).toBe('pass')
  })

  it('keeps Markdown parsing local to Core text segments', () => {
    const provider = createMarkdownProvider(() => DEFAULT_SETTINGS)
    const draft = '**ab**'
    const ranges = provider.decorate({
      sessionId: 's' as never,
      draft,
      draftRev: 23,
      nativeRanges: [],
      textSegments: [
        { start: 0, end: 3, text: '**a' },
        { start: 3, end: draft.length, text: 'b**' },
      ],
      presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: draft.length },
    })
    expect(ranges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-strong' }),
    ]))
  })
})
