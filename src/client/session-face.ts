import type { Context } from '@deepseek-ai/cordis'

/**
 * Narrow face of the client `sessions` service the composer actually uses.
 * The plugin's single typecheck program can see both the client and the host
 * package augment `cordis`'s `Context.sessions`; depending on which
 * augmentation wins, the ambient type differs. Reading through this local face
 * keeps the composer code stable regardless of merge order — the runtime
 * service has had this shape since the host this plugin targets.
 */
export interface ComposerSessionsFace {
  readonly list: { getSnapshot(): unknown }
  retainInfo?(sessionId: never): { subscribe(listener: () => void): () => void }
  binding(sessionId: never): {
    readonly session: { readonly projections?: unknown }
    readonly eventSource?: { getSnapshot(): unknown; subscribe?(listener: () => void): () => void }
  } | undefined
  scope(sessionId: never): Context | undefined
  fork?(request: unknown): Promise<unknown>
}

/** Resolve the client sessions service through the narrow face. */
export function composerSessions(ctx: Context): ComposerSessionsFace | undefined {
  const sessions = (ctx as { readonly sessions?: unknown }).sessions
  if (sessions === undefined || sessions === null) return undefined
  return sessions as ComposerSessionsFace
}
