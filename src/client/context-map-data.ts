import { buildContextBrowser, summarizeContextWindow } from './context-map.ts'
import type { ContextBrowserModel, ContextSummary } from './context-map.ts'
import type { CompositionSegment } from './context-doctor/composition-chart.tsx'

/** Public client-session observations and user-initiated native commands. */
export interface ContextMapProbe {
  version(): number
  subscribe(listener: () => void): () => void
  projection(key: 'contextPressure' | 'contextBreakdown' | 'tokenUsage'): unknown
  events(): { readonly entries: readonly unknown[]; readonly revision: number }
  draftClips(): number
  historyLoading(): boolean
  loadAllHistory(): void
  compact(): Promise<void>
  forkAt(endSeq: number): Promise<void>
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}
export function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Native composition is heuristic; pressure is a distinct Host projection. */
export function readRuntimeComposition(probe: ContextMapProbe, summary?: ContextSummary) {
  const breakdown = asRecord(probe.projection('contextBreakdown'))
  const pressure = asRecord(probe.projection('contextPressure'))
  const values = [numberOf(breakdown.systemTokens) ?? null, numberOf(breakdown.toolsTokens) ?? null,
    numberOf(breakdown.messageTokens) ?? (summary && probe.events().entries.length ? summary.estimatedMessageTokens : null)]
  const total = values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null
  const projected = numberOf(pressure.projectedTokens) ?? total
  const window = numberOf(pressure.contextWindow) ?? null
  const occupancy = projected !== null && window !== null && window > 0 ? Math.min(1, projected / window) : null
  const segments: readonly CompositionSegment[] = [['system', '系统'], ['tools', '工具'], ['messages', '消息']].map(([key, label], index) => ({ key: key!, label: label!, value: values[index]!, share: total !== null && total > 0 ? (values[index] ?? 0) / total : null }))
  return { segments, total, projected, window, occupancy, estimated: pressure.projectedTokens === undefined, partial: values.some(value => value === null) }
}

const digests = new WeakMap<ContextMapProbe, { entries: readonly unknown[]; revision: number; summary: ContextSummary; browser: ContextBrowserModel }>()
/** Projection/draft changes reuse the unchanged history fold. */
export function readContextMapData(probe: ContextMapProbe) {
  const events = probe.events()
  let digest = digests.get(probe)
  if (!digest || digest.entries !== events.entries || digest.revision !== events.revision) {
    digest = { ...events, summary: summarizeContextWindow(events.entries, events.revision), browser: buildContextBrowser(events.entries) }
    digests.set(probe, digest)
  }
  return { summary: digest.summary, browser: digest.browser, runtime: readRuntimeComposition(probe, digest.summary) }
}
