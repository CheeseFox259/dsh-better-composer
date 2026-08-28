import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createDecorationProvider, createThrowingSmokeProvider } from './decoration-provider.ts'

/** Required client service for the adapter's public registration face. */
export const inject = ['conversation']

/** Register the provider through the public conversation service and its fiber lifecycle. */
export function apply(ctx: ClientContext): void {
  const provider = createDecorationProvider()
  ctx.effect(
    () => ctx.conversation.decorations.register(provider),
    'dsh-rich-editor: composer decoration provider',
  )
  const smokeProvider = createThrowingSmokeProvider()
  ctx.effect(
    () => ctx.conversation.decorations.register(smokeProvider),
    'dsh-rich-editor: M1 smoke provider',
  )
}
