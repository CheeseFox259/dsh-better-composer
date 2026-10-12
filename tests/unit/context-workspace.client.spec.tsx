// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { ContextMapPanel } from '../../src/client/context-map-panel.tsx'
const persistedAnchors = new Map<string, string>()
beforeAll(() => vi.stubGlobal('localStorage', { getItem: (key: string) => persistedAnchors.get(key) ?? null, setItem: (key: string, value: string) => persistedAnchors.set(key, value), removeItem: (key: string) => persistedAnchors.delete(key) }))
afterAll(() => vi.unstubAllGlobals())
import { ContextDoctorPanel } from '../../src/client/context-doctor/panel.tsx'
import type { ContextMapProbe } from '../../src/client/context-map-panel.tsx'

function probe(): ContextMapProbe {
  return {
    version: () => 1, subscribe: () => () => {}, historyLoading: () => false, loadAllHistory() {}, draftClips: () => 2,
    projection: key => key === 'contextBreakdown' ? { systemTokens: 20, toolsTokens: 30, messageTokens: 50 } : key === 'contextPressure' ? { projectedTokens: 120, contextWindow: 1000 } : { uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 90, cacheWriteTokens: 5 },
    events: () => ({ revision: 1, entries: [
      { type: 'event', event: { type: 'turn/start', seq: 4, data: { turn: 1 } } },
      { type: 'event', event: { type: 'user/message', seq: 5, data: { content: [{ type: 'text', text: 'original message' }] } } },
      { type: 'event', event: { type: 'turn/end', seq: 6, data: { turn: 1 } } },
    ] }),
    async compact() {}, async forkAt() {},
  }
}

it('defaults to the complete live map and keeps inspection separate from diagnostics and model actions', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div'); const root = createRoot(element)
  let scans = 0
  await act(async () => root.render(<ContextDoctorPanel probe={probe()} sessionId="s1" loadReport={async () => { scans += 1; return undefined }} />))
  expect([...element.querySelectorAll('.doctor-pages [role="tab"]')].map(tab => tab.textContent)).toEqual(['概览', '诊断', '分析', '反馈'])
  expect(element.textContent).toContain('宿主实时构成')
  expect(element.textContent).toContain('缓存')
  expect(element.textContent).toContain('逐轮增长')
  expect(element.querySelector('.doctor-ring-center strong')!.textContent).toBe('100')
  await act(async () => (element.querySelector('[data-legend="system"]')! as HTMLButtonElement).click())
  expect(scans).toBe(0)
  expect(element.textContent).toContain('暂无系统提示词')
  await act(async () => [...element.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='诊断')!.dispatchEvent(new MouseEvent('click',{bubbles:true})))
  expect(scans).toBe(1)
  await act(async () => root.unmount())
})

it('retains expanded source content across pages and clears an unsubmitted compact confirmation', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div'); const root = createRoot(element)
  const source = probe(); let compacts = 0; source.compact = async () => { compacts += 1 }
  await act(async () => root.render(<ContextDoctorPanel probe={source} sessionId="s1" />))
  const click = async (text: string) => act(async () => [...element.querySelectorAll('button')].find(button=>button.textContent===text)!.click())
  const turn = element.querySelector('[data-turn] .dsh-better-composer-ctxmap-row-expander')! as HTMLButtonElement
  await act(async () => turn.click())
  await click('压缩上下文')
  expect(element.textContent).toContain('确认压缩')
  await click('诊断'); await click('概览')
  expect(element.querySelector('[data-turn] .dsh-better-composer-ctxmap-row-expander')!.getAttribute('aria-expanded')).toBe('true')
  expect(element.textContent).not.toContain('确认压缩？')
  expect(compacts).toBe(0)
  await act(async () => root.unmount())
})

it('adds the Host canonical source independently of browsing and carries it across pages into analysis', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div'); const root = createRoot(element)
  const requests: unknown[] = []; let prepared: unknown
  const face = {
    async doctorProblems() { return { ok: true, value: [] } },
    async doctorAnalysisAvailable() { return { ok: true, value: { available: true } } },
    async doctorConstraints() { return { ok: true, value: [] } },
    async doctorEvidence(request: unknown) { requests.push(request); return { ok: true, value: { sessionId: 's1', cutoffSeq: 7, status: { kind: 'ok' }, items: [{ ref: 's1:5', text: 'Host canonical body', role: 'user', bucket: 'message' }] } } },
    async doctorPrepareAnalysis(request: unknown) { prepared = request; return { ok: true, value: { id: 'p1', feasible: true, model: { provider: 'fixture', model: 'local' }, inputEstimateTokens: 20, budget: { totalInputTokens: 24000, maxCalls: 2, outputTokensPerCall: 4000 }, dataGaps: [] } } },
  }
  await act(async () => root.render(<ContextDoctorPanel probe={probe()} sessionId="s1" face={face as never} resolveModel={async () => ({ provider: 'fixture', model: 'local' })} />))
  for (const selector of ['[data-turn] .dsh-better-composer-ctxmap-row-expander', '.dsh-better-composer-ctxmap-step > button', '.dsh-better-composer-ctxmap-message > button']) {
    await act(async () => (element.querySelector(selector)! as HTMLButtonElement).click())
  }
  const click = async (text: string) => act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === text)!.click())
  await click('加入分析')
  expect(requests).toContainEqual({ sessionId: 's1', refs: ['s1:5'] })
  expect(element.querySelector('.doctor-pages [aria-selected="true"]')!.textContent).toBe('概览')
  await click('分析'); await click('反馈'); await click('分析')
  expect(element.textContent).toContain('1 项选定证据')
  await click('预览分析范围与预算')
  expect(prepared).toMatchObject({ evidenceRefs: ['s1:5'] })
  await act(async () => root.unmount())
})

