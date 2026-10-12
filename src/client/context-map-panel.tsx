import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { formatTokens, loadTurnAnchors, saveTurnAnchors } from './context-map.ts'
import { asRecord, numberOf, readContextMapData } from './context-map-data.ts'
import type { ContextMapProbe } from './context-map-data.ts'
import { ContextContentBrowser, TurnDetail } from './context-content-browser.tsx'
import type { ContextBrowserTab, ContextSourceActions } from './context-content-browser.tsx'
import { CompositionChart, compositionSegments } from './context-doctor/composition-chart.tsx'
import { buildCompositionRows } from './context-doctor/view-model.ts'
import { Button, SegmentedControl } from './context-doctor/ui.tsx'
import { EvidenceBrowser } from './context-doctor/evidence-browser.tsx'
import type { EvidenceItem } from './context-doctor/evidence-browser.tsx'
import type { DoctorRemoteFace } from './remote.ts'
import { DoctorClient } from './context-doctor/doctor-client.ts'
import type { EvidencePage } from '../doctor/host/runtime.ts'
import type { SessionReportEntry } from '../doctor/host/jobs.ts'
export type { ContextMapProbe } from './context-map-data.ts'

export const CONTEXT_MAP_TAB_ID = '@cheesefox/dsh-better-composer.contextmap'
export const CONTEXT_MAP_TAB_KIND = 'better-composer.contextmap'
export function contextMapTabDefinition() { return { id: CONTEXT_MAP_TAB_ID, kind: CONTEXT_MAP_TAB_KIND, keepMounted: true, title: () => '上下文地图' } }

export interface ContextMapPanelProps {
  readonly sessionId?: string
  readonly probe: ContextMapProbe
  readonly active?: boolean
  readonly doctorEntry?: SessionReportEntry
  readonly client?: DoctorClient
  readonly face?: DoctorRemoteFace
  readonly onRequestStructure?: () => void
  readonly evidenceSelection?: readonly EvidenceItem[]
  readonly onEvidenceSelectionChange?: (items: readonly EvidenceItem[]) => void
  readonly onAddEvidence?: (ref: string) => void
  readonly onFeedback?: (ref: string) => void
  readonly onInspectEvidence?: (ref: string, bucket: string) => void
  readonly onAnalysis?: () => void
  readonly analysisBusy?: boolean
}

