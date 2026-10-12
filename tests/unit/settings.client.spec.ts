import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, normalizeSettings,
  type BetterComposerSettings,
} from '../../src/settings.ts'
import { Config } from '../../src/index.ts'
import { BetterComposerSettingsStore } from '../../src/client/settings-store.ts'
import { createEnabledActions } from '../../src/commands/actions.ts'
import { project } from '../../src/decoration/index.ts'

describe('Better Composer settings', () => {
  it('exports the canonical existing plugin schema', () => {
    expect(Config({} as never)).toEqual(DEFAULT_SETTINGS)
  })

  it('fills settings from the product defaults', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ enabled: false, toolbarMode: 'hidden' })).toEqual({
      enabled: false,
      markdownVisual: true,
      inactiveMarkerDisplay: 'hide',
      toolbarMode: 'hidden',
      pasteClipThreshold: 4000,
    })
  })

  it('keeps invalid persisted values at their safe defaults', () => {
    expect(normalizeSettings({ enabled: 'false', markdownVisual: 0, inactiveMarkerDisplay: 'glow', toolbarMode: 'wide', pasteFileExtension: '.exe' })).toEqual(DEFAULT_SETTINGS)
  })

  it('tracks the scope, writes fields, and stops after disposal', async () => {
    let value: unknown = { ...DEFAULT_SETTINGS }
    const listeners = new Set<() => void>()
    const set = async (field: string, next: unknown): Promise<void> => {
      value = { ...(value as object), [field]: next }
      for (const listener of listeners) listener()
    }
    const scope = {
      getSnapshot: () => ({ value }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set,
      unset: async () => {},
    } as never
    const store = new BetterComposerSettingsStore(scope)
    let updates = 0
    const off = store.subscribe(() => { updates += 1 })
    await store.set('inactiveMarkerDisplay', 'fade')
    expect(store.get()).toMatchObject({ inactiveMarkerDisplay: 'fade' })
    expect(updates).toBe(1)
    await store.set('markdownVisual', false)
    expect(store.get()).toMatchObject({ markdownVisual: false })
    expect(updates).toBe(2)
    await store.set('pasteClipThreshold', 1000)
    expect(store.get()).toMatchObject({ pasteClipThreshold: 1000 })
    expect(updates).toBe(3)
    off()
    store.dispose()
    await set('inactiveMarkerDisplay', 'hide')
    expect(updates).toBe(3)
  })

  it('keeps the last accepted snapshot when a Settings write fails', async () => {
    const scope = {
      getSnapshot: () => ({ value: { ...DEFAULT_SETTINGS } }),
      subscribe: () => () => {},
      set: async () => { throw new Error('settings unavailable') },
      unset: async () => {},
    } as never
    const store = new BetterComposerSettingsStore(scope)

    await expect(store.set('markdownVisual', false)).rejects.toThrow('settings unavailable')
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    store.dispose()
  })

  it('makes actions inert while the plugin is disabled', () => {
    const actions = createEnabledActions(() => false)
    const action = actions.find(candidate => candidate.id === 'strong')!
    expect(action.transform({ draft: 'x', draftRev: 1, selection: { start: 0, end: 1 }, nativeRanges: [] })).toBeUndefined()
  })

  it('keeps printable pairing and diagnostic presentation out of the action registry', () => {
    expect(createEnabledActions(() => true).filter(action => action.input !== undefined)).toEqual([])
    expect(createEnabledActions(() => true).map(action => action.id)).not.toEqual(expect.arrayContaining([
      expect.stringContaining('locate:'),
    ]))
  })

  it('keeps the legacy toolbarMode field schema-compatible without a toolbar consumer', () => {
    expect(normalizeSettings({ toolbarMode: 'hidden' })).toEqual({ ...DEFAULT_SETTINGS, toolbarMode: 'hidden' })
  })

  it('separates the visual toggle from the projection in the provider', () => {
    const draft = '# x\n`bad'
    const planVisual = project(draft, { start: 0, end: 0, focused: false }, [], { markdownVisual: true })
    expect(planVisual.lines[0]?.signature).toContain('dsh-better-composer-heading')
    expect(planVisual.inlines.length).toBeGreaterThan(0)

    const planDisabled = project(draft, { start: 0, end: 0, focused: false }, [], { markdownVisual: false })
    expect(planDisabled.inlines).toEqual([])
    expect(planDisabled.lines.every(l => l.signature === '')).toBe(true)
  })
})