it('preserves explicit compact confirmation, native fork boundary and anchored turn markers', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div'); const root = createRoot(element)
  const source = probe(); let compacts = 0; const forks: number[] = []
  source.compact = async () => { compacts += 1 }; source.forkAt = async seq => { forks.push(seq) }
  await act(async () => root.render(<ContextDoctorPanel probe={source} sessionId="parity-session" />))
  const find = (label: string) => [...element.querySelectorAll('button')].find(button=>button.textContent===label)!
  await act(async () => find('压缩上下文').click())
  expect(compacts).toBe(0)
  await act(async () => find('确认压缩？将摘要替换历史').click())
  expect(compacts).toBe(1)
  await act(async () => (element.querySelector('[aria-label="从第 1 轮后分叉"]')! as HTMLButtonElement).click())
  expect(forks).toEqual([6])
  expect(element.textContent).toContain('已创建分叉会话')
  await act(async () => (element.querySelector('[aria-label="锚定第 1 轮"]')! as HTMLButtonElement).click())
  expect(element.querySelector('[data-anchored="true"]')).not.toBeNull()
  expect(persistedAnchors.get('dsh-better-composer.anchors.parity-session')).toBe('[1]')
  await act(async () => root.unmount())
  persistedAnchors.delete('dsh-better-composer.anchors.parity-session')
})

it('does not admit a late source lookup after the analysis object changes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div'); const root = createRoot(element)
  let finish!: (value: unknown) => void
  const face = {
    async doctorProblems() { return { ok: true, value: [] } },
    async doctorAnalysisAvailable() { return {ok:true,value:{available:false}} },
    async doctorConstraints() { return {ok:true,value:[]} },
    doctorEvidence() { return new Promise(resolve=>{finish=resolve}) },
  }
  await act(async () => root.render(<ContextDoctorPanel probe={probe()} sessionId="s1" face={face as never} />))
  for (const selector of ['[data-turn] .dsh-better-composer-ctxmap-row-expander', '.dsh-better-composer-ctxmap-step > button', '.dsh-better-composer-ctxmap-message > button']) await act(async () => (element.querySelector(selector)! as HTMLButtonElement).click())
  await act(async () => [...element.querySelectorAll('button')].find(button=>button.textContent==='加入分析')!.click())
  await act(async () => [...element.querySelectorAll('button')].find(button=>button.textContent==='模式预设')!.click())
  await act(async () => finish({ok:true,value:{sessionId:'s1',cutoffSeq:7,status:{kind:'ok'},items:[{ref:'s1:5',text:'stale',role:'user'}]}}))
  await act(async () => [...element.querySelectorAll('button')].find(button=>button.textContent==='分析')!.click())
  expect(element.textContent).toContain('0 项选定证据')
  expect(element.textContent).not.toContain('stale')
  await act(async () => root.unmount())
})

it('discards an old structural evidence page when the Doctor cutoff changes', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div'); const root = createRoot(element)
  let finishOld!: (value: unknown) => void
  const face = { doctorEvidence(request: { cutoffSeq: number; offset?: number }) {
    if (request.offset) return new Promise(resolve=>{finishOld=resolve})
    return Promise.resolve({ok:true,value:{sessionId:'s1',cutoffSeq:request.cutoffSeq,status:{kind:'ok'},nextOffset:request.cutoffSeq===7?25:undefined,items:[{ref:`s1:${request.cutoffSeq-1}`,text:request.cutoffSeq===7?'old first':'fresh source',role:'user',bucket:'message'}]}})
  } }
  const entry = (cutoffSeq: number) => ({ sessionId:'s1',cutoffSeq,status:{kind:'ok'},metrics:{composition:{buckets:[{bucket:'message',bytes:100,chars:100,estTokens:25}],exactDuplicates:{}}} })
  const source = probe()
  await act(async()=>root.render(<ContextMapPanel sessionId="s1" probe={source} face={face as never} doctorEntry={entry(7) as never} />))
  await act(async()=>[...element.querySelectorAll('button')].find(button=>button.textContent==='结构细分估算')!.click())
  await act(async()=>[...element.querySelectorAll('button')].find(button=>button.textContent==='继续读取证据')!.click())
  await act(async()=>root.render(<ContextMapPanel sessionId="s1" probe={source} face={face as never} doctorEntry={entry(8) as never} />))
  await act(async()=>finishOld({ok:true,value:{sessionId:'s1',cutoffSeq:7,status:{kind:'ok'},items:[{ref:'s1:0',text:'stale page',role:'user',bucket:'message'}]}}))
  expect(element.textContent).toContain('fresh source')
  expect(element.textContent).not.toContain('stale page')
  await act(async()=>root.unmount())
})

