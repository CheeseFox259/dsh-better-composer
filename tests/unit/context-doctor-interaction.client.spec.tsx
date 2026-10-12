// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { ContextDoctorPanel } from '../../src/client/context-doctor/panel.tsx'
import { DoctorAnalysisPanel } from '../../src/client/context-doctor/analysis-panel.tsx'
import { FakeDoctorClient } from '../helpers/doctor-client-fake.ts'
import type { AnalysisPlan, AnalysisResult } from '../../src/doctor/host/analyze.ts'
import type { EvidencePage } from '../../src/doctor/host/runtime.ts'

it('scans the selected mode rather than reusing the current-session report', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  const scopes: unknown[] = []
  await act(async () => root.render(<ContextDoctorPanel sessionId="session-a" modeId="mode-b"
    loadReport={async (scope) => { scopes.push(scope); return undefined }} />))
  const tab = [...element.querySelectorAll('button')].find((button) => button.textContent === '模式预设')!
  await act(async () => tab.click())
  expect(scopes).toContainEqual({ sessionIds: ['session-a'] })
  expect(scopes).toContainEqual({ modeId: 'mode-b' })
  await act(async () => root.unmount())
})

it('offers distinct overview, diagnosis, analysis and feedback pages without rescanning on page changes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  let scans = 0
  await act(async () => root.render(<ContextDoctorPanel sessionId="session-a" loadReport={async () => { scans += 1; return undefined }} />))
  const labels = [...element.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)
  expect(labels).toEqual(expect.arrayContaining(['概览', '诊断', '分析', '反馈']))
  const evidence = [...element.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent === '诊断')! as HTMLElement
  await act(async () => evidence.click())
  expect(scans).toBe(1)
  await act(async () => root.unmount())
})

it('remembers cancellation while the analysis start response is still pending', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  let finishStart!: (value: AnalysisResult) => void
  let cancelled = false
  const plan: AnalysisPlan = { id: 'prepared', model: { provider: 'fixture', model: 'local' }, inputEstimateTokens: 100, feasible: true, evidence: [], dataGaps: [], budget: { totalInputTokens: 24000, maxCalls: 2, outputTokensPerCall: 4000 } }
  const client = new FakeDoctorClient({ analysisPlan: plan })
  client.analysis.run = async (_plan, options) => {
    return new Promise((resolve, reject) => {
      finishStart = resolve
      options?.signal?.addEventListener('abort', () => {
        cancelled = true
        reject(new Error('分析已取消'))
      })
    })
  }

  const click = (label: string) => [...element.querySelectorAll('button')].find((button) => button.textContent === label)!.click()
  await act(async () => root.render(<DoctorAnalysisPanel client={client} lens="mode" page="analysis" modeId="standard" onFeedback={() => {}} resolveModel={async () => ({ provider: 'fixture', model: 'local' })} />))
  await act(async () => click('预览分析范围与预算'))
  await act(async () => click('开始这次分析'))
  await act(async () => click('取消分析'))
  await act(async () => finishStart({ candidates: [], summary: '', evidenceUsed: [], model: plan.model, tokenUsage: { totalTokens: 0 } }))
  expect(cancelled).toBe(true)
  expect(element.textContent).toContain('本次分析已取消')
  await act(async () => root.unmount())
})

it('discards an evidence response after selecting another source session', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  const replies = new Map<string, (value: EvidencePage) => void>()
  const client = new FakeDoctorClient()
  client.evidence.query = (sessionId) => new Promise((resolve) => replies.set(sessionId, resolve))

  const report = { sessions: [{ sessionId: 'first', title: 'First', eligibility: { confirmedExchanges: 2 } }, { sessionId: 'second', title: 'Second', eligibility: { confirmedExchanges: 2 } }] }
  const response = (id: string): EvidencePage => ({
    sessionId: id,
    status: { kind: 'ok' },
    cutoffSeq: 1,
    items: [{ ref: `${id}:0`, text: `${id} evidence`, bucket: 'message', role: 'user' }],
  })
  await act(async () => root.render(<DoctorAnalysisPanel client={client} report={report as never} lens="mode" page="evidence" onFeedback={() => {}} />))
  const source = element.querySelector('select')!
  await act(async () => { source.value = 'second'; source.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => replies.get('second')!(response('second')))
  await act(async () => replies.get('first')!(response('first')))
  expect(element.textContent).toContain('second evidence')
  expect(element.textContent).not.toContain('first evidence')
  await act(async () => root.unmount())
})

it('allows a new budget preview when its purpose changes during preparation', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  let finishPrepare!: (value: AnalysisPlan) => void
  const client = new FakeDoctorClient()
  client.analysis.prepare = () => new Promise((resolve) => { finishPrepare = resolve })

  await act(async () => root.render(<DoctorAnalysisPanel client={client} lens="mode" page="analysis" onFeedback={() => {}} resolveModel={async () => ({ provider: 'fixture', model: 'local' })} />))
  await act(async () => [...element.querySelectorAll('button')].find((button) => button.textContent === '预览分析范围与预算')!.click())
  const purpose = element.querySelector('select')!
  await act(async () => { purpose.value = 'requirement-distill'; purpose.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => finishPrepare({ id: 'stale-plan', model: { provider: 'fixture', model: 'local' }, inputEstimateTokens: 10, feasible: true, evidence: [], dataGaps: [], budget: { totalInputTokens: 100, maxCalls: 1, outputTokensPerCall: 50 } }))
  const preview = [...element.querySelectorAll('button')].find((button) => button.textContent === '预览分析范围与预算')
  expect(preview?.disabled).toBe(false)
  expect(element.textContent).not.toContain('确认这次分析')
  await act(async () => root.unmount())
})

it('blocks duplicate provider application and confirms the completed change', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  let finishApply!: () => void
  let applies = 0
  const client = new FakeDoctorClient({
    providerPlan: { planId: 'change', modeId: 'standard', enabled: true, promptChanges: [], toolChanges: [], revision: 1 } as never,
  })
  client.provider.apply = () => {
    applies += 1
    return new Promise((resolve) => { finishApply = resolve })
  }

  const button = (label: string) => [...element.querySelectorAll('button')].find((entry) => entry.textContent === label)!
  await act(async () => root.render(<DoctorAnalysisPanel client={client} lens="mode" page="analysis" modeId="standard" onFeedback={() => {}} />))
  await act(async () => button('预览模式配置变更').click())
  await act(async () => button('确认应用到新 Agent').click())
  expect(button('正在应用…').disabled).toBe(true)
  await act(async () => button('正在应用…').click())
  expect(applies).toBe(1)
  await act(async () => finishApply())
  expect(element.textContent).toContain('配置已应用，将用于新 Agent。')
  await act(async () => root.unmount())
})
