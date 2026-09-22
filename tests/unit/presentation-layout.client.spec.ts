import { describe, expect, it } from 'vitest'
import type { ComposerTextSegment } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  codeCopyBlocksForSegments, codeFenceLanguageEdit, tableColumnWidths, tableLayoutsForSegments,
} from '../../src/client/presentation-layout.ts'

describe('Better Composer presentation layout', () => {
  it('derives one shared UTF-16-independent column model from all table rows', () => {
    const source = '| Project name | 值 |\n| --- | --- |\n| A | 1 |'
    expect(tableColumnWidths(source)).toEqual([14, 6])
  })

  it('projects table layouts and code copy text per Context Object-separated segment', () => {
    const segments: readonly ComposerTextSegment[] = [{
      start: 0,
      text: '| Name | Value |\n| --- | --- |\n| A | 1 |\n```js\nconsole.log(1)\n```',
    }]
    const tables = tableLayoutsForSegments(segments)
    const code = codeCopyBlocksForSegments(segments)

    expect(tables).toEqual([expect.objectContaining({ start: 0, end: 40, columnWidths: [6, 7] })])
    expect(tables[0]?.rows).toEqual([
      expect.objectContaining({ cells: ['Name', 'Value'], header: true }),
      expect.objectContaining({ cells: ['A', '1'], header: false }),
    ])
    expect(code).toEqual([expect.objectContaining({ language: 'js', copyText: 'console.log(1)' })])
  })

  it('builds one revision-aware source edit for the fenced-code language token', () => {
    const source = '```js\nconsole.log(1)\n```'
    const [block] = codeCopyBlocksForSegments([{ start: 0, text: source }])

    expect(block).toEqual(expect.objectContaining({
      language: 'js',
      languageStart: 3,
      languageEnd: 5,
    }))
    expect(codeFenceLanguageEdit(block!, 'python')).toEqual({
      start: 3,
      end: 5,
      text: 'python',
      selectionStart: 9,
      selectionEnd: 9,
    })
  })
})
