import type { ComposerDecorationProvider } from '@deepseek-ai/dsh-client-ui-conversation/client'

interface SmokeState {
  enabled?: boolean
  throwProvider?: boolean
}

function smokeState(): SmokeState | undefined {
  const value = (globalThis as typeof globalThis & {
    __DSH_RICH_EDITOR_M1_SMOKE__?: unknown
  }).__DSH_RICH_EDITOR_M1_SMOKE__
  return typeof value === 'object' && value !== null ? value as SmokeState : undefined
}

/** Create the adapter provider; its opt-in probe is only used by the assembled M1 smoke. */
export function createDecorationProvider(): ComposerDecorationProvider {
  return {
    id: 'dsh-rich-editor',
    decorate: ({ draft }) => {
      if (smokeState()?.enabled !== true || draft.length === 0) return []
      return [{ start: 0, end: draft.length, className: 'dsh-rich-editor-m1-probe' }]
    },
  }
}

/** Create the opt-in smoke provider that exercises per-provider fail-open handling. */
export function createThrowingSmokeProvider(): ComposerDecorationProvider {
  return {
    id: 'dsh-rich-editor-m1-throw-probe',
    decorate: () => {
      if (smokeState()?.throwProvider === true) throw new Error('M1 smoke provider failure')
      return []
    },
  }
}
