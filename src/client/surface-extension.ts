import type {
  ComposerSurfaceExtension, ComposerSurfaceExtensionPresentation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { acceptMarkdownCompletion, markdownCompletion } from '../markdown/completion.ts'
import { diagnosticsForSegments } from '../markdown/diagnostics.ts'
import { MAX_SYNC_PROJECTION_LENGTH } from '../markdown/limits.ts'
import type { BetterComposerSettings } from '../settings.ts'
import type { BetterComposerSettingsStore } from './settings-store.ts'

const DIAGNOSTIC_MESSAGES: Readonly<Record<string, string>> = {
  'dsh-better-composer-diagnostic-fence': '代码块未闭合',
  'dsh-better-composer-diagnostic-inline-code': '行内代码定界符未闭合',
  'dsh-better-composer-diagnostic-link': '显式链接格式不完整',
}

/** Create the session-local deterministic Markdown surface contribution. */
export function createMarkdownSurfaceExtension(settings: BetterComposerSettingsStore): ComposerSurfaceExtension {
  let selectedKey: string | undefined
  let selectedIndex = 0
  let dismissedKey: string | undefined

  return {
    id: 'dsh-better-composer-markdown-surface',

    present(context): ComposerSurfaceExtensionPresentation | undefined {
      const current = settings.get()
      if (!current.enabled) return undefined
      const completion = markdownCompletion({
        draft: context.draft,
        draftRev: context.draftRev,
        selection: context.selection,
        nativeRanges: context.nativeRanges,
        composing: context.composing,
        triggerOwner: context.triggerOwner,
        segments: context.textSegments.map(segment => ({ sourceStart: segment.start, text: segment.text })),
      })
      const completionId = completion === undefined ? undefined : completionKey(completion)
      const visibleCompletion = completionId !== undefined && dismissedKey === completionId ? undefined : completion
      const popup = visibleCompletion?.kind === 'popup'
        ? {
          revision: visibleCompletion.revision,
          from: visibleCompletion.from,
          to: visibleCompletion.to,
          candidates: visibleCompletion.candidates,
          selectedIndex: selectedKey === completionId
            ? Math.min(selectedIndex, Math.max(0, visibleCompletion.candidates.length - 1))
            : 0,
        }
        : undefined
      const ghost = visibleCompletion?.kind === 'ghost'
        ? {
          revision: visibleCompletion.revision,
          from: visibleCompletion.from,
          to: visibleCompletion.to,
          insertText: visibleCompletion.insertText,
          label: visibleCompletion.label,
        }
        : undefined
      const diagnostics = current.diagnostics
        ? diagnosticsForSegments({
          draftRev: context.draftRev,
          segments: context.textSegments.map(segment => ({ sourceStart: segment.start, text: segment.text })),
        }).map(diagnostic => ({
          start: diagnostic.start,
          end: diagnostic.end,
          className: diagnostic.className,
          message: DIAGNOSTIC_MESSAGES[diagnostic.className] ?? 'Markdown 语法提示',
        }))
        : []
      const hints = [
        // The decoration provider fails open past the sync-projection bound;
        // say so instead of letting Markdown paint silently vanish.
        ...(context.draft.length > MAX_SYNC_PROJECTION_LENGTH
          ? [{
            revision: context.draftRev,
            kind: 'limits',
            start: 0,
            end: 0,
            message: `草稿超过 ${MAX_SYNC_PROJECTION_LENGTH.toLocaleString()} 字符，Markdown 视觉增强与诊断已暂停。`,
          }]
          : []),
      ]
      if (popup === undefined && ghost === undefined && diagnostics.length === 0 && hints.length === 0) return undefined
      return {
        revision: context.draftRev,
        ...(popup === undefined ? {} : { popup }),
        ...(ghost === undefined ? {} : { ghost }),
        diagnostics,
        ...(hints.length === 0 ? {} : { hints }),
      }
    },

    handleKey(request): 'consumed' | 'pass' {
      const completion = request.presentation.popup ?? request.presentation.ghost
      if (completion === undefined) return 'pass'
      const id = completionKey({
        ...completion,
        kind: request.presentation.popup === undefined ? 'ghost' : 'popup',
      })
      if (request.key === 'escape') {
        dismissedKey = id
        return 'consumed'
      }
      if (request.presentation.popup !== undefined) {
        const popup = request.presentation.popup
        if (request.key === 'escape') {
          dismissedKey = id
          return 'consumed'
        }
        if (request.key === 'up' || request.key === 'down') {
          const direction = request.key === 'down' ? 1 : -1
          selectedIndex = (popup.selectedIndex + direction + popup.candidates.length) % popup.candidates.length
          selectedKey = id
          return 'consumed'
        }
        // Enter remains the host composer action (submit/newline). Tab is the
        // explicit completion acceptance key; never move the caret merely
        // because a passive popup happens to be visible.
        if (request.key !== 'tab' || request.shift) return 'pass'
        const candidate = popup.candidates[popup.selectedIndex]
        if (candidate === undefined) return 'pass'
        const result = acceptMarkdownCompletion({
          completion: {
            revision: popup.revision,
            from: popup.from,
            to: popup.to,
            insertText: candidate.insertText,
          },
          snapshot: { draftRev: request.context.draftRev, draft: request.context.draft },
          apply: request.apply,
        })
        if (!result.accepted) return 'pass'
        dismissedKey = undefined
        selectedKey = undefined
        selectedIndex = 0
        return 'consumed'
      }
      if (request.key !== 'tab' || request.shift) return 'pass'
      const ghost = request.presentation.ghost
      if (ghost === undefined) return 'pass'
      const result = acceptMarkdownCompletion({
        completion: {
          revision: ghost.revision,
          from: ghost.from,
          to: ghost.to,
          insertText: ghost.insertText,
        },
        snapshot: { draftRev: request.context.draftRev, draft: request.context.draft },
        apply: request.apply,
      })
      if (!result.accepted) return 'pass'
      dismissedKey = undefined
      return 'consumed'
    },
  }
}

function completionKey(completion: {
  readonly revision: number
  readonly from: number
  readonly to: number
  readonly kind?: string
  readonly insertText?: string
}): string {
  return `${completion.revision}:${completion.kind ?? 'surface'}:${completion.from}:${completion.to}:${completion.insertText ?? ''}`
}
