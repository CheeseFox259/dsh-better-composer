import { useCallback, useEffect, useState } from 'react'

/** Expand/collapse icon button for the composer toolbar. */
export function ComposerExpandButton() {
  const [expanded, setExpanded] = useState(false)

  const toggle = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const card = event.currentTarget.closest<HTMLElement>('[data-composer-card]')
    if (card === null) return
    const next = !expanded
    setExpanded(next)
    if (next) {
      card.setAttribute('data-composer-expanded', 'true')
    } else {
      card.removeAttribute('data-composer-expanded')
    }
  }, [expanded])

  // Sync state if card is reset
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && expanded) {
        const card = document.querySelector<HTMLElement>('[data-composer-card][data-composer-expanded]')
        if (card !== null) {
          card.removeAttribute('data-composer-expanded')
          setExpanded(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [expanded])

  return (
    <button
      type="button"
      className="dsh-better-composer-expand-button"
      aria-label={expanded ? '收起输入框' : '展开输入框'}
      title={expanded ? '收起输入框 (Esc)' : '展开输入框'}
      data-composer-expanded-trigger={expanded ? 'true' : undefined}
      onClick={toggle}
    >
      {expanded ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 14h6v6" />
          <path d="M20 10h-6V4" />
          <path d="M14 10l7-7" />
          <path d="M3 21l7-7" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </svg>
      )}
    </button>
  )
}
