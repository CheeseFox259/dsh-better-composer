// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type {
  ComposerEditResult, ComposerSurfaceExtension, ComposerSurfaceExtensionContext,
  ComposerSurfaceExtensionPresentation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { installComposerKeymap, type ComposerKeymapHooks } from '../../src/client/keys.ts'
import type { ArmedBreakContinuation } from '../../src/markdown/structural-editing.ts'

function install(overrides?: {
  readonly draft?: string
  readonly selection?: { start: number; end: number }
  readonly presentation?: ComposerSurfaceExtensionPresentation
  readonly enabled?: boolean
  readonly handleKey?: ComposerSurfaceExtension['handleKey']
}) {
  const input = document.createElement('div')
  input.contentEditable = 'true'
  document.body.appendChild(input)
  const draft = overrides?.draft ?? '- item'
  const context: ComposerSurfaceExtensionContext = {
    draft,
    draftRev: 1,
    selection: overrides?.selection ?? { start: draft.length, end: draft.length },
    nativeRanges: [],
    composing: false,
    triggerOwner: 'none',
    textSegments: [{ start: 0, end: draft.length, text: draft }],
  }
  const extension: ComposerSurfaceExtension = {
    id: 'test',
    present: () => undefined,
    handleKey: overrides?.handleKey,
  }
  const armed: (ArmedBreakContinuation | undefined)[] = []
  const applied: ComposerEditResult[] = []
  const hooks: ComposerKeymapHooks = {
    input: () => input,
    surfaceContext: () => context,
    presentation: () => overrides?.presentation,
    extension,
    apply: edit => {
      applied.push(edit)
      return true
    },
    noteBreakContinuation: value => {
      armed.push(value)
    },
    isEnabled: () => overrides?.enabled ?? true,
  }
  const dispose = installComposerKeymap(hooks)
  const keydown = (key: string, shift = false): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    return event
  }
  return {
    armed, applied, keydown,
    dispose: () => {
      dispose()
      input.remove()
    },
  }
}

describe('composer keymap break continuation', () => {
  it('arms a continuation on Shift+Enter without consuming the key', () => {
    const session = install()
    const event = session.keydown('Enter', true)
    expect(session.armed).toHaveLength(1)
    expect(session.armed[0]?.followUp).toEqual({ kind: 'insert-prefix', prefix: '- ' })
    expect(event.defaultPrevented).toBe(false)
    expect(session.applied).toHaveLength(0)
    session.dispose()
  })

  it('clears the intent on any other key', () => {
    const session = install()
    session.keydown('Enter', true)
    session.keydown('a')
    expect(session.armed).toEqual([expect.objectContaining({ followUp: expect.anything() }), undefined])
    session.dispose()
  })

  it('arms nothing while a completion popup owns the interaction', () => {
    const session = install({
      presentation: {
        revision: 1,
        popup: { revision: 1, from: 0, to: 1, candidates: [{ label: 'x', insertText: 'x' }], selectedIndex: 0 },
        diagnostics: [],
      },
    })
    session.keydown('Enter', true)
    expect(session.armed).toEqual([undefined])
    session.dispose()
  })

  it('arms nothing while disabled', () => {
    const session = install({ enabled: false })
    session.keydown('Enter', true)
    expect(session.armed).toHaveLength(0)
    session.dispose()
  })

  it('arms nothing on plain Enter, leaving submit with the host', () => {
    const session = install()
    const event = session.keydown('Enter')
    expect(session.armed).toEqual([undefined])
    expect(event.defaultPrevented).toBe(false)
    session.dispose()
  })

  it('still consumes Tab for list indentation', () => {
    const session = install()
    const event = session.keydown('Tab')
    expect(event.defaultPrevented).toBe(true)
    expect(session.applied).toHaveLength(1)
    session.dispose()
  })
})
