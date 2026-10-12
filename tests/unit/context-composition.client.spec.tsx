// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { CompositionChart } from '../../src/client/context-doctor/composition-chart.tsx'

const segments = [
  { key: 'system', label: '系统', value: 20, share: .2 },
  { key: 'tools', label: '工具', value: 30, share: .3 },
  { key: 'messages', label: '消息', value: 50, share: .5 },
]

it('previews a segment without changing content selection, then restores the pinned selection', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  const selections: string[] = []
  await act(async () => root.render(<CompositionChart segments={segments} total={100} selectedKey="messages" onSelect={(key) => selections.push(key)} />))
  const tool = element.querySelector('[data-segment="tools"]')! as SVGElement
  await act(async () => tool.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  expect(tool.getAttribute('data-preview')).toBe('true')
  expect(element.querySelector('[data-segment="messages"]')!.getAttribute('data-raised')).toBe('false')
  expect(selections).toEqual([])
  await act(async () => tool.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: element })))
  expect(element.querySelector('[data-segment="messages"]')!.getAttribute('data-raised')).toBe('true')
  expect(element.querySelector('.doctor-ring-center strong')!.textContent).toBe('100')
  await act(async () => tool.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  expect(selections).toEqual(['tools'])
  await act(async () => root.unmount())
})

it('supports keyboard selection and the same legend action without nested interactive controls in the composer', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  const selections: string[] = []
  await act(async () => root.render(<CompositionChart segments={segments} total={100} onSelect={(key) => selections.push(key)} />))
  await act(async () => element.querySelector('[data-segment="system"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await act(async () => (element.querySelector('[data-legend="tools"]')! as HTMLButtonElement).click())
  expect(selections).toEqual(['system', 'tools'])
  await act(async () => root.render(<CompositionChart compact segments={segments} total={100} />))
  expect(element.querySelectorAll('[role="button"],button,[tabindex="0"]').length).toBe(0)
  await act(async () => root.unmount())
})

it('shows unknown composition as unknown rather than drawing a fabricated proportion', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const element = document.createElement('div')
  const root = createRoot(element)
  await act(async () => root.render(<CompositionChart segments={[{ key: 'system', label: '系统', value: null, share: null }]} total={null} />))
  expect(element.querySelector('.doctor-ring-center strong')!.textContent).toBe('—')
  expect(element.querySelectorAll('[data-segment]').length).toBe(0)
  expect(element.textContent).toContain('未观测')
  await act(async () => root.unmount())
})
