import type { ComposerAction } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { codeFenceAction, linkAction, outdentAction, prefixLines, wrapAction } from './action-transforms.ts'

/** Complete formatting action set, with generic ids and pure transforms. */
export const composerActions: readonly ComposerAction[] = [
  { id: 'strong', order: 10, shortcut: { key: 'b', mod: true }, transform: wrapAction('**') },
  { id: 'emphasis', order: 20, shortcut: { key: 'i', mod: true }, transform: wrapAction('*') },
  { id: 'inline-code', order: 30, shortcut: { key: '`', mod: true }, transform: wrapAction('`') },
  { id: 'link', order: 40, shortcut: { key: 'k', mod: true }, transform: linkAction },
  { id: 'quote', order: 50, transform: prefixLines('> ') },
  { id: 'bullet', order: 60, transform: prefixLines('- ') },
  { id: 'ordered', order: 70, transform: prefixLines('1. ') },
  { id: 'task', order: 80, transform: prefixLines('- [ ] ') },
  { id: 'code-fence', order: 90, transform: codeFenceAction },
  { id: 'indent', order: 100, transform: prefixLines('    ') },
  { id: 'outdent', order: 110, transform: outdentAction },
]

/**
 * Bind the fixed action set to the live enabled preference.
 * @param isEnabled - synchronous read of the current plugin setting.
 * @returns action registrations that become inert while disabled.
 */
export function createEnabledActions(
  isEnabled: () => boolean,
): readonly ComposerAction[] {
  return composerActions.map(action => ({
    ...action,
    transform: (context) => isEnabled() ? action.transform(context) : undefined,
  }))
}
