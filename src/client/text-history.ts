export interface TextHistory {
  readonly past: readonly string[]
  readonly future: readonly string[]
}

export const EMPTY_TEXT_HISTORY: TextHistory = { past: [], future: [] }

export function recordTextChange(history: TextHistory, current: string, next: string): TextHistory {
  if (current === next) return history
  return { past: [...history.past, current], future: [] }
}

export function undoTextChange(history: TextHistory, current: string): { readonly history: TextHistory; readonly text: string } | undefined {
  const previous = history.past.at(-1)
  if (previous === undefined) return undefined
  return {
    text: previous,
    history: { past: history.past.slice(0, -1), future: [...history.future, current] },
  }
}

export function redoTextChange(history: TextHistory, current: string): { readonly history: TextHistory; readonly text: string } | undefined {
  const next = history.future.at(-1)
  if (next === undefined) return undefined
  return {
    text: next,
    history: { past: [...history.past, current], future: history.future.slice(0, -1) },
  }
}
