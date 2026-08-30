import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { createDecorationProvider } from './decoration-provider.ts'
import { createEnabledActions } from '../commands/actions.ts'
import { RichEditorSettingsCard } from './settings-card.tsx'
import { createEditorContribution } from './editor.tsx'
import { SETTINGS_NAMESPACE } from '../settings.ts'
import { RichEditorSettingsStore } from './settings-store.ts'
import { installStyles } from './styles.ts'

/** Required client services for the generic composer contribution. */
export const inject = ['conversation', 'slots', 'settingsScope']

/** Register production contributions through independent effect-owned disposers. */
export function apply(ctx: ClientContext): void {
  installStyles(ctx)
  const settings = new RichEditorSettingsStore(ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }))
  ctx.effect(() => () => { settings.dispose() }, 'dsh-rich-editor: settings store')
  const provider = createDecorationProvider(() => settings.get())
  ctx.effect(() => ctx.conversation.decorations.register(provider), 'dsh-rich-editor: markdown decorations')
  for (const action of createEnabledActions(() => settings.get().enabled)) {
    ctx.effect(() => ctx.conversation.actions.register(action), `dsh-rich-editor: action ${action.id}`)
  }
  const editor = createEditorContribution(settings)
  ctx.slots.inject('conversation.input.editor', () => ctx.slots.register({ name: 'conversation.input.editor' }, editor))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: SETTINGS_NAMESPACE,
    inject: () => ({ settings }),
  }, RichEditorSettingsCard))
}
