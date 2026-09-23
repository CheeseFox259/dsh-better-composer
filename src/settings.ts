/** Stable Settings namespace shared by the Host and client halves. */
export const SETTINGS_NAMESPACE = 'dsh-better-composer'

/** Persisted product preferences owned by the Better Composer plugin. */
export interface BetterComposerSettings {
  enabled: boolean
  markdownVisual: boolean
  diagnostics: boolean
  toolbarMode: ToolbarMode
  /** Minimum pasted-text length that converts into a clip chip; 0 disables. */
  pasteClipThreshold: number
}

/** Whether the formatting toolbar is compact or absent. */
export type ToolbarMode = 'compact' | 'hidden'

/** Defaults used when no Settings provider or user override is available. */
export const DEFAULT_SETTINGS: Readonly<BetterComposerSettings> = Object.freeze({
  enabled: true,
  markdownVisual: true,
  diagnostics: true,
  toolbarMode: 'compact',
  pasteClipThreshold: 4000,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalize a Settings snapshot at the browser wire boundary.
 * @param value - decoded settings section.
 * @returns a complete safe settings value.
 */
export function normalizeSettings(value: unknown): BetterComposerSettings {
  const record = isRecord(value) ? value : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
    markdownVisual: typeof record.markdownVisual === 'boolean' ? record.markdownVisual : DEFAULT_SETTINGS.markdownVisual,
    diagnostics: typeof record.diagnostics === 'boolean' ? record.diagnostics : DEFAULT_SETTINGS.diagnostics,
    toolbarMode: record.toolbarMode === 'hidden' || record.toolbarMode === 'compact'
      ? record.toolbarMode
      : DEFAULT_SETTINGS.toolbarMode,
    pasteClipThreshold: typeof record.pasteClipThreshold === 'number'
      && Number.isFinite(record.pasteClipThreshold) && record.pasteClipThreshold >= 0
      ? Math.floor(record.pasteClipThreshold)
      : DEFAULT_SETTINGS.pasteClipThreshold,
  }
}
