import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ScanReport, ScanScope } from '../../doctor/host/jobs.ts'
import type { ObservedModes } from '../../doctor/host/observe.ts'
import type { DoctorRemoteFace } from '../remote.ts'
import { resolveDoctorClient, type DoctorClient, type FeedbackTree } from './doctor-client.ts'
import doctorCss from './context-doctor.css?inline'
import { FeedbackPanel, type OccurrenceItem, type ProblemOption } from './feedback-panel.tsx'
import { ModeLens } from './mode-lens.tsx'
import { SessionLens } from './session-lens.tsx'
import { DoctorAnalysisPanel } from './analysis-panel.tsx'
import { Button, SegmentedControl, DoctorIcon } from './ui.tsx'
import { CompositionChart } from './composition-chart.tsx'
import { buildCompositionRows } from './view-model.ts'
import { formatTokens } from './format.ts'
import { ContextMapPanel } from '../context-map-panel.tsx'
import { readRuntimeComposition } from '../context-map-data.ts'
import type { ContextMapProbe } from '../context-map-data.ts'
import type { EvidenceItem } from './evidence-browser.tsx'
import type { EvidencePage } from '../../doctor/host/runtime.ts'

export type WorkspacePage = 'overview' | 'diagnosis' | 'analysis' | 'feedback'

export interface ContextDoctorPanelProps {
  readonly client?: DoctorClient
  readonly loadReport?: (scope: ScanScope, signal?: AbortSignal) => Promise<ScanReport | undefined>
  readonly modes?: () => Promise<ObservedModes>
  readonly face?: DoctorRemoteFace
  readonly faceLoader?: () => Promise<DoctorRemoteFace | undefined>
  readonly resolveModel?: (sessionId: string) => Promise<{ provider: string; model: string } | undefined>
  readonly sessionId?: string
  readonly modeId?: string
  readonly initialTab?: 'session' | 'mode'
  readonly initialReport?: ScanReport
  readonly subscribe?: (listener: () => void) => () => void
  readonly initialModes?: ObservedModes
  readonly probe?: ContextMapProbe
  readonly active?: boolean
  readonly initialPage?: WorkspacePage
  readonly navigationPage?: WorkspacePage
  readonly navigationRevision?: number
}

