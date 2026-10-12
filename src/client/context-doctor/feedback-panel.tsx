/**
 * Context Doctor lightweight user feedback (W4): two-step record and withdrawal (experience.md §5.1).
 */
import { useRef, useState } from 'react'
import type { DoctorRemoteFace, RemoteResult } from '../remote.ts'
import { resolveDoctorClient, type DoctorClient, type FeedbackTree, type FeedbackSubmitIntent } from './doctor-client.ts'
import { Button } from './ui.tsx'

export type FeedbackType = 'omission' | 'misunderstanding' | 'addition' | 'rework' | 'other'

export interface FeedbackTypeChip {
  readonly type: FeedbackType
  readonly label: string
}

export const FEEDBACK_CHIPS: readonly FeedbackTypeChip[] = [
  { type: 'omission', label: '遗漏' },
  { type: 'misunderstanding', label: '理解偏差' },
  { type: 'addition', label: '需要补做' },
  { type: 'rework', label: '返工' },
  { type: 'other', label: '其他' },
]

/** Convert text into a safe ASCII/alphanumeric slug. */
export function slugify(text: string): string {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s\W]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'untitled'
}

export interface SaveFeedbackParams {
  readonly client?: DoctorClient
  readonly face?: DoctorRemoteFace
  readonly problemId?: string
  readonly problemTitle: string
  readonly occurrence: Record<string, unknown>
}

/** Dispatch a two-step feedback save to the host via DoctorClient. */
export async function executeSaveFeedback(params: SaveFeedbackParams): Promise<RemoteResult<FeedbackTree>> {
  const client = resolveDoctorClient(params.client, params.face)
  if (!client) return { ok: false, error: new Error('DoctorClient required') }
  try {
    const tree = await client.feedback.submit({
      targetProblemId: params.problemId && params.problemId !== 'new' ? params.problemId : undefined,
      problemTitle: params.problemTitle.trim() || '未命名问题',
      type: (params.occurrence['type'] as string) || 'other',
      typeLabel: params.occurrence['typeLabel'] as string | undefined,
      note: params.occurrence['note'] as string | undefined,
      sessionId: params.occurrence['sessionId'] as string | undefined,
      modeId: params.occurrence['modeId'] as string | undefined,
      evidenceRefs: params.occurrence['evidenceRefs'] as readonly string[] | undefined,
      occurrence: params.occurrence,
    })
    return { ok: true, value: tree }
  } catch (error) {
    return { ok: false, error }
  }
}

export interface WithdrawOccurrenceParams {
  readonly client?: DoctorClient
  readonly face?: DoctorRemoteFace
  readonly occurrenceId: string
  readonly revision: number
}

/** Withdraw one previously saved problem occurrence under optimistic revision control. */
export async function executeWithdrawOccurrence(params: WithdrawOccurrenceParams): Promise<RemoteResult<FeedbackTree>> {
  const client = resolveDoctorClient(params.client, params.face)
  if (!client) return { ok: false, error: new Error('DoctorClient required') }
  try {
    const tree = await client.feedback.withdraw(params.occurrenceId, params.revision)
    return { ok: true, value: tree }
  } catch (error) {
    return { ok: false, error }
  }
}

export interface ProblemOption {
  readonly id: string
  readonly title: string
  readonly revision: number
}

export interface OccurrenceItem {
  readonly id: string
  readonly revision: number
  readonly problemId: string
  readonly type?: string
  readonly note?: string
  readonly withdrawn?: boolean
  readonly reportedAt?: number
  readonly sessionId?: string
  readonly modeId?: string
  readonly versionKey?: string
}

export interface FeedbackPanelProps {
  readonly client?: DoctorClient
  readonly face?: DoctorRemoteFace
  readonly sessionId?: string
  readonly modeId?: string
  readonly evidenceRefs?: readonly string[]
  readonly existingProblems?: readonly ProblemOption[]
  readonly existingOccurrences?: readonly OccurrenceItem[]
  readonly initialType?: FeedbackType
  readonly initialNote?: string
  readonly initialProblemId?: string
  readonly initialTitle?: string
  readonly onSaved?: (result?: { problemId?: string; occurrenceId?: string; tree?: FeedbackTree }) => void
  readonly onWithdrawn?: (occurrenceId: string, tree?: FeedbackTree) => void
  readonly onClose?: () => void
  readonly showHeading?: boolean
}

