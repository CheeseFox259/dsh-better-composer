import type { ComposerNativeRange } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Replace protected native text with same-length spaces while preserving line breaks. */
export function maskNative(draft: string, ranges: readonly ComposerNativeRange[]): string {
  const chars = Array.from({ length: draft.length }, (_unused, offset) => draft[offset] ?? '')
  for (const range of ranges) {
    const start = Math.max(0, range.start)
    const end = Math.min(draft.length, range.end)
    for (let offset = start; offset < end; offset += 1) {
      if (draft[offset] !== '\n' && draft[offset] !== '\r') chars[offset] = ' '
    }
  }
  return chars.join('')
}
