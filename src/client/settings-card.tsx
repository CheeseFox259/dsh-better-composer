import { useState, useSyncExternalStore } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { BetterComposerSettings } from '../settings.ts'
import type { BetterComposerSettingsStore } from './settings-store.ts'

/** Fixed shortcut reference; users cannot remap these keys in Beta. */
export const SHORTCUTS = [
  { id: 'strong', label: '加粗', shortcut: '⌘/Ctrl+B' },
  { id: 'emphasis', label: '斜体', shortcut: '⌘/Ctrl+I' },
  { id: 'inline-code', label: '行内代码', shortcut: '⌘/Ctrl+`' },
  { id: 'link', label: '链接', shortcut: '⌘/Ctrl+K' },
] as const

/** Business face injected into the keyed Settings slot. */
export interface BetterComposerSettingsCardInjected {
  settings: BetterComposerSettingsStore
}

/** Settings card props: the injected settings face only. */
export type BetterComposerSettingsCardProps = InjectFace<BetterComposerSettingsCardInjected>

/**
 * Render the existing preference controls and fixed shortcuts.
 * @param props - keyed slot props and the caller-owned Settings store.
 * @returns the Settings card.
 */
export function BetterComposerSettingsCard({ settings }: BetterComposerSettingsCardProps) {
  const current = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.get(),
    () => settings.get(),
  )
  const [failure, setFailure] = useState(false)

  const update = <K extends keyof BetterComposerSettings>(field: K, value: BetterComposerSettings[K]): void => {
    setFailure(false)
    void settings.set(field, value).catch(() => { setFailure(true) })
  }

  return (
    <li className="dsh-better-composer-settings-card">
      <section aria-label="Better Composer 设置">
        <div className="dsh-better-composer-settings-header">
          <h3>Better Composer 设置</h3>
          <p>在 DSH 输入框中提供 Markdown 编辑增强。</p>
        </div>
        <div className="dsh-better-composer-settings-fields">
          <label className="dsh-better-composer-settings-row">
            <span className="dsh-better-composer-settings-copy">
              <strong>启用 Better Composer</strong>
              <small>关闭后保留原生 Composer。</small>
            </span>
            <input aria-label="启用 Better Composer" type="checkbox" checked={current.enabled}
              onChange={event => { update('enabled', event.target.checked) }} />
          </label>
          <label className="dsh-better-composer-settings-row">
            <span className="dsh-better-composer-settings-copy">
              <strong>Markdown 视觉增强</strong>
              <small>突出 Markdown 结构，不会修改实际发送给 Agent 的文本。</small>
            </span>
            <input aria-label="Markdown 视觉增强" type="checkbox" checked={current.markdownVisual}
              onChange={event => { update('markdownVisual', event.target.checked) }} />
          </label>
          <label className="dsh-better-composer-settings-row">
            <span className="dsh-better-composer-settings-copy">
              <strong>Markdown 语法提示</strong>
              <small>检查高置信度 Markdown 问题，不阻止发送。</small>
            </span>
            <input aria-label="Markdown 语法提示" type="checkbox" checked={current.diagnostics}
              onChange={event => { update('diagnostics', event.target.checked) }} />
          </label>
          <label className="dsh-better-composer-settings-row">
            <span className="dsh-better-composer-settings-copy">
              <strong>确定性写作辅助</strong>
              <small>仅显示固定的本地结构提醒，不修改内容或阻止发送。</small>
            </span>
            <input aria-label="确定性写作辅助" type="checkbox" checked={current.deterministicAssistance}
              onChange={event => { update('deterministicAssistance', event.target.checked) }} />
          </label>
          <label className="dsh-better-composer-settings-row">
            <span className="dsh-better-composer-settings-copy">
              <strong>超长粘贴转引用</strong>
              <small>粘贴超过该字符数时自动转为可点击编辑的引用；0 表示关闭。</small>
            </span>
            <input aria-label="超长粘贴转引用阈值" type="number" min={0} step={100} value={current.pasteClipThreshold}
              onChange={event => { update('pasteClipThreshold', Math.max(0, Math.floor(Number(event.currentTarget.value) || 0))) }} />
          </label>
        </div>
        <div className="dsh-better-composer-settings-shortcuts" aria-label="快捷键">
          <strong>快捷键</strong>
          <ul>
            {SHORTCUTS.map(shortcut => <li key={shortcut.id}><span>{shortcut.label}</span><kbd>{shortcut.shortcut}</kbd></li>)}
          </ul>
        </div>
        {failure ? <p className="dsh-better-composer-settings-failure" role="status">设置保存失败，请重试。</p> : null}
      </section>
    </li>
  )
}
