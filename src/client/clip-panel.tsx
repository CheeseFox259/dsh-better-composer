import { useEffect, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ClipMode, ClipStore } from './clip-store.ts'
import type { BetterComposerRemoteFace } from './remote.ts'

/** The clip tab's registry identity and page kind. */
export const CLIP_TAB_ID = '@noleftbutright/dsh-better-composer'
export const CLIP_TAB_KIND = 'better-composer.clip'

/** The page-type definition registered into the right Sidebar. */
export function clipTabDefinition() {
  return {
    id: CLIP_TAB_ID,
    kind: CLIP_TAB_KIND,
    title: () => '粘贴文本',
  }
}

/** Business face injected into the clip tab seat. */
export interface ClipPanelInjected {
  readonly clips: ClipStore
  readonly remote: () => BetterComposerRemoteFace | undefined
  readonly resolveModel: (sessionId: string) => Promise<{ readonly provider: string; readonly model: string } | undefined>
  readonly fetchContext: (sessionId: string) => readonly { readonly role: string; readonly text: string }[]
}

/** The framework-bound tab reader the seat injects. */
export interface UseClipTabInfo {
  (): { readonly tab: { readonly navigation: { readonly params?: unknown } } }
}

export type ClipPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<ClipPanelInjected> & {
  readonly useTabInfo: UseClipTabInfo
  /** Session identity supplied by the framework at runtime. */
  readonly sessionId?: string
}

const MODES: readonly { readonly value: ClipMode; readonly label: string; readonly hint: string }[] = [
  { value: 'inline', label: '内联发送', hint: '发送时，完整文本随消息一起进入对话' },
  { value: 'file', label: '文件送达', hint: '发送时，文本写入工作区文件，Agent 用工具按需读取' },
]

/** Right-sidebar editor for one pasted-text clip. */
export function ClipPanel({ clips, remote, resolveModel, fetchContext, useTabInfo, sessionId = '' }: ClipPanelProps) {
  const { tab } = useTabInfo()
  const id = (tab.navigation.params as { readonly id?: string } | undefined)?.id ?? ''
  const [text, setText] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<ClipMode>('inline')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined)
  const [missing, setMissing] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [withContext, setWithContext] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editError, setEditError] = useState('')

  useEffect(() => {
    let active = true
    setText(undefined)
    setMissing(false)
    void clips.resolve(id).then(entry => {
      if (!active) return
      if (entry === undefined) {
        setMissing(true)
        return
      }
      setText(entry.text)
      setMode(entry.mode)
      setDirty(false)
    })
    return () => { active = false }
  }, [clips, id])

  const save = (): void => {
    if (text === undefined) return
    if (clips.update(id, text) !== undefined) {
      setDirty(false)
      setSavedAt(Date.now())
    }
  }

  const runLlmEdit = async (): Promise<void> => {
    setBusy(true)
    setEditError('')
    try {
      const face = remote()
      if (face === undefined) throw new Error('Remote 服务不可用')
      const route = await resolveModel(sessionId)
      if (route === undefined) throw new Error('无法确定当前模型，请先在输入框选择模型')
      const result = await face.editText({
        ...route,
        text: text ?? '',
        instruction,
        contextMessages: withContext ? fetchContext(sessionId) : [],
      })
      if (!result.ok) {
        const error = result.error
        throw new Error(error !== null && typeof error === 'object' && 'message' in error
          ? String((error as { readonly message: unknown }).message)
          : JSON.stringify(error))
      }
      setText(result.value.text)
      setDirty(true)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (missing) {
    return <div className="dsh-better-composer-clip-panel" data-clip-panel>
      <p className="dsh-better-composer-clip-missing">该粘贴内容已不可用（可能已被清理）。</p>
    </div>
  }
  return <div className="dsh-better-composer-clip-panel" data-clip-panel>
    <div className="dsh-better-composer-clip-toolbar">
      <span className="dsh-better-composer-clip-title">粘贴文本 · {text?.length ?? 0} 字符</span>
      <div className="dsh-better-composer-clip-modes" role="radiogroup" aria-label="发送方式">
        {MODES.map(option => <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={mode === option.value}
          className="dsh-better-composer-clip-mode"
          title={option.hint}
          onClick={() => {
            setMode(option.value)
            clips.setMode(id, option.value)
          }}
        >{option.label}</button>)}
      </div>
    </div>
    <textarea
      className="dsh-better-composer-clip-editor"
      aria-label="粘贴内容编辑"
      value={text ?? ''}
      placeholder="加载中…"
      readOnly={text === undefined}
      onChange={event => {
        setText(event.currentTarget.value)
        setDirty(true)
      }}
      onKeyDown={event => { event.stopPropagation() }}
    />
    <div className="dsh-better-composer-clip-footer">
      <button
        type="button"
        className="dsh-better-composer-clip-save"
        disabled={!dirty}
        onClick={save}
      >保存</button>
      <span className="dsh-better-composer-clip-status">
        {dirty ? '有未保存的修改' : savedAt === undefined ? '' : '已保存'}
      </span>
    </div>
    <div className="dsh-better-composer-clip-llm">
      <div className="dsh-better-composer-clip-llm-row">
        <label className="dsh-better-composer-clip-section" htmlFor="dsh-better-composer-clip-instruction">智能改写</label>
        <label className="dsh-better-composer-clip-context">
          <input
            type="checkbox"
            checked={withContext}
            onChange={event => { setWithContext(event.currentTarget.checked) }}
          />
          <span>参考当前对话</span>
        </label>
      </div>
      <div className="dsh-better-composer-clip-llm-row">
        <input
          id="dsh-better-composer-clip-instruction"
          className="dsh-better-composer-clip-instruction"
          aria-label="改写要求"
          placeholder="描述想要的修改，如：翻译为英文"
          value={instruction}
          onChange={event => { setInstruction(event.currentTarget.value) }}
          onKeyDown={event => {
            // Panel-local submit: Enter starts the rewrite for THIS clip only.
            // The composer's Enter-to-send lives on the Lexical keymap and is
            // unreachable from the sidebar; stopPropagation is the belt to
            // that suspenders, and IME composition owns Enter until commit.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing
              && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
              event.preventDefault()
              event.stopPropagation()
              if (!busy && text !== undefined && text !== '' && instruction.trim() !== '') {
                void runLlmEdit()
              }
            } else if (event.key === 'Escape') {
              event.stopPropagation()
              setInstruction('')
            } else {
              event.stopPropagation()
            }
          }}
        />
        <button
          type="button"
          className="dsh-better-composer-clip-run"
          disabled={busy || text === undefined || text === '' || instruction.trim() === ''}
          onClick={() => { void runLlmEdit() }}
        >{busy ? '改写中…' : '改写'}</button>
      </div>
      <p className="dsh-better-composer-clip-llm-note">改写由模型独立完成，不写入当前会话。</p>
      {editError !== '' ? <p className="dsh-better-composer-clip-error" role="alert">{editError}</p> : null}
    </div>
  </div>
}
