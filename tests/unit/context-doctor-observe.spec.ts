/**
 * W1 tests: live mount observation and current-mode metadata.
 * Pins A13/§11.1: mounts are enumerated inside one runtime root, a live mount
 * fingerprint is a composition signature (never a persisted configuration
 * version), and missing registry capabilities degrade instead of guessing.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  fingerprintMountTree,
  mountObservationToVersionRef,
  observeCurrentModes,
  observeStandingMount,
} from '../../src/doctor/host/observe.ts'

describe('observeCurrentModes', () => {
  it('reads declared presets with their activation diagnostics', async () => {
    const registry = {
      async list() {
        return [
          { id: 'minimal', name: 'Minimal' },
          { id: 'broken-mode', broken: 'activation failed' },
        ]
      },
    }
    const observed = await observeCurrentModes(registry)
    expect(observed.available).toBe(true)
    expect(observed.modes.map((mode) => mode.id)).toEqual(['minimal', 'broken-mode'])
    expect(observed.modes.find((mode) => mode.id === 'broken-mode')!.broken).toBe('activation failed')
  })

  it('degrades when the registry capability is absent (AT35)', async () => {
    const observed = await observeCurrentModes(undefined)
    expect(observed.available).toBe(false)
    expect(observed.reason).toBeDefined()
    expect(observed.modes).toEqual([])
  })
})

describe('fingerprintMountTree', () => {
  function fakeMount(rows: readonly unknown[]) {
    return {
      presetId: 'standard',
      key: 'scope-key-1',
      tree: { entries: () => rows },
    } as never
  }

  it('content-addresses the live composition rows (composition signature)', () => {
    const rows = [
      { options: { id: 'compaction-basic', name: 'basic' }, fiber: { state: 4 } },
      { options: { id: 'command-compact', name: 'compact' }, fiber: { state: 4 } },
    ]
    const digest = fingerprintMountTree(fakeMount(rows))
    expect(digest).toBe(fingerprintMountTree(fakeMount(rows)))
    expect(digest).not.toBe(fingerprintMountTree(fakeMount([...rows, { options: { id: 'extra', disabled: true } }])))
  })

  it('produces a partial runtime-config VersionRef naming its binding evidence', () => {
    const version = mountObservationToVersionRef('standard', 'digest-xyz', 'scope-key-1')
    expect(version.kind).toBe('runtime-config')
    expect(version.digest).toBe('digest-xyz')
    expect(version.coverage).toBe('partial')
    expect(version.observedBinding).toBe('scope-key-1')
  })
})

describe('observeStandingMount', () => {
  it('returns undefined for a context that joined no preset instead of throwing', () => {
    expect(observeStandingMount({} as Context)).toBeUndefined()
  })
})
