import { describe, expect, it } from 'vitest'
import { analyzePromptStructure } from '../../src/markdown/prompt-structure.ts'

describe('agent-native Composer helpers', () => {
  it('indexes agent prompt sections and missing guidance', () => {
    const result = analyzePromptStructure('## Goal\nFix it\n\n### Validation\n```bash\npnpm test\n```')
    expect(result.sections.map(section => section.name)).toEqual(['goal', 'validation'])
    expect(result.hasCodeFence).toBe(true)
    expect(result.missing).toContain('constraints')
  })
})
