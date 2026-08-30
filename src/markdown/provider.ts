import { parseGfm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerDecorationContext, ComposerDecorationProvider, ComposerDecorationRange } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { rangesFromGfm } from './ast-ranges.ts'
import { diagnosticsFor } from './diagnostics.ts'
import { maskNative } from './native-mask.ts'
import { DEFAULT_SETTINGS, type RichEditorSettings } from '../settings.ts'

/** Pure Markdown projection provider used by the out-of-tree contribution. */
export function createMarkdownProvider(
  getSettings: () => RichEditorSettings = () => DEFAULT_SETTINGS,
): ComposerDecorationProvider {
  return {
    id: 'dsh-rich-editor-markdown', order: 0,
    decorate(context: ComposerDecorationContext): readonly ComposerDecorationRange[] {
      const settings = getSettings()
      if (!settings.enabled) return []
      const masked = maskNative(context.draft, context.nativeRanges)
      const ranges = settings.markdownVisual ? [...rangesFromGfm(parseGfm(masked))] : []
      if (settings.diagnostics) ranges.push(...diagnosticsFor(masked))
      return ranges
    },
  }
}
