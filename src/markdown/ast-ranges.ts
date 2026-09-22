import type { Root } from 'mdast'
import type { ComposerDecorationRange } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { highlightLines } from '@deepseek-ai/dsh-client-ui-primitives'

interface MarkdownNode {
  readonly type: string
  readonly position?: { readonly start: { readonly offset?: number }; readonly end: { readonly offset?: number } }
  readonly children?: readonly MarkdownNode[]
  readonly ordered?: boolean
  readonly checked?: boolean | null
}

const classes: Readonly<Record<string, string>> = {
  heading: 'dsh-better-composer-heading', strong: 'dsh-better-composer-strong', emphasis: 'dsh-better-composer-emphasis',
  inlineCode: 'dsh-better-composer-inline-code', code: 'dsh-better-composer-fenced-code', blockquote: 'dsh-better-composer-quote',
  link: 'dsh-better-composer-link', image: 'dsh-better-composer-image', table: 'dsh-better-composer-table', tableCell: 'dsh-better-composer-table-cell', delete: 'dsh-better-composer-strike',
}

/** Map existing MDAST positions to generic composer ranges. */
export function rangesFromGfm(tree: Root, source = ''): readonly ComposerDecorationRange[] {
  const projection = projectGfm(tree, source)
  return [...projection.semanticRanges, ...projection.markerRanges, ...projection.fenceRanges, ...projection.structuralRanges]
}

/** Source-preserving Markdown projection split by semantic and syntax roles. */
export interface MarkdownSourceProjection {
  readonly semanticRanges: readonly ComposerDecorationRange[]
  readonly markerRanges: readonly ComposerDecorationRange[]
  readonly fenceRanges: readonly ComposerDecorationRange[]
  /** Block-targeted ranges consumed by the canonical Lexical presentation. */
  readonly structuralRanges: readonly ComposerDecorationRange[]
  /** Complete parsed constructs and conservative incomplete-source records. */
  readonly constructs: readonly MarkdownConstructRecord[]
  /** Raw HTML block spans; their text is literal, never Markdown syntax. */
  readonly htmlRanges: readonly { readonly start: number; readonly end: number }[]
}

/** Options controlling optional work in a source projection. */
export interface MarkdownProjectionOptions {
  /** Include Shiki token ranges; live editor providers defer this work. */
  readonly includeCodeTokens?: boolean
}

/** One source-preserving Markdown construct used by the active-set policy. */
export interface MarkdownConstructRecord {
  readonly kind: 'heading' | 'strong' | 'emphasis' | 'inline-code' | 'link' | 'image' | 'delete' | 'list' | 'task' | 'blockquote' | 'fence' | 'table' | 'thematic-break'
  readonly sourceStart: number
  readonly sourceEnd: number
  readonly semanticStart: number
  readonly semanticEnd: number
  readonly markers: readonly { readonly start: number; readonly end: number }[]
  readonly depth: number
  readonly complete: boolean
}

/**
 * Project one parsed draft without coupling caret presentation to parsing.
 * @param tree - parsed GFM tree for the masked source.
 * @param source - source text used to derive marker positions.
 * @returns source-preserving text, syntax, block, and construct projections.
 */
