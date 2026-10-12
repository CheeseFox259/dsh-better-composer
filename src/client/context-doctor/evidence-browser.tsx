import type { EvidencePage } from '../../doctor/host/runtime.ts'
import { Button, Checkbox, DoctorIcon } from './ui.tsx'

export type EvidenceItem = EvidencePage['items'][number]
export const EVIDENCE_BUCKETS = [
  { value: 'all', label: '全部证据' }, { value: 'system', label: '系统与要求' }, { value: 'tool-definition', label: '工具定义' },
  { value: 'skill-catalog', label: 'Skill 目录' }, { value: 'skill-body', label: 'Skill 正文' }, { value: 'tool-result', label: '工具结果' },
  { value: 'message', label: '会话消息' }, { value: 'reference', label: '引用材料' }, { value: 'unknown', label: '来源未归类' },
]

/** Canonical Host evidence leaves shared by map inspection and diagnosis. */
export function EvidenceBrowser({ items, selectedRefs, disabled, onToggle, onFeedback, focusedRef }: {
  readonly items: readonly EvidenceItem[]
  readonly selectedRefs: readonly string[]
  readonly disabled?: boolean
  readonly onToggle: (item: EvidenceItem, checked: boolean) => void
  readonly onFeedback: (ref: string) => void
  readonly focusedRef?: string
}) {
  return <div className="doctor-evidence-list">{items.map(item => <div className={`doctor-evidence-item ${selectedRefs.includes(item.ref) ? 'is-selected' : ''}`} key={item.ref} data-evidence-ref={item.ref}>
    <div className="doctor-evidence-select"><Checkbox checked={selectedRefs.includes(item.ref)} disabled={disabled} label={EVIDENCE_BUCKETS.find(bucket => bucket.value === item.bucket)?.label ?? item.role} onChange={checked => onToggle(item, checked)} /><span className="doctor-muted">事件 {item.ref.slice(item.ref.lastIndexOf(':') + 1)}</span></div>
    <details open={item.ref === focusedRef ? true : undefined}><summary><span>{item.text.replace(/\s+/g, ' ').slice(0, 120) || '无可见文本'}</span><DoctorIcon kind="chevron" /></summary><pre className="doctor-source-text">{item.text}</pre><Button size="sm" variant="ghost" icon={<DoctorIcon kind="feedback" />} onClick={() => onFeedback(item.ref)}>记录此处问题</Button></details>
  </div>)}</div>
}
