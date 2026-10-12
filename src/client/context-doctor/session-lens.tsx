import type { SessionReportEntry } from '../../doctor/host/jobs.ts'
import { buildCompositionRows, buildIssueLines, buildSessionSummary } from './view-model.ts'
import { CompositionChart } from './composition-chart.tsx'
import { formatTokens } from './format.ts'
import { Button, DoctorIcon } from './ui.tsx'
export { formatTokens } from './format.ts'

export interface SessionLensProps {
  readonly entry?: SessionReportEntry
  readonly problems?: readonly { readonly title: string }[]
  readonly onOpenFeedback?: () => void
  readonly onRefresh?: () => void
  readonly showComposition?: boolean
  readonly onInspect?: (bucket?: string) => void
}

export function SessionLens({ entry, problems = [], onOpenFeedback, onRefresh, onInspect, showComposition = true }: SessionLensProps) {
  if (!entry) return <div className="doctor-empty"><div className="doctor-empty-glyph"><DoctorIcon kind="evidence" /></div><h3>从会话开始</h3><p>打开已有会话，即可查看上下文构成。统计不会调用模型。</p>{onRefresh && <Button size="sm" variant="outline" onClick={onRefresh}>读取当前会话</Button>}</div>
  if (entry.status.kind === 'error') return <div className="doctor-empty"><h3>暂时无法读取会话</h3><p>更新统计重试，或选择其他会话。</p><details><summary>查看原因</summary>{entry.status.reason}</details>{onRefresh && <Button size="sm" variant="outline" onClick={onRefresh}>更新统计</Button>}</div>
  const summary = buildSessionSummary(entry)
  const composition = buildCompositionRows(entry)
  const issues = buildIssueLines(entry, problems)
  return <div className="doctor-overview">
    {showComposition && <section className="doctor-section doctor-composition-section">
      <div className="doctor-section-heading"><h3>当前上下文</h3><span className="doctor-muted">字符估算</span></div>
      <CompositionChart rows={composition.rows} total={composition.totalEstimatedTokens} onInspect={onInspect} />
      <p className="doctor-caption">图形表示占用。点击组成部分查看证据。</p>
      <div className="doctor-facts">
        <div><span>已报告输入小计</span><strong>{summary.observedInputTotal === null ? '未观测' : `${formatTokens(summary.observedInputTotal)} tok`}</strong></div>
        <div><span>模型请求</span><strong>{summary.requestCount} 次</strong></div>
        <div><span>工具调用</span><strong>{entry.metrics.tools.callShare.reduce((count, item) => count + item.calls, 0)} 次</strong></div>
      </div>
    </section>}
    {entry.status.kind === 'partial' && <div className="doctor-status-note">已读取部分证据，缺失部分不计为 0。<details><summary>读取详情</summary>{entry.status.reason}</details></div>}
    {summary.eligibilityStatus !== 'eligible' && <div className="doctor-status-note"><span className="doctor-status-dot" />可查看和反馈此会话；达到两轮完整对话后，才纳入模式统计。</div>}
    <section className="doctor-section">
      <div className="doctor-section-heading"><h3>需要关注</h3>{onOpenFeedback && <Button size="sm" variant="ghost" icon={<DoctorIcon kind="feedback" />} onClick={onOpenFeedback}>记录问题</Button>}</div>
      {issues.length ? <div className="doctor-issues">{issues.map((issue, index) => <button className="doctor-issue-row" type="button" key={index} onClick={() => issue.kind === 'user-recorded' ? onOpenFeedback?.() : onInspect?.()}><span className={`doctor-tone-tag tone-${issue.kind}`}>{issue.kind === 'user-recorded' ? '用户反馈' : issue.kind === 'structural' ? '结构特征' : '代理信号'}</span><span>{issue.text}</span><DoctorIcon kind="chevron" /></button>)}</div>
        : <div className="doctor-clear-state"><DoctorIcon kind="check" /><div><strong>暂无明确问题</strong><p>这不代表任务已验收。遗漏或返工可由你记录。</p></div></div>}
    </section>
    <details className="doctor-details"><summary>来源与统计口径</summary><dl className="doctor-metadata"><dt>会话</dt><dd>{entry.sessionId}</dd><dt>快照边界</dt><dd>{entry.cutoffSeq} 个事件</dd><dt>Usage 覆盖</dt><dd>{summary.observedCoverage}</dd><dt>计量方式</dt><dd>组成使用字符/4估算，与供应商报告独立展示；不缩放分项。</dd><dt>模式资格</dt><dd>{summary.eligibilityStatus === 'eligible' ? '满足两轮完整对话' : '未满足门槛'} {summary.eligibilityReasons.join('、')}</dd></dl><p>依据：宿主输入重建；分项 token 为估算。占比仅表示占用，不表示风险。</p>{entry.versions.filter((version) => version.kind === 'runtime-config').map((version) => <p key={version.digest}>活动代际 {version.observedBinding}（部分观测）</p>)}</details>
  </div>
}
