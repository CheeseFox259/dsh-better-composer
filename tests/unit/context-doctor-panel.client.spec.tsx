/**
 * Unit tests for Context Doctor panel, lenses, and feedback interaction (W4).
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ScanReport, SessionReportEntry } from '../../src/doctor/host/jobs.ts'
import type { ObservedModes } from '../../src/doctor/host/observe.ts'
import { computeModeEvaluation } from '../../src/doctor/mode-evaluation.ts'
import { REPORT_RULE_VERSIONS } from '../../src/doctor/rule-versions.ts'
import type { DoctorRemoteFace, RemoteResult } from '../../src/client/remote.ts'
import { SessionLens } from '../../src/client/context-doctor/session-lens.tsx'
import { ModeLens } from '../../src/client/context-doctor/mode-lens.tsx'
import {
  FeedbackPanel,
  slugify,
} from '../../src/client/context-doctor/feedback-panel.tsx'
import { ContextDoctorPanel } from '../../src/client/context-doctor/panel.tsx'
import { FakeDoctorClient } from '../helpers/doctor-client-fake.ts'

function createMockEntry(partial: Partial<SessionReportEntry> & { sessionId: string }): SessionReportEntry {
  return {
    originSessionId: partial.sessionId,
    cutoffSeq: 18,
    status: { kind: 'ok' },
    eligibility: {
      sessionId: partial.sessionId,
      rawUnits: [],
      recoveryGroups: [],
      confirmedExchanges: 2,
      possibleExchanges: 0,
      status: 'eligible',
      reasons: [],
    },
    versions: [],
    metrics: {
      composition: {
        observedUsage: {
          id: 'C01',
          metricVersion: 'doctor-metrics/3',
          scope: partial.sessionId,
          value: 42_800,
          unit: 'observed-tokens',
          method: 'm',
          numerator: 42_800,
          eligibleCount: 2,
          observedCount: 2,
        },
        compositionShares: [],
        exactDuplicates: {
          id: 'C05',
          metricVersion: 'doctor-metrics/3',
          scope: partial.sessionId,
          value: 0.1,
          unit: 'ratio',
          method: 'm',
          numerator: 10_000,
          denominator: 100_000,
        },
        repeatedToolResults: { id: 'C06', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'count', method: 'm' },
        buckets: [
          { bucket: 'tool-result', bytes: 40_000, chars: 40_000, estTokens: 10_000 },
          { bucket: 'message', bytes: 20_000, chars: 20_000, estTokens: 5_000 },
        ],
      },
      tools: {
        exposure: { id: 'T01', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 1, unit: 'ratio', method: 'm' },
        usageRatio: { id: 'T02', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 1, unit: 'ratio', method: 'm' },
        pairing: {
          id: 'C10',
          metricVersion: 'doctor-metrics/3',
          scope: partial.sessionId,
          value: 0,
          unit: 'count',
          method: 'm',
          warnings: ['orphan-results:2'],
        },
        ptcFacts: { id: 'T08', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'count', method: 'm' },
        perTool: [{ name: 'bash', exposed: true, called: true }],
        callShare: [{ name: 'bash', share: 1, calls: 4 }],
        status: [{ name: 'bash', success: 3, error: 1, unknown: 0, pending: 0 }],
        repeatArgs: [],
        toolBurden: [{ name: 'bash', definitionBytes: 400, resultBytes: 1000, carryRequests: 2 }],
      },
      extensions: {
        skillCatalog: { id: 'S01', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'count', method: 'm' },
        skillLoads: { id: 'S02', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'count', method: 'm' },
        skillReloads: { id: 'S03', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'ratio', method: 'm' },
        skillBurden: { id: 'S04', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'bytes', method: 'm' },
        mcpComponents: { id: 'M01', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'count', method: 'm' },
        skillLoadsByPath: [],
        components: [{ name: 'bash', kind: 'native' }],
        mcpReachability: [],
      },
      carrying: {
        addRemove: { id: 'C03', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: null, unit: 'bytes', method: 'm' },
        cumulativeCarry: { id: 'C04', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'bytes-per-request', method: 'm' },
        cacheReadRatio: { id: 'C08', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: null, unit: 'ratio', method: 'm' },
        compactionChange: { id: 'C12', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: null, unit: 'ratio', method: 'm' },
        capabilityChanges: { id: 'C14', metricVersion: 'doctor-metrics/3', scope: partial.sessionId, value: 0, unit: 'count', method: 'm' },
      },
      issues: [
        { kind: 'structural', text: '存在未配对的工具结果', evidenceRefs: [] },
        { kind: 'proxy', text: '额外精确副本 10000 bytes（占 10.0%）', evidenceRefs: [] },
      ],
    },
    ...partial,
  } as SessionReportEntry
}

function createMockReport(): ScanReport {
  const entryA = createMockEntry({ sessionId: 'session-a' })
  const entryB = createMockEntry({
    sessionId: 'session-b',
    eligibility: {
      sessionId: 'session-b',
      rawUnits: [],
      recoveryGroups: [],
      confirmedExchanges: 1,
      possibleExchanges: 0,
      status: 'ineligible',
      reasons: ['insufficient-exchanges'],
    },
  })
  const entryC = createMockEntry({
    sessionId: 'session-c',
    status: { kind: 'error', reason: 'read-failed:corrupt' },
    metrics: {
      ...entryA.metrics,
      extensions: {
        ...entryA.metrics.extensions,
        components: [{ name: 'mcp__fs__read', kind: 'mcp' }],
      },
    },
  })

  const sessions = [entryA, entryB, entryC]
  return {
    id: 'report-1',
    createdAt: Date.now(),
    scope: { modeId: 'mode-std' },
    ruleVersions: [...REPORT_RULE_VERSIONS],
    coverage: {
      candidates: 120,
      completed: 76,
      partial: 8,
      failed: 1,
      modeSkipped: 2,
      failures: [{ sessionId: 'session-c', reason: 'read-failed:corrupt' }],
    },
    sessions,
    modeEvaluation: computeModeEvaluation('mode-std', sessions, { candidates: 120, modeSkipped: 2 }),
  }
}

describe('Context Doctor session lens presentation', () => {
  it('displays observed total and estimated tokens separated on two distinct rows', () => {
    const entry = createMockEntry({ sessionId: 's-alpha' })
    const html = renderToStaticMarkup(<SessionLens entry={entry} />)

    expect(html).toContain('当前上下文')
    expect(html).toContain('依据：宿主输入重建；分项 token 为估算')

    // Both metrics present with their canonical labels
    expect(html).toContain('已报告输入小计')
    expect(html).toContain('42.8k tok')
    expect(html).toContain('2/2 请求有供应商报告')

    expect(html).toContain('role="img"')
    expect(html).toContain('15.0k')
    expect(html).toContain('估算')
    expect(html).toContain('2/2 请求有供应商报告')

    expect(html).toContain('估算 tokens')
    expect(html).toContain('<circle')
  })

  it('renders composition table rows without equating area to risk', () => {
    const entry = createMockEntry({ sessionId: 's-alpha' })
    const html = renderToStaticMarkup(<SessionLens entry={entry} />)

    expect(html).toContain('工具结果')
    expect(html).toContain('10.0k')
    expect(html).toContain('66.7%')
    expect(html).toContain('会话消息')
    expect(html).toContain('5.0k')
    expect(html).toContain('33.3%')
    expect(html).toContain('占比仅表示占用，不表示风险')
  })

  it('renders independent quality issues on separate lines with labels', () => {
    const entry = createMockEntry({ sessionId: 's-alpha' })
    const problems = [{ title: '交付后遗漏验收环境' }]
    const html = renderToStaticMarkup(<SessionLens entry={entry} problems={problems} />)

    // User-recorded issue
    expect(html).toContain('用户反馈')
    expect(html).toContain('交付后遗漏验收环境')

    // Proxy signal issue
    expect(html).toContain('代理信号')
    expect(html).toContain('额外精确副本 10000 bytes')

    // Structural issue
    expect(html).toContain('结构特征')
    expect(html).toContain('存在未配对的工具结果')
  })

  it('displays missing/partial reason notice and does not treat missing as 0', () => {
    const entry = createMockEntry({
      sessionId: 's-partial',
      status: { kind: 'partial', reason: 'truncated-input' },
      eligibility: {
        sessionId: 's-partial',
        rawUnits: [],
        recoveryGroups: [],
        confirmedExchanges: 1,
        possibleExchanges: 0,
        status: 'ineligible',
        reasons: ['insufficient-exchanges'],
      },
    })
    const html = renderToStaticMarkup(<SessionLens entry={entry} />)

    expect(html).toContain('缺失部分不计为 0')
    expect(html).toContain('truncated-input')
    expect(html).toContain('达到两轮完整对话后')
    expect(html).toContain('insufficient-exchanges')
  })
})

describe('Context Doctor mode lens presentation', () => {
  const report = createMockReport()
  const modes: ObservedModes = {
    available: true,
    modes: [
      { id: 'mode-std', name: '标准模式' },
      { id: 'mode-broken', name: '故障预设', broken: 'schema-version-mismatch' },
    ],
  }
  const occurrences = [
    { sessionId: 'session-a', versionKey: 'v3', counted: true },
    { sessionId: 'session-a', versionKey: 'unknown', counted: true },
  ]

  it('renders funnel numbers in sequential stages', () => {
    const html = renderToStaticMarkup(<ModeLens report={report} modes={modes} occurrences={occurrences} />)

    expect(html).toContain('候选 118')
    expect(html).toContain('满足交互门槛 2')
    expect(html).toContain('可读 1')
    expect(html).toContain('本项可计算 1')
  })

  it('renders component table with exposure, usage, and burden tokens', () => {
    const html = renderToStaticMarkup(<ModeLens report={report} modes={modes} occurrences={occurrences} />)

    expect(html).toContain('组件使用与上下文负担')
    expect(html).toContain('bash')
    expect(html).toContain('原生')
    expect(html).toContain('已曝光')
    expect(html).toContain('4 次')
    expect(html).not.toContain('mcp__fs__read') // Its only source is an unreadable session.
  })

  it('lists unknown version problem group separately with explicit warning', () => {
    const html = renderToStaticMarkup(<ModeLens report={report} modes={modes} occurrences={occurrences} />)

    expect(html).toContain('v3')
    expect(html).toContain('版本未记录')
    expect(html).toContain('不默认归入当前配置')
  })

  it('displays broken mode status in selector', () => {
    const html = renderToStaticMarkup(
      <ModeLens report={report} modes={modes} selectedModeId="mode-broken" occurrences={occurrences} />,
    )

    expect(html).toContain('schema-version-mismatch')
    expect(html).toContain('模式当前不可用')
  })

  it('renders rescan prompt when report lacks modeEvaluation (stale legacy report)', () => {
    const legacyReport = { ...report, modeEvaluation: undefined }
    const html = renderToStaticMarkup(
      <ModeLens report={legacyReport} modes={modes} occurrences={occurrences} onRefresh={() => {}} />,
    )

    expect(html).toContain('报告已过期')
    expect(html).toContain('重新扫描模式会话')
  })
})

describe('Context Doctor two-step feedback interaction', () => {
  it('renders chips for problem types and associates with new or existing problems', () => {
    const client = new FakeDoctorClient()
    const html = renderToStaticMarkup(
      <FeedbackPanel
        client={client}
        sessionId="s-test"
        existingProblems={[{ id: 'p-1', title: '既有问题A', revision: 1 }]}
      />,
    )

    expect(html).toContain('用户问题反馈')
    expect(html).toContain('遗漏')
    expect(html).toContain('理解偏差')
    expect(html).toContain('需要补做')
    expect(html).toContain('返工')
    expect(html).toContain('其他')
    expect(html).toContain('关联问题')
    expect(html).toContain('+ 新问题')
    expect(html).toContain('已有: 既有问题A')
  })

  it('submits feedback via client.feedback.submit for new problem without client IDs', async () => {
    const client = new FakeDoctorClient()

    const tree = await client.feedback.submit({
      problemTitle: '交付后遗漏验收环境',
      type: 'omission',
      note: '没有跑自动化测试',
      sessionId: 's-100',
    })

    expect(client.calls.feedbackSubmit).toHaveLength(1)
    const call = client.calls.feedbackSubmit[0]!
    expect(call.problemTitle).toBe('交付后遗漏验收环境')
    expect(call.type).toBe('omission')
    expect(call.note).toBe('没有跑自动化测试')
    expect(call.sessionId).toBe('s-100')

    expect(tree.problems).toHaveLength(1)
    const p = tree.problems[0]!
    expect(p.title).toBe('交付后遗漏验收环境')
    expect(p.id).toMatch(/^problem-/)
    expect(p.occurrences).toHaveLength(1)
    expect(p.occurrences[0]!.id).toMatch(/^occ-/)
    expect(p.occurrences[0]!.problemId).toBe(p.id)
  })

  it('submits feedback via client.feedback.submit targeting an existing problemId', async () => {
    const client = new FakeDoctorClient()

    const tree = await client.feedback.submit({
      targetProblemId: 'problem-existing-123',
      problemTitle: '已存在的问题',
      type: 'rework',
      sessionId: 's-200',
    })

    expect(client.calls.feedbackSubmit).toHaveLength(1)
    const call = client.calls.feedbackSubmit[0]!
    expect(call.targetProblemId).toBe('problem-existing-123')
    expect(call.problemTitle).toBe('已存在的问题')
    expect(call.type).toBe('rework')

    expect(tree.problems).toHaveLength(1)
    expect(tree.problems[0]!.id).toBe('problem-existing-123')
    expect(tree.problems[0]!.occurrences[0]!.problemId).toBe('problem-existing-123')
  })

  it('withdraws occurrence using client.feedback.withdraw with expected revision', async () => {
    const client = new FakeDoctorClient({
      feedbackTree: {
        problems: [
          {
            id: 'p-1',
            revision: 1,
            title: '问题1',
            data: {},
            occurrences: [
              { id: 'occ-target-99', revision: 4, problemId: 'p-1', data: { note: 'test' } },
            ],
          },
        ],
      },
    })

    const tree = await client.feedback.withdraw('occ-target-99', 4)

    expect(client.calls.feedbackWithdraw).toHaveLength(1)
    expect(client.calls.feedbackWithdraw[0]!).toEqual({ occurrenceId: 'occ-target-99', revision: 4 })
    const occ = tree.problems[0]!.occurrences.find((o) => o.id === 'occ-target-99')!
    expect(occ.data['withdrawn']).toBe(true)
  })

  it('generates reproducible slug for user titles', () => {
    expect(slugify('  My Feature Request #123! ')).toBe('my-feature-request-123')
    expect(slugify('')).toBe('untitled')
  })
})

describe('Context Doctor panel container', () => {
  const report = createMockReport()
  const modes: ObservedModes = {
    available: true,
    modes: [{ id: 'mode-std', name: '标准模式' }],
  }

  it('renders perspective tabs and defaults to session lens', () => {
    const html = renderToStaticMarkup(
      <ContextDoctorPanel
        initialReport={report}
        initialModes={modes}
        sessionId="session-a"
      />,
    )

    expect(html).toContain('当前会话')
    expect(html).toContain('模式预设')
    expect(html).toContain('当前上下文')
    expect(html).toContain('dsh-context-doctor-panel')
  })

  it('switches to mode lens when initialTab is mode', () => {
    const html = renderToStaticMarkup(
      <ContextDoctorPanel
        initialReport={report}
        initialModes={modes}
        initialTab="mode"
      />,
    )

    expect(html).toContain('观测分组')
    expect(html).toContain('样本范围')
    expect(html).toContain('组件使用与上下文负担')
  })
})