export function projectGfm(
  tree: Root,
  source = '',
  options: MarkdownProjectionOptions = {},
): MarkdownSourceProjection {
  const ranges: ComposerDecorationRange[] = []
  const markers: ComposerDecorationRange[] = []
  const structuralRanges: ComposerDecorationRange[] = []
  const constructs: MarkdownConstructRecord[] = []
  // HTML block ranges are presentation barriers for the line-scanner fallback:
  // a fence-like line inside an HTML block is literal text, never an opener.
  const htmlRanges: { start: number; end: number }[] = []
  const visit = (node: MarkdownNode, listKind?: 'bullet' | 'ordered', depth = 0, tableHeader = false): void => {
    const range = positionOf(node)
    if (node.type === 'html' && range !== undefined) htmlRanges.push(range)
    const className = classes[node.type]
    const markerStart = markers.length
    if (range !== undefined && className !== undefined) {
      if (node.type === 'link') {
        const label = explicitLinkLabel(node, source)
        if (label !== undefined) {
          ranges.push({ ...label, className })
          addMarker(markers, range.start, label.start)
          addMarker(markers, label.end, range.end)
        }
      } else if (node.type === 'image') {
        const alt = explicitImageAlt(node, source)
        if (alt !== undefined) {
          ranges.push({ ...alt, className })
          addMarker(markers, range.start, alt.start)
          addMarker(markers, alt.end, range.end)
        }
      } else if (node.type === 'tableCell') {
        const content = tableCellContent(node)
        if (content !== undefined) ranges.push({ ...content, className: tableHeader ? 'dsh-better-composer-table-header-cell' : 'dsh-better-composer-table-cell' })
      } else {
        ranges.push({ ...range, className, ...(node.type === 'code' ? { priority: 10 } : {}) })
      }
    }
    if (range !== undefined) addStructuralRanges(structuralRanges, node, range, source, listKind, tableHeader)
    if (range !== undefined) addNodeMarkers(markers, node, range, source)
    if (node.type === 'table' && range !== undefined) {
      for (const separator of tableSeparatorRanges(range, source)) {
        ranges.push({ ...separator, className: 'dsh-better-composer-table-separator', layer: 'syntax' })
      }
    }
    if (node.type === 'list' && range !== undefined) {
      listKind = node.ordered === true ? 'ordered' : 'bullet'
      ranges.push({ ...range, className: `dsh-better-composer-${listKind}` })
    }
    if (node.type === 'listItem' && range !== undefined) {
      if (listKind !== undefined) ranges.push({ ...range, className: `dsh-better-composer-${listKind}` })
      ranges.push({ ...range, className: listDepthClass(source, range) })
      if (node.checked !== null && node.checked !== undefined) ranges.push({ ...range, className: 'dsh-better-composer-task' })
    }
    if (range !== undefined) {
      const nodeMarkers = markers.slice(markerStart).map(marker => ({ start: marker.start, end: marker.end }))
      const kind = constructKind(node, listKind)
      if (kind !== undefined) {
        const semantic = node.type === 'link' ? explicitLinkLabel(node, source) ?? range : range
        constructs.push({
          kind,
          sourceStart: range.start,
          sourceEnd: range.end,
          semanticStart: semantic.start,
          semanticEnd: semantic.end,
          markers: nodeMarkers,
          depth,
          complete: node.type !== 'code' || isCompleteFence(source.slice(range.start, range.end)),
        })
      }
    }
    for (const [index, child] of (node.children ?? []).entries()) {
      visit(child, listKind, depth + 1, node.type === 'table' ? index === 0 : tableHeader)
    }
  }
  for (const node of tree.children as unknown as readonly MarkdownNode[]) visit(node)
  const tokens = options.includeCodeTokens === false || source === '' ? [] : codeTokenRanges(source)
  const fences = markers.filter(range => range.className === 'dsh-better-composer-fence-marker' || range.className === 'dsh-better-composer-fence-language')
  const complete = constructs
  const fallback = boundedLexicalFallback(source, complete, htmlRanges)
  return {
    semanticRanges: ranges,
    markerRanges: markers.filter(range => range.className !== 'dsh-better-composer-fence-marker' && range.className !== 'dsh-better-composer-fence-language'),
    fenceRanges: [...fences, ...tokens],
    structuralRanges,
    constructs: [...complete, ...fallback],
    htmlRanges,
  }
}

