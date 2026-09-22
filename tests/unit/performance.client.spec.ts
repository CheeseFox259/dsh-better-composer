import { describe, expect, it } from 'vitest'
import { createMarkdownProvider } from '../../src/markdown/provider.ts'
import { detectLongInsertion } from '../../src/client/paste-watch.ts'

describe('projection performance budget', () => {
  it('records prose and code-heavy timings at every M7 workload size', () => {
    const timings: Record<number, {
      proseP95: number
      codeP95: number
      proseRanges: number
      codeRanges: number
    }> = {}
    for (const size of [1_000, 10_000, 50_000, 100_000]) {
      const prose = `# ${'x'.repeat(size - 3)}`
      const codePrefix = '\`\`\`ts\n'
      const codeSuffix = '\n\`\`\`'
      const codeBody = 'const value = 1\n'.repeat(Math.ceil(size / 16)).slice(0, Math.max(0, size - codePrefix.length - codeSuffix.length))
      const code = `${codePrefix}${codeBody}${codeSuffix}`

      const proseTimes: number[] = []
      const codeTimes: number[] = []
      let proseRangeCount = 0
      let codeRangeCount = 0
      for (let sample = 0; sample < 20; sample += 1) {
        const proseStarted = performance.now()
        proseRangeCount = createMarkdownProvider().decorate({ sessionId: `perf-prose-${size}-${sample}` as never, draft: prose, draftRev: sample, nativeRanges: [] }).length
        proseTimes.push(performance.now() - proseStarted)

        const codeStarted = performance.now()
        codeRangeCount = createMarkdownProvider().decorate({ sessionId: `perf-code-${size}-${sample}` as never, draft: code, draftRev: sample, nativeRanges: [] }).length
        codeTimes.push(performance.now() - codeStarted)
      }
      timings[size] = {
        proseP95: percentile95(proseTimes),
        codeP95: percentile95(codeTimes),
        proseRanges: proseRangeCount,
        codeRanges: codeRangeCount,
      }
    }
    console.log(`projection-performance ${JSON.stringify(timings)}`)
    expect(Object.keys(timings)).toEqual(['1000', '10000', '50000', '100000'])
  })

  it('records the steady-state collect: one provider, unchanged text, cursor-move collects', () => {
    const steady: Record<number, { hitP95: number }> = {}
    for (const size of [1_000, 10_000, 50_000]) {
      const draft = `## Section\n\n${'body text with *emphasis* and \`code\` spans.\n\n'.repeat(Math.ceil(size / 48))}`
      const provider = createMarkdownProvider()
      const context = (revision: number) => ({
        sessionId: 'perf-steady' as never,
        draft,
        draftRev: revision,
        nativeRanges: [],
        presentation: {
          focused: true,
          selectionStart: revision % draft.length,
          selectionEnd: revision % draft.length,
          activeLineStart: 0,
          activeLineEnd: draft.length,
        },
      })
      provider.decorate(context(0))
      const times: number[] = []
      for (let sample = 0; sample < 60; sample += 1) {
        const started = performance.now()
        provider.decorate(context(sample + 1))
        times.push(performance.now() - started)
      }
      steady[size] = { hitP95: percentile95(times) }
    }
    console.log(`steady-collect-performance ${JSON.stringify(steady)}`)
    expect(Object.keys(steady)).toEqual(['1000', '10000', '50000'])
  }, 30_000)

  it('records paste-detection cost at workload sizes', () => {
    const payload = 'const value = 1\n'.repeat(4000)
    const previous = 'before\n\nafter'
    const next = `before\n${payload}\nafter`
    const started = performance.now()
    for (let sample = 0; sample < 200; sample += 1) {
      detectLongInsertion(previous, next, 4000)
    }
    const elapsed = (performance.now() - started) / 200
    console.log(`paste-detection ${JSON.stringify({ avgMs: elapsed })}`)
    expect(elapsed).toBeLessThan(5)
  })
})

function percentile95(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0
}
