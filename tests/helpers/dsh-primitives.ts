/**
 * Test double for `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The published primitives package does not yet export the markdown surface
 * this plugin builds on (parseGfm / highlightLines / grammar hooks); the DSH
 * host provides them at runtime. For repository tests we re-export the real
 * published module and fill the gap with ports of the host implementations
 * (MIT, (c) DeepSeek — see the DSH harness repository).
 */
export * from '../../node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js'

import type { Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

// --- parseGfm -----------------------------------------------------------------

/** Let asterisk strong emphasis close after punctuation when CJK prose continues without whitespace. */

import { attention } from 'micromark-core-commonmark'
import { unicodePunctuation } from 'micromark-util-character'
import { classifyCharacter } from 'micromark-util-classify-character'
import { codes, constants } from 'micromark-util-symbol'
import type { Construct, Extension, State, Tokenizer } from 'micromark-util-types'

const cjkCharacter = new RegExp([
  '\\p{Script_Extensions=Han}',
  '\\p{Script_Extensions=Hiragana}',
  '\\p{Script_Extensions=Katakana}',
  '\\p{Script_Extensions=Hangul}',
  '\\p{Script_Extensions=Bopomofo}',
].join('|'), 'u')

function isCjkCharacter(code: number | null): boolean {
  return code !== null && code >= 0 && cjkCharacter.test(String.fromCodePoint(code))
}

const tokenizeCjkFriendlyAttention: Tokenizer = function (effects, ok, nok) {
  const configuredAttentionMarkers = this.parser.constructs.attentionMarkers.null
  if (configuredAttentionMarkers === undefined) {
    throw new Error('micromark CommonMark attention markers are unavailable')
  }
  const attentionMarkers = configuredAttentionMarkers
  const previous = this.previous
  const before = classifyCharacter(previous)
  let marker: number | null = codes.eof

  return start

  function start(code: number | null): State | undefined {
    /* v8 ignore next -- this text construct is dispatched only for an asterisk. */
    if (code !== codes.asterisk) return nok(code)
    marker = code
    effects.enter('attentionSequence')
    return inside(code)
  }

  function inside(code: number | null): State | undefined {
    if (code === marker) {
      effects.consume(code)
      return inside
    }

    const token = effects.exit('attentionSequence')
    const after = classifyCharacter(code)
    const open = !after || (after === constants.characterGroupPunctuation && Boolean(before))
      || attentionMarkers.includes(code)
    const commonMarkClose = !before
      || (before === constants.characterGroupPunctuation && Boolean(after))
      || attentionMarkers.includes(previous)
    const markerCount = token.end.offset - token.start.offset
    const cjkStrongClose = markerCount >= 2
      && unicodePunctuation(previous)
      && isCjkCharacter(code)
    const close = commonMarkClose || cjkStrongClose

    token._open = open
    token._close = close
    return ok(code)
  }
}

const cjkFriendlyAttention: Construct = {
  name: 'cjkFriendlyAttention',
  resolveAll: attention.resolveAll,
  tokenize: tokenizeCjkFriendlyAttention,
}

const cjkFriendlyStrongExtension: Extension = {
  text: { [codes.asterisk]: cjkFriendlyAttention },
}

/**
 * Extend CommonMark asterisk strong emphasis for punctuation-delimited CJK
 * prose, as a micromark syntax extension for `fromMarkdown`.
 * @returns The micromark syntax extension.
 */
export function cjkFriendlyStrong(): Extension {
  return cjkFriendlyStrongExtension
}


export function parseGfm(text: string): Root {
  return fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

// --- highlightLines ------------------------------------------------------------

import type { LanguageRegistration } from 'shiki/core'
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'

export interface HighlightSpan {
  readonly text: string
  readonly style: { readonly color?: string }
}

const cssVariablesTheme = createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })
const regexEngine = createJavaScriptRegexEngine({ forgiving: true, regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, { lazyCompileLength: Number.POSITIVE_INFINITY }) })
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'

const highlighter = createHighlighterCoreSync({
  themes: [cssVariablesTheme],
  langs: [langTs as LanguageRegistration, langBash as LanguageRegistration, langJson as LanguageRegistration],
  engine: regexEngine,
})

const LAZY_GRAMMARS = new Map<string, () => Promise<{ default: LanguageRegistration[] }>>([
  ['python', () => import('@shikijs/langs/python')],
  ['ruby', () => import('@shikijs/langs/ruby')],
  ['go', () => import('@shikijs/langs/go')],
  ['rust', () => import('@shikijs/langs/rust')],
  ['java', () => import('@shikijs/langs/java')],
  ['yaml', () => import('@shikijs/langs/yaml')],
  ['markdown', () => import('@shikijs/langs/markdown')],
  ['html', () => import('@shikijs/langs/html')],
  ['css', () => import('@shikijs/langs/css')],
  ['sql', () => import('@shikijs/langs/sql')],
  ['xml', () => import('@shikijs/langs/xml')],
])

const LANG_ALIASES = new Map<string, string>([
  ['ts', 'typescript'], ['tsx', 'typescript'], ['js', 'typescript'], ['jsx', 'typescript'], ['javascript', 'typescript'],
  ['bash', 'shellscript'], ['sh', 'shellscript'], ['shell', 'shellscript'], ['zsh', 'shellscript'],
  ['json', 'json'], ['jsonc', 'json'],
  ['py', 'python'], ['python', 'python'],
  ['rb', 'ruby'], ['ruby', 'ruby'],
  ['go', 'go'], ['rs', 'rust'], ['rust', 'rust'], ['java', 'java'],
  ['yaml', 'yaml'], ['yml', 'yaml'], ['toml', 'yaml'],
  ['md', 'markdown'], ['markdown', 'markdown'],
  ['html', 'html'], ['css', 'css'], ['scss', 'css'], ['less', 'css'],
  ['sql', 'sql'], ['xml', 'xml'],
])

let grammarLoads = 0
const grammarListeners = new Set<() => void>()
const requested = new Set<string>()

function ensureGrammar(resolved: string): boolean {
  const load = LAZY_GRAMMARS.get(resolved)
  if (load === undefined) return true
  if (highlighter.getLoadedLanguages().includes(resolved)) return true
  if (!requested.has(resolved)) {
    requested.add(resolved)
    void load().then(mod => {
      highlighter.loadLanguageSync(mod.default)
      grammarLoads += 1
      for (const listener of grammarListeners) listener()
    })
  }
  return false
}

export function grammarLoadCount(): number {
  return grammarLoads
}

export function subscribeGrammarLoaded(listener: () => void): () => void {
  grammarListeners.add(listener)
  return () => { grammarListeners.delete(listener) }
}

export function highlightLines(code: string, lang: string | undefined): readonly (readonly HighlightSpan[])[] | undefined {
  const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
  if (resolved === undefined) return undefined
  if (!ensureGrammar(resolved)) return undefined
  const { tokens } = highlighter.codeToTokens(code, { lang: resolved, theme: 'css-variables' })
  const last = tokens[tokens.length - 1]
  const lines = tokens.length > 1 && last !== undefined && last.length === 0 ? tokens.slice(0, -1) : tokens
  return lines.map(line => line.map(token => ({ text: token.content, style: { color: token.color } })))
}
