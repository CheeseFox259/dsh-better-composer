import { useState, useSyncExternalStore } from 'react'
import type { ComposerEditorProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { composerActions, diagnosticActionId } from '../commands/actions.ts'
import { diagnosticsFor } from '../markdown/diagnostics.ts'
import { toolbarActions, type RichEditorSettings } from '../settings.ts'
import type { RichEditorSettingsStore } from './settings-store.ts'

const labels: Readonly<Record<string, { readonly label: string; readonly title: string }>> = {
  strong: { label: '加粗', title: '加粗（⌘/Ctrl+B）' },
  emphasis: { label: '斜体', title: '斜体（⌘/Ctrl+I）' },
  'inline-code': { label: '行内代码', title: '行内代码（⌘/Ctrl+`）' },
  link: { label: '链接', title: '链接（⌘/Ctrl+K）' },
  quote: { label: '引用', title: '引用' },
  bullet: { label: '无序列表', title: '无序列表' },
  ordered: { label: '有序列表', title: '有序列表' },
  task: { label: '任务列表', title: '任务列表' },
  'code-fence': { label: '代码块', title: '代码块' },
  indent: { label: '增加缩进', title: '增加缩进' },
  outdent: { label: '减少缩进', title: '减少缩进' },
}

/** Toolbar, preview, and expanded controls for the shared native editor. */
export function createEditorContribution(settings: RichEditorSettingsStore): SlotComponent<ComposerEditorProps> {
  return function EditorContribution(props: ComposerEditorProps) {
    return <EditorView {...props} settings={settings} />
  }
}

function EditorView({ useInput, runAction, expanded, setExpanded, settings }: ComposerEditorProps & { settings: RichEditorSettingsStore }) {
  const draft = useInput(state => state.draft)
  const current = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.get(),
    () => settings.get(),
  )
  const [preview, setPreview] = useState(false)
  const [more, setMore] = useState(false)
  if (!current.enabled) return null
  const directIds = new Set(toolbarActions(current))
  const directActions = composerActions.filter(action => directIds.has(action.id))
  const extraActions = current.toolbarMode === 'compact'
    ? composerActions.filter(action => !directIds.has(action.id))
    : []
  const diagnostics = current.diagnostics ? diagnosticsFor(draft) : []
  return (
    <div className="dsh-rich-editor-editor" data-rich-editor>
      {current.toolbarMode === 'compact' ? <div className="dsh-rich-editor-toolbar" role="toolbar" aria-label="编辑工具栏">
        {directActions.map(action => (
          <button key={action.id} type="button" className="dsh-rich-editor-button" title={labels[action.id]?.title}
            onMouseDown={event => { event.preventDefault() }}
            onClick={() => { runAction(action.id) }}>
            {labels[action.id]?.label ?? action.id}
          </button>
        ))}
        {extraActions.length > 0 ? (
          <div className="dsh-rich-editor-more">
            <button type="button" className="dsh-rich-editor-button" aria-expanded={more} onClick={() => { setMore(!more) }}>
              更多
            </button>
            {more ? <div className="dsh-rich-editor-more-menu">
              {extraActions.map(action => (
                <button key={action.id} type="button" className="dsh-rich-editor-button" title={labels[action.id]?.title}
                  onMouseDown={event => { event.preventDefault() }}
                  onClick={() => { runAction(action.id); setMore(false) }}>
                  {labels[action.id]?.label ?? action.id}
                </button>
              ))}
            </div> : null}
          </div>
        ) : null}
        <button type="button" className="dsh-rich-editor-button" onClick={() => { setPreview(!preview) }}>
          {preview ? '编辑' : '预览'}
        </button>
        <button type="button" className="dsh-rich-editor-button" onClick={() => { setExpanded(!expanded) }}>
          {expanded ? '收起' : '展开'}
        </button>
      </div> : null}
      {current.toolbarMode === 'compact' && preview && <div className="dsh-rich-editor-preview" data-rich-editor-preview><MarkdownText text={draft} /></div>}
      {diagnostics.length > 0 ? <ul className="dsh-rich-editor-diagnostics" aria-label="Markdown 诊断">
        {diagnostics.map((diagnostic, index) => <li key={`${diagnostic.className}-${diagnostic.start}-${index}`}>
          <button type="button" className="dsh-rich-editor-diagnostic" title="定位到源码"
            onMouseDown={event => { event.preventDefault() }}
            onClick={() => { runAction(diagnosticActionId(diagnostic.className)) }}>
            {diagnostic.className === 'dsh-rich-editor-diagnostic-fence'
              ? '代码块未闭合'
              : diagnostic.className === 'dsh-rich-editor-diagnostic-inline-code'
                ? '行内代码定界符未闭合'
                : '显式链接格式不完整'}
          </button>
        </li>)}
      </ul> : null}
    </div>
  )
}
