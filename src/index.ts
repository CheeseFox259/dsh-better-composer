import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_SETTINGS, SETTINGS_NAMESPACE, type BetterComposerSettings } from './settings.ts'
import { BetterComposerRemoteService } from './remote.ts'

/** Stable Settings namespace shared by the Host and browser halves. */
export { SETTINGS_NAMESPACE }

const SETTINGS_NS = SETTINGS_NAMESPACE

/** Schema for the Better Composer preferences and the legacy toolbar field. */
export const Config: z<BetterComposerSettings> = z.object({
  enabled: z.boolean().default(DEFAULT_SETTINGS.enabled),
  markdownVisual: z.boolean().default(DEFAULT_SETTINGS.markdownVisual),
  diagnostics: z.boolean().default(DEFAULT_SETTINGS.diagnostics),
  toolbarMode: z.union(['compact', 'hidden'] as const).default(DEFAULT_SETTINGS.toolbarMode),
  pasteClipThreshold: z.number().default(DEFAULT_SETTINGS.pasteClipThreshold),
  // Published schemastery lines infer slightly different schema generics;
  // the runtime host validates against this exact schema object.
}) as z<BetterComposerSettings>

/** Descriptive alias for consumers that identify the Settings schema by role. */
export const SettingsSchema = Config

/**
 * Host half of the out-of-tree adapter; the browser half consumes the scope.
 * @param ctx - plugin context owning the optional Settings provider.
 * @param config - composition defaults for this plugin entry.
 */
export function apply(ctx: Context, config: BetterComposerSettings = { ...DEFAULT_SETTINGS }): void {
  new BetterComposerRemoteService(ctx)
  void config
}
