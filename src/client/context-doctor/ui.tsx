import type { ReactNode } from 'react'
export { Button, SegmentedControl, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'

export function DoctorIcon({ kind, className }: { kind: 'refresh' | 'evidence' | 'analyze' | 'feedback' | 'back' | 'check' | 'chevron'; className?: string }) {
  const paths: Record<typeof kind, ReactNode> = {
    refresh: <><path d="M15 6A6 6 0 1 0 16 11"/><path d="M15 2v4h-4"/></>,
    evidence: <><path d="M5 2h7l3 3v11H5z"/><path d="M11 2v4h4M8 9h4M8 12h4"/></>,
    analyze: <><path d="m9 2 1.7 4.3L15 8l-4.3 1.7L9 14l-1.7-4.3L3 8l4.3-1.7L9 2Z"/><path d="m15 12 .8 2.2L18 15l-2.2.8L15 18l-.8-2.2L12 15l2.2-.8L15 12Z"/></>,
    feedback: <><path d="M3 3h12v9H8l-4 3v-3H3z"/><path d="M6 6h6M6 9h4"/></>,
    back: <><path d="m9 4-5 5 5 5M4 9h12"/></>, check: <path d="m4 9 3 3 7-7"/>, chevron: <path d="m7 4 5 5-5 5"/>,
  }
  return <svg className={className} viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
}
