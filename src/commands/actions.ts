import type { ComposerAction } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { codeFenceAction, linkAction, outdentAction, prefixLines, wrapAction } from './action-transforms.ts'
import { diagnosticsFor } from '../markdown/diagnostics.ts'
import { maskNative } from '../markdown/native-mask.ts'

const DIAGNOSTIC_CLASSES = [
  'dsh-rich-editor-diagnostic-fence',
  'dsh-rich-editor-diagnostic-inline-code',
  'dsh-rich-editor-diagnostic-link',
] as const

/** Return the private action id that selects the first diagnostic of this class. */
export function diagnosticActionId(className: string): string {
  return `dsh-rich-editor:locate:${className}`
}

const diagnosticActions: readonly ComposerAction[] = DIAGNOSTIC_CLASSES.map((className, index) => ({
  id: diagnosticActionId(className),
  order: 1_000 + index,
  transform: (context) => {
    const diagnostic = diagnosticsFor(maskNative(context.draft, context.nativeRanges))
      .find(candidate => candidate.className === className)
    if (diagnostic === undefined) return undefined
    return {
      start: diagnostic.start,
      end: diagnostic.end,
      text: context.draft.slice(diagnostic.start, diagnostic.end),
      selectionStart: diagnostic.start,
      selectionEnd: diagnostic.end,
    }
  },
}))

/** Complete Beta action set, with generic ids and pure transforms. */
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
export function createEnabledActions(isEnabled: () => boolean): readonly ComposerAction[] {
  return [...composerActions, ...diagnosticActions].map(action => ({
    ...action,
    transform: (context) => isEnabled() ? action.transform(context) : undefined,
  }))
}
