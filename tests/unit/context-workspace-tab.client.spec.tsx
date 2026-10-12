// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { LegacyDoctorTab } from '../../src/client/context-workspace-tab.tsx'
it('replaces a restored visible Doctor tab through the session-bound public action',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  const calls: unknown[]=[];const element=document.createElement('div');const root=createRoot(element)
  const useTabInfo=()=>({tab:{visible:true,actions:{openTab:(...args:unknown[])=>calls.push(args)}}})
  await act(async()=>root.render(<LegacyDoctorTab useTabInfo={useTabInfo as never} />))
  expect(calls).toEqual([['better-composer.contextmap',{replaceTab:true,params:{page:'diagnosis'}}]])
  await act(async()=>root.unmount())
})