function addStructuralRanges(
  ranges: ComposerDecorationRange[],
  node: MarkdownNode,
  range: { start: number; end: number },
  source: string,
  listKind: 'bullet' | 'ordered' | undefined,
  tableHeader: boolean,
): void {
  if (node.type === 'heading') {
    addBlockRange(ranges, range, 'dsh-better-composer-heading')
    const level = /^\s*(#{1,6})(?:[ \t]+|$)/u.exec(source.slice(range.start, range.end))?.[1]?.length
    if (level !== undefined) addBlockRange(ranges, range, `dsh-better-composer-heading-level-${level}`)
    return
  }
  if (node.type === 'thematicBreak') {
    addBlockRange(ranges, range, 'dsh-better-composer-thematic-break')
    return
  }
  if (node.type === 'image') {
    addBlockRange(ranges, range, 'dsh-better-composer-image-card')
    return
  }
  if (node.type === 'code') {
    if (!isCompleteFence(source.slice(range.start, range.end))) return
    const lines = lineRanges(range, source)
    for (const [index, line] of lines.entries()) {
      const position = lines.length === 1
        ? 'single'
        : index === 0 ? 'start' : index === lines.length - 1 ? 'end' : 'middle'
      addBlockRange(ranges, line, 'dsh-better-composer-code-block')
      addBlockRange(ranges, line, `dsh-better-composer-code-block-${position}`)
      if (index === 0 && hasFenceLanguage(source.slice(line.start, line.end))) {
        addBlockRange(ranges, line, 'dsh-better-composer-code-block-language')
      }
    }
    return
  }
  if (node.type === 'table') {
    addBlockRange(ranges, range, 'dsh-better-composer-table')
    const separators = tableSeparatorRanges(range, source)
    let headerAssigned = false
    const lines = lineRanges(range, source)
    for (const [index, line] of lines.entries()) {
      addBlockRange(ranges, line, 'dsh-better-composer-table-row')
      if (separators.some(separator => rangesIntersect(line.start, line.end, separator.start, separator.end))) {
        addBlockRange(ranges, line, 'dsh-better-composer-table-separator')
      } else if (!headerAssigned) {
        addBlockRange(ranges, line, 'dsh-better-composer-table-header-row')
        headerAssigned = true
      } else addBlockRange(ranges, line, 'dsh-better-composer-table-body-row')
      if (index === lines.length - 1) addBlockRange(ranges, line, 'dsh-better-composer-table-last-row')
    }
    return
  }
  if (node.type === 'list') {
    addBlockRange(ranges, range, `dsh-better-composer-${node.ordered === true ? 'ordered' : 'bullet'}`)
    return
  }
  if (node.type === 'listItem') {
    const kind = listKind ?? 'bullet'
    addBlockRange(ranges, range, `dsh-better-composer-${kind}`)
    addBlockRange(ranges, range, listDepthClass(source, range))
    if (node.checked !== null && node.checked !== undefined) {
      addBlockRange(ranges, range, 'dsh-better-composer-task')
      addBlockRange(ranges, range, node.checked ? 'dsh-better-composer-task-checked' : 'dsh-better-composer-task-unchecked')
    }
    return
  }
  if (node.type === 'blockquote') addBlockRange(ranges, range, 'dsh-better-composer-quote')
}

function addBlockRange(
  ranges: ComposerDecorationRange[],
  range: { start: number; end: number },
  className: string,
): void {
  if (range.end > range.start) ranges.push({ ...range, className, target: 'block' })
}

function lineRanges(range: { start: number; end: number }, source: string): readonly { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  let start = range.start
  while (start < range.end) {
    const newline = source.indexOf('\n', start)
    const end = newline < 0 || newline + 1 > range.end ? range.end : newline + 1
    out.push({ start, end })
    if (end === range.end) break
    start = end
  }
  return out
}

function hasFenceLanguage(line: string): boolean {
  return /^\s*(`{3,}|~{3,})[ \t]*[^ \t\r\n]+/u.test(line)
}

function constructKind(node: MarkdownNode, listKind?: 'bullet' | 'ordered'): MarkdownConstructRecord['kind'] | undefined {
  switch (node.type) {
    case 'heading': return 'heading'
    case 'strong': return 'strong'
    case 'emphasis': return 'emphasis'
    case 'inlineCode': return 'inline-code'
    case 'link': return 'link'
    case 'image': return 'image'
    case 'delete': return 'delete'
    case 'blockquote': return 'blockquote'
    case 'code': return 'fence'
    case 'table': return 'table'
    case 'thematicBreak': return 'thematic-break'
    case 'listItem': return node.checked === null || node.checked === undefined ? (listKind === undefined ? 'list' : 'list') : 'task'
    default: return undefined
  }
}

/** Find only high-confidence incomplete syntax near source delimiters. */
export function boundedLexicalFallback(
  source: string,
  complete: readonly MarkdownConstructRecord[] = [],
  barriers: readonly { readonly start: number; readonly end: number }[] = [],
): readonly MarkdownConstructRecord[] {
  const out: MarkdownConstructRecord[] = []
  const covered = (start: number, end: number): boolean => complete.some(record => start < record.sourceEnd && record.sourceStart < end)
  const blocked = (at: number): boolean => barriers.some(range => at >= range.start && at < range.end)
  const lineRe = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})([^\n]*)/gu
  const openFences: Array<{ start: number; marker: string; languageStart?: number; languageEnd?: number }> = []
  for (const match of source.matchAll(lineRe)) {
    const start = (match.index ?? 0) + match[1].length
    if (blocked(start)) continue
    const marker = match[2]
    const text = match[3] ?? ''
    if (openFences.length === 0) {
      const language = /^[ \t]+([^ \t]+)/u.exec(text) ?? /^([^ \t]+)/u.exec(text)
      const languageText = language?.[1]
      const languageStart = languageText === undefined ? undefined : start + match[0].lastIndexOf(languageText)
      openFences.push({ start, marker, ...(languageStart === undefined || languageText === undefined ? {} : { languageStart, languageEnd: languageStart + languageText.length }) })
    } else {
      const opening = openFences[openFences.length - 1]
      if (opening !== undefined && marker[0] === opening.marker[0] && marker.length >= opening.marker.length) openFences.pop()
    }
  }
  for (const opening of openFences) {
    const markerEnd = opening.start + opening.marker.length
    if (!covered(opening.start, source.length)) out.push({
      kind: 'fence', sourceStart: opening.start, sourceEnd: source.length,
      semanticStart: markerEnd, semanticEnd: source.length,
      markers: [{ start: opening.start, end: markerEnd }, ...(opening.languageStart === undefined || opening.languageEnd === undefined ? [] : [{ start: opening.languageStart, end: opening.languageEnd }])],
      depth: 0, complete: false,
    })
  }
  const fenced = complete.filter(record => record.kind === 'fence').map(record => ({ start: record.sourceStart, end: record.sourceEnd }))
  const inFence = (at: number): boolean => fenced.some(range => at >= range.start && at < range.end)
  const pending = new Map<string, number>()
  for (const match of source.matchAll(/\*\*|__|~~|`+|\*|_/gu)) {
    const at = match.index ?? 0
    if (inFence(at)) continue
    const token = match[0]
    const previous = pending.get(token)
    if (previous === undefined) pending.set(token, at)
    else pending.delete(token)
  }
  for (const [token, start] of pending) {
    if (covered(start, start + token.length)) continue
    out.push({ kind: token === '`' || token.startsWith('`') ? 'inline-code' : token.length === 2 ? 'strong' : 'emphasis', sourceStart: start, sourceEnd: source.length, semanticStart: start + token.length, semanticEnd: source.length, markers: [{ start, end: start + token.length }], depth: 0, complete: false })
  }
  const link = /\[[^\]\n]*\]\([^\)\n]*$/gu.exec(source)
  if (link !== null && !inFence(link.index)) {
    out.push({ kind: 'link', sourceStart: link.index, sourceEnd: source.length, semanticStart: link.index + 1, semanticEnd: Math.max(link.index + 1, source.length), markers: [{ start: link.index, end: Math.min(source.length, link.index + 1) }], depth: 0, complete: false })
  }
  return out
}

