import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const styles = readFileSync(new URL('../../src/client/styles.css', import.meta.url), 'utf8')

describe('live Markdown styles', () => {
  const ruleBody = (selector: string): string => new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'u').exec(styles)?.[1] ?? ''

  it('keeps inline styles paint-only and restores level/block styles separately', () => {
    const heading = /\.dsh-better-composer-heading\s*\{([^}]*)\}/u.exec(styles)?.[1] ?? ''
    const strong = /\.dsh-better-composer-strong\s*\{([^}]*)\}/u.exec(styles)?.[1] ?? ''
    expect(heading).toMatch(/(?:background-color|text-decoration|text-shadow):/u)
    expect(strong).toMatch(/(?:background-color|text-decoration|text-shadow):/u)
    for (const rule of [heading, strong]) {
      expect(rule).not.toMatch(/(?:font(?:-size|-family|-weight|-style)?|line-height|letter-spacing|display|margin|padding)\s*:/u)
    }
    for (const level of [1, 2, 3]) {
      expect(styles).toMatch(new RegExp(`\\.dsh-better-composer-heading-level-${level}\\s*\\{[^}]*font-size:`, 'u'))
    }
    expect(styles).toMatch(/\.dsh-better-composer-code-block\s*\{/u)
    expect(styles).toMatch(/\.dsh-better-composer-code-block-start\s*\{[^}]*font-family:/u)
    expect(styles).not.toMatch(/\.dsh-better-composer-code-block-language::after/u)
    expect(styles).toMatch(/\.dsh-better-composer-code-language-select\s*\{[^}]*pointer-events:\s*auto/u)
    expect(styles).toMatch(/::highlight\(dsh-composer-dsh-better-composer-shiki-token-string\)/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-row\s*\{/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-row\s*\{[^}]*width:\s*100%/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-row\s*\{[^}]*min-width:\s*9\.5rem/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-visual-row\s*\{[^}]*display:\s*grid/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-visual-cell\s*\{[^}]*padding:\s*8px 12px/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-visual-cell\s*\{[^}]*justify-content:\s*center/u)
    expect(styles).toMatch(/::highlight\(dsh-composer-dsh-better-composer-table-divider-hidden\)/u)
    expect(styles).toMatch(/::highlight\(dsh-composer-dsh-better-composer-fence-language-visible\)/u)
    expect(styles).toMatch(/\.dsh-better-composer-list-depth-3\s*\{/u)
    expect(styles).toMatch(/\.dsh-better-composer-bullet\.dsh-better-composer-list-depth-2:not\(\.dsh-better-composer-task\)::before/u)
    expect(styles).toMatch(/\.dsh-better-composer-task::before/u)
    expect(styles).toMatch(/\.dsh-better-composer-quote\s*\{[^}]*border-inline-start:/u)
    expect(styles).toMatch(/list-marker-depth-2-hidden/u)
    expect(styles).toMatch(/\.dsh-better-composer-image-card\s*\{/u)
    expect(styles).toMatch(/\.dsh-better-composer-thematic-break\s*\{/u)
  })

  it('uses quiet table and code surfaces without showing hidden source width', () => {
    const tableDividerHidden = ruleBody('::highlight\\(dsh-composer-dsh-better-composer-table-divider-hidden\\)')
    const codeBlock = ruleBody('\\.dsh-better-composer-code-block')
    const codeStart = ruleBody('\\.dsh-better-composer-code-block-start')
    const codeStartHidden = ruleBody('\\.dsh-better-composer-code-block-start-source-hidden')
    const codeEndHidden = ruleBody('\\.dsh-better-composer-code-block-end-source-hidden')

    expect(tableDividerHidden).toMatch(/color:\s*transparent/u)
    expect(tableDividerHidden).toMatch(/opacity:\s*0/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-separator,\s*\.dsh-better-composer-table-separator-hidden\s*\{[^}]*padding:\s*0/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-separator,\s*\.dsh-better-composer-table-separator-hidden\s*\{[^}]*line-height:\s*0/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-separator-hidden\s*\{[^}]*display:\s*block/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-separator-active\s*\{[^}]*height:\s*auto/u)
    expect(codeBlock).toMatch(/overflow:\s*hidden/u)
    expect(codeBlock).not.toMatch(/box-shadow:/u)
    expect(codeStart).toMatch(/border-top-left-radius:\s*18px/u)
    expect(codeStart).toMatch(/background:\s*color-mix\(/u)
    expect(codeStartHidden).toMatch(/text-indent:\s*0/u)
    expect(codeEndHidden).toMatch(/line-height:\s*0/u)
    expect(styles).toMatch(/\.dsh-better-composer-table-row\s*\+\s*p:has\(>\s*br\[data-lexical-managed-linebreak\]\),\s*\.dsh-better-composer-code-block-end\s*\+\s*p:has\(>\s*br\[data-lexical-managed-linebreak\]\)\s*\{[^}]*min-height:\s*8px/u)
  })
})
