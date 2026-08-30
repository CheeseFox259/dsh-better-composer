import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, normalizeSettings, toolbarActions,
  type RichEditorSettings,
} from '../../src/settings.ts'
import { Config } from '../../src/index.ts'
import { RichEditorSettingsStore } from '../../src/client/settings-store.ts'
import { createEnabledActions, diagnosticActionId } from '../../src/commands/actions.ts'
import { createMarkdownProvider } from '../../src/markdown/provider.ts'

describe('Rich Editor settings', () => {
  it('exports the canonical plugin schema with four defaults and strict values', () => {
    expect(Config({} as never)).toEqual(DEFAULT_SETTINGS)
    expect(() => Config({ toolbarMode: 'wide' } as never)).toThrow()
  })

  it('fills all four settings from the product defaults', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ enabled: false, toolbarMode: 'hidden' })).toEqual({
      enabled: false,
      markdownVisual: true,
      diagnostics: true,
      toolbarMode: 'hidden',
    })
  })

  it('keeps invalid persisted values at their safe defaults', () => {
    expect(normalizeSettings({ enabled: 'false', markdownVisual: 0, diagnostics: null, toolbarMode: 'wide' })).toEqual(DEFAULT_SETTINGS)
  })

  it('defines compact and hidden toolbar projections without remapping shortcuts', () => {
    const settings: RichEditorSettings = { ...DEFAULT_SETTINGS, toolbarMode: 'compact' }
    expect(toolbarActions(settings)).toEqual(['strong', 'emphasis', 'inline-code', 'link'])
    expect(toolbarActions({ ...settings, toolbarMode: 'hidden' })).toEqual([])
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
    const store = new RichEditorSettingsStore(scope)
    let updates = 0
    const off = store.subscribe(() => { updates += 1 })
    await store.set('diagnostics', false)
    expect(store.get()).toMatchObject({ diagnostics: false })
    expect(updates).toBe(1)
    off()
    store.dispose()
    await set('diagnostics', true)
    expect(updates).toBe(1)
  })

  it('makes actions inert while the plugin is disabled', () => {
    const actions = createEnabledActions(() => false)
    const action = actions.find(candidate => candidate.id === 'strong')!
    expect(action.transform({ draft: 'x', draftRev: 1, selection: { start: 0, end: 1 }, nativeRanges: [] })).toBeUndefined()
  })

  it('locates a diagnostic through a text-preserving native action result', () => {
    const draft = '```ts\nfoo()'
    const action = createEnabledActions(() => true)
      .find(candidate => candidate.id === diagnosticActionId('dsh-rich-editor-diagnostic-fence'))!
    const result = action.transform({
      draft, draftRev: 1, selection: { start: draft.length, end: draft.length }, nativeRanges: [],
    })
    expect(result).toEqual({
      start: 0,
      end: draft.length,
      text: draft,
      selectionStart: 0,
      selectionEnd: draft.length,
    })
  })

  it('separates enabled, visual, and diagnostic settings in the provider', () => {
    const context = { sessionId: 's' as never, draft: '# x\n`bad', draftRev: 1, nativeRanges: [] }
    expect(createMarkdownProvider(() => ({ ...DEFAULT_SETTINGS, markdownVisual: false })).decorate(context)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ className: 'dsh-rich-editor-heading' }),
    ]))
    expect(createMarkdownProvider(() => ({ ...DEFAULT_SETTINGS, diagnostics: false })).decorate(context)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: 'diagnostic' }),
    ]))
    expect(createMarkdownProvider(() => ({ ...DEFAULT_SETTINGS, enabled: false })).decorate(context)).toEqual([])
  })
})
