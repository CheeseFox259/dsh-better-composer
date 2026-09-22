const SECTION_NAMES = ['goal', 'task', 'context', 'constraints', 'requirements', 'validation', 'acceptance criteria'] as const
export type PromptSectionName = typeof SECTION_NAMES[number]

/** A recognized agent-prompt section and its source span. */
export interface PromptSection { readonly name: PromptSectionName; readonly start: number; readonly end: number; readonly headingStart: number; readonly headingEnd: number }
/** Structural facts used by Composer guidance. */
export interface PromptStructure { readonly sections: readonly PromptSection[]; readonly missing: readonly PromptSectionName[]; readonly hasCodeFence: boolean; readonly lineCount: number }

/** Analyze headings and fenced code in an agent task prompt. */
export function analyzePromptStructure(source: string): PromptStructure {
  const sections: PromptSection[] = []
  const heading = /^(#{1,6})\s+(.+?)\s*$/gmu
  const matches = [...source.matchAll(heading)]
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const normalized = match[2].toLowerCase().replace(/[:：]+$/u, '').trim() as PromptSectionName
    if (!(SECTION_NAMES as readonly string[]).includes(normalized)) continue
    const start = match.index ?? 0
    const headingEnd = start + match[0].length
    const next = matches[index + 1]?.index ?? source.length
    sections.push({ name: normalized, start, end: next, headingStart: start, headingEnd })
  }
  const present = new Set(sections.map(section => section.name))
  return { sections, missing: SECTION_NAMES.filter(name => !present.has(name)), hasCodeFence: /^\s*(`{3,}|~{3,})/mu.test(source), lineCount: source === '' ? 0 : source.split('\n').length }
}
