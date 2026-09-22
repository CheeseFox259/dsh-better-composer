/** One detected large single-step insertion in the draft. */
export interface InsertionDetection {
  /** Start offset in the next draft. */
  readonly start: number
  /** End offset in the next draft (exclusive). */
  readonly end: number
  /** The inserted text. */
  readonly text: string
}

/**
 * Detect a large single-revision insertion by common prefix/suffix diff.
 * Paste, IME commits, and undo all show up as single-step jumps; only jumps
 * at or over the threshold report. The check is exact-text based, so small
 * edits around the insertion shrink the detected span rather than widening it.
 * @param previous - previous draft text.
 * @param next - current draft text.
 * @param threshold - minimum inserted length; 0 or less disables detection.
 * @returns the inserted span, or undefined when the change is below threshold.
 */
export function detectLongInsertion(
  previous: string,
  next: string,
  threshold: number,
): InsertionDetection | undefined {
  if (threshold <= 0 || next.length - previous.length < threshold) return undefined
  let prefix = 0
  const shared = Math.min(previous.length, next.length)
  while (prefix < shared && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix += 1
  let suffix = 0
  while (
    suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) suffix += 1
  const end = next.length - suffix
  const text = next.slice(prefix, end)
  return text.length >= threshold ? { start: prefix, end, text } : undefined
}
