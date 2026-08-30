import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_SETTINGS, SETTINGS_NAMESPACE, type RichEditorSettings } from './settings.ts'

/** Stable Settings namespace shared by the Host and browser halves. */
export { SETTINGS_NAMESPACE }

const SETTINGS_NS = settingsNamespace(SETTINGS_NAMESPACE)

/** Schema for the four live Rich Editor preferences. */
export const Config: z<RichEditorSettings> = z.object({
  enabled: z.boolean().default(DEFAULT_SETTINGS.enabled),
  markdownVisual: z.boolean().default(DEFAULT_SETTINGS.markdownVisual),
  diagnostics: z.boolean().default(DEFAULT_SETTINGS.diagnostics),
  toolbarMode: z.union(['compact', 'hidden'] as const).default(DEFAULT_SETTINGS.toolbarMode),
})

/** Descriptive alias for consumers that identify the Settings schema by role. */
export const SettingsSchema = Config

/**
 * Host half of the out-of-tree adapter; the browser half consumes the scope.
 * @param ctx - plugin context owning the optional Settings provider.
 * @param config - composition defaults for this plugin entry.
 */
export function apply(ctx: Context, config: RichEditorSettings = { ...DEFAULT_SETTINGS }): void {
  installSettingsSection(ctx, SETTINGS_NS, Config, config, {
    setSource: () => {},
    onChange: () => {},
  })
}
