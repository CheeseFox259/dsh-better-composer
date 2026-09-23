const optionalStringSchema = {
  parse(value: unknown): string | undefined {
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw new Error('expected string')
    return value
  },
}

const clipRecordSchema = {
  parse(value: unknown): { id: string; text: string; mode: string; createdAt: number; cwd: string } {
    if (value === null || typeof value !== 'object') throw new Error('expected clip record')
    const record = value as Record<string, unknown>
    if (typeof record['id'] !== 'string' || typeof record['text'] !== 'string') throw new Error('invalid clip record')
    return {
      id: record['id'],
      text: record['text'],
      mode: record['mode'] === 'file' ? 'file' : 'inline',
      createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
      cwd: typeof record['cwd'] === 'string' ? record['cwd'] : '',
    }
  },
}

const storedResultSchema = {
  parse(value: unknown): { stored: boolean } {
    if (value === null || typeof value !== 'object') throw new Error('expected result')
    return { stored: (value as Record<string, unknown>)['stored'] === true }
  },
}

const loadResultSchema = {
  parse(value: unknown): { text: string | undefined } {
    if (value === null || typeof value !== 'object') throw new Error('expected result')
    const text = (value as Record<string, unknown>)['text']
    return { text: optionalStringSchema.parse(text) }
  },
}

/** Hand-written Remote contribution; the host side is discovered via SRC markers. */
export const betterComposerRemoteContribution = {
  package: '@cheesefox/dsh-better-composer',
  descriptors: [{
    id: '@cheesefox/dsh-better-composer#betterComposer/storePaste',
    service: 'betterComposer',
    namespace: 'betterComposer',
    method: 'storePaste',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@cheesefox/dsh-better-composer#ClipRecord', schema: clipRecordSchema },
    }],
    result: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/storePaste:result',
      schema: storedResultSchema,
    },
  }, {
    id: '@cheesefox/dsh-better-composer#betterComposer/loadPaste',
    service: 'betterComposer',
    namespace: 'betterComposer',
    method: 'loadPaste',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/loadPaste:request',
        schema: {
          parse(value: unknown): { id: string } {
            if (value === null || typeof value !== 'object') throw new Error('expected request')
            const id = (value as Record<string, unknown>)['id']
            if (typeof id !== 'string') throw new Error('invalid clip id')
            return { id }
          },
        },
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/loadPaste:result',
      schema: loadResultSchema,
    },
  }, {
    id: '@cheesefox/dsh-better-composer#betterComposer/publishPaste',
    service: 'betterComposer',
    namespace: 'betterComposer',
    method: 'publishPaste',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/publishPaste:request',
        schema: {
          parse(value: unknown): { id: string; cwd: string } {
            if (value === null || typeof value !== 'object') throw new Error('expected request')
            const record = value as Record<string, unknown>
            if (typeof record['id'] !== 'string' || typeof record['cwd'] !== 'string') throw new Error('invalid publish request')
            return { id: record['id'], cwd: record['cwd'] }
          },
        },
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/publishPaste:result',
      schema: {
        parse(value: unknown): { path: string; bytes: number } {
          if (value === null || typeof value !== 'object') throw new Error('expected result')
          const record = value as Record<string, unknown>
          if (typeof record['path'] !== 'string' || typeof record['bytes'] !== 'number') throw new Error('invalid publish result')
          return { path: record['path'], bytes: record['bytes'] }
        },
      },
    },
  }, {
    id: '@cheesefox/dsh-better-composer#betterComposer/editText',
    service: 'betterComposer',
    namespace: 'betterComposer',
    method: 'editText',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/editText:request',
        schema: {
          parse(value: unknown): {
            provider: string
            model: string
            text: string
            instruction: string
            contextMessages: readonly { role: string; text: string }[]
          } {
            if (value === null || typeof value !== 'object') throw new Error('expected request')
            const record = value as Record<string, unknown>
            for (const field of ['provider', 'model', 'text', 'instruction'] as const) {
              if (typeof record[field] !== 'string') throw new Error(`invalid edit request: ${field}`)
            }
            const contextMessages = Array.isArray(record['contextMessages']) ? record['contextMessages'] : []
            return {
              provider: record['provider'] as string,
              model: record['model'] as string,
              text: record['text'] as string,
              instruction: record['instruction'] as string,
              contextMessages: contextMessages.filter((entry): entry is { role: string; text: string } =>
                entry !== null && typeof entry === 'object'
                && typeof (entry as Record<string, unknown>)['role'] === 'string'
                && typeof (entry as Record<string, unknown>)['text'] === 'string'),
            }
          },
        },
      },
    }],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/editText:result',
      schema: {
        parse(value: unknown): { text: string } {
          if (value === null || typeof value !== 'object') throw new Error('expected result')
          const text = (value as Record<string, unknown>)['text']
          if (typeof text !== 'string') throw new Error('invalid edit result')
          return { text }
        },
      },
    },
  }],
} as const

export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown }

export interface BetterComposerRemoteFace {
  storePaste(request: { id: string; text: string; mode: string; createdAt: number; cwd: string }): Promise<RemoteResult<{ stored: boolean }>>
  loadPaste(request: { id: string }): Promise<RemoteResult<{ text: string | undefined }>>
  publishPaste(request: { id: string; cwd: string }): Promise<RemoteResult<{ path: string; bytes: number }>>
  editText(request: {
    provider: string
    model: string
    text: string
    instruction: string
    contextMessages: readonly { role: string; text: string }[]
  }): Promise<RemoteResult<{ text: string }>>
}

export interface BetterComposerRemoteState {
  readonly face?: BetterComposerRemoteFace
  readonly error?: string
}

let remoteState: BetterComposerRemoteState = {}
const listeners = new Set<() => void>()

/** Snapshot of the mounted Remote face, for useSyncExternalStore. */
export function remoteSnapshot(): BetterComposerRemoteState {
  return remoteState
}

/** Subscribe to Remote mount-state changes. */
export function subscribeRemote(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Publish the mounted face or the mount failure. */
export function publishRemoteState(next: BetterComposerRemoteState): void {
  remoteState = next
  for (const listener of listeners) listener()
}

/** The mounted namespace accessor, typed narrowly to the hand-written face. */
export function betterComposerRemote(ctx: { readonly get: (name: string, strict?: boolean) => unknown }): BetterComposerRemoteFace | undefined {
  const face = ctx.get('remote.betterComposer', false)
  return face === undefined || face === null ? undefined : face as BetterComposerRemoteFace
}
