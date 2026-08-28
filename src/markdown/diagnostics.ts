import type { ComposerDecorationRange } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Return the three deterministic authoring diagnostics supported by Beta. */
export function diagnosticsFor(draft: string): readonly ComposerDecorationRange[] {
  const ranges: ComposerDecorationRange[] = []
  const fence = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gu
  const fenceMarkerStarts = new Set<number>()
  const fencedRanges: Array<{ start: number; end: number }> = []
  let open: { start: number; marker: string } | undefined
  for (const match of draft.matchAll(fence)) {
    const marker = match[2]
    const start = (match.index ?? 0) + match[1].length
    fenceMarkerStarts.add(start)
    const lineEnd = (match.index ?? 0) + match[0].length
    if (open === undefined) {
      open = { start, marker }
    } else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
      fencedRanges.push({ start: open.start, end: lineEnd })
      open = undefined
    }
  }
  if (open !== undefined) {
    fencedRanges.push({ start: open.start, end: draft.length })
    ranges.push({ start: open.start, end: draft.length, className: 'dsh-rich-editor-diagnostic-fence', layer: 'diagnostic', priority: 10 })
  }
  const ticks = /`+/gu
  const pending = new Map<number, number[]>()
  for (const match of draft.matchAll(ticks)) {
    const start = match.index ?? 0
    if (fenceMarkerStarts.has(start) || fencedRanges.some(range => start >= range.start && start < range.end)) continue
    const length = match[0].length
    const starts = pending.get(length)
    if (starts === undefined) pending.set(length, [start])
    else if (starts.length === 0) starts.push(start)
    else starts.pop()
  }
  for (const [length, starts] of pending) {
    for (const start of starts) {
      ranges.push({ start, end: Math.min(draft.length, start + length), className: 'dsh-rich-editor-diagnostic-inline-code', layer: 'diagnostic', priority: 10 })
    }
  }
  const malformed = /\[[^\]\n]*\]\([^\)\n]*$/gu.exec(draft)
  if (malformed !== null && !fencedRanges.some(range => malformed.index >= range.start && malformed.index < range.end)) {
    ranges.push({ start: malformed.index, end: draft.length, className: 'dsh-rich-editor-diagnostic-link', layer: 'diagnostic', priority: 10 })
  }
  return ranges
}
