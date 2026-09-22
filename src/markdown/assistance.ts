import { analyzePromptStructure } from './prompt-structure.ts'
import { MAX_OPTIONAL_SCAN_LENGTH } from './limits.ts'

/** One ordinary Core text segment supplied in authoritative UTF-16 coordinates. */
export interface DeterministicAssistanceSegment {
  readonly sourceStart: number
  readonly text: string
}

/** Input for the bounded, local assistance projection. */
export interface DeterministicAssistanceInput {
  readonly draftRev: number
  readonly segments: readonly DeterministicAssistanceSegment[]
}

/** One passive hint; it has no edit or submission operation. */
export interface DeterministicAssistanceHint {
  readonly revision: number
  readonly kind: 'validation-section'
  readonly start: number
  readonly end: number
  readonly message: string
}

const VALIDATION_HINT = '已检测到代码块，可检查是否需要“Validation”区段。'

/**
 * Derive at most one fixed structural hint per eligible ordinary text segment.
 * @param input - Core revision and Context Object-separated text segments.
 * @returns revision-bound passive hints in source UTF-16 coordinates.
 */
export function deterministicAssistanceForSegments(
  input: DeterministicAssistanceInput,
): readonly DeterministicAssistanceHint[] {
  const hints: DeterministicAssistanceHint[] = []
  let scanned = 0
  for (const segment of input.segments) {
    if (segment.text.length > MAX_OPTIONAL_SCAN_LENGTH || scanned + segment.text.length > MAX_OPTIONAL_SCAN_LENGTH) break
    scanned += segment.text.length
    const structure = analyzePromptStructure(segment.text)
    const hasTaskSection = structure.sections.some(section => section.name === 'goal' || section.name === 'task')
    const hasValidationSection = structure.sections.some(section => (
      section.name === 'validation' || section.name === 'acceptance criteria'
    ))
    if (!hasTaskSection || !structure.hasCodeFence || hasValidationSection) continue
    const end = segment.sourceStart + segment.text.length
    hints.push({
      revision: input.draftRev,
      kind: 'validation-section',
      start: end,
      end,
      message: VALIDATION_HINT,
    })
  }
  return hints
}
