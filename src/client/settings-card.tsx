import { useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { RichEditorSettings, ToolbarMode } from '../settings.ts'
import type { RichEditorSettingsStore } from './settings-store.ts'

/** One visible, persisted preference in the Rich Editor card. */
export type SettingsField =
  | { id: 'enabled' | 'markdownVisual' | 'diagnostics'; label: string }
  | { id: 'toolbarMode'; label: string; options: readonly { value: ToolbarMode; label: string }[] }

/** The four persisted preferences exposed by the Settings card. */
export const SETTINGS_FIELDS: readonly SettingsField[] = [
  { id: 'enabled', label: '启用富文本编辑器' },
  { id: 'markdownVisual', label: 'Markdown 视觉增强' },
  { id: 'diagnostics', label: 'Markdown 语法提示' },
  {
    id: 'toolbarMode', label: '编辑工具栏', options: [
      { value: 'compact', label: '紧凑' },
      { value: 'hidden', label: '隐藏' },
    ],
  },
]

/** Fixed shortcut reference; users cannot remap these keys in Beta. */
export const SHORTCUTS = [
  { id: 'strong', label: '加粗', shortcut: '⌘/Ctrl+B' },
  { id: 'emphasis', label: '斜体', shortcut: '⌘/Ctrl+I' },
  { id: 'inline-code', label: '行内代码', shortcut: '⌘/Ctrl+`' },
  { id: 'link', label: '链接', shortcut: '⌘/Ctrl+K' },
] as const

/** Business face injected into the keyed Settings slot. */
export interface RichEditorSettingsCardInjected {
  settings: RichEditorSettingsStore
}

/** Settings slot component props. */
export type RichEditorSettingsCardProps =
  PropsRuntime<'settings.plugin.item'> & InjectFace<RichEditorSettingsCardInjected>

/**
 * Render the Rich Editor's four preference controls and fixed shortcuts.
 * @param props - keyed slot props and the caller-owned Settings store.
 * @returns the Settings card.
 */
export function RichEditorSettingsCard({ settings }: RichEditorSettingsCardProps) {
  const current = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.get(),
    () => settings.get(),
  )
  const [failure, setFailure] = useState(false)

  const update = <K extends keyof RichEditorSettings>(field: K, value: RichEditorSettings[K]): void => {
    setFailure(false)
    void settings.set(field, value).catch(() => { setFailure(true) })
  }

  return (
    <li className="dsh-rich-editor-settings-card">
      <section aria-label="Rich Editor 设置">
        <div className="dsh-rich-editor-settings-header">
          <h3>Rich Editor 设置</h3>
          <p>在 DSH 输入框中提供 Markdown 编辑增强。</p>
        </div>
        <div className="dsh-rich-editor-settings-fields">
          <label className="dsh-rich-editor-settings-row">
            <span className="dsh-rich-editor-settings-copy">
              <strong>启用富文本编辑器</strong>
              <small>关闭后保留原生 Composer。</small>
            </span>
            <input aria-label="启用富文本编辑器" type="checkbox" checked={current.enabled}
              onChange={event => { update('enabled', event.target.checked) }} />
          </label>
          <label className="dsh-rich-editor-settings-row">
            <span className="dsh-rich-editor-settings-copy">
              <strong>Markdown 视觉增强</strong>
              <small>突出 Markdown 结构，不会修改实际发送给 Agent 的文本。</small>
            </span>
            <input aria-label="Markdown 视觉增强" type="checkbox" checked={current.markdownVisual}
              onChange={event => { update('markdownVisual', event.target.checked) }} />
          </label>
          <label className="dsh-rich-editor-settings-row">
            <span className="dsh-rich-editor-settings-copy">
              <strong>Markdown 语法提示</strong>
              <small>检查高置信度 Markdown 问题，不阻止发送。</small>
            </span>
            <input aria-label="Markdown 语法提示" type="checkbox" checked={current.diagnostics}
              onChange={event => { update('diagnostics', event.target.checked) }} />
          </label>
          <label className="dsh-rich-editor-settings-row">
            <span className="dsh-rich-editor-settings-copy">
              <strong>编辑工具栏</strong>
              <small>在紧凑工具栏和无工具栏之间切换。</small>
            </span>
            <select aria-label="编辑工具栏" value={current.toolbarMode}
              onChange={event => { update('toolbarMode', event.target.value as ToolbarMode) }}>
              <option value="compact">紧凑</option>
              <option value="hidden">隐藏</option>
            </select>
          </label>
        </div>
        <div className="dsh-rich-editor-settings-shortcuts" aria-label="快捷键">
          <strong>快捷键</strong>
          <ul>
            {SHORTCUTS.map(shortcut => <li key={shortcut.id}><span>{shortcut.label}</span><kbd>{shortcut.shortcut}</kbd></li>)}
          </ul>
        </div>
        {failure ? <p className="dsh-rich-editor-settings-failure" role="status">设置保存失败，请重试。</p> : null}
      </section>
    </li>
  )
}
