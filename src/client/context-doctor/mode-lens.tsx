import { useState } from 'react'
import type { ScanReport } from '../../doctor/host/jobs.ts'
import type { ObservedModes } from '../../doctor/host/observe.ts'
import { hasCurrentRuleVersions } from '../../doctor/rule-versions.ts'
import { buildModeProblemGroups } from './view-model.ts'
import { formatTokens } from './format.ts'
import { Button, DoctorIcon } from './ui.tsx'

export interface ModeLensProps {
  readonly report?: ScanReport
  readonly modes?: ObservedModes
  readonly selectedModeId?: string
  readonly occurrences?: readonly { readonly sessionId: string; readonly versionKey?: string; readonly counted: boolean }[]
  readonly onSelectModeId?: (modeId: string) => void
  readonly onRefresh?: () => void
  readonly onInspect?: () => void
}

export function ModeLens({ report, modes, selectedModeId, occurrences = [], onRefresh, onInspect }: ModeLensProps) {
  const [selectedVersion, setSelectedVersion] = useState('')
  const [allComponents, setAllComponents] = useState(false)
  const preset = modes?.modes.find((mode) => mode.id === selectedModeId)

  if (!report) {
    return (
      <div className="doctor-empty">
        <DoctorIcon kind="evidence" />
        <h3>查看模式的实际表现</h3>
        <p>选择一个模式，读取它的可访问会话。不同观测版本分别展示。</p>
        {onRefresh && <Button variant="outline" size="sm" onClick={onRefresh}>读取模式会话</Button>}
      </div>
    )
  }

  const evaluation = report.modeEvaluation
  if (!evaluation || !hasCurrentRuleVersions(report.ruleVersions)) {
    return (
      <div className="doctor-empty">
        <DoctorIcon kind="evidence" />
        <h3>报告已过期</h3>
        <p>当前报告缺少模式质量评价聚合数据或度量规则已更新，请重新扫描该模式。</p>
        {onRefresh && <Button variant="outline" size="sm" onClick={onRefresh}>重新扫描模式会话</Button>}
      </div>
    )
  }

  const versions = evaluation.groups.map((group) => group.fingerprint)
  const version = versions.includes(selectedVersion) ? selectedVersion : (versions[0] ?? '')
  const currentGroup = evaluation.groups.find((group) => group.fingerprint === version) ?? evaluation.groups[0]
  const components = currentGroup?.components ?? []
  const groupSessionIdSet = new Set(currentGroup?.sessionIds ?? [])
  const group = { ...report, sessions: report.sessions.filter((entry) => groupSessionIdSet.has(entry.sessionId)) }
  const problems = buildModeProblemGroups(group, occurrences)
  const funnel = evaluation.funnel
  const repetition = currentGroup?.repetition
  const percent = (value: number | null | undefined) => value == null ? '未观测' : `${(value * 100).toFixed(1)}%`

  return (
    <div className="doctor-overview">
      {preset?.description && <p className="doctor-mode-description">{preset.description}</p>}
      {preset?.broken && <div className="doctor-status-note">模式当前不可用：{preset.broken}</div>}
      {modes && !modes.available && <div className="doctor-status-note">暂时无法读取模式列表。{modes.reason}</div>}
      <section className="doctor-section">
        <div className="doctor-section-heading">
          <h3>样本范围</h3>
          <span className="doctor-muted">至少两轮完整对话</span>
        </div>
        <div className="doctor-funnel">
          {[
            { label: '候选会话', value: funnel.candidates },
            { label: '满足交互门槛', value: funnel.eligible },
            { label: '可读且可计算', value: funnel.perMetricComputable },
          ].map((stage, index) => (
            <div key={stage.label}>
              <strong>{stage.value}</strong>
              <span>{stage.label}</span>
              <div className="doctor-funnel-track">
                <i style={{ width: `${funnel.candidates ? (stage.value / funnel.candidates) * 100 : 0}%`, opacity: 1 - index * 0.2 }} />
              </div>
            </div>
          ))}
        </div>
        {(report.coverage.failed > 0 || report.coverage.partial > 0) && (
          <p className="doctor-caption">
            {report.coverage.partial} 个部分读取，{report.coverage.failed} 个读取失败。缺失不计为 0。
          </p>
        )}
      </section>
      {versions.length > 0 && (
        <div className="doctor-version-selector">
          <label htmlFor="doctor-observation-group">观测分组</label>
          <select id="doctor-observation-group" value={version} onChange={(event) => setSelectedVersion(event.target.value)}>
            {evaluation.groups.map((g, index) => (
              <option key={g.fingerprint} value={g.fingerprint}>
                分组 {index + 1}（{g.candidates} 个会话）
              </option>
            ))}
          </select>
        </div>
      )}
      <section className="doctor-section">
        <div className="doctor-section-heading">
          <h3>组件使用与上下文负担</h3>
          <span className="doctor-muted">当前分组</span>
        </div>
        {components.length === 0 ? (
          <div className="doctor-empty-inline">本分组尚无满足门槛的组件数据。短会话仍可单独查看和反馈。</div>
        ) : (
          <div className="doctor-component-list">
            {(allComponents ? components : components.slice(0, 8)).map((row) => (
              <div className="doctor-component-row" key={row.name}>
                <div>
                  <strong title={row.name}>{row.name}</strong>
                  <span>
                    {row.kind === 'mcp' ? 'MCP' : row.kind === 'native' ? '原生工具' : '来源未解析'}{' '}
                    {row.exposed ? '已曝光' : '曝光未观测'}
                  </span>
                </div>
                <div>
                  <strong>{row.calls} 次</strong>
                  <span>{row.errors ? `${row.errors} 次错误` : row.used ? '已调用' : '未调用'}</span>
                </div>
                <div>
                  <strong>{row.burdenEstimatedTokens === null ? '—' : formatTokens(row.burdenEstimatedTokens)}</strong>
                  <span>定义估算 tok</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {components.length > 8 && (
          <Button size="sm" variant="ghost" onClick={() => setAllComponents((value) => !value)}>
            {allComponents ? '收起组件' : `查看全部 ${components.length} 个组件`}
          </Button>
        )}
        <p className="doctor-caption">曝光和调用是事实，不用于判断组件是否必要。</p>
      </section>
      <section className="doctor-section">
        <h3>精确重复观察</h3>
        <div className="doctor-facts">
          <div>
            <span>典型会话中位数</span>
            <strong>{percent(repetition?.median)}</strong>
          </div>
          <div>
            <span>会话等权均值</span>
            <strong>{percent(repetition?.mean)}</strong>
          </div>
          <div>
            <span>总体资源贡献</span>
            <strong>{percent(repetition?.pooledContribution)}</strong>
          </div>
        </div>
        <p className="doctor-caption">{repetition?.sampleCount ?? 0} 个可计算样本。重复占用不代表质量损害。</p>
      </section>
      <section className="doctor-section">
        <div className="doctor-section-heading">
          <h3>用户记录的问题</h3>
          {onInspect && (
            <Button size="sm" variant="ghost" onClick={onInspect}>
              查看证据
            </Button>
          )}
        </div>
        {problems.length ? (
          problems.map((problem) => (
            <div className="doctor-problem-summary" key={problem.versionKey}>
              <strong>{problem.affectedSessions} 个受影响会话</strong>
              <span>{problem.reports} 条记录</span>
              <span className="doctor-tone-tag">
                {problem.versionKey === 'unknown'
                  ? '版本未记录'
                  : `配置 ${problem.versionKey.length > 16 ? problem.versionKey.slice(0, 12) : problem.versionKey}`}
              </span>
            </div>
          ))
        ) : (
          <p className="doctor-caption">本分组暂无问题反馈。未反馈不等于已经验收。</p>
        )}
      </section>
      <details className="doctor-details">
        <summary>版本与覆盖说明</summary>
        <p>历史权威配置版本未知，不默认归入当前配置。当前分组依据可观测能力指纹，不能证明完整配置一致。</p>
        <p className="doctor-source-id">{version}</p>
        <p>
          候选 {funnel.candidates}，满足交互门槛 {funnel.eligible}，可读 {funnel.readable}，本项可计算 {funnel.perMetricComputable}。
        </p>
        <p>归档会话保留统计资格；模式跳过 {report.coverage.modeSkipped} 个。已报告小计和估算分别保留。</p>
      </details>
    </div>
  )
}
