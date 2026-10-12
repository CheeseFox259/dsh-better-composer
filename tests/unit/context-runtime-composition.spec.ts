import { expect, it } from 'vitest'
import { readRuntimeComposition } from '../../src/client/context-map-data.ts'
import type { ContextMapProbe } from '../../src/client/context-map-data.ts'
function source(breakdown: unknown, pressure: unknown): ContextMapProbe {
  return { version:()=>0, subscribe:()=>()=>{}, projection:key=>key==='contextBreakdown'?breakdown:pressure, events:()=>({entries:[],revision:0}), historyLoading:()=>false, loadAllHistory(){}, draftClips:()=>0, async compact(){},async forkAt(){} }
}
it('keeps composition and pressure independent instead of rescaling shares to projected input',()=>{
  const result=readRuntimeComposition(source({systemTokens:20,toolsTokens:30,messageTokens:50},{projectedTokens:400,contextWindow:1000}))
  expect(result.total).toBe(100);expect(result.projected).toBe(400);expect(result.occupancy).toBe(.4)
  expect(result.segments.map(segment=>segment.share)).toEqual([.2,.3,.5])
})
it('distinguishes absent projection dimensions from a measured zero',()=>{
  const missing=readRuntimeComposition(source({messageTokens:0},{}))
  expect(missing.total).toBeNull();expect(missing.projected).toBeNull();expect(missing.segments.map(segment=>segment.value)).toEqual([null,null,0])
  const zero=readRuntimeComposition(source({systemTokens:0,toolsTokens:0,messageTokens:0},{projectedTokens:0,contextWindow:1000}))
  expect(zero.total).toBe(0);expect(zero.occupancy).toBe(0)
})
