import { describe, expect, it } from 'vitest'
import { diagnosticsFor } from '../../src/markdown/diagnostics.ts'

describe('authoring diagnostics', () => {
  it('reports only the three supported malformed forms', () => {
    expect(diagnosticsFor('```\nunclosed')).toEqual([
      expect.objectContaining({ className: 'dsh-rich-editor-diagnostic-fence', layer: 'diagnostic' }),
    ])
    expect(diagnosticsFor('`unclosed')).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-rich-editor-diagnostic-inline-code', layer: 'diagnostic' }),
    ]))
    expect(diagnosticsFor('[label](https://')).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-rich-editor-diagnostic-link', layer: 'diagnostic' }),
    ]))
    expect(diagnosticsFor('```\n`inside code\n```')).toEqual([])
    expect(diagnosticsFor('plain text')).toEqual([])
  })
})
