import { describe, expect, it } from 'vitest'
import { diagnosticsFor } from '../../src/markdown/diagnostics.ts'

describe('authoring diagnostics', () => {
  it('reports only the three supported malformed forms', () => {
    expect(diagnosticsFor('```\nunclosed')).toEqual([
      expect.objectContaining({ className: 'dsh-better-composer-diagnostic-fence', layer: 'diagnostic' }),
    ])
    expect(diagnosticsFor('`unclosed')).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-diagnostic-inline-code', layer: 'diagnostic' }),
    ]))
    expect(diagnosticsFor('[label](https://')).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-diagnostic-link', layer: 'diagnostic' }),
    ]))
    expect(diagnosticsFor('```\n`inside code\n```')).toEqual([])
    expect(diagnosticsFor('plain text')).toEqual([])
  })

  it('ignores fence-like lines inside HTML blocks and indented code', () => {
    // The ``` inside an HTML block or a tab-indented code block is literal
    // text, not a fence opener: no unclosed-fence or inline-code diagnostic.
    expect(diagnosticsFor('<div>\n```\n</div>\n\ntail text')).toEqual([])
    expect(diagnosticsFor('text\n\n\t```\n\tcode')).toEqual([])
    expect(diagnosticsFor('<pre>\n`not-inline\n</pre>')).toEqual([])
  })
})
