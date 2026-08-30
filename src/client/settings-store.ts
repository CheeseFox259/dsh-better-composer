import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_SETTINGS, normalizeSettings, type RichEditorSettings } from '../settings.ts'

/** Reactive browser view over the plugin's official Settings scope. */
export class RichEditorSettingsStore {
  private current: RichEditorSettings = { ...DEFAULT_SETTINGS }
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private disposed = false

  /** @param scope - caller-owned Settings scope for the plugin namespace. */
  constructor(private readonly scope: SettingsScope<RichEditorSettings>) {
    this.sync()
    this.unsubscribe = scope.subscribe(() => { this.sync() })
  }

  /** @returns the latest complete settings value. */
  get(): RichEditorSettings {
    return this.current
  }

  /**
   * Subscribe to accepted Settings snapshot changes.
   * @param listener - called after the local value changes.
   * @returns an idempotent listener disposer.
   */
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Persist one explicit preference through the Settings scope.
   * @param field - preference field to change.
   * @param value - field value accepted by the local schema.
   * @returns settlement after the scope write and recovery handling.
   */
  set<K extends keyof RichEditorSettings>(field: K, value: RichEditorSettings[K]): Promise<void> {
    return this.scope.set(field, value)
  }

  /** Stop listening to Settings and release local listeners. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.listeners.clear()
  }

  private sync(): void {
    if (this.disposed) return
    const next = normalizeSettings(this.scope.getSnapshot().value)
    if (sameSettings(this.current, next)) return
    this.current = next
    for (const listener of this.listeners) listener()
  }
}

function sameSettings(left: RichEditorSettings, right: RichEditorSettings): boolean {
  return left.enabled === right.enabled
    && left.markdownVisual === right.markdownVisual
    && left.diagnostics === right.diagnostics
    && left.toolbarMode === right.toolbarMode
}
