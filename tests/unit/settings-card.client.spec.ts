import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BetterComposerSettingsCard } from '../../src/client/settings-card.tsx'
import { createEditorContribution } from '../../src/client/editor.tsx'
import { DEFAULT_SETTINGS } from '../../src/settings.ts'

describe('Better Composer Settings card', () => {
  it('exposes the M6 preferences without plugin-owned formatting shortcuts', () => {
    const settingsHtml = renderToStaticMarkup(createElement(BetterComposerSettingsCard as never, {
      settings: store({ ...DEFAULT_SETTINGS }),
    } as never))
    expect(settingsHtml.match(/type="checkbox"/gu)).toHaveLength(3)
    expect(settingsHtml).not.toContain('快捷键')
  })

  it('renders existing settings copy and keeps the editor toolbar-free', () => {
    const compactStore = store({ ...DEFAULT_SETTINGS })
    const settingsHtml = renderToStaticMarkup(createElement(BetterComposerSettingsCard as never, {
      settings: compactStore,
    } as never))
    expect(settingsHtml).toContain('Better Composer 设置')
    expect(settingsHtml).toContain('Markdown 视觉增强')
    expect(settingsHtml).toContain('Markdown 语法提示')
    expect(settingsHtml).toContain('超长粘贴转引用')
    expect(settingsHtml).toContain('dsh-better-composer-settings-fields')
    expect(settingsHtml).toContain('在 DSH 输入框中提供 Markdown 编辑增强。')
    expect(settingsHtml).toContain('不会修改实际发送给 Agent 的文本。')
    expect(settingsHtml).toContain('检查高置信度 Markdown 问题，不阻止发送。')

    const Editor = createEditorContribution({} as never, store({ ...DEFAULT_SETTINGS }), {} as never)
    const editorHtml = renderToStaticMarkup(createElement(Editor as never, {
      sessionId: 's1',
      useInput: (selector: (state: unknown) => unknown) => selector({
        draft: '# Task', draftRev: 1, occurrences: [], phase: 'plain', attachmentIds: [], queue: [],
      }),
      inputActions: {},
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
