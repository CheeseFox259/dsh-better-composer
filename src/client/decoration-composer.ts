/**
 * Collect and compose provider ranges into non-overlapping segments.
 *
 * Direct port of the canonical DSH harness decoration registry implementation
 * (MIT, (c) DeepSeek) so the plugin can compute exact text and block segments
 * locally without depending on an out-of-tree host registry.
 */

import type {
  ComposerDecorationContext, ComposerDecorationLayer, ComposerDecorationProvider,
  ComposerDecorationRange, ComposerDecorationSegment, ComposerDecorationTarget,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

interface Range {
  readonly start: number
  readonly end: number
  readonly className: string
  readonly layer: ComposerDecorationLayer
  readonly priority: number
  readonly target: ComposerDecorationTarget
  readonly providerRank: number
  readonly ordinal: number
}

/**
 * Collect ranges from one provider, subtract native ranges, and compose
 * non-overlapping segments with explicit text and block class names.
 */
export function collectDecorationSegments(
  provider: ComposerDecorationProvider,
  context: ComposerDecorationContext,
): readonly ComposerDecorationSegment[] | undefined {
  const native = mergedIntervals(context.nativeRanges, context.draft.length)
  let returned: readonly ComposerDecorationRange[]
  try {
    const value = provider.decorate(context)
    if (!Array.isArray(value)) return undefined
    returned = value
  } catch {
    return undefined
  }
  const ranges: Range[] = []
  for (let ordinal = 0; ordinal < returned.length; ordinal += 1) {
    const range = validateRange(returned[ordinal], context.draft, 0, ordinal)
    if (range === undefined) return undefined
    ranges.push(...subtractNative(range, native))
  }
  return composeRanges(ranges)
}

function validateRange(candidate: unknown, draft: string, providerRank: number, ordinal: number): Range | undefined {
  if (candidate === null || typeof candidate !== 'object') return undefined
  const value = candidate as {
    readonly start?: unknown
    readonly end?: unknown
    readonly className?: unknown
    readonly layer?: unknown
    readonly priority?: unknown
    readonly target?: unknown
  }
  if (typeof value.start !== 'number' || typeof value.end !== 'number'
    || !Number.isInteger(value.start) || !Number.isInteger(value.end)
    || value.start < 0 || value.start >= value.end || value.end > draft.length
    || !surrogateBoundary(draft, value.start) || !surrogateBoundary(draft, value.end)) return undefined
  if (typeof value.className !== 'string' || value.className.length === 0
    || value.className.trim() !== value.className || /\s/u.test(value.className)) return undefined
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

function mergedIntervals(ranges: readonly { start: number; end: number }[], length: number): readonly Range[] {
  const sorted = ranges
    .filter(range => Number.isInteger(range.start) && Number.isInteger(range.end)
      && range.start >= 0 && range.start < range.end && range.end <= length)
    .map(range => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: Range[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous !== undefined && range.start <= previous.end) {
      merged[merged.length - 1] = { ...previous, end: Math.max(previous.end, range.end), className: '', layer: 'syntax', priority: 0, target: 'text', providerRank: 0, ordinal: 0 }
    } else {
      merged.push({ ...range, className: '', layer: 'syntax', priority: 0, target: 'text', providerRank: 0, ordinal: 0 })
    }
  }
  return merged
}

function subtractNative(range: Range, native: readonly Range[]): Range[] {
  const out: Range[] = []
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

function composeRanges(ranges: readonly Range[]): ComposerDecorationSegment[] {
  if (ranges.length === 0) return []
  const points = [...new Set(ranges.flatMap(range => [range.start, range.end]))].sort((left, right) => left - right)
  const out: ComposerDecorationSegment[] = []
  for (let index = 0; index + 1 < points.length; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (start === undefined || end === undefined) continue
    const active = ranges.filter(range => range.start <= start && end <= range.end)
    const classes = composeClasses(active, false)
    const blockClasses = composeClasses(active, true)
    if (classes.length === 0 && blockClasses.length === 0) continue
    const className = classes.join(' ')
    const blockClassName = blockClasses.length === 0 ? undefined : blockClasses.join(' ')
    const previous = out.at(-1)
    if (previous?.end === start && previous.className === className && previous.blockClassName === blockClassName) {
      out[out.length - 1] = { ...previous, end }
    } else {
      out.push({ start, end, className, ...(blockClassName === undefined ? {} : { blockClassName }) })
    }
  }
  return out
}

function composeClasses(active: readonly Range[], blockOnly: boolean): string[] {
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
