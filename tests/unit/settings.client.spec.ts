import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, normalizeSettings,
  type BetterComposerSettings,
} from '../../src/settings.ts'
import { Config } from '../../src/index.ts'
import { BetterComposerSettingsStore } from '../../src/client/settings-store.ts'
import { createEnabledActions } from '../../src/commands/actions.ts'
import { createMarkdownProvider } from '../../src/markdown/provider.ts'

describe('Better Composer settings', () => {
  it('exports the canonical existing plugin schema', () => {
    expect(Config({} as never)).toEqual(DEFAULT_SETTINGS)
  })

  it('fills settings from the product defaults', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ enabled: false, toolbarMode: 'hidden' })).toEqual({
      enabled: false,
      markdownVisual: true,
      diagnostics: true,
      toolbarMode: 'hidden',
      deterministicAssistance: false,
      pasteClipThreshold: 4000,
    })
  })

  it('keeps invalid persisted values at their safe defaults', () => {
    expect(normalizeSettings({ enabled: 'false', markdownVisual: 0, diagnostics: null, toolbarMode: 'wide' })).toEqual(DEFAULT_SETTINGS)
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
    await store.set('diagnostics', false)
    expect(store.get()).toMatchObject({ diagnostics: false })
    expect(updates).toBe(1)
    await store.set('deterministicAssistance', true)
    expect(store.get()).toMatchObject({ deterministicAssistance: true })
    expect(updates).toBe(2)
    off()
    store.dispose()
    await set('diagnostics', true)
    expect(updates).toBe(2)
  })

  it('keeps the last accepted snapshot when a Settings write fails', async () => {
    const scope = {
      getSnapshot: () => ({ value: { ...DEFAULT_SETTINGS } }),
      subscribe: () => () => {},
      set: async () => { throw new Error('settings unavailable') },
      unset: async () => {},
    } as never
    const store = new BetterComposerSettingsStore(scope)

    await expect(store.set('deterministicAssistance', true)).rejects.toThrow('settings unavailable')
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

  it('keeps deterministic assistance opt-in and independent from Markdown diagnostics', () => {
    expect(DEFAULT_SETTINGS.deterministicAssistance).toBe(false)
    expect(normalizeSettings({ deterministicAssistance: true })).toEqual({
      ...DEFAULT_SETTINGS,
      deterministicAssistance: true,
    })
    expect(normalizeSettings({ deterministicAssistance: 'yes' })).toEqual(DEFAULT_SETTINGS)
  })

  it('separates display and diagnostic settings in the provider', () => {
    const context = { sessionId: 's' as never, draft: '# x\n`bad', draftRev: 1, nativeRanges: [], presentation: { focused: false, selectionStart: 0, selectionEnd: 0, activeLineStart: 0, activeLineEnd: 0 } }
    expect(createMarkdownProvider(() => ({ ...DEFAULT_SETTINGS, markdownVisual: true })).decorate(context)).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-better-composer-heading' }),
    ]))
    expect(createMarkdownProvider(() => ({ ...DEFAULT_SETTINGS, diagnostics: false })).decorate(context)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: 'diagnostic' }),
    ]))
    expect(createMarkdownProvider(() => ({ ...DEFAULT_SETTINGS, enabled: false })).decorate(context)).toEqual([])
  })
})
