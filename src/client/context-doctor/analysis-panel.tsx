import { useEffect, useRef, useState } from 'react'
import type { AnalysisPlan, AnalysisResult, CandidateConstraint } from '../../doctor/host/analyze.ts'
import type { ConstraintScope, EvidencePage } from '../../doctor/host/runtime.ts'
import type { ProviderPlan } from '../../doctor/host/provider.ts'
import type { ScanReport } from '../../doctor/host/jobs.ts'
import type { ObservedModes } from '../../doctor/host/observe.ts'
import type { DoctorRemoteFace } from '../remote.ts'
import { resolveDoctorClient, type DoctorClient, type StoredConstraint } from './doctor-client.ts'
import { Button, DoctorIcon } from './ui.tsx'
import { EvidenceBrowser, EVIDENCE_BUCKETS } from './evidence-browser.tsx'
import type { EvidenceItem } from './evidence-browser.tsx'

/** Evidence stays local until the user starts a prepared analysis; candidates require review. */
export function DoctorAnalysisPanel({ client: directClient, face, sessionId, modeId, lens, report, modes, resolveModel, onFeedback, page: activePage = 'evidence', filter = 'all', onFilter, onNavigate, evidenceSelection, onEvidenceSelectionChange, onBusyChange, focusedRef }: {
  readonly client?: DoctorClient
  readonly face?: DoctorRemoteFace
  readonly sessionId?: string
  readonly modeId?: string
  readonly lens: 'session' | 'mode'
  readonly report?: ScanReport
  readonly modes?: ObservedModes
  readonly resolveModel?: (id: string) => Promise<{ provider: string; model: string } | undefined>
  readonly page?: 'evidence' | 'analysis' | 'idle'
  readonly filter?: string
  readonly onFilter?: (filter: string) => void
  readonly onNavigate?: (page: 'evidence' | 'analysis') => void
  readonly onFeedback: (ref: string) => void
  readonly evidenceSelection?: readonly EvidenceItem[]
  readonly onEvidenceSelectionChange?: (items: readonly EvidenceItem[]) => void
  readonly onBusyChange?: (busy: boolean) => void
  readonly focusedRef?: string
}) {
  const client = resolveDoctorClient(directClient, face)
  const [sourceId, setSourceId] = useState(lens === 'session' ? sessionId : report?.sessions[0]?.sessionId)
  const [page, setPage] = useState<EvidencePage>()
  const [localSelection, setLocalSelection] = useState<readonly EvidenceItem[]>([])
  const selectedItems = evidenceSelection ?? localSelection
  const selected = selectedItems.map(item => item.ref)
  const setSelection = (items: readonly EvidenceItem[]) => { if (onEvidenceSelectionChange) onEvidenceSelectionChange(items); else setLocalSelection(items) }
  const [kind, setKind] = useState<AnalysisPlan['kind']>(lens === 'mode' ? 'mode-quality' : 'session-quality')
  const [plan, setPlan] = useState<AnalysisPlan>()
  const [result, setResult] = useState<AnalysisResult>()
  const [available, setAvailable] = useState(false)
  const [state, setState] = useState('idle')
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [error, setError] = useState('')
  const [constraints, setConstraints] = useState<readonly StoredConstraint[]>([])
  const [providerPlan, setProviderPlan] = useState<ProviderPlan>()
  const [providerEnabled, setProviderEnabled] = useState(true)
  const [providerBusy, setProviderBusy] = useState(false)
  const [providerNotice, setProviderNotice] = useState('')
  const live = useRef(true)
  const abortController = useRef<AbortController>()
  const inputRevision = useRef(0)
  const sourceRevision = useRef(0)

  useEffect(() => {
    live.current = true
    if (client) {
      void client.analysis.available().then((res) => { if (live.current) setAvailable(res) }).catch((failure) => { if (live.current) setError(String(failure)) })
      void client.constraints.list().then((res) => { if (live.current) setConstraints(res) }).catch((failure) => { if (live.current) setError(String(failure)) })
    }
    return () => { live.current = false; abortController.current?.abort() }
  }, [client])

  const operation = async (work: () => Promise<void>) => {
    const revision = sourceRevision.current
    setError('')
    try { await work() } catch (failure) { if (live.current && revision === sourceRevision.current) setError(failure instanceof Error ? failure.message : String(failure)) }
  }

  const loadEvidence = () => operation(async () => {
    if (!client || !sourceId) return
    const revision = sourceRevision.current
    setState('loading-evidence')
    try {
      const next = await client.evidence.query(sourceId, { offset: page?.nextOffset ?? 0, cutoffSeq: page?.cutoffSeq })
      if (!live.current || revision !== sourceRevision.current) return
      setPage((previous) => previous ? { ...next, items: [...previous.items, ...next.items] } : next)
      if (next.status.kind === 'error') throw new Error(next.status.reason)
    } finally { if (live.current && revision === sourceRevision.current) setState('idle') }
  })

  useEffect(() => {
    if (activePage === 'evidence' && client && sourceId && !page) void loadEvidence()
  }, [activePage, client, sourceId])

  const prepare = () => operation(async () => {
    if (!client) return
    const revision = inputRevision.current
    onBusyChange?.(true)
    setState('preparing')
    try {
      const model = await resolveModel?.(sourceId ?? sessionId ?? '')
      if (!model) throw new Error('未配置可用分析模型，请先在宿主选择模型')
      const preparedPlan = await client.analysis.prepare({
        kind,
        model,
        sessionId: lens === 'session' ? sessionId : undefined,
        modeId: lens === 'mode' ? modeId : undefined,
        reportId: report?.id,
        evidenceRefs: selectedItems.map((item) => item.ref),
      })
      if (live.current && revision === inputRevision.current) {
        setPlan(preparedPlan)
        setResult(undefined)
      }
    } finally { if (live.current && revision === inputRevision.current) { setState('idle'); onBusyChange?.(false) } }
  })

  const start = () => operation(async () => {
    if (!client || !plan) return
    const controller = new AbortController()
    abortController.current = controller
    onBusyChange?.(true)
    setState('running')
    try {
      const res = await client.analysis.run(plan, {
        idempotencyKey: plan.id,
        signal: controller.signal,
        onProgress: (p) => {
          if (live.current) setState(p.state)
        },
      })
      if (live.current) {
        setState('complete')
        setResult(res)
      }
    } catch (err) {
      if (live.current) {
        if (controller.signal.aborted) {
          setState('cancelled')
        } else {
          setState('failed')
          setError((err as Error).message)
        }
      }
    } finally {
      if (live.current) onBusyChange?.(false)
    }
  })

  const saveCandidate = (candidate: CandidateConstraint, values: { requirement: string; conditions: string; exceptions: string; scope: ConstraintScope }) => operation(async () => {
    if (!client) return
    const updated = await client.constraints.confirm(candidate, {
      requirement: values.requirement,
      conditions: values.conditions.split('\n').filter(Boolean),
      exceptions: values.exceptions.split('\n').filter(Boolean),
      scope: values.scope,
    })
    if (live.current) setConstraints(updated)
  })

  const prepareProvider = () => operation(async () => {
    if (!client || !modeId || providerBusy) return
    setProviderBusy(true)
    setProviderNotice('')
    try {
      const plan = await client.provider.prepare(modeId, providerEnabled)
      if (live.current) setProviderPlan(plan)
    } finally { if (live.current) setProviderBusy(false) }
  })

  const applyProvider = () => operation(async () => {
    if (!client || !providerPlan || providerBusy) return
    setProviderBusy(true)
    try {
      await client.provider.apply(providerPlan.id)
      if (live.current) { setProviderPlan(undefined); setProviderNotice('配置已应用，将用于新 Agent。') }
    } finally { if (live.current) setProviderBusy(false) }
  })

  const scopedConstraints = constraints.filter((item) => {
    const scope = item.data['scope'] as ConstraintScope | undefined
    return scope?.kind === 'session' ? scope.sessionId === sourceId : scope?.kind === 'mode' && scope.modeId === modeId
  })

  const evidenceRows = page?.items.filter((item) => filter === 'all' || item.bucket === filter || item.role === filter) ?? []
  const running = state === 'running' || state === 'cancelling'
  const buckets = EVIDENCE_BUCKETS
  useEffect(() => { inputRevision.current += 1; setPlan(undefined); setResult(undefined); if (!running) setState('idle') }, [selectedItems])
  const selectionBusy = running || state === 'preparing'
  useEffect(() => { onBusyChange?.(selectionBusy); return () => onBusyChange?.(false) }, [selectionBusy, onBusyChange])

  return <div className="doctor-workbench">
    {activePage === 'evidence' && <section role="tabpanel" id="doctor-evidence-panel" aria-labelledby="doctor-page-evidence">
      <div className="doctor-page-intro"><h3>查看来源证据</h3><p>展开原文核对，勾选需要分析的部分。只发送你选定的证据。</p></div>
      {lens === 'mode' && <label className="doctor-field">证据会话<select disabled={running} value={sourceId ?? ''} onChange={(event) => { inputRevision.current += 1; sourceRevision.current += 1; setSourceId(event.target.value); setPage(undefined); setSelection([]); setPlan(undefined); setResult(undefined); setState('idle') }}><option value="">仅使用模式统计</option>{report?.sessions.map((entry, index) => <option key={entry.sessionId} value={entry.sessionId}>{entry.title ?? `会话 ${index + 1}`}（{entry.eligibility.confirmedExchanges} 轮）</option>)}</select></label>}
      <div className="doctor-evidence-tools"><select aria-label="筛选证据类型" value={filter} onChange={(event) => onFilter?.(event.target.value)}>{buckets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><span className="doctor-muted">{page?.items.length ?? 0} 项已读取</span></div>
      {state === 'loading-evidence' && <div className="doctor-loading" role="status"><span className="doctor-spinner"/>正在读取原文</div>}
      {page?.status.kind === 'partial' && <div className="doctor-status-note">部分原文暂不可读取，已读取内容仍可核对。</div>}
      {evidenceRows.length === 0 && state !== 'loading-evidence' && <div className="doctor-empty"><DoctorIcon kind="evidence"/><p>{sourceId ? '当前筛选下没有已读取的证据。可以换一种类型，或继续读取下一页。' : '请选择一个会话查看原文。模式分析也可仅使用统计。'}</p></div>}
      <EvidenceBrowser items={evidenceRows} selectedRefs={selected} disabled={running} focusedRef={focusedRef} onFeedback={onFeedback} onToggle={(item, checked) => { inputRevision.current += 1; setSelection(checked ? [...selectedItems.filter(selected => selected.ref !== item.ref), item] : selectedItems.filter(selected => selected.ref !== item.ref)); setPlan(undefined); if (!running) setState('idle') }} />
      {sourceId && (page === undefined || page.nextOffset !== undefined) && <Button size="sm" variant="outline" disabled={state === 'loading-evidence'} onClick={() => void loadEvidence()}>{page ? '继续读取证据' : '读取会话证据'}</Button>}
      <div className="doctor-selection-bar"><span>已选 {selected.length} 项证据</span><Button size="sm" variant="primary" icon={<DoctorIcon kind="analyze" />} disabled={selected.length === 0 && lens !== 'mode'} onClick={() => onNavigate?.('analysis')}>分析所选证据</Button></div>
    </section>}
    {activePage === 'analysis' && <section role="tabpanel" id="doctor-analysis-panel" aria-labelledby="doctor-page-analysis">
      <div className="doctor-page-intro"><h3>{result ? '审阅分析结果' : plan ? '确认这次分析' : '准备一次分析'}</h3><p>{result ? '建议与候选都需要你判断，确认的要求才进入保护范围。' : '先核对范围和预算，再决定是否调用模型。'}</p></div>
      <div className="doctor-analysis-scope"><div><DoctorIcon kind="evidence"/><strong>{selected.length} 项选定证据</strong><Button size="sm" variant="ghost" onClick={() => onNavigate?.('evidence')}>调整范围</Button></div><p>{selected.length ? `${selectedItems.reduce((count, item) => count + item.text.length, 0).toLocaleString()} 字符，另附必要统计摘要` : lens === 'mode' ? '仅使用模式声明与统计摘要' : '尚未选择原文，请先在证据页勾选。'}</p></div>
      <label className="doctor-field">分析目的<select disabled={running} value={kind} onChange={(event) => { inputRevision.current += 1; setKind(event.target.value as AnalysisPlan['kind']); setPlan(undefined); setResult(undefined); setState('idle') }}><option value={lens === 'mode' ? 'mode-quality' : 'session-quality'}>{lens === 'mode' ? '模式能力组合质量' : '当前会话质量'}</option><option value="requirement-distill">提炼需要保留的要求</option></select></label>
      {!available && <div className="doctor-status-note">分析模型服务暂不可用。你仍可查看统计、证据和记录问题。</div>}
      {!plan && <Button variant="primary" disabled={!client || !available || state === 'preparing' || running || (!selected.length && lens !== 'mode')} onClick={() => void prepare()}>{state === 'preparing' ? '正在准备…' : '预览分析范围与预算'}</Button>}
      {plan && <div className="doctor-plan"><div className="doctor-section-heading"><h4>本次分析</h4><span className="doctor-tone-tag">{plan.feasible ? '预算内' : '需要缩小范围'}</span></div><dl className="doctor-metadata"><dt>模型</dt><dd>{plan.model.provider} / {plan.model.model}</dd><dt>输入估算</dt><dd>约 {plan.inputEstimateTokens.toLocaleString()} tokens</dd><dt>预算</dt><dd>总输入 {plan.budget.totalInputTokens.toLocaleString()}，最多 {plan.budget.maxCalls} 次调用，每次输出 {plan.budget.outputTokensPerCall.toLocaleString()}</dd></dl>{plan.dataGaps.map((gap) => <p className="doctor-status-note" key={gap}>{gap}</p>)}<p className="doctor-caption">预览未调用模型。开始后只分析本次范围，不执行用户工具。</p>{!result && <Button variant="primary" disabled={!plan.feasible || running || state === 'complete'} onClick={() => void start()}>开始这次分析</Button>}</div>}
      {running && <div className="doctor-loading" role="status"><span className="doctor-spinner"/>正在分析所选证据<Button size="sm" variant="outline" disabled={state === 'cancelling'} onClick={() => { abortController.current?.abort(); setState('cancelling') }}>{state === 'cancelling' ? '正在取消…' : '取消分析'}</Button></div>}
      {plan && !running && ['cancelled', 'failed'].includes(state) && <Button size="sm" variant="outline" onClick={() => void prepare()}>重新准备分析</Button>}
      {state === 'cancelled' && <p role="status" className="doctor-status-note">本次分析已取消。已发生的调用仍以模型报告为准。</p>}
      {error && <p role="alert" className="doctor-status-note">{error}</p>}
      {result?.findings.length ? <section className="doctor-section"><h4>分析发现</h4>{result.findings.map((finding, index) => <div className="doctor-finding" key={index}><span className="doctor-tone-tag">建议</span><p>{finding.statement}</p></div>)}</section> : null}
      {result?.candidateConstraints.map((candidate) => <CandidateReview key={candidate.id} candidate={candidate} sessionId={sourceId} modeId={modeId} saved={constraints.some((item) => item.id === candidate.id)} onConfirm={saveCandidate} />)}
      <details className="doctor-details" open={configurationOpen} onToggle={(event) => setConfigurationOpen(event.currentTarget.open)}><summary>已确认要求与压缩设置</summary>
        {scopedConstraints.length === 0 ? <p className="doctor-caption">此范围尚无已确认的要求。分析后可审阅候选，再决定是否保护。</p> : scopedConstraints.map((item) => <div className="doctor-saved-constraint" key={item.id}><p>{String(item.data['normalizedRequirement'])}</p><span className="doctor-muted">{item.data['status'] === 'active' ? '已确认' : item.data['status'] === 'revoked' ? '已撤销' : '来源已变化'}</span>{item.data['status'] === 'active' && <Button size="sm" variant="ghost" onClick={() => void operation(async () => { const updated = await client!.constraints.update(item.id, item.revision, { status: 'revoked' }); setConstraints(updated) })}>撤销此要求</Button>}</div>)}
        {modeId && <><h4>模式压缩增强</h4><p className="doctor-caption">将已确认要求融合进原有摘要调用。只影响新 Agent，现有会话继续使用原配置。</p><label className="doctor-field">操作<select disabled={providerBusy} value={providerEnabled ? 'enable' : 'disable'} onChange={(event) => { setProviderEnabled(event.target.value === 'enable'); setProviderPlan(undefined); setProviderNotice('') }}><option value="enable">启用增强</option><option value="disable">恢复基础提供方</option></select></label><Button size="sm" variant="outline" disabled={providerBusy} onClick={() => void prepareProvider()}>{providerBusy && !providerPlan ? '正在预览…' : '预览模式配置变更'}</Button>{providerNotice && <p role="status" className="doctor-status-note">{providerNotice}</p>}{providerPlan && <div className="doctor-plan"><p>保留原有阈值、路由和输出上限，只替换压缩提供方。</p><pre className="doctor-source-text">原配置：{providerPlan.before}{'\n'}新配置：{providerPlan.after}</pre><Button variant="primary" disabled={providerBusy} onClick={() => void applyProvider()}>{providerBusy ? '正在应用…' : '确认应用到新 Agent'}</Button></div>}</>}
      </details>
    </section>}
  </div>
}

function CandidateReview({ candidate, sessionId, modeId, saved, onConfirm }: {
  candidate: CandidateConstraint; sessionId?: string; modeId?: string; saved: boolean
  onConfirm: (candidate: CandidateConstraint, values: { requirement: string; conditions: string; exceptions: string; scope: ConstraintScope }) => Promise<void>
}) {
  const [requirement, setRequirement] = useState(candidate.normalizedRequirement)
  const [conditions, setConditions] = useState(candidate.conditions.join('\n'))
  const [exceptions, setExceptions] = useState(candidate.exceptions.join('\n'))
  const [scopeKind, setScopeKind] = useState<'session' | 'mode'>(sessionId ? 'session' : 'mode')
  const [saving, setSaving] = useState(false)
  const scope: ConstraintScope | undefined = scopeKind === 'session' && sessionId ? { kind: 'session', sessionId } : scopeKind === 'mode' && modeId ? { kind: 'mode', modeId } : undefined
  return <fieldset className="doctor-candidate"><legend>需要保留的要求</legend><p>原文：</p><pre>{candidate.originalText}</pre><p>来源：{candidate.sourceRefs.join('、')}</p>
    <label>确认要求<textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} /></label>
    <label>条件（每行一项）<textarea value={conditions} onChange={(event) => setConditions(event.target.value)} /></label>
    <label>例外（每行一项）<textarea value={exceptions} onChange={(event) => setExceptions(event.target.value)} /></label>
    <label>适用范围<select value={scopeKind} onChange={(event) => setScopeKind(event.target.value as 'session' | 'mode')}><option value="session" disabled={!sessionId}>仅此会话</option><option value="mode" disabled={!modeId}>此模式</option></select></label>
    <Button variant="primary" disabled={saved || saving || !scope || !requirement.trim()} onClick={() => { if (scope) { setSaving(true); void onConfirm(candidate, { requirement, conditions, exceptions, scope }).finally(() => setSaving(false)) } }}>{saved ? '已确认' : saving ? '正在保存…' : '确认此要求'}</Button>
  </fieldset>
}
