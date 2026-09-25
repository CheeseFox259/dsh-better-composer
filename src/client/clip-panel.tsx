import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ClipMode, ClipStore } from './clip-store.ts'
import type { BetterComposerRemoteFace } from './remote.ts'
import { PASTE_FILE_EXTENSIONS, type PasteFileExtension } from '../file-extensions.ts'
import { EMPTY_TEXT_HISTORY, recordTextChange, redoTextChange, undoTextChange, type TextHistory } from './text-history.ts'

/** The clip tab's registry identity and page kind. */
export const CLIP_TAB_ID = '@cheesefox/dsh-better-composer'
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
  readonly remote: () => BetterComposerRemoteFace | undefined | Promise<BetterComposerRemoteFace | undefined>
  readonly resolveModel: (sessionId: string) => Promise<{ readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | undefined>
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Right-sidebar editor for one pasted-text clip. */
export function ClipPanel({ clips, remote, resolveModel, fetchContext, useTabInfo, sessionId = '' }: ClipPanelProps) {
  const { tab } = useTabInfo()
  const id = (tab.navigation.params as { readonly id?: string } | undefined)?.id ?? ''
  const [text, setText] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<ClipMode>('inline')
  const [fileExtension, setFileExtension] = useState<PasteFileExtension>('.md')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined)
  const [missing, setMissing] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [withContext, setWithContext] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editError, setEditError] = useState('')
  const [previewText, setPreviewText] = useState<string | undefined>(undefined)
  const [rewriteBaseText, setRewriteBaseText] = useState<string | undefined>(undefined)
  const [history, setHistory] = useState<TextHistory>(EMPTY_TEXT_HISTORY)
  const abortRef = useRef<AbortController | null>(null)

  const cancelRewrite = (): void => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
  }

  useEffect(() => {
    let active = true
    cancelRewrite()
    setText(undefined)
    setPreviewText(undefined)
    setRewriteBaseText(undefined)
    setHistory(EMPTY_TEXT_HISTORY)
    setEditError('')
    setMissing(false)
    void clips.resolve(id).then(entry => {
      if (!active) return
      if (entry === undefined) {
        setMissing(true)
        return
      }
      setText(entry.text)
      setMode(entry.mode)
      setFileExtension(entry.fileExtension)
      setDirty(false)
    })
    return () => {
      active = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [clips, id])

  useEffect(() => {
    const cancelOnBlur = (): void => { cancelRewrite() }
    const cancelWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') cancelRewrite()
    }
    window.addEventListener('blur', cancelOnBlur)
    document.addEventListener('visibilitychange', cancelWhenHidden)
    return () => {
      window.removeEventListener('blur', cancelOnBlur)
      document.removeEventListener('visibilitychange', cancelWhenHidden)
    }
  }, [])

  const save = (): void => {
    if (text === undefined) return
    if (clips.update(id, text) !== undefined) {
      setDirty(false)
      setSavedAt(Date.now())
    }
  }

  const runLlmEdit = async (): Promise<void> => {
    if (busy || text === undefined || text === '' || instruction.trim() === '') return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    const base = text
    setBusy(true)
    setEditError('')
    setPreviewText(undefined)
    setRewriteBaseText(base)
    try {
      const face = await remote()
      if (face === undefined) throw new Error('Remote 服务不可用')
      const route = await resolveModel(sessionId)
      if (route === undefined) throw new Error('无法确定当前模型，请先在输入框选择模型')
      const result = await face.editText({
        ...route,
        text: base,
        instruction,
        contextMessages: withContext ? fetchContext(sessionId) : [],
      }, controller.signal)
      if (!result.ok) {
        const error = result.error
        throw new Error(error !== null && typeof error === 'object' && 'message' in error
          ? String((error as { readonly message: unknown }).message)
          : JSON.stringify(error))
      }
      if (abortRef.current !== controller) return
      setPreviewText(result.value.text)
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted) {
        setEditError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setBusy(false)
      }
    }
  }

  const applyTextChange = (next: string): void => {
    if (text === undefined || text === next) return
    setHistory(current => recordTextChange(current, text, next))
    setText(next)
    setDirty(true)
  }

  const undo = (): void => {
    if (text === undefined) return
    const result = undoTextChange(history, text)
    if (result === undefined) return
    setText(result.text)
    setHistory(result.history)
    setDirty(true)
  }

  const redo = (): void => {
    if (text === undefined) return
    const result = redoTextChange(history, text)
    if (result === undefined) return
    setText(result.text)
    setHistory(result.history)
    setDirty(true)
  }

  const applyPreview = (): void => {
    if (previewText === undefined) return
    applyTextChange(previewText)
    setPreviewText(undefined)
    setRewriteBaseText(undefined)
  }

  const discardPreview = (): void => {
    setPreviewText(undefined)
    setRewriteBaseText(undefined)
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
      {mode === 'file' ? (
        <label className="dsh-better-composer-clip-file-type">
          <span>文件类型</span>
          <select aria-label="文件类型" value={fileExtension}
            onChange={event => {
              const next = event.currentTarget.value as PasteFileExtension
              setFileExtension(next)
              clips.setFileExtension(id, next)
            }}>
            {PASTE_FILE_EXTENSIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ) : null}
    </div>
    {previewText !== undefined ? (
      <section className="dsh-better-composer-clip-preview" aria-label="改写预览" data-clip-rewrite-preview>
        <div className="dsh-better-composer-clip-preview-header">
          <strong>改写预览</strong>
          <span>{rewriteBaseText?.length ?? 0} → {previewText.length} 字符</span>
        </div>
        <pre className="dsh-better-composer-clip-preview-text">{previewText}</pre>
        <div className="dsh-better-composer-clip-preview-actions">
          <button type="button" onClick={applyPreview}>应用改写</button>
          <button type="button" onClick={discardPreview}>放弃</button>
          <button type="button" onClick={() => { discardPreview(); void runLlmEdit() }}>重新生成</button>
        </div>
      </section>
    ) : null}
    <textarea
      className="dsh-better-composer-clip-editor"
      aria-label="粘贴内容编辑"
      value={text ?? ''}
      placeholder="加载中…"
      readOnly={text === undefined}
      onChange={event => {
        applyTextChange(event.currentTarget.value)
        setPreviewText(undefined)
        setRewriteBaseText(undefined)
      }}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
        } else if (!event.nativeEvent.isComposing && event.ctrlKey && event.key.toLowerCase() === 'y') {
          event.preventDefault()
          redo()
        }
        event.stopPropagation()
      }}
    />
    <div className="dsh-better-composer-clip-footer">
      <div className="dsh-better-composer-clip-actions">
        <button
          type="button"
          className="dsh-better-composer-clip-save"
          disabled={!dirty}
          onClick={save}
        >保存</button>
        <button type="button" className="dsh-better-composer-clip-history" disabled={history.past.length === 0} onClick={undo}>撤销</button>
        <button type="button" className="dsh-better-composer-clip-history" disabled={history.future.length === 0} onClick={redo}>重做</button>
      </div>
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
              event.preventDefault()
              event.stopPropagation()
              if (busy) cancelRewrite()
              else if (previewText !== undefined) discardPreview()
              else setInstruction('')
            } else {
              event.stopPropagation()
            }
          }}
        />
        <button
          type="button"
          className="dsh-better-composer-clip-run"
          disabled={!busy && (text === undefined || text === '' || instruction.trim() === '')}
          onClick={() => { if (busy) cancelRewrite(); else void runLlmEdit() }}
        >{busy ? '停止' : '改写'}</button>
      </div>
      <p className="dsh-better-composer-clip-llm-note">改写使用当前会话模型和推理等级，结果先预览，不写入当前会话。</p>
      {editError !== '' ? <p className="dsh-better-composer-clip-error" role="alert">{editError}</p> : null}
    </div>
  </div>
}
