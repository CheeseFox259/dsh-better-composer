/**
 * W1 pure-rule tests: observed version fingerprints and mode sample grouping.
 * Fixtures only — no host runtime.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  requestHeaderEvent,
  systemMessageEvent,
  userMessageEvent,
  assistantMessageEvent,
} from '../helpers/doctor-events.ts'
import {
  contentHash,
  fingerprintEvents,
  modeSampleGroupKey,
} from '../../src/doctor/versions.ts'

function headerWithTools(tools: readonly { name: string; description: string }[]) {
  return requestHeaderEvent(9, {
    config: { provider: 'fixture', model: 'fixture-small' },
    tools: tools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: { type: 'object', properties: {} } },
    })),
  }, 'initial')
}

describe('contentHash', () => {
  it('is deterministic, content-addressed, and marks its method version', () => {
    const a = contentHash('same text')
    const b = contentHash('same text')
    const c = contentHash('other text')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.startsWith('v1.')).toBe(true)
  })
})

describe('fingerprintEvents', () => {
  it('hashes the latest request header tools, system head, and model route', () => {
    const base: SessionEvent[] = [
      systemMessageEvent(0, 0, 0, 'You are helpful.'),
      userMessageEvent(1, 0, 'do the thing'),
      assistantMessageEvent(2, 0, 0, 'done'),
      headerWithTools([{ name: 'read_file', description: 'Read a file' }]),
    ]

    const first = fingerprintEvents(base)
    expect(first.gaps).toEqual([])
    expect(first.parts.toolDefinitions).toBeDefined()
    expect(first.parts.systemHead).toBeDefined()
    expect(first.parts.modelRoute).toBeDefined()

    // Same visible capabilities → same fingerprint.
    const again = fingerprintEvents(base)
    expect(first.digest).toBe(again.digest)

    // A visible capability change changes the fingerprint.
    const changedTools: SessionEvent[] = [
      ...base.slice(0, 3),
      headerWithTools([{ name: 'read_file', description: 'Read a file' }, { name: 'run_shell', description: 'Run a shell command' }]),
    ]
    expect(fingerprintEvents(changedTools).digest).not.toBe(first.digest)

    // A rendered system prompt change changes the fingerprint.
    const changedSystem: SessionEvent[] = [
      systemMessageEvent(0, 0, 0, 'You are terse.'),
      ...base.slice(1),
    ]
    expect(fingerprintEvents(changedSystem).digest).not.toBe(first.digest)
  })

  it('records coverage gaps instead of inventing observations (AT35 degrade)', () => {
    // No request/header in the prefix: tool exposure was never observable.
    const noHeader: SessionEvent[] = [
      systemMessageEvent(0, 0, 0, 'sys'),
      userMessageEvent(1, 0, 'hi'),
      assistantMessageEvent(2, 0, 0, 'hello'),
    ]
    const fingerprint = fingerprintEvents(noHeader)
    expect(fingerprint.parts.toolDefinitions).toBeUndefined()
    expect(fingerprint.gaps).toContain('request-header-missing')
    // The fingerprint still exists — it just covers less.
    expect(fingerprint.digest.length).toBeGreaterThan(0)
  })
})

describe('modeSampleGroupKey', () => {
  it('groups by mode id plus observed fingerprint; historical configuration stays unknown (AT13, AT14)', () => {
    const events: SessionEvent[] = [headerWithTools([{ name: 'a', description: 'A' }])]
    const fingerprint = fingerprintEvents(events)

    const key = modeSampleGroupKey('minimal', fingerprint)
    expect(key).toContain('minimal')
    expect(key).toContain('unknown')

    // Same mode + same observed capabilities group together.
    expect(modeSampleGroupKey('minimal', fingerprintEvents(events))).toBe(key)

    // Same mode, different observed capabilities → distinct group.
    const other = fingerprintEvents([
      headerWithTools([{ name: 'b', description: 'B' }]),
    ])
    expect(modeSampleGroupKey('minimal', other)).not.toBe(key)
  })
})
