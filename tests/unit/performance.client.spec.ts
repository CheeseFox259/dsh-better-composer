import { describe, expect, it } from 'vitest'
import { decorateViaPlan } from '../helpers/project-ranges.ts'

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
        proseRangeCount = decorateViaPlan({ draft: prose, nativeRanges: [] }).length
        proseTimes.push(performance.now() - proseStarted)

        const codeStarted = performance.now()
        codeRangeCount = decorateViaPlan({ draft: code, nativeRanges: [] }).length
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
      const context = (revision: number) => ({
        draft,
        nativeRanges: [],
        presentation: {
          focused: true,
          selectionStart: revision % draft.length,
          selectionEnd: revision % draft.length,
        },
      })
      decorateViaPlan(context(0))
      const times: number[] = []
      for (let sample = 0; sample < 60; sample += 1) {
        const started = performance.now()
        decorateViaPlan(context(sample + 1))
        times.push(performance.now() - started)
      }
      steady[size] = { hitP95: percentile95(times) }
    }
    console.log(`steady-collect-performance ${JSON.stringify(steady)}`)
    expect(Object.keys(steady)).toEqual(['1000', '10000', '50000'])
  }, 30_000)
})

function percentile95(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0
}