/** Independent current-session and selected-mode scopes; scans never start a model. */
export function ContextDoctorPanel({ client: directClient, loadReport, modes: loadModes, face, faceLoader, resolveModel, sessionId, modeId,
  initialTab = 'session', initialReport, initialModes, subscribe, probe, active = true, initialPage = 'overview', navigationPage, navigationRevision }: ContextDoctorPanelProps) {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [report, setReport] = useState(initialReport)
  const [modeReport, setModeReport] = useState(initialTab === 'mode' ? initialReport : undefined)
  const [modes, setModes] = useState(initialModes)
  const [selectedModeId, setSelectedModeId] = useState(modeId)
  const [page, setPage] = useState<WorkspacePage>(initialPage)
  const [doctorRequested, setDoctorRequested] = useState(initialPage !== 'overview')
  const [evidenceSelection, setEvidenceSelection] = useState<readonly EvidenceItem[]>([])
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [focusedRef, setFocusedRef] = useState<string>()
  const instanceId = useId()
  const [workbenchOpened, setWorkbenchOpened] = useState(false)
  const [evidenceFilter, setEvidenceFilter] = useState<string>('all')
  const [feedbackEvidence, setFeedbackEvidence] = useState<readonly string[]>([])
  const [problems, setProblems] = useState<readonly ProblemOption[]>([])
  const [occurrences, setOccurrences] = useState<readonly OccurrenceItem[]>([])
  const [resolvedFace, setResolvedFace] = useState(face)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController>()
  const selectionEpoch = useRef(0)
  const analysisBusyRef = useRef(false)
  const live = useRef(true)
  const wantsReport = !probe || doctorRequested || activeTab === 'mode'
  const scopeKey = JSON.stringify(activeTab === 'session' ? { sessionIds: sessionId ? [sessionId] : [] } : { modeId: selectedModeId })

  useEffect(() => {
    let alive = true
    if (face) setResolvedFace(face)
    else if (faceLoader) void faceLoader().then((value) => { if (alive) setResolvedFace(value) }).catch((failure) => { if (alive) setError(String(failure)) })
    if (loadModes) void loadModes().then((value) => { if (alive) setModes(value) }).catch((failure) => { if (alive) setError(String(failure)) })
    return () => { alive = false }
  }, [face, faceLoader, loadModes])

  useEffect(() => {
    if (selectedModeId === undefined) setSelectedModeId(report?.sessions.find((entry) => entry.sessionId === sessionId)?.modeId ?? modes?.modes[0]?.id)
  }, [report, modes, sessionId, selectedModeId])

  useEffect(() => {
    if (!wantsReport || !loadReport || (activeTab === 'mode' && !selectedModeId)) return
    const abort = new AbortController()
    controller.current = abort
    setLoading(true)
    setError('')
    if (activeTab === 'mode') setModeReport(undefined)
    void loadReport(JSON.parse(scopeKey) as ScanScope, abort.signal).then((value) => {
      if (abort.signal.aborted) return
      if (activeTab === 'session') setReport(value)
      else setModeReport(value)
    }).catch((failure) => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)) })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [loadReport, scopeKey, refresh, wantsReport])

  const resolvedClient = useMemo(() => resolveDoctorClient(directClient, resolvedFace), [directClient, resolvedFace])

  const loadFeedback = useCallback(async () => {
    if (!resolvedClient) return
    const tree = await resolvedClient.feedback.load()
    setProblems(tree.problems.map((item) => ({ id: item.id, revision: item.revision, title: item.title })))
    const records = tree.problems.flatMap((item) =>
      item.occurrences.map((record) => ({ ...record.data, id: record.id, revision: record.revision, problemId: item.id } as OccurrenceItem)),
    )
    setOccurrences(records)
  }, [resolvedClient])

  useEffect(() => { void loadFeedback().catch((failure) => setError(String(failure))) }, [loadFeedback])
  useEffect(() => subscribe?.(() => setRefresh((value) => value + 1)), [subscribe])
  const currentSessionEntry = sessionId ? report?.sessions.find((entry) => entry.sessionId === sessionId) : report?.sessions[0]
  const currentReport = activeTab === 'session' ? report : modeReport
  const sourceRef = feedbackEvidence[0]
  const feedbackSessionId = sourceRef ? sourceRef.slice(0, sourceRef.lastIndexOf(':')) : activeTab === 'session' ? sessionId : undefined
  const feedbackModeId = sourceRef ? currentReport?.sessions.find((entry) => entry.sessionId === feedbackSessionId)?.modeId : activeTab === 'session' ? currentSessionEntry?.modeId : selectedModeId
  const feedbackOccurrences = occurrences.filter((item) => activeTab === 'session' ? item.sessionId === sessionId : item.modeId === selectedModeId || modeReport?.sessions.some((entry) => entry.sessionId === item.sessionId))

  const openPage = (next: WorkspacePage) => { setPage(next); if (next !== 'overview') setDoctorRequested(true); if (next === 'diagnosis' || next === 'analysis') setWorkbenchOpened(true) }
  const inspect = (bucket?: string, ref?: string) => { setEvidenceFilter(bucket ?? 'all'); setFocusedRef(ref); openPage('diagnosis') }
  const feedback = (ref?: string) => { setFeedbackEvidence(ref ? [ref] : []); openPage('feedback') }
  const changeSelection = (items: readonly EvidenceItem[]) => { if (!analysisBusyRef.current) setEvidenceSelection(items) }
  const changeAnalysisBusy = useCallback((busy: boolean) => {
    if (busy) selectionEpoch.current += 1
    analysisBusyRef.current = busy
    setAnalysisBusy(busy)
  }, [])
  const addEvidence = async (ref: string) => {
    if (analysisBusyRef.current || !resolvedClient || !sessionId) return
    const epoch = selectionEpoch.current
    setError('')
    try {
      const response = await resolvedClient.evidence.query(sessionId, { refs: [ref] })
      if (!live.current || analysisBusyRef.current || epoch !== selectionEpoch.current) return
      const item = response.items.find(item => item.ref === ref)
      if (!item) throw new Error('此内容不在当前可用的有效上下文中，不能加入分析；仍可浏览或记录问题。')
      setEvidenceSelection(previous => [...previous.filter(selected => selected.ref !== ref), item])
      setWorkbenchOpened(true); setDoctorRequested(true)
    } catch (failure) { if (live.current && epoch === selectionEpoch.current) setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  useEffect(() => { live.current = true; return () => { live.current = false; selectionEpoch.current += 1 } }, [])
  useEffect(() => { selectionEpoch.current += 1; setEvidenceSelection([]); setFeedbackEvidence([]); setFocusedRef(undefined); changeAnalysisBusy(false) }, [scopeKey, changeAnalysisBusy])
  useEffect(() => { if (navigationPage) openPage(navigationPage) }, [navigationPage, navigationRevision])
  const scopedProblems = problems.filter((problem) => feedbackOccurrences.some((item) => item.problemId === problem.id && !item.withdrawn))
  const scopeName = activeTab === 'session' ? '当前会话' : modes?.modes.find((mode) => mode.id === selectedModeId)?.name ?? '模式预设'

  return <div className="dsh-context-doctor-panel context-workspace doctor-palette">
    <style>{doctorCss}</style>
    <header className="doctor-toolbar">
      <SegmentedControl id={`doctor-scope-${instanceId}`} value={activeTab} label="分析对象" options={[{ value: 'session', label: '当前会话' }, { value: 'mode', label: '模式预设' }]} onChange={value => { setActiveTab(value); setPage('overview'); setFeedbackEvidence([]) }} />
      <Button size="sm" variant="ghost" aria-label="更新统计" title="更新统计" className="doctor-icon-button" onClick={() => { setDoctorRequested(true); setRefresh(value => value + 1) }}><DoctorIcon kind="refresh" /></Button>
    </header>
    {activeTab === 'mode' && <div className="doctor-scope-selector"><label htmlFor={`doctor-mode-${instanceId}`}>模式</label><select id={`doctor-mode-${instanceId}`} value={selectedModeId ?? ''} onChange={event => { setSelectedModeId(event.target.value); setPage('overview') }}><option value="">选择模式</option>{modes?.modes.map(mode => <option key={mode.id} value={mode.id}>{mode.name ?? mode.id}{mode.broken ? '（不可用）' : ''}</option>)}</select></div>}
    <nav className="doctor-pages" role="tablist" aria-label="工作页面">{([{ id: 'overview', label: '概览' }, { id: 'diagnosis', label: '诊断' }, { id: 'analysis', label: '分析' }, { id: 'feedback', label: '反馈' }] as const).map(item => <button key={item.id} id={`doctor-page-${item.id}`} type="button" role="tab" aria-selected={page === item.id} aria-controls={`doctor-${item.id}-panel`} onClick={() => openPage(item.id)}>{item.label}{item.id === 'feedback' && feedbackOccurrences.filter(occurrence => !occurrence.withdrawn).length > 0 ? <span className="doctor-count">{feedbackOccurrences.filter(occurrence => !occurrence.withdrawn).length}</span> : null}</button>)}</nav>
    <div className="doctor-body">
      {loading && <div role="status" className="doctor-loading"><span className="doctor-spinner" />正在更新诊断统计<Button size="sm" variant="ghost" onClick={() => { controller.current?.abort(); setLoading(false); setError('扫描已取消。点击更新可重新读取。') }}>取消</Button></div>}
      {error && <div role="alert" className="doctor-status-note">{error}</div>}
      {probe && <section hidden={page !== 'overview' || activeTab !== 'session'} role="tabpanel" id="doctor-overview-panel" aria-labelledby="doctor-page-overview"><ContextMapPanel key={sessionId} sessionId={sessionId} probe={probe} active={active && page === 'overview' && activeTab === 'session'} doctorEntry={currentSessionEntry} client={resolvedClient} face={resolvedFace} onRequestStructure={() => setDoctorRequested(true)} evidenceSelection={evidenceSelection} onEvidenceSelectionChange={changeSelection} onAddEvidence={ref => void addEvidence(ref)} onFeedback={feedback} onInspectEvidence={(ref, bucket) => inspect(bucket, ref)} onAnalysis={() => openPage('analysis')} analysisBusy={analysisBusy} /></section>}
      {page === 'overview' && (!probe || activeTab === 'mode') && <section role="tabpanel" id={probe ? 'doctor-mode-overview-panel' : 'doctor-overview-panel'} aria-labelledby="doctor-page-overview">{activeTab === 'session' ? <SessionLens entry={currentSessionEntry} problems={scopedProblems} onOpenFeedback={() => feedback()} onRefresh={() => { setDoctorRequested(true); setRefresh(value => value + 1) }} onInspect={inspect} /> : <ModeLens report={modeReport} modes={modes} selectedModeId={selectedModeId} onRefresh={() => setRefresh(value => value + 1)} onInspect={() => inspect()} occurrences={feedbackOccurrences.filter(item => item.sessionId).map(item => ({ sessionId: item.sessionId!, counted: !item.withdrawn, versionKey: item.versionKey }))} />}</section>}
      {page === 'diagnosis' && <section role="tabpanel" id="doctor-diagnosis-panel" aria-labelledby="doctor-page-diagnosis">{activeTab === 'session' ? <SessionLens showComposition={false} entry={currentSessionEntry} problems={scopedProblems} onOpenFeedback={() => feedback()} onRefresh={() => setRefresh(value => value + 1)} onInspect={inspect} /> : <div className="doctor-page-intro"><h3>模式来源与诊断</h3><p>选择会话核对证据；模式评价依据自身声明与可访问样本。</p></div>}</section>}
      {workbenchOpened && <div hidden={page !== 'diagnosis' && page !== 'analysis'}><DoctorAnalysisPanel key={`${activeTab}:${activeTab === 'session' ? sessionId : selectedModeId}`} client={resolvedClient} face={resolvedFace} sessionId={sessionId} modeId={activeTab === 'session' ? currentSessionEntry?.modeId : selectedModeId} lens={activeTab} page={page === 'analysis' ? 'analysis' : page === 'diagnosis' ? 'evidence' : 'idle'} filter={evidenceFilter} onFilter={setEvidenceFilter} focusedRef={focusedRef} onNavigate={next => openPage(next === 'evidence' ? 'diagnosis' : next)} report={currentReport} modes={modes} resolveModel={resolveModel} onFeedback={feedback} evidenceSelection={evidenceSelection} onEvidenceSelectionChange={changeSelection} onBusyChange={changeAnalysisBusy} /></div>}
      {page === 'feedback' && <section role="tabpanel" id="doctor-feedback-panel" aria-labelledby="doctor-page-feedback"><div className="doctor-page-intro"><h3>记录一次问题</h3><p>{sourceRef ? '已关联所选原文，选择问题类型后即可保存。' : `记录 ${scopeName} 中的遗漏、理解偏差或返工。`}</p></div><FeedbackPanel key={sourceRef ?? activeTab} client={resolvedClient} face={resolvedFace} sessionId={feedbackSessionId} modeId={feedbackModeId} showHeading={false} evidenceRefs={feedbackEvidence} existingProblems={problems} existingOccurrences={feedbackOccurrences} onSaved={(res) => { if (res?.tree) { setProblems(res.tree.problems.map(p => ({ id: p.id, revision: p.revision, title: p.title }))); setOccurrences(res.tree.problems.flatMap(p => p.occurrences.map(o => ({ ...o.data, id: o.id, revision: o.revision, problemId: p.id } as OccurrenceItem)))) } else void loadFeedback().catch(failure => setError(String(failure))) }} onWithdrawn={(_id, tree) => { if (tree) { setProblems(tree.problems.map(p => ({ id: p.id, revision: p.revision, title: p.title }))); setOccurrences(tree.problems.flatMap(p => p.occurrences.map(o => ({ ...o.data, id: o.id, revision: o.revision, problemId: p.id } as OccurrenceItem)))) } else void loadFeedback().catch(failure => setError(String(failure))) }} /></section>}
    </div>
    <footer className="doctor-footer"><span className="doctor-status-dot" /><span>统计读取不调用模型</span>{currentReport && <span>诊断快照 {new Date(currentReport.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}</footer>
  </div>
}

export const DOCTOR_TAB_ID = '@cheesefox/dsh-better-composer.contextdoctor'
export const DOCTOR_TAB_KIND = 'better-composer.contextdoctor'
export function doctorTabDefinition() { return { id: DOCTOR_TAB_ID, kind: DOCTOR_TAB_KIND, title: () => 'Context Doctor' } }
export function ContextDoctorButton({ onOpen, probe }: { readonly onOpen: () => void; readonly probe?: ContextMapProbe }) {
  useSyncExternalStore(listener => probe?.subscribe(listener) ?? (() => {}), () => probe?.version() ?? 0, () => 0)
  const composition = probe ? readRuntimeComposition(probe) : undefined
  return <button type="button" className="doctor-composer doctor-palette" aria-label="上下文地图" title="查看上下文地图与诊断" onClick={onOpen}><style>{doctorCss}</style><CompositionChart compact segments={composition?.segments ?? []} total={composition?.total ?? null} /><span>{composition?.total !== null && composition?.total !== undefined ? `约 ${formatTokens(composition.total)}` : '上下文'}</span></button>
}
