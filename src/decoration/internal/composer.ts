import type {
  ComposerDecorationLayer, ComposerDecorationRange, ComposerDecorationTarget,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

export interface RangeRecord {
  readonly start: number
  readonly end: number
  readonly className: string
  readonly layer: ComposerDecorationLayer
  readonly priority: number
  readonly target: ComposerDecorationTarget
  readonly providerRank: number
  readonly ordinal: number
}

export function validateRange(
  candidate: unknown,
  draft: string,
  providerRank: number,
  ordinal: number,
): RangeRecord | undefined {
  if (candidate === null || typeof candidate !== 'object') return undefined
  const value = candidate as {
    readonly start?: unknown
    readonly end?: unknown
    readonly className?: unknown
    readonly layer?: unknown
    readonly priority?: unknown
    readonly target?: unknown
  }
  if (
    typeof value.start !== 'number' || typeof value.end !== 'number'
    || !Number.isInteger(value.start) || !Number.isInteger(value.end)
    || value.start < 0 || value.start >= value.end || value.end > draft.length
    || !surrogateBoundary(draft, value.start) || !surrogateBoundary(draft, value.end)
  ) return undefined
  if (
    typeof value.className !== 'string' || value.className.length === 0
    || value.className.trim() !== value.className || /\s/u.test(value.className)
  ) return undefined
  if (value.layer !== undefined && value.layer !== 'syntax' && value.layer !== 'diagnostic') return undefined
  if (value.priority !== undefined) {
    if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) return undefined
  }
  if (value.target !== undefined && value.target !== 'text' && value.target !== 'block') return undefined
  return {
    start: value.start,
    end: value.end,
    className: value.className,
    layer: value.layer ?? 'syntax',
    priority: value.priority ?? 0,
    target: value.target ?? 'text',
    providerRank,
    ordinal,
  }
}

function surrogateBoundary(text: string, offset: number): boolean {
  if (offset === 0 || offset === text.length) return true
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF)
}

export function mergedIntervals(
  ranges: readonly { start: number; end: number }[],
  length: number,
): readonly RangeRecord[] {
  const sorted = ranges
    .filter(range => Number.isInteger(range.start) && Number.isInteger(range.end)
      && range.start >= 0 && range.start < range.end && range.end <= length)
    .map(range => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: RangeRecord[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous !== undefined && range.start <= previous.end) {
      merged[merged.length - 1] = {
        ...previous,
        end: Math.max(previous.end, range.end),
        className: '',
        layer: 'syntax',
        priority: 0,
        target: 'text',
        providerRank: 0,
        ordinal: 0,
      }
    } else {
      merged.push({
        ...range,
        className: '',
        layer: 'syntax',
        priority: 0,
        target: 'text',
        providerRank: 0,
        ordinal: 0,
      })
    }
  }
  return merged
}

export function subtractNative(range: RangeRecord, native: readonly RangeRecord[]): RangeRecord[] {
  const out: RangeRecord[] = []
  let cursor = range.start
  for (const blocked of native) {
    if (blocked.end <= cursor) continue
    if (blocked.start >= range.end) break
    if (blocked.start > cursor) out.push({ ...range, start: cursor, end: Math.min(blocked.start, range.end) })
    cursor = Math.max(cursor, blocked.end)
    if (cursor >= range.end) return out
  }
  if (cursor < range.end) out.push({ ...range, start: cursor })
  return out
}

export function composeClasses(active: readonly RangeRecord[], blockOnly: boolean): string[] {
  const classes: string[] = []
  for (const layer of ['syntax', 'diagnostic'] as const) {
    const layerRanges = active.filter(range => range.layer === layer && (!blockOnly || range.target === 'block'))
    const highest = Math.max(...layerRanges.map(range => range.priority), Number.NEGATIVE_INFINITY)
    for (const range of layerRanges
      .filter(range => range.priority === highest)
      .sort((left, right) => left.providerRank - right.providerRank || left.ordinal - right.ordinal)) {
      if (!classes.includes(range.className)) classes.push(range.className)
    }
  }
  return classes
}
