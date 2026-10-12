const MIN_TABLE_COLUMN_WIDTH = 6
const MAX_TABLE_COLUMN_WIDTH = 48

export interface MarkdownTableRowData {
  readonly start: number
  readonly end: number
  readonly cells: readonly string[]
  readonly header: boolean
  readonly last: boolean
}

export function tableColumnWidths(source: string): readonly number[] {
  const widths: number[] = []
  for (const line of source.split(/\r?\n/u)) {
    if (isTableSeparator(line)) continue
    for (const [index, cell] of tableCells(line).entries()) {
      widths[index] = Math.max(widths[index] ?? 0, displayWidth(cell))
    }
  }
  return widths.map(width => Math.min(MAX_TABLE_COLUMN_WIDTH, Math.max(MIN_TABLE_COLUMN_WIDTH, width + 2)))
}

export function tableRows(source: string, sourceStart: number): readonly MarkdownTableRowData[] {
  const rows: Array<Omit<MarkdownTableRowData, 'last'>> = []
  let cursor = 0
  while (cursor <= source.length) {
    const newline = source.indexOf('\n', cursor)
    const rawEnd = newline < 0 ? source.length : newline
    const lineEnd = rawEnd > cursor && source[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd
    const line = source.slice(cursor, lineEnd)
    if (!isTableSeparator(line) && line.trim() !== '') {
      rows.push({
        start: sourceStart + cursor,
        end: sourceStart + lineEnd,
        cells: tableCells(line),
        header: rows.length === 0,
      })
    }
    if (newline < 0) break
    cursor = newline + 1
  }
  return rows.map((row, index) => ({ ...row, last: index === rows.length - 1 }))
}

export function tableCells(line: string): readonly string[] {
  const trimmed = line.trim()
  const withoutLeading = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
  const withoutEdge = withoutLeading.endsWith('|') ? withoutLeading.slice(0, -1) : withoutLeading
  return withoutEdge.split('|').map(cell => cell.trim())
}

export function isTableSeparator(line: string): boolean {
  return /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/u.test(line)
}

function displayWidth(value: string): number {
  let width = 0
  for (const character of value) {
    if (/\p{Mark}/u.test(character)) continue
    if (character === '\t') {
      width += 4
      continue
    }
    const codePoint = character.codePointAt(0) ?? 0
    width += isWideCodePoint(codePoint) ? 2 : 1
  }
  return width
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  )
}