/** Lightweight two-step user problem feedback component. */
export function FeedbackPanel({
  client: directClient,
  face,
  sessionId,
  modeId,
  evidenceRefs = [],
  existingProblems = [],
  existingOccurrences = [],
  initialType = 'omission',
  initialNote = '',
  initialProblemId = 'new',
  initialTitle = '',
  onSaved,
  onWithdrawn,
  onClose,
  showHeading = true,
}: FeedbackPanelProps) {
  const client = resolveDoctorClient(directClient, face)
  const [selectedType, setSelectedType] = useState<FeedbackType>(initialType)
  const [selectedProblemId, setSelectedProblemId] = useState<string>(initialProblemId)
  const [title, setTitle] = useState(initialTitle)
  const [note, setNote] = useState(initialNote)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null)
  const submission = useRef<{ signature: string }>()

  const handleSave = async () => {
    if (!client) return
    const typeChip = FEEDBACK_CHIPS.find((c) => c.type === selectedType)
    const typeLabel = typeChip?.label ?? selectedType
    const existing = existingProblems.find((p) => p.id === selectedProblemId)

    const problemTitle = selectedProblemId !== 'new' && existing
      ? existing.title
      : (title.trim() || typeLabel)
    const signature = JSON.stringify([selectedProblemId, problemTitle, selectedType, note, sessionId, modeId, evidenceRefs])
    if (submission.current?.signature === signature && saveStatus === 'success') return
    submission.current = { signature }

    setSaveStatus('saving')
    setStatusMessage('')
    try {
      const tree = await client.feedback.submit({
        targetProblemId: selectedProblemId !== 'new' ? selectedProblemId : undefined,
        problemTitle,
        type: selectedType,
        typeLabel,
        note: note.trim() || undefined,
        sessionId,
        modeId,
        evidenceRefs,
      })
      setSaveStatus('success')
      setStatusMessage('反馈保存成功')
      onSaved?.({ tree })
    } catch (err) {
      setSaveStatus('error')
      setStatusMessage(`保存失败: ${(err as Error).message}`)
    }
  }

  const handleWithdraw = async (item: OccurrenceItem) => {
    if (!client) return
    setWithdrawingId(item.id)
    try {
      const tree = await client.feedback.withdraw(item.id, item.revision)
      onWithdrawn?.(item.id, tree)
    } catch (err) {
      setStatusMessage(`撤回失败: ${(err as Error).message}`)
    } finally {
      setWithdrawingId(null)
    }
  }

  return (
    <div className="dsh-context-doctor-feedback">
      {(showHeading || onClose) && <div className="dsh-context-doctor-title-row">
        {showHeading && <h3>用户问题反馈</h3>}
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        )}
      </div>}

      <div className="dsh-context-doctor-feedback-field">
        <label className="dsh-context-doctor-field-label">类型选择：</label>
        <div className="dsh-context-doctor-chips" role="radiogroup" aria-label="问题类型">
          {FEEDBACK_CHIPS.map((chip) => (
            <button
              key={chip.type}
              type="button"
              role="radio"
              aria-checked={selectedType === chip.type}
              className={`dsh-context-doctor-chip ${selectedType === chip.type ? 'is-selected' : ''}`}
              onClick={() => setSelectedType(chip.type)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="dsh-context-doctor-feedback-field">
        <label htmlFor="dsh-feedback-assoc-select" className="dsh-context-doctor-field-label">关联问题：</label>
        <select
          id="dsh-feedback-assoc-select"
          className="dsh-context-doctor-select"
          value={selectedProblemId}
          onChange={(e) => setSelectedProblemId(e.target.value)}
        >
          <option value="new">+ 新问题</option>
          {existingProblems.map((prob) => (
            <option key={prob.id} value={prob.id}>
              已有: {prob.title}
            </option>
          ))}
        </select>
      </div>

      {selectedProblemId === 'new' && (
        <div className="dsh-context-doctor-feedback-field">
          <label htmlFor="dsh-feedback-title-input" className="dsh-context-doctor-field-label">问题标题（可选）：</label>
          <input
            id="dsh-feedback-title-input"
            type="text"
            className="dsh-context-doctor-input"
            placeholder="输入问题简述，留空默认使用类型名称"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      )}

      <div className="dsh-context-doctor-feedback-field">
        <label htmlFor="dsh-feedback-note-input" className="dsh-context-doctor-field-label">说明（可选）：</label>
        <textarea
          id="dsh-feedback-note-input"
          className="dsh-context-doctor-textarea"
          placeholder="描述具体表现或纠偏要求..."
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="dsh-context-doctor-feedback-actions">
        <Button
          variant="primary"
          disabled={saveStatus === 'saving' || !face}
          onClick={handleSave}
        >
          {saveStatus === 'saving' ? '保存中...' : '保存'}
        </Button>
        {saveStatus === 'success' && (
          <span className="dsh-context-doctor-status-tag is-success">{statusMessage}</span>
        )}
        {saveStatus === 'error' && (
          <span className="dsh-context-doctor-status-tag is-error">{statusMessage}</span>
        )}
      </div>

      {existingOccurrences.length > 0 && (
        <div className="dsh-context-doctor-section" style={{ marginTop: 12 }}>
          <div className="dsh-context-doctor-section-header">
            <h4>已记录的问题</h4>
          </div>
          <ul className="dsh-context-doctor-occurrence-list">
            {existingOccurrences.map((occ) => (
              <li key={occ.id} className={`dsh-context-doctor-occ-item ${occ.withdrawn ? 'is-withdrawn' : ''}`}>
                <span className="dsh-context-doctor-occ-info">
                  [{FEEDBACK_CHIPS.find((chip) => chip.type === occ.type)?.label ?? '问题'}] {occ.note || existingProblems.find((problem) => problem.id === occ.problemId)?.title || '未填写说明'}
                  {occ.withdrawn && <span className="dsh-context-doctor-withdrawn-badge">（已撤回）</span>}
                </span>
                {!occ.withdrawn && face && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={withdrawingId === occ.id}
                    onClick={() => handleWithdraw(occ)}
                  >
                    {withdrawingId === occ.id ? '撤回中...' : '撤回'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
