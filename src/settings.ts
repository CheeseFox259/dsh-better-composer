/** Stable Settings namespace shared by the Host and client halves. */
export const SETTINGS_NAMESPACE = 'dsh-rich-editor'

/** Persisted product preferences owned by the Rich Editor plugin. */
export interface RichEditorSettings {
  enabled: boolean
  markdownVisual: boolean
  diagnostics: boolean
  toolbarMode: ToolbarMode
}

/** Whether the formatting toolbar is compact or absent. */
export type ToolbarMode = 'compact' | 'hidden'

/** Defaults used when no Settings provider or user override is available. */
export const DEFAULT_SETTINGS: Readonly<RichEditorSettings> = Object.freeze({
  enabled: true,
  markdownVisual: true,
  diagnostics: true,
  toolbarMode: 'compact',
})

/** Actions shown directly in the compact toolbar. */
const COMPACT_ACTIONS = ['strong', 'emphasis', 'inline-code', 'link'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalize a Settings snapshot at the browser wire boundary.
 * @param value - decoded settings section.
 * @returns a complete safe settings value.
 */
export function normalizeSettings(value: unknown): RichEditorSettings {
  const record = isRecord(value) ? value : {}
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_SETTINGS.enabled,
    markdownVisual: typeof record.markdownVisual === 'boolean' ? record.markdownVisual : DEFAULT_SETTINGS.markdownVisual,
    diagnostics: typeof record.diagnostics === 'boolean' ? record.diagnostics : DEFAULT_SETTINGS.diagnostics,
    toolbarMode: record.toolbarMode === 'hidden' || record.toolbarMode === 'compact'
      ? record.toolbarMode
      : DEFAULT_SETTINGS.toolbarMode,
  }
}

/**
 * Select the direct toolbar actions without changing the fixed shortcut map.
 * @param settings - current plugin settings.
 * @returns action ids shown in the direct toolbar.
 */
export function toolbarActions(settings: RichEditorSettings): readonly string[] {
  return settings.toolbarMode === 'compact' ? COMPACT_ACTIONS : []
}
