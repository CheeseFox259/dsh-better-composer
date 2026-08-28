import { parseGfm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerDecorationContext, ComposerDecorationProvider, ComposerDecorationRange } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { rangesFromGfm } from './ast-ranges.ts'
import { diagnosticsFor } from './diagnostics.ts'
import { maskNative } from './native-mask.ts'

/** Pure Markdown projection provider used by the out-of-tree contribution. */
export function createMarkdownProvider(): ComposerDecorationProvider {
  return {
    id: 'dsh-rich-editor-markdown', order: 0,
    decorate(context: ComposerDecorationContext): readonly ComposerDecorationRange[] {
      const masked = maskNative(context.draft, context.nativeRanges)
      return [...rangesFromGfm(parseGfm(masked)), ...diagnosticsFor(masked)]
    },
  }
}