/** Select constructs whose hidden source must be revealed for one selection. */
export function selectActiveConstructs(
  records: readonly MarkdownConstructRecord[],
  selection: { readonly start: number; readonly end: number },
  composing = false,
): readonly MarkdownConstructRecord[] {
  if (composing) return records
  if (selection.start < 0 || selection.end < 0) return []
  const start = Math.max(0, Math.min(selection.start, Number.MAX_SAFE_INTEGER))
  const end = Math.max(start, selection.end)
  if (start !== end) return records.filter(record =>
    rangesIntersect(start, end, record.semanticStart, record.semanticEnd)
      || record.markers.some(marker => rangesIntersect(start, end, marker.start, marker.end)))
  const left = records.filter(record => record.sourceEnd === start).sort((a, b) => b.depth - a.depth)
  if (left.length > 0) return [left[0]!]
  const containing = records.filter(record => start >= record.sourceStart && start < record.sourceEnd)
  if (containing.length > 0) return [containing.sort((a, b) =>
    (a.sourceEnd - a.sourceStart) - (b.sourceEnd - b.sourceStart) || b.depth - a.depth)[0]!]
  return []
}

function rangesIntersect(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end
}

function codeTokenRanges(source: string): readonly ComposerDecorationRange[] {
  const ranges: ComposerDecorationRange[] = []
  const fence = /^([ \t]*)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(?:\n|^)[ \t]*\2[ \t]*$/gmu
  let match: RegExpExecArray | null
  while ((match = fence.exec(source)) !== null) {
    const language = match[3]?.trim().split(/\s+/u)[0] ?? ''
    const body = match[4] ?? ''
    const highlighted = highlightLines(body, language)
    if (highlighted === undefined) continue
    const bodyStart = match.index + match[0].indexOf(body)
    let offset = bodyStart
    for (const line of highlighted) {
      for (const token of line) {
        const length = token.text.length
        const color = token.style.color
        const category = typeof color === 'string' ? /--shiki-token-([\w-]+)/u.exec(color)?.[1] : undefined
        if (length > 0 && category !== undefined) ranges.push({
          start: offset, end: offset + length,
          className: `dsh-better-composer-shiki-token-${category}`,
          // Token colors refine the fenced-code text range. Core keeps only
          // the highest-priority syntax class per source slice; block
          // presentation supplies the panel background independently.
          layer: 'syntax', priority: 20,
        })
        offset += length
      }
      offset += 1
    }
  }
  return ranges
}

