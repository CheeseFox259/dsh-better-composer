import { describe, expect, it } from 'vitest'
import { SETTINGS_FIELDS, SHORTCUTS } from '../../src/client/settings-card.tsx'

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
})
