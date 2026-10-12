/**
 * Observed version fingerprints for Context Doctor. Pure rules over session
 * events: what capabilities were visible at the cutoff, content-addressed so
 * equal observations group together and distinct observations never merge
 * (architecture.md §6, §14.1). Historical configuration versions stay
 * `unknown`; the fingerprint is an observed capability dimension, never a
 * substitute for a full configuration version.
 */
import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Content-address one exact byte string; the `v1.` prefix versions the method. */
export function contentHash(text: string): string {
  return `v1.${createHash('sha256').update(text, 'utf8').digest('base64url')}`
}

/** Deterministic JSON: sorted object keys, arrays in order. Same content → same bytes. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
}

/** One observed dimension of the capability fingerprint; undefined when unobserved. */
export interface FingerprintParts {
  /** Hash of the latest request header's tool schemas, in header order. */
  readonly toolDefinitions?: string
  /** Hash of the concatenated nonempty system prompt nodes. */
  readonly systemHead?: string
  /** Hash of the provider/model route from the latest request header. */
  readonly modelRoute?: string
  /** Hash of observed skill-catalog entries, in surface order. */
  readonly skillCatalog?: string
}

/** What was observable about capabilities at the snapshot cutoff. */
export interface ObservedFingerprint {
  /** Combined digest over every observed part. */
  readonly digest: string
  readonly parts: FingerprintParts
  /** Why an expected part could not be observed; never silently dropped. */
  readonly gaps: readonly string[]
}

function textOf(content: readonly { type: string; text?: string }[]): string {
  return content.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text!).join('')
}

function latestRequestHeader(events: readonly SessionEvent[]): SessionEvent<'request/header'> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type === 'request/header') return event
  }
  return undefined
}

/** Observe the capability fingerprint from one frozen event prefix. */
export function fingerprintEvents(events: readonly SessionEvent[]): ObservedFingerprint {
  const parts: Record<string, string> = {}
  const gaps: string[] = []

  const header = latestRequestHeader(events)
  if (header === undefined) {
    gaps.push('request-header-missing')
  } else {
    if (header.data.header.tools !== undefined && header.data.header.tools.length > 0) {
      parts['toolDefinitions'] = contentHash(header.data.header.tools.map((tool) => canonicalize(tool)).join('\n'))
    }
    const config = header.data.header.config
    parts['modelRoute'] = contentHash(canonicalize({ provider: config.provider, model: config.model }))
  }

  const systemText = events
    .filter((event) => event.type === 'system/message')
    .map((event) => textOf(event.data.message.content))
    .filter((text) => text.length > 0)
    .join('\n')
  if (systemText.length > 0) parts['systemHead'] = contentHash(systemText)

  const catalogSources = events
    .filter((event) => event.type === 'user/message')
    .map((event) => event.data.source)
    .filter((source) => (source as { readonly kind?: string }).kind === 'skill-catalog')
  if (catalogSources.length > 0) parts['skillCatalog'] = contentHash(catalogSources.map((source) => canonicalize(source)).join('\n'))

  const defined = Object.entries(parts).sort(([left], [right]) => left.localeCompare(right))
  const digest = contentHash(defined.map(([key, hash]) => `${key}=${hash}`).join(';'))
  return { digest, parts: parts as FingerprintParts, gaps }
}

/**
 * Grouping key for mode samples: the mode id plus the observed capability
 * fingerprint. Historical sessions carry `cfg:unknown` — their authoritative
 * configuration version was never persisted (A12), and the fingerprint must
 * not impersonate one.
 */
export function modeSampleGroupKey(modeId: string, fingerprint: ObservedFingerprint): string {
  return `${modeId}#cfg:unknown#fp:${fingerprint.digest}`
}
