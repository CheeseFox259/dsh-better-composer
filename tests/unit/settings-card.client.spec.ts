import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SETTINGS_FIELDS, SHORTCUTS } from '../../src/client/settings-card.tsx'
import { RichEditorSettingsCard } from '../../src/client/settings-card.tsx'
import { createEditorContribution } from '../../src/client/editor.tsx'
import { DEFAULT_SETTINGS } from '../../src/settings.ts'

describe('Rich Editor Settings card', () => {
  it('exposes only the four persisted preferences and read-only shortcuts', () => {
    expect(SETTINGS_FIELDS.map(field => field.id)).toEqual([
      'enabled', 'markdownVisual', 'diagnostics', 'toolbarMode',
    ])
    expect(SETTINGS_FIELDS.find(field => field.id === 'toolbarMode')?.options).toEqual([
      { value: 'compact', label: '紧凑' },
      { value: 'hidden', label: '隐藏' },
    ])
    expect(SHORTCUTS).toEqual([
      { id: 'strong', label: '加粗', shortcut: '⌘/Ctrl+B' },
      { id: 'emphasis', label: '斜体', shortcut: '⌘/Ctrl+I' },
      { id: 'inline-code', label: '行内代码', shortcut: '⌘/Ctrl+`' },
      { id: 'link', label: '链接', shortcut: '⌘/Ctrl+K' },
    ])
  })

  it('renders all settings copy and removes the complete toolbar in hidden mode', () => {
    const compactStore = store({ ...DEFAULT_SETTINGS })
    const settingsHtml = renderToStaticMarkup(createElement(RichEditorSettingsCard as never, {
      settings: compactStore,
    } as never))
    expect(settingsHtml).toContain('Rich Editor 设置')
    expect(settingsHtml).toContain('Markdown 视觉增强')
    expect(settingsHtml).toContain('Markdown 语法提示')
    expect(settingsHtml).toContain('编辑工具栏')
    expect(settingsHtml).toContain('dsh-rich-editor-settings-fields')
    expect(settingsHtml).toContain('在 DSH 输入框中提供 Markdown 编辑增强。')
    expect(settingsHtml).toContain('不会修改实际发送给 Agent 的文本。')
    expect(settingsHtml).toContain('检查高置信度 Markdown 问题，不阻止发送。')

    const HiddenEditor = createEditorContribution(store({ ...DEFAULT_SETTINGS, toolbarMode: 'hidden' }))
    const editorHtml = renderToStaticMarkup(createElement(HiddenEditor as never, {
      useInput: (selector: (state: { draft: string }) => unknown) => selector({ draft: '# Task' }),
      inputActions: {},
      runAction: () => {},
      expanded: false,
      setExpanded: () => {},
    } as never))
    expect(editorHtml).not.toContain('role="toolbar"')
    expect(editorHtml).not.toContain('预览')
    expect(editorHtml).not.toContain('展开')
  })
})

function store(value: typeof DEFAULT_SETTINGS) {
  return {
    get: () => value,
    subscribe: () => () => {},
    set: async () => {},
  } as never
}
