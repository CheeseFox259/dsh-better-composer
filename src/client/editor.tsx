import { useState } from 'react'
import type { ComposerEditorProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { composerActions } from '../commands/actions.ts'

const labels: Readonly<Record<string, string>> = {
  strong: 'Strong', emphasis: 'Emphasis', 'inline-code': 'Code', link: 'Link', quote: 'Quote',
  bullet: 'Bullet', ordered: 'Ordered', task: 'Task', 'code-fence': 'Fence', indent: 'Indent', outdent: 'Outdent',
}

/** Toolbar, preview, and expanded controls for the shared native editor. */
export function EditorContribution({ useInput, runAction, expanded, setExpanded }: ComposerEditorProps) {
  const draft = useInput(state => state.draft)
  const [preview, setPreview] = useState(false)
  return (
    <div className="dsh-rich-editor-editor" data-rich-editor>
      <div className="dsh-rich-editor-toolbar" role="toolbar" aria-label="Formatting">
        {composerActions.map(action => (
          <button key={action.id} type="button" className="dsh-rich-editor-button"
            onMouseDown={event => { event.preventDefault() }}
            onClick={() => { runAction(action.id) }}>
            {labels[action.id]}
          </button>
        ))}
        <button type="button" className="dsh-rich-editor-button" onClick={() => { setPreview(!preview) }}>
          {preview ? 'Edit' : 'Preview'}
        </button>
        <button type="button" className="dsh-rich-editor-button" onClick={() => { setExpanded(!expanded) }}>
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {preview && <div className="dsh-rich-editor-preview" data-rich-editor-preview><MarkdownText text={draft} /></div>}
    </div>
  )
}
