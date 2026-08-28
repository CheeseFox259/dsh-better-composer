import { describe, expect, it } from 'vitest'
import { createMarkdownProvider } from '../../src/markdown/provider.ts'

describe('projection performance budget', () => {
  it('records the 1k/10k/50k draft timings without asserting a machine-specific threshold', () => {
    const provider = createMarkdownProvider()
    const timings: Record<number, number> = {}
    for (const size of [1_000, 10_000, 50_000]) {
      const draft = `# ${'x'.repeat(size - 3)}`
      const started = performance.now()
      provider.decorate({ sessionId: 'perf' as never, draft, draftRev: 1, nativeRanges: [] })
      timings[size] = performance.now() - started
    }
    console.log(`projection-performance ${JSON.stringify(timings)}`)
    expect(Object.keys(timings)).toEqual(['1000', '10000', '50000'])
  })
})
