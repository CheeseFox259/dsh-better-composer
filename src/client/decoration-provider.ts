import type { ComposerDecorationProvider } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createMarkdownProvider } from '../markdown/provider.ts'
import type { RichEditorSettings } from '../settings.ts'

/** Create the production provider adapter; all Markdown logic remains pure and local. */
export function createDecorationProvider(
  getSettings: () => RichEditorSettings,
): ComposerDecorationProvider {
  return createMarkdownProvider(getSettings)
}