it('keeps loaded structural pages through a page hide without re-reading the first page', async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  const element=document.createElement('div');const root=createRoot(element);let reads=0
  const face={async doctorEvidence(request:{offset?:number}){reads+=1;return {ok:true,value:{sessionId:'s1',cutoffSeq:8,status:{kind:'ok'},nextOffset:request.offset?undefined:25,items:[{ref:request.offset?'s1:7':'s1:6',text:request.offset?'second source':'first source',role:'user',bucket:'message'}]}}}}
  const source=probe();const entry={sessionId:'s1',cutoffSeq:8,status:{kind:'ok'},metrics:{composition:{buckets:[{bucket:'message',bytes:100,chars:100,estTokens:25}],exactDuplicates:{}}}}
  const render=(active:boolean)=>root.render(<ContextMapPanel active={active} sessionId="s1" probe={source} face={face as never} doctorEntry={entry as never} />)
  await act(async()=>render(true))
  await act(async()=>[...element.querySelectorAll('button')].find(button=>button.textContent==='结构细分估算')!.click())
  await act(async()=>[...element.querySelectorAll('button')].find(button=>button.textContent==='继续读取证据')!.click())
  await act(async()=>render(false));await act(async()=>render(true))
  expect(reads).toBe(2);expect(element.textContent).toContain('second source')
  await act(async()=>root.unmount())
})

it('does not let a pending source addition rewrite a prepared analysis range', async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  const element=document.createElement('div');const root=createRoot(element);let pending!: (value:unknown)=>void;let reads=0
  const face={
    async doctorProblems(){return {ok:true,value:[]}},async doctorConstraints(){return {ok:true,value:[]}},async doctorAnalysisAvailable(){return {ok:true,value:{available:true}}},
    doctorEvidence(){reads+=1;if(reads===2)return new Promise(resolve=>{pending=resolve});return Promise.resolve({ok:true,value:{sessionId:'s1',cutoffSeq:7,status:{kind:'ok'},items:[{ref:'s1:5',text:'first canonical',role:'user',bucket:'message'}]}})},
    async doctorPrepareAnalysis(){return {ok:true,value:{id:'prepared',feasible:true,model:{provider:'fixture',model:'local'},inputEstimateTokens:20,budget:{totalInputTokens:24000,maxCalls:2,outputTokensPerCall:4000},dataGaps:[]}}},
  }
  const source=probe()
  const twoEvents=[...source.events().entries,{type:'event',event:{type:'user/message',seq:7,data:{turn:1,step:1,content:[{type:'text',text:'second preview'}]}}}]
  source.events=()=>({revision:1,entries:twoEvents})
  await act(async()=>root.render(<ContextDoctorPanel probe={source} sessionId="s1" face={face as never} resolveModel={async()=>({provider:'fixture',model:'local'})} />))
  await act(async()=> (element.querySelector('[data-turn] .dsh-better-composer-ctxmap-row-expander')! as HTMLButtonElement).click())
  await act(async()=> (element.querySelector('.dsh-better-composer-ctxmap-step > button')! as HTMLButtonElement).click())
  for(const button of element.querySelectorAll<HTMLButtonElement>('.dsh-better-composer-ctxmap-message > button'))await act(async()=>button.click())
  const additions=[...element.querySelectorAll<HTMLButtonElement>('button')].filter(button=>button.textContent==='加入分析')
  await act(async()=>additions[0]!.click());await act(async()=>additions[1]!.click())
  await act(async()=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='分析')!.click())
  await act(async()=>[...element.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='预览分析范围与预算')!.click())
  await act(async()=>pending({ok:true,value:{sessionId:'s1',cutoffSeq:8,status:{kind:'ok'},items:[{ref:'s1:7',text:'late canonical',role:'user',bucket:'message'}]}}))
  expect(element.textContent).toContain('1 项选定证据');expect(element.textContent).toContain('确认这次分析')
  await act(async()=>root.unmount())
})
