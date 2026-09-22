import { describe, expect, it } from 'vitest'
import { createMarkdownSurfaceExtension } from '../../src/client/surface-extension.ts'
import {
  deterministicAssistanceForSegments,
  type DeterministicAssistanceSegment,
} from '../../src/markdown/assistance.ts'
import { DEFAULT_SETTINGS, type BetterComposerSettings } from '../../src/settings.ts'

const source = '## Task\nrun\n```bash\npnpm test\n```'

describe('M6 deterministic assistance', () => {
  it('assistance rule emits one fixed Validation hint for a high-confidence structure', () => {
    expect(deterministicAssistanceForSegments({
      draftRev: 31,
      segments: [{ sourceStart: 0, text: source }],
    })).toEqual([{
      revision: 31,
      kind: 'validation-section',
      start: source.length,
      end: source.length,
      message: '已检测到代码块，可检查是否需要“Validation”区段。',
    }])
  })

  it('rejects speculative coaching and cross-Context Object structure', () => {
    const ordinary = deterministicAssistanceForSegments({
      draftRev: 32,
      segments: [{ sourceStart: 0, text: 'Fix the parser' }],
    })
    const validated = deterministicAssistanceForSegments({
      draftRev: 33,
      segments: [{ sourceStart: 0, text: `${source}\n## Validation\nchecked` }],
    })
    const splitAcrossObject = deterministicAssistanceForSegments({
      draftRev: 34,
      segments: [
        { sourceStart: 0, text: '## Task\nrun\n' },
        { sourceStart: 20, text: '```bash\npnpm test\n```' },
      ],
    })

    expect(ordinary).toEqual([])
    expect(validated).toEqual([])
    expect(splitAcrossObject).toEqual([])
  })

  it('uses source UTF-16 offsets for CJK, emoji, and CRLF without normalizing the text', () => {
    const prefix = '😀 任务\r\n'
    const segment = [prefix.slice(0, -2), '## Task', 'run', '```bash', 'pnpm test', '```'].join('\r\n')
    const segments: readonly DeterministicAssistanceSegment[] = [{ sourceStart: 4, text: segment }]

    expect(deterministicAssistanceForSegments({ draftRev: 35, segments })).toEqual([expect.objectContaining({
      revision: 35,
      start: 4 + segment.length,
      end: 4 + segment.length,
    })])
    expect(segment).toContain('\r\n')
    expect(segment.length).toBeGreaterThan(segment.replaceAll('\r\n', '\n').length)
  })

  it('connects the opt-in hint to the existing surface without editing or handling its keys', () => {
    let current: BetterComposerSettings = { ...DEFAULT_SETTINGS, deterministicAssistance: true }
    const settings = { get: () => current } as never
    const extension = createMarkdownSurfaceExtension(settings)
    const context = {
      draft: source,
      draftRev: 36,
      selection: { start: source.length, end: source.length },
      textSegments: [{ start: 0, end: source.length, text: source }],
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none' as const,
    }
    const presentation = extension.present(context)
    let applies = 0

    expect(presentation?.hints).toEqual([expect.objectContaining({ revision: 36, kind: 'validation-section' })])
    expect(extension.handleKey?.({
      key: 'tab', shift: false, context, presentation: presentation!,
      apply: () => { applies += 1; return true },
    })).toBe('pass')
    expect(applies).toBe(0)

    current = { ...current, deterministicAssistance: false }
    expect(extension.present(context)).toBeUndefined()
    expect(context.draft).toBe(source)
  })

  it('does not retain a hint from a stale revision', () => {
    const settings = { get: () => ({ ...DEFAULT_SETTINGS, deterministicAssistance: true }) } as never
    const extension = createMarkdownSurfaceExtension(settings)
    const first = {
      draft: source,
      draftRev: 37,
      selection: { start: source.length, end: source.length },
      textSegments: [{ start: 0, end: source.length, text: source }],
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none' as const,
    }
    const stale = extension.present(first)
    const nextDraft = '## Task\nrun'
    const next = extension.present({
      ...first,
      draft: nextDraft,
      draftRev: 38,
      selection: { start: nextDraft.length, end: nextDraft.length },
      textSegments: [{ start: 0, end: nextDraft.length, text: nextDraft }],
    })

    expect(stale?.hints?.[0]?.revision).toBe(37)
    expect(next).toBeUndefined()
  })
})