function explicitLinkLabel(node: MarkdownNode, source: string): { start: number; end: number } | undefined {
  const range = positionOf(node)
  if (range === undefined || source[range.start] !== '[') return undefined
  const children = (node.children ?? []).map(positionOf).filter((child): child is { start: number; end: number } => child !== undefined)
  const first = children[0]
  const last = children[children.length - 1]
  if (first === undefined || last === undefined || first.start >= last.end) return undefined
  return { start: first.start, end: last.end }
}

function explicitImageAlt(node: MarkdownNode, source: string): { start: number; end: number } | undefined {
  const range = positionOf(node)
  if (range === undefined) return undefined
  const match = /^!\[([^\]\n]*)\]\(/u.exec(source.slice(range.start, range.end))
  if (match === null || match[1] === undefined || match[1].length === 0) return undefined
  return { start: range.start + 2, end: range.start + 2 + match[1].length }
}

function tableCellContent(node: MarkdownNode): { start: number; end: number } | undefined {
  const children = (node.children ?? []).map(positionOf).filter((child): child is { start: number; end: number } => child !== undefined)
  const first = children[0]
  const last = children[children.length - 1]
  return first === undefined || last === undefined || first.start >= last.end
    ? undefined
    : { start: first.start, end: last.end }
}

function listDepthClass(source: string, range: { start: number }): string {
  const lineStart = source.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1
  const indentation = source.slice(lineStart, range.start).replace(/\t/gu, '  ')
  return `dsh-better-composer-list-depth-${Math.min(6, Math.floor(indentation.length / 2) + 1)}`
}

function listMarkerClass(source: string, range: { start: number }, raw: string): string {
  const depth = listDepthClass(source, range).replace('dsh-better-composer-list-depth-', '')
  return /^\d+[.)]/u.test(raw.trim())
    ? `dsh-better-composer-ordered-marker-depth-${depth}`
    : `dsh-better-composer-list-marker-depth-${depth}`
}

function addTableMarkers(
  markers: ComposerDecorationRange[],
  range: { start: number },
  raw: string,
): void {
  let lineStart = range.start
  for (const line of raw.split('\n')) {
    if (/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/u.test(line)) {
      addMarker(markers, lineStart, lineStart + line.length, 'dsh-better-composer-table-separator')
    } else {
      for (const match of line.matchAll(/\|/gu)) {
        const at = match.index
        if (at !== undefined) addMarker(markers, lineStart + at, lineStart + at + 1, 'dsh-better-composer-table-divider')
      }
    }
    lineStart += line.length + 1
  }
}

function tableSeparatorRanges(range: { start: number; end: number }, source: string): readonly { start: number; end: number }[] {
  const raw = source.slice(range.start, range.end)
  const ranges: { start: number; end: number }[] = []
  let lineStart = range.start
  for (const line of raw.split('\n')) {
    if (/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/u.test(line)) {
      ranges.push({ start: lineStart, end: lineStart + line.length })
    }
    lineStart += line.length + 1
  }
  return ranges
}

