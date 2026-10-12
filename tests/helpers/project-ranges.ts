import { project } from '../../src/decoration/index.ts'

export interface PlanDecorateInput {
  readonly draft: string
  readonly nativeRanges?: readonly { readonly start: number; readonly end: number; readonly kind?: string }[]
  readonly presentation?: {
    readonly focused: boolean
    readonly selectionStart: number
    readonly selectionEnd: number
    readonly composing?: boolean
  }
  readonly options?: { readonly markdownVisual?: boolean }
}

export interface FlatDecorationRange {
  readonly start: number
  readonly end: number
  readonly className: string
  readonly target: 'text' | 'block'
}

/**
 * Test adapter over the public 装饰投影 seam: runs project() and flattens the
 * DecorationPlan into a range list so legacy range-oriented assertions keep
 * working against the public interface instead of a deleted provider.
 */
export function decorateViaPlan(input: PlanDecorateInput): FlatDecorationRange[] {
  const selection = input.presentation === undefined
    ? null
    : {
        start: input.presentation.selectionStart,
        end: input.presentation.selectionEnd,
        focused: input.presentation.focused,
        composing: input.presentation.composing,
      }
  const plan = project(input.draft, selection, input.nativeRanges ?? [], input.options)
  const ranges: FlatDecorationRange[] = []
  for (const line of plan.lines) {
    for (const className of line.blockClasses) {
      ranges.push({ start: line.start, end: line.end, className, target: 'block' })
    }
  }
  for (const inline of plan.inlines) {
    ranges.push({ start: inline.start, end: inline.end, className: inline.className, target: 'text' })
  }
  return ranges
}
