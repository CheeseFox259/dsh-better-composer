/**
 * Transient notification for clip conversion and other plugin feedback.
 * Auto-dismisses after a fixed duration (default 4 seconds) so the composer
 * never retains a permanent banner.
 */

let currentToast: string | null = null
let toastTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Show a transient banner that disappears after `durationMs`. */
export function showClipToast(message: string, durationMs = 4000): void {
  currentToast = message
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    currentToast = null
    toastTimer = undefined
    notify()
  }, durationMs)
  notify()
}

/** Clear any active banner immediately. */
export function dismissClipToast(): void {
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer)
    toastTimer = undefined
  }
  currentToast = null
  notify()
}

/** Read the current message, or null when settled. */
export function getClipToast(): string | null {
  return currentToast
}

/** Subscribe to banner changes. */
export function subscribeClipToast(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
