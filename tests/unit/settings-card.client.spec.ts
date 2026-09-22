import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SHORTCUTS } from '../../src/client/settings-card.tsx'
import { BetterComposerSettingsCard } from '../../src/client/settings-card.tsx'
import { createEditorContribution } from '../../src/client/editor.tsx'
import { DEFAULT_SETTINGS } from '../../src/settings.ts'

describe('Better Composer Settings card', () => {
  it('exposes the four M6 preferences and read-only shortcuts', () => {
    const settingsHtml = renderToStaticMarkup(createElement(BetterComposerSettingsCard as never, {
      settings: store({ ...DEFAULT_SETTINGS }),
    } as never))
    expect(settingsHtml.match(/type="checkbox"/gu)).toHaveLength(4)
    expect(SHORTCUTS).toEqual([
      { id: 'strong', label: '加粗', shortcut: '⌘/Ctrl+B' },
      { id: 'emphasis', label: '斜体', shortcut: '⌘/Ctrl+I' },
      { id: 'inline-code', label: '行内代码', shortcut: '⌘/Ctrl+`' },
      { id: 'link', label: '链接', shortcut: '⌘/Ctrl+K' },
    ])
  })

  it('renders existing settings copy and keeps the editor toolbar-free', () => {
    const compactStore = store({ ...DEFAULT_SETTINGS })
    const settingsHtml = renderToStaticMarkup(createElement(BetterComposerSettingsCard as never, {
      settings: compactStore,
    } as never))
    expect(settingsHtml).toContain('Better Composer 设置')
    expect(settingsHtml).toContain('Markdown 视觉增强')
    expect(settingsHtml).toContain('Markdown 语法提示')
    expect(settingsHtml).toContain('确定性写作辅助')
    expect(settingsHtml).toContain('dsh-better-composer-settings-fields')
    expect(settingsHtml).toContain('在 DSH 输入框中提供 Markdown 编辑增强。')
    expect(settingsHtml).toContain('不会修改实际发送给 Agent 的文本。')
    expect(settingsHtml).toContain('检查高置信度 Markdown 问题，不阻止发送。')
    expect(settingsHtml).toContain('仅显示固定的本地结构提醒，不修改内容或阻止发送。')

    const Editor = createEditorContribution(store({ ...DEFAULT_SETTINGS }))
    const editorHtml = renderToStaticMarkup(createElement(Editor as never, {
      useInput: (selector: (state: { draft: string }) => unknown) => selector({ draft: '# Task' }),
      inputActions: {},
      runAction: () => {},
      expanded: false,
      setExpanded: () => {},
    } as never))
    expect(editorHtml).not.toContain('role="toolbar"')
    expect(editorHtml).not.toContain('<button')
  })
})

function store(value: typeof DEFAULT_SETTINGS) {
  return {
    get: () => value,
    subscribe: () => () => {},
    set: async () => {},
  } as never
}
