import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompletionPopup, EditorSurface } from '../../src/client/editor.tsx'
import { markdownCompletion } from '../../src/markdown/completion.ts'
import { decorateViaPlan } from '../helpers/project-ranges.ts'

function oversizedStructuredDraft(): string {
  return `## Task\nrun\n\`\`\`ts\n${'const value = 1\n'.repeat(4_000)}\`\`\``
}

describe('M7 bounded optional presentation', () => {
  it('fails open instead of synchronously projecting an oversized draft', () => {
    const draft = oversizedStructuredDraft()

    expect(draft.length).toBeGreaterThan(50_000)
    expect(decorateViaPlan({ draft, nativeRanges: [] })).toEqual([])
  })

  it('suppresses completion when fence ownership cannot be established within the bound', () => {
    const draft = `${'ordinary text\n'.repeat(4_000)}## Val`

    expect(markdownCompletion({
      draft,
      draftRev: 3,
      selection: { start: draft.length, end: draft.length },
      nativeRanges: [],
      composing: false,
      triggerOwner: 'none',
    })).toBeUndefined()
  })
})

describe('M7 accessible presentation', () => {
  it('exposes the active completion option as polite status', () => {
    const html = renderToStaticMarkup(<div>
      <CompletionPopup
        popup={{
          revision: 4,
          from: 3,
          to: 3,
          candidates: [{ label: 'ts', insertText: 'ts' }],
          selectedIndex: 0,
        }}
        top={20}
        left={8}
        activeOptionId="dsh-better-composer-completion-option-4-0"
      />
    </div>)

    expect(html).toContain('role="listbox"')
    expect(html).toContain('aria-activedescendant="dsh-better-composer-completion-option-4-0"')
    expect(html).toContain('id="dsh-better-composer-completion-option-4-0"')
  })
})
