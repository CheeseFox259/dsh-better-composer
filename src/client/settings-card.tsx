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
  { id: 'markdownVisual', label: 'Markdown 可视化' },
  { id: 'diagnostics', label: '诊断提示' },
  {
    id: 'toolbarMode', label: '工具栏', options: [
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
    <section aria-label="Rich Editor 设置">
      <h3>Rich Editor 设置</h3>
      <p>控制 Markdown 编辑增强，不改变原生 Composer。</p>
      <label>
        <input type="checkbox" checked={current.enabled} onChange={event => { update('enabled', event.target.checked) }} />
        启用富文本编辑器
      </label>
      <label>
        <input type="checkbox" checked={current.markdownVisual} onChange={event => { update('markdownVisual', event.target.checked) }} />
        Markdown 可视化
      </label>
      <label>
        <input type="checkbox" checked={current.diagnostics} onChange={event => { update('diagnostics', event.target.checked) }} />
        诊断提示
      </label>
      <label>
        工具栏
        <select value={current.toolbarMode} onChange={event => { update('toolbarMode', event.target.value as ToolbarMode) }}>
          <option value="compact">紧凑</option>
          <option value="hidden">隐藏</option>
        </select>
      </label>
      <div aria-label="快捷键">
        <strong>快捷键</strong>
        <ul>
          {SHORTCUTS.map(shortcut => <li key={shortcut.id}>{shortcut.label}: {shortcut.shortcut}</li>)}
        </ul>
      </div>
      {failure ? <p role="status">设置保存失败，请重试。</p> : null}
    </section>
  )
}
