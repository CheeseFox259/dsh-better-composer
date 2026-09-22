import { describe, expect, it } from 'vitest'
import { detectLongInsertion } from '../../src/client/paste-watch.ts'

const LONG = 'const answer = 42\n'.repeat(300)

describe('long-paste detection', () => {
  it('reports the inserted span for a middle paste', () => {
    const previous = 'before\n\nafter'
    const next = `before\n${LONG}\nafter`
    const detection = detectLongInsertion(previous, next, 4000)

    expect(detection).toEqual({
      start: 'before\n'.length,
      end: 'before\n'.length + LONG.length,
      text: LONG,
    })
  })

  it('ignores small insertions and shrink edits', () => {
    expect(detectLongInsertion('', 'short text', 4000)).toBeUndefined()
    expect(detectLongInsertion(LONG, 'x', 4000)).toBeUndefined()
    expect(detectLongInsertion('ab', `a${LONG}b`, LONG.length + 1)).toBeUndefined()
  })

  it('handles prefix/suffix overlap without crossing', () => {
    const previous = 'aaabbb'
    const next = `aaa${LONG}bbb`
    const detection = detectLongInsertion(previous, next, 100)

    expect(detection?.text).toBe(LONG)
    expect(detection?.start).toBe(3)
    expect(detection?.end).toBe(3 + LONG.length)
  })

  it('disables detection at a zero threshold and rejects disabled settings', () => {
    expect(detectLongInsertion('', LONG, 0)).toBeUndefined()
  })
})
