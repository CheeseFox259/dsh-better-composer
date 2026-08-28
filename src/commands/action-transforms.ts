import type { ComposerActionContext, ComposerEditResult } from '@deepseek-ai/dsh-client-ui-conversation/client'

type Transform = (context: ComposerActionContext) => ComposerEditResult | undefined

/** Build a symmetric inline wrapper action. */
export function wrapAction(prefix: string, suffix = prefix): Transform {
  return ({ draft, selection }) => {
    const selected = draft.slice(selection.start, selection.end)
    return {
      start: selection.start, end: selection.end, text: `${prefix}${selected}${suffix}`,
      selectionStart: selection.start + prefix.length,
      selectionEnd: selection.start + prefix.length + selected.length,
    }
  }
}

/** Link selected text, leaving the URL selected for immediate replacement. */
export const linkAction: Transform = ({ draft, selection }) => {
  const selected = draft.slice(selection.start, selection.end)
  const text = `[${selected}](url)`
  const urlStart = selection.start + selected.length + 3
  return { start: selection.start, end: selection.end, text, selectionStart: urlStart, selectionEnd: urlStart + 3 }
}

function lineRange(draft: string, selection: { start: number; end: number }): { start: number; end: number } {
  const start = draft.lastIndexOf('\n', Math.max(0, selection.start - 1)) + 1
  const newline = draft.indexOf('\n', selection.end)
  return { start, end: newline === -1 ? draft.length : newline }
}

/** Prefix every selected line and preserve the selected content. */
export function prefixLines(prefix: string): Transform {
  return ({ draft, selection }) => {
    const lines = lineRange(draft, selection)
    const body = draft.slice(lines.start, lines.end)
    const count = body.split('\n').length
    return {
      start: lines.start, end: lines.end, text: body.split('\n').map(line => `${prefix}${line}`).join('\n'),
      selectionStart: selection.start + prefix.length,
      selectionEnd: selection.end + prefix.length * count,
    }
  }
}

/** Add a fenced block around the selected lines. */
export const codeFenceAction: Transform = ({ draft, selection }) => {
  const lines = lineRange(draft, selection)
  const body = draft.slice(lines.start, lines.end)
  const text = `\`\`\`\n${body}\n\`\`\``
  return { start: lines.start, end: lines.end, text, selectionStart: lines.start + 4, selectionEnd: lines.start + 4 + body.length }
}

/** Remove one common indentation prefix from each selected line. */
export const outdentAction: Transform = ({ draft, selection }) => {
  const lines = lineRange(draft, selection)
  const body = draft.slice(lines.start, lines.end)
  const removed = body.split('\n').map(line => line.startsWith('    ') ? line.slice(4) : line.replace(/^ {1,2}/u, '')).join('\n')
  const delta = body.length - removed.length
  return {
    start: lines.start, end: lines.end, text: removed,
    selectionStart: Math.max(lines.start, selection.start - Math.min(delta, selection.start - lines.start)),
    selectionEnd: Math.max(lines.start, selection.end - delta),
  }
}
