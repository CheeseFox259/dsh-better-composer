import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_SETTINGS, normalizeSettings, type BetterComposerSettings } from '../settings.ts'

/** Reactive browser view over the plugin's official Settings scope. */
export class BetterComposerSettingsStore {
  private current: BetterComposerSettings = { ...DEFAULT_SETTINGS }
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: () => void
  private disposed = false

  /** @param scope - caller-owned Settings scope for the plugin namespace. */
  constructor(private readonly scope: SettingsScope<BetterComposerSettings>) {
    this.sync()
    this.unsubscribe = scope.subscribe(() => { this.sync() })
  }

  /** @returns the latest complete settings value. */
  get(): BetterComposerSettings {
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
  set<K extends keyof BetterComposerSettings>(field: K, value: BetterComposerSettings[K]): Promise<void> {
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

function sameSettings(left: BetterComposerSettings, right: BetterComposerSettings): boolean {
  return left.enabled === right.enabled
    && left.markdownVisual === right.markdownVisual
    && left.diagnostics === right.diagnostics
    && left.toolbarMode === right.toolbarMode
}