function addNodeMarkers(
  markers: ComposerDecorationRange[],
  node: MarkdownNode,
  range: { start: number; end: number },
  source: string,
): void {
  const raw = source.slice(range.start, range.end)
  if (node.type === 'heading') {
    const prefix = /^#{1,6}(?:[ \t]+|$)/u.exec(raw)?.[0]
    if (prefix !== undefined) addMarker(markers, range.start, range.start + prefix.length)
    return
  }
  if (node.type === 'strong') {
    addSymmetricMarker(markers, range, raw, raw.startsWith('**') ? '**' : raw.startsWith('__') ? '__' : undefined)
    return
  }
  if (node.type === 'emphasis') {
    addSymmetricMarker(markers, range, raw, raw.startsWith('*') ? '*' : raw.startsWith('_') ? '_' : undefined)
    return
  }
  if (node.type === 'delete') {
    addSymmetricMarker(markers, range, raw, raw.startsWith('~~') ? '~~' : undefined)
    return
  }
  if (node.type === 'inlineCode') {
    const delimiter = /^`+/u.exec(raw)?.[0]
    addSymmetricMarker(markers, range, raw, delimiter)
    return
  }
  if (node.type === 'image') {
    const alt = explicitImageAlt(node, source)
    if (alt !== undefined) {
      addMarker(markers, range.start, alt.start)
      addMarker(markers, alt.end, range.end)
    }
    return
  }
  if (node.type === 'thematicBreak') {
    addMarker(markers, range.start, range.end, 'dsh-better-composer-thematic-break-marker')
    return
  }
  if (node.type === 'listItem') {
    const prefix = /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/u.exec(raw)?.[0]
    if (prefix !== undefined) addMarker(markers, range.start, range.start + prefix.length, listMarkerClass(source, range, prefix))
    return
  }
  if (node.type === 'blockquote') {
    let lineStart = range.start
    for (const line of raw.split('\n')) {
      const prefix = /^[ \t]{0,3}>[ \t]?/u.exec(line)?.[0]
      if (prefix !== undefined) addMarker(markers, lineStart, lineStart + prefix.length)
      lineStart += line.length + 1
    }
    return
  }
  if (node.type === 'code') addFenceMarkers(markers, range, raw)
  if (node.type === 'table') addTableMarkers(markers, range, raw)
}

function addSymmetricMarker(
  markers: ComposerDecorationRange[],
  range: { start: number; end: number },
  raw: string,
  delimiter: string | undefined,
): void {
  if (delimiter === undefined || !raw.endsWith(delimiter) || raw.length < delimiter.length * 2) return
  addMarker(markers, range.start, range.start + delimiter.length)
  addMarker(markers, range.end - delimiter.length, range.end)
}

function addFenceMarkers(
  markers: ComposerDecorationRange[],
  range: { start: number; end: number },
  raw: string,
): void {
  const opening = /^([ \t]*)(`{3,}|~{3,})([^\n]*)/u.exec(raw)
  if (opening === null) return
  const fenceStart = range.start + opening[1].length
  addMarker(markers, fenceStart, fenceStart + opening[2].length, 'dsh-better-composer-fence-marker')
  const language = opening[3].trim().split(/\s+/u)[0] ?? ''
  const languageAt = language === '' ? -1 : raw.indexOf(language, opening[1].length + opening[2].length)
  if (languageAt >= 0) addMarker(markers, range.start + languageAt, range.start + languageAt + language.length, 'dsh-better-composer-fence-language')
  const closingLineAt = raw.lastIndexOf('\n') + 1
  const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/u.exec(raw.slice(closingLineAt))
  if (closing !== null) {
    const closingAt = range.start + closingLineAt + closing[0].indexOf(closing[1])
    addMarker(markers, closingAt, closingAt + closing[1].length, 'dsh-better-composer-fence-marker')
  }
}

function isCompleteFence(raw: string): boolean {
  const opening = /^([ \t]*)(`{3,}|~{3,})[^\n]*(?:\n|$)/u.exec(raw)
  if (opening === null) return true
  const marker = opening[2]
  const character = marker[0]
  const minimumLength = marker.length
  return raw.slice(opening[0].length).split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed.length >= minimumLength && [...trimmed].every(value => value === character)
  })
}

function addMarker(
  markers: ComposerDecorationRange[],
  start: number,
  end: number,
  className = 'dsh-better-composer-marker',
): void {
  if (end > start) markers.push({ start, end, className, layer: 'syntax', priority: 10 })
}

function positionOf(node: MarkdownNode): { start: number; end: number } | undefined {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (!Number.isInteger(start) || !Number.isInteger(end) || start! >= end!) return undefined
  return { start: start!, end: end! }
}