/** Complete native map; only composition presentation is shared with Doctor. */
export function ContextMapPanel({ sessionId = '', probe, active = true, doctorEntry, client, face, onRequestStructure, evidenceSelection = [], onEvidenceSelectionChange, onAddEvidence, onFeedback, onInspectEvidence, onAnalysis, analysisBusy }: ContextMapPanelProps) {
  const version = useSyncExternalStore(listener => active ? probe.subscribe(listener) : () => {}, () => probe.version(), () => 0)
  const { summary, browser, runtime } = useMemo(() => readContextMapData(probe), [probe, version])
  const { projected, window, occupancy, estimated } = runtime
  const usage = asRecord(probe.projection('tokenUsage'))
  const clips = probe.draftClips()
  const [basis, setBasis] = useState<'runtime' | 'structure'>('runtime')
  const [tab, setTab] = useState<ContextBrowserTab>('messages')
  const [hoverKind, setHoverKind] = useState<string>()
  const [structureKey, setStructureKey] = useState('message')
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [selectedTurn, setSelectedTurn] = useState<number>()
  const [confirmingCompact, setConfirmingCompact] = useState(false)
  const [commandPending, setCommandPending] = useState(false)
  const [compactError, setCompactError] = useState('')
  const [forkNotice, setForkNotice] = useState('')
  const [anchors, setAnchors] = useState<readonly number[]>(() => loadTurnAnchors(sessionId))
  const [evidence, setEvidence] = useState<EvidencePage>()
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [evidenceError, setEvidenceError] = useState('')
  const contentRoot = useRef<HTMLDivElement>(null)
  const evidenceRevision = useRef(0)
  const evidenceLoaded = useRef(false)

  useEffect(() => { if (active) probe.loadAllHistory() }, [probe, active])
  useEffect(() => { setAnchors(loadTurnAnchors(sessionId)) }, [sessionId])
  useEffect(() => { if (!active) { setConfirmingCompact(false); setHoverKind(undefined) } }, [active])
  useEffect(() => { if (!forkNotice) return; const timer = setTimeout(() => setForkNotice(''), 4000); return () => clearTimeout(timer) }, [forkNotice])

  const resolvedClient = useMemo(() => client ?? (face ? new DoctorClient(face) : undefined), [client, face])

  useEffect(() => {
    evidenceRevision.current += 1
    evidenceLoaded.current = false
    setEvidence(undefined); setEvidenceError(''); setEvidenceLoading(false)
  }, [resolvedClient, sessionId, doctorEntry?.cutoffSeq])

  useEffect(() => {
    if (!active || basis !== 'structure' || !resolvedClient || !doctorEntry || !sessionId) return
    if (evidenceLoaded.current) return
    let alive = true
    evidenceRevision.current += 1
    setEvidenceLoading(true); setEvidenceError('')
    void resolvedClient.evidence.query(sessionId, { cutoffSeq: doctorEntry.cutoffSeq }).then((page: EvidencePage) => {
      if (!alive) return
      evidenceLoaded.current = true
      setEvidence(page)
      if (page.status.kind === 'error') setEvidenceError('原文暂不可读取，请更新统计重试。')
    }).catch((error: unknown) => { if (alive) setEvidenceError(String(error)) }).finally(() => { if (alive) setEvidenceLoading(false) })
    return () => { alive = false; evidenceRevision.current += 1; setEvidenceLoading(false) }
  }, [resolvedClient, sessionId, doctorEntry?.cutoffSeq, basis, active])

  const loadMoreEvidence = async () => {
    if (!resolvedClient || !sessionId || !evidence || evidence.nextOffset === undefined || evidenceLoading) return
    const revision = evidenceRevision.current
    setEvidenceLoading(true)
    try {
      const next = await resolvedClient.evidence.query(sessionId, { cutoffSeq: evidence.cutoffSeq, offset: evidence.nextOffset })
      if (revision !== evidenceRevision.current) return
      setEvidence(previous => previous ? { ...next, items: [...previous.items, ...next.items] } : next)
    }
    catch (error) { if (revision === evidenceRevision.current) setEvidenceError(String(error)) } finally { if (revision === evidenceRevision.current) setEvidenceLoading(false) }
  }
  const toggle = (key: string) => setExpanded(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key])
  const isOpen = (key: string) => expanded.includes(key)
  const revealTurn = (index: number) => {
    setBasis('runtime'); setTab('messages')
    setExpanded(previous => previous.includes(`turn:${index}`) ? previous : [...previous, `turn:${index}`])
    requestAnimationFrame(() => contentRoot.current?.querySelector(`[data-turn="${index}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }))
  }
  const toggleAnchor = (turn: number) => setAnchors(previous => {
    const next = previous.includes(turn) ? previous.filter(item => item !== turn) : [...previous, turn]
    saveTurnAnchors(sessionId, next); return next
  })
  const turnMax = Math.max(1, ...summary.turns.map(turn => turn.userTokens + turn.assistantTokens + turn.toolTokens))
  const input = numberOf(usage.uncachedInputTokens) ?? 0
  const output = numberOf(usage.outputTokens) ?? 0
  const cacheRead = numberOf(usage.cacheReadTokens) ?? 0
  const cacheWrite = numberOf(usage.cacheWriteTokens) ?? 0
  const hasUsage = input > 0 || output > 0
  const cacheHit = cacheRead + input > 0 ? cacheRead / (cacheRead + input) : undefined
  const cacheCover = cacheRead > 0 && projected !== null && projected > 0 ? Math.min(1, cacheRead / projected) : undefined
  const runCompact = async () => {
    if (!confirmingCompact) { setConfirmingCompact(true); return }
    setConfirmingCompact(false); setCompactError(''); setCommandPending(true)
    try { await probe.compact() } catch (error) { setCompactError(error instanceof Error ? error.message : String(error)) } finally { setCommandPending(false) }
  }
  const runFork = async (seq: number) => {
    try { await probe.forkAt(seq); setForkNotice('已创建分叉会话（在侧边栏会话列表中打开）') }
    catch (error) { setForkNotice(`分叉失败：${error instanceof Error ? error.message : String(error)}`) }
  }
  const composition = doctorEntry && doctorEntry.status.kind !== 'error' ? buildCompositionRows(doctorEntry) : undefined
  const sourceActions: ContextSourceActions | undefined = onAddEvidence && onFeedback && onInspectEvidence ? { sessionId, selectedRefs: evidenceSelection.map(item => item.ref), disabled: analysisBusy, onAdd: onAddEvidence, onFeedback, onInspect: onInspectEvidence } : undefined
  const toggleEvidence = (item: EvidenceItem, checked: boolean) => onEvidenceSelectionChange?.(checked ? [...evidenceSelection.filter(selected => selected.ref !== item.ref), item] : evidenceSelection.filter(selected => selected.ref !== item.ref))

  return <div className="dsh-better-composer-ctxmap" data-ctxmap>
    <section className="dsh-better-composer-ctxmap-card" aria-label="上下文占用">
      <header className="dsh-better-composer-ctxmap-card-head"><span className="dsh-better-composer-ctxmap-card-title">上下文占用</span><span className="dsh-better-composer-ctxmap-badge">{estimated ? '估算' : '宿主投影'}</span>{browser.compacting && <span className="dsh-better-composer-ctxmap-badge" data-live>压缩中…</span>}</header>
      <div className="dsh-better-composer-ctxmap-figure"><span className="dsh-better-composer-ctxmap-big">{projected === null ? '—' : formatTokens(projected)}</span><span className="dsh-better-composer-ctxmap-unit">{window !== null ? `/ ${formatTokens(window)} tokens` : 'tokens · 窗口未知'}</span><span className="context-occupancy-percent">{occupancy === null ? '—' : `${Math.round(occupancy * 100)}%`}</span></div>
      <div className="dsh-better-composer-ctxmap-gauge" aria-hidden><div className="dsh-better-composer-ctxmap-gauge-fill" style={{ width: `${(occupancy ?? 0) * 100}%` }} /></div>
      <p className="dsh-better-composer-ctxmap-sub">{occupancy === null ? '窗口或投影尚未观测，构成与占用分别展示。' : occupancy < .6 ? '余量充足。' : occupancy < .85 ? '占用偏高，可考虑压缩。' : '接近窗口上限，建议压缩或分叉。'}</p>
      <div className="dsh-better-composer-ctxmap-actions"><Button size="sm" variant="outline" disabled={browser.compacting || commandPending} onClick={() => void runCompact()}>{confirmingCompact ? '确认压缩？将摘要替换历史' : browser.compacting || commandPending ? '压缩中…' : '压缩上下文'}</Button><span className="dsh-better-composer-ctxmap-action-note">{compactError || '/compact · 摘要替换较早历史'}</span></div>
      {forkNotice && <p className="dsh-better-composer-ctxmap-sub" role="status">{forkNotice}</p>}
    </section>
    <section className="dsh-better-composer-ctxmap-card" aria-label="上下文构成">
      <SegmentedControl id={`context-basis-${sessionId}`} label="构成口径" value={basis} options={[{ value: 'runtime', label: '宿主实时构成' }, { value: 'structure', label: '结构细分估算' }]} onChange={next => { setBasis(next); setHoverKind(undefined); if (next === 'structure') onRequestStructure?.() }} />
      {basis === 'runtime' ? <><CompositionChart segments={runtime.segments} total={runtime.total} selectedKey={tab} previewKey={hoverKind} onPreview={setHoverKind} onSelect={key => { if (key === 'messages' || key === 'tools' || key === 'system') setTab(key) }} />
        <p className="doctor-caption">构成按宿主表面估算；上方占用为独立投影，不是供应商最终请求。{runtime.partial ? '部分构成未观测，不将缺项计为零。' : ''}</p>
        <div className="dsh-better-composer-ctxmap-tabs" role="tablist" aria-label="上下文浏览">{([['messages', '消息'], ['tools', '工具'], ['system', '系统']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className="dsh-better-composer-ctxmap-tab" onClick={() => setTab(value)} onMouseEnter={() => setHoverKind(value)} onMouseLeave={() => setHoverKind(undefined)} onFocus={() => setHoverKind(value)} onBlur={() => setHoverKind(undefined)}>{label}</button>)}</div>
        <div ref={contentRoot}><ContextContentBrowser tab={tab} browser={browser} isOpen={isOpen} toggle={toggle} anchors={anchors} onAnchor={toggleAnchor} onFork={runFork} loading={probe.historyLoading()} sourceActions={sourceActions} /></div>{evidenceSelection.length > 0 && <div className="doctor-selection-bar"><span>已选 {evidenceSelection.length} 项证据</span><Button size="sm" variant="primary" onClick={onAnalysis}>分析所选证据</Button></div>}</>
        : <><CompositionChart segments={composition ? compositionSegments(composition.rows) : []} total={composition?.totalEstimatedTokens ?? null} selectedKey={structureKey} onSelect={setStructureKey} />
          <p className="doctor-caption">已保存的有效上下文 · 字符估算{doctorEntry ? ` · 快照 ${doctorEntry.cutoffSeq} 个事件` : ' · 正在准备统计'}</p>
          {evidenceError && <p role="alert" className="doctor-status-note">{evidenceError}</p>}
          {evidenceLoading && <p role="status" className="doctor-caption">正在读取来源证据…</p>}
          <EvidenceBrowser items={evidence?.items.filter(item => item.bucket === structureKey) ?? []} selectedRefs={evidenceSelection.map(item => item.ref)} disabled={analysisBusy} onToggle={toggleEvidence} onFeedback={ref => onFeedback?.(ref)} />
          {evidence?.nextOffset !== undefined && <Button size="sm" variant="outline" disabled={evidenceLoading} onClick={() => void loadMoreEvidence()}>继续读取证据</Button>}
          <div className="doctor-selection-bar"><span>已选 {evidenceSelection.length} 项证据</span><Button size="sm" variant="primary" disabled={!evidenceSelection.length} onClick={onAnalysis}>分析所选证据</Button></div>
        </>}
    </section>
    {hasUsage || cacheRead > 0
      ? <section className="dsh-better-composer-ctxmap-card" aria-label="缓存">
        <header className="dsh-better-composer-ctxmap-card-head">
          <span className="dsh-better-composer-ctxmap-card-title">缓存</span>
          {cacheHit !== undefined
            ? <span className="dsh-better-composer-ctxmap-card-note">命中率 {Math.round(cacheHit * 100)}%</span>
            : null}
        </header>
        {cacheCover !== undefined
          ? <div className="dsh-better-composer-ctxmap-gauge" aria-hidden>
            <div className="dsh-better-composer-ctxmap-gauge-fill" data-level="cache" style={{ width: `${Math.max(2, cacheCover * 100)}%` }} />
          </div>
          : null}
        <div className="dsh-better-composer-ctxmap-grid">
          <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(cacheRead)}</strong><span>缓存读取</span></div>
          <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(cacheWrite)}</strong><span>缓存写入</span></div>
          <div className="dsh-better-composer-ctxmap-stat"><strong>{cacheCover !== undefined ? `${Math.round(cacheCover * 100)}%` : '—'}</strong><span>当前上下文覆盖</span></div>
        </div>
        <p className="dsh-better-composer-ctxmap-sub">由 provider 前缀缓存自动生效，无需手动标记。</p>
      </section>
      : null}

    <section className="dsh-better-composer-ctxmap-card" aria-label="结构统计">
      <header className="dsh-better-composer-ctxmap-card-head">
        <span className="dsh-better-composer-ctxmap-card-title">结构</span>
      </header>
      <div className="dsh-better-composer-ctxmap-grid">
        <div className="dsh-better-composer-ctxmap-stat"><strong>{summary.userMessages}</strong><span>用户消息</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{summary.assistantMessages}</strong><span>助手消息</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{summary.toolCalls}</strong><span>工具调用</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{summary.fileRefs + summary.imageCount}</strong><span>文件与图片</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{clips}</strong><span>粘贴引用</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(summary.assistantOutputTokens)}</strong><span>输出 tokens</span></div>
      </div>
    </section>

    <section className="dsh-better-composer-ctxmap-card" aria-label="逐轮增长">
      <header className="dsh-better-composer-ctxmap-card-head">
        <span className="dsh-better-composer-ctxmap-card-title">逐轮增长</span>
        <span className="dsh-better-composer-ctxmap-card-note">最近 {summary.turns.length} 轮</span>
      </header>
      {summary.turns.length === 0
        ? <p className="dsh-better-composer-ctxmap-sub">{probe.historyLoading() ? '正在加载更早历史…' : '暂无对话内容'}</p>
        : <>
          <div className="dsh-better-composer-ctxmap-bars" role="group" aria-label="逐轮 tokens">
            {summary.turns.map(turn => <button
              key={turn.index}
              type="button"
              className="dsh-better-composer-ctxmap-bar"
              data-anchored={anchors.includes(turn.index) ? 'true' : undefined}
              data-selected={selectedTurn === turn.index ? 'true' : undefined}
              aria-pressed={selectedTurn === turn.index}
              aria-label={`第 ${turn.index} 轮 · ${formatTokens(turn.userTokens + turn.assistantTokens + turn.toolTokens)} tokens`}
              title={`第 ${turn.index} 轮 · 用户 ${formatTokens(turn.userTokens)} · 助手 ${formatTokens(turn.assistantTokens)}${turn.toolTokens > 0 ? ` · 工具 ${formatTokens(turn.toolTokens)}` : ''}${anchors.includes(turn.index) ? ' · 已锚定' : ''}`}
              onClick={() => { setSelectedTurn(previous => previous === turn.index ? undefined : turn.index) }}
            >
              <i data-kind="assistant" style={{ height: `${turn.assistantTokens / turnMax * 100}%`, minHeight: turn.assistantTokens > 0 ? 3 : 0 }} />
              <i data-kind="tool" style={{ height: `${turn.toolTokens / turnMax * 100}%`, minHeight: turn.toolTokens > 0 ? 3 : 0 }} />
              <i data-kind="user" style={{ height: `${turn.userTokens / turnMax * 100}%`, minHeight: turn.userTokens > 0 ? 3 : 0 }} />
              {anchors.includes(turn.index) ? <b className="dsh-better-composer-ctxmap-bar-anchor" aria-hidden /> : null}
            </button>)}
          </div>
          <div className="dsh-better-composer-ctxmap-bars-axis" aria-hidden>
            <span>第 {summary.turns[0]!.index} 轮</span>
            {summary.turns.length > 1 ? <span>第 {summary.turns.at(-1)!.index} 轮</span> : null}
          </div>
        </>}
      {selectedTurn !== undefined ? <TurnDetail
        turn={selectedTurn}
        stat={summary.turns.find(candidate => candidate.index === selectedTurn)}
        browser={browser}
        anchored={anchors.includes(selectedTurn)}
        onAnchor={toggleAnchor}
        onReveal={revealTurn}
      /> : null}
      <p className="dsh-better-composer-ctxmap-sub">点击轮次柱查看该轮构成；锚定后显示蓝色刻线与菱形。</p>
    </section>
  </div>
}

/** Module-level opener handle: the plugin publishes it at registration time. */
let contextMapOpener: (() => void) | undefined
const openerListeners = new Set<() => void>()

/** Publish the opener (called once from the client apply). */
export function publishContextMapOpener(open: () => void): void {
  contextMapOpener = open
  for (const listener of openerListeners) listener()
}

function useContextMapOpener(): () => void {
  return useSyncExternalStore(
    listener => { openerListeners.add(listener); return () => { openerListeners.delete(listener) } },
    () => contextMapOpener,
    () => undefined,
  ) ?? (() => {})
}

/** Composer toolbar button that opens the context map for the session. */
export type ContextMapButtonProps = PropsRuntime<'conversation.input.right'>

export function ContextMapButton(_props: ContextMapButtonProps) {
  const openMap = useContextMapOpener()
  return <button
    type="button"
    className="dsh-better-composer-ctxmap-button"
    aria-label="上下文地图"
    title="上下文地图"
    onClick={openMap}
  >
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 14h12" />
      <path d="M4 14V9" />
      <path d="M8 14V5" />
      <path d="M12 14V2" />
    </svg>
  </button>
}
