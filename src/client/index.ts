import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createDecorationProvider } from './decoration-provider.ts'
import { composerActions } from '../commands/actions.ts'
import { EditorContribution } from './editor.tsx'
import { installStyles } from './styles.ts'

/** Required client services for the generic composer contribution. */
export const inject = ['conversation', 'slots']

/** Register production contributions through independent effect-owned disposers. */
export function apply(ctx: ClientContext): void {
  installStyles(ctx)
  const provider = createDecorationProvider()
  ctx.effect(() => ctx.conversation.decorations.register(provider), 'dsh-rich-editor: markdown decorations')
  for (const action of composerActions) {
    ctx.effect(() => ctx.conversation.actions.register(action), `dsh-rich-editor: action ${action.id}`)
  }
  ctx.effect(
    () => ctx.slots.register({ name: 'conversation.input.editor' }, EditorContribution),
    'dsh-rich-editor: editor controls',
  )
}
