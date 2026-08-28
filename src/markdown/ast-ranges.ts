import type { Root } from 'mdast'
import type { ComposerDecorationRange } from '@deepseek-ai/dsh-client-ui-conversation/client'

interface MarkdownNode {
  readonly type: string
  readonly position?: { readonly start: { readonly offset?: number }; readonly end: { readonly offset?: number } }
  readonly children?: readonly MarkdownNode[]
  readonly ordered?: boolean
  readonly checked?: boolean | null
}

const classes: Readonly<Record<string, string>> = {
  heading: 'dsh-rich-editor-heading', strong: 'dsh-rich-editor-strong', emphasis: 'dsh-rich-editor-emphasis',
  inlineCode: 'dsh-rich-editor-inline-code', code: 'dsh-rich-editor-fenced-code', blockquote: 'dsh-rich-editor-quote',
  link: 'dsh-rich-editor-link', delete: 'dsh-rich-editor-strike',
}

/** Map existing MDAST positions to generic composer ranges. */
export function rangesFromGfm(tree: Root): readonly ComposerDecorationRange[] {
  const ranges: ComposerDecorationRange[] = []
  const visit = (node: MarkdownNode, listKind?: 'bullet' | 'ordered'): void => {
    const range = positionOf(node)
    const className = classes[node.type]
    if (range !== undefined && className !== undefined) ranges.push({ ...range, className })
    if (node.type === 'list' && range !== undefined) {
      listKind = node.ordered === true ? 'ordered' : 'bullet'
      ranges.push({ ...range, className: `dsh-rich-editor-${listKind}` })
    }
    if (node.type === 'listItem' && range !== undefined) {
      if (listKind !== undefined) ranges.push({ ...range, className: `dsh-rich-editor-${listKind}` })
      if (node.checked !== null && node.checked !== undefined) ranges.push({ ...range, className: 'dsh-rich-editor-task' })
    }
    for (const child of node.children ?? []) visit(child, listKind)
  }
  for (const node of tree.children as unknown as readonly MarkdownNode[]) visit(node)
  return ranges
}

function positionOf(node: MarkdownNode): { start: number; end: number } | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (!Number.isInteger(start) || !Number.isInteger(end) || start! >= end!) return undefined
  return { start: start!, end: end! }
}
