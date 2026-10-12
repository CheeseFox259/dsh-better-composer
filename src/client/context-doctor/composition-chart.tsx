import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { CompositionRow } from './view-model.ts'
import { formatTokens } from './format.ts'

export interface CompositionSegment {
  readonly key: string
  readonly label: string
  readonly value: number | null
  readonly share: number | null
}

export const COMPOSITION_COLORS: Record<string, string> = {
  system: 'var(--doctor-system)', tools: 'var(--doctor-definitions)', 'tool-definition': 'var(--doctor-definitions)',
  'skill-catalog': 'var(--doctor-catalog)', 'skill-body': 'var(--doctor-skills)', messages: 'var(--doctor-messages)',
  message: 'var(--doctor-messages)', 'tool-result': 'var(--doctor-results)', reference: 'var(--doctor-reference)', unknown: 'var(--doctor-unknown)',
}

export function compositionSegments(rows: readonly CompositionRow[]): readonly CompositionSegment[] {
  return rows.filter(row => row.bytes > 0).map(row => ({ key: row.bucket, label: row.label, value: row.estimatedTokens, share: row.share }))
}

function arc(start: number, end: number): string {
  const point = (angle: number) => [62 + 47 * Math.cos(angle - Math.PI / 2), 62 + 47 * Math.sin(angle - Math.PI / 2)]
  const from = point(start)
  const to = point(end)
  return `M ${from[0]} ${from[1]} A 47 47 0 ${end - start > Math.PI ? 1 : 0} 1 ${to[0]} ${to[1]}`
}

/** One chart renderer for native projections, Doctor snapshots and the composer. */
export function CompositionChart({ segments: supplied, rows = [], total, compact = false, selectedKey, onSelect, onInspect, previewKey, onPreview, caption = '构成估算 tokens' }: {
  readonly segments?: readonly CompositionSegment[]
  readonly rows?: readonly CompositionRow[]
  readonly total: number | null
  readonly compact?: boolean
  readonly selectedKey?: string
  readonly onSelect?: (key: string) => void
  readonly onInspect?: (key: string) => void
  readonly previewKey?: string
  readonly onPreview?: (key: string | undefined) => void
  readonly caption?: string
}) {
  const id = useId()
  const [localPreview, setLocalPreview] = useState<string>()
  const preview = onPreview ? previewKey : localPreview
  const setPreview = onPreview ?? setLocalPreview
  const segments = supplied ?? compositionSegments(rows)
  const select = onSelect ?? onInspect
  const active = preview ?? selectedKey
  let offset = 0
  const parts = segments.filter(segment => total !== null && (segment.share ?? 0) > 0).map(segment => {
    const length = (segment.share ?? 0) * 2 * Math.PI
    const gap = Math.min(.06, length * .2)
    const middle = offset + length / 2 - Math.PI / 2
    const path = arc(offset + gap / 2, offset + length - gap / 2)
    offset += length
    return { segment, middle, path }
  })
  const description = (segment: CompositionSegment) => `${segment.label}：${segment.value === null ? '未观测' : `${formatTokens(segment.value)} tokens`}${segment.share === null ? '' : `，${(segment.share * 100).toFixed(1)}%`}`
  const keyboard = (event: KeyboardEvent<SVGGElement>, key: string) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select?.(key); return }
    if (event.key === 'Escape') { setPreview(undefined); return }
    const nodes = [...(event.currentTarget.parentElement?.querySelectorAll<SVGElement>('[data-segment]') ?? [])]
    const index = nodes.indexOf(event.currentTarget)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length - 1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % nodes.length : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + nodes.length - 1) % nodes.length : undefined
    if (next !== undefined) { event.preventDefault(); nodes[next]?.focus() }
  }
  return <div className={`doctor-composition ${compact ? 'is-compact' : ''}`}>
    <div className="doctor-ring-wrap">
      <svg viewBox="0 0 124 124" role={compact || !select ? 'img' : 'group'} aria-labelledby={`${id}-title`} className="doctor-ring">
        <title id={`${id}-title`}>{total === null ? '上下文构成尚未读取' : `上下文构成，约 ${formatTokens(total)} tokens`}</title>
        <circle cx="62" cy="62" r="47" fill="none" stroke="var(--doctor-track)" strokeWidth={compact ? 19 : 16} />
        {parts.map(({ segment, middle, path }) => {
          const raised = !compact && active === segment.key
          const distance = raised ? preview ? 4 : 6 : 0
          return <g key={segment.key} data-segment={compact ? undefined : segment.key} data-preview={!compact && preview === segment.key ? 'true' : 'false'} data-raised={raised ? 'true' : 'false'} data-dim={!compact && active && !raised ? 'true' : 'false'}
            role={!compact && select ? 'button' : undefined} tabIndex={!compact && select ? 0 : undefined} aria-label={description(segment)} aria-pressed={!compact && select ? selectedKey === segment.key : undefined}
            onMouseEnter={compact ? undefined : () => setPreview(segment.key)} onMouseLeave={compact ? undefined : () => setPreview(undefined)} onFocus={compact ? undefined : () => setPreview(segment.key)} onBlur={compact ? undefined : () => setPreview(undefined)} onKeyDown={compact ? undefined : event => keyboard(event, segment.key)} onClick={compact ? undefined : () => select?.(segment.key)}
            style={{ transform: `translate(${Math.cos(middle) * distance}px, ${Math.sin(middle) * distance}px)` }} className="doctor-ring-part">
            <path d={path} fill="none" stroke={COMPOSITION_COLORS[segment.key] ?? COMPOSITION_COLORS.unknown} strokeWidth={compact ? 19 : 16} />
            <title>{description(segment)}</title>
          </g>
        })}
      </svg>
      {!compact && <div className="doctor-ring-center"><strong>{total === null ? '—' : formatTokens(total)}</strong><span>{caption}</span></div>}
    </div>
    {!compact && <div className="doctor-composition-legend">{segments.map(segment => <button key={segment.key} data-legend={segment.key} data-active={active === segment.key ? 'true' : 'false'} type="button" className="doctor-legend-row" onClick={() => select?.(segment.key)} disabled={!select} aria-pressed={selectedKey === segment.key}
      onMouseEnter={() => setPreview(segment.key)} onMouseLeave={() => setPreview(undefined)} onFocus={() => setPreview(segment.key)} onBlur={() => setPreview(undefined)}>
      <span className="doctor-color-dot" style={{ background: COMPOSITION_COLORS[segment.key] ?? COMPOSITION_COLORS.unknown }} />
      <span className="doctor-legend-name">{segment.label}</span><span className="doctor-legend-value">{segment.value === null ? '未观测' : formatTokens(segment.value)}</span><span className="doctor-legend-share">{segment.share === null ? '—' : `${(segment.share * 100).toFixed(0)}%`}</span>
    </button>)}</div>}
  </div>
}
