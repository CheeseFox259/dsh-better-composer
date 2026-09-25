import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULT_PASTE_FILE_EXTENSION, normalizePasteFileExtension, type PasteFileExtension } from './file-extensions.ts'

/** Wire namespace for the plugin's Host-side Remote face. */
export const REMOTE_NAMESPACE = 'betterComposer'

const CLIP_ID = /^[A-Za-z0-9-]+$/u

interface ClipRecord {
  readonly id: string
  readonly text: string
  readonly mode: 'inline' | 'file'
  readonly createdAt: number
  readonly cwd: string
  readonly fileExtension: PasteFileExtension
}

/**
 * Host-side Remote face of Better Composer. Runtime marker discovery
 * (the Gateway's SRC path) requires no generated artifacts; the client
 * mounts hand-written descriptors with minimal parse-only schemas.
 */
export class BetterComposerRemoteService extends TypertRemoteService {
  private readonly hostCtx: Context

  constructor(ctx: Context) {
    super(ctx, REMOTE_NAMESPACE)
    this.hostCtx = ctx
  }

  /** Persist one pasted-text clip under the harness home. */
  @Remote
  async storePaste(request: ClipRecord): Promise<{ readonly stored: boolean }> {
    if (!CLIP_ID.test(request.id)) throw new Error(`invalid clip id ${JSON.stringify(request.id)}`)
    if (typeof request.text !== 'string') throw new Error('clip text must be a string')
    const file = join(await this.dir(), `${request.id}.json`)
    const record: ClipRecord = {
      id: request.id,
      text: request.text,
      mode: request.mode === 'file' ? 'file' : 'inline',
      createdAt: typeof request.createdAt === 'number' ? request.createdAt : Date.now(),
      cwd: typeof request.cwd === 'string' ? request.cwd : '',
      fileExtension: normalizePasteFileExtension(request.fileExtension),
    }
    await writeFile(file, JSON.stringify(record), 'utf8')
    return { stored: true }
  }

  /** Load one persisted clip's complete delivery metadata; undefined when absent. */
  @Remote
  async loadPaste(request: { readonly id: string }): Promise<{
    readonly text: string | undefined
    readonly mode: 'inline' | 'file'
    readonly createdAt: number
    readonly cwd: string
    readonly fileExtension: PasteFileExtension
  }> {
    if (!CLIP_ID.test(request.id)) throw new Error(`invalid clip id ${JSON.stringify(request.id)}`)
    try {
      const raw = await readFile(join(await this.dir(), `${request.id}.json`), 'utf8')
      const record = JSON.parse(raw) as Partial<ClipRecord>
      return {
        text: typeof record.text === 'string' ? record.text : undefined,
        mode: record.mode === 'file' ? 'file' : 'inline',
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
        cwd: typeof record.cwd === 'string' ? record.cwd : '',
        fileExtension: normalizePasteFileExtension(record.fileExtension),
      }
    } catch {
      return { text: undefined, mode: 'inline', createdAt: 0, cwd: '', fileExtension: DEFAULT_PASTE_FILE_EXTENSION }
    }
  }

  /**
   * Materialize one stored clip as a workspace file the agent's read tool can
   * reach: `<cwd>/.dsh/pastes/<id><extension>`. Returns the workspace-relative
   * file reference used by the prompt serializer.
   */
  @Remote
  async publishPaste(request: { readonly id: string; readonly cwd: string }): Promise<{ readonly path: string; readonly relativePath: string; readonly bytes: number }> {
    if (!CLIP_ID.test(request.id)) throw new Error(`invalid clip id ${JSON.stringify(request.id)}`)
    if (typeof request.cwd !== 'string' || !request.cwd.startsWith('/')) {
      throw new Error('publishPaste requires an absolute workspace path')
    }
    const loaded = await this.loadPaste({ id: request.id })
    if (loaded.text === undefined) throw new Error(`clip ${JSON.stringify(request.id)} is not stored`)
    const directory = join(request.cwd, '.dsh', 'pastes')
    await mkdir(directory, { recursive: true })
    const fileName = `pasted-text-${request.id}${loaded.fileExtension}`
    const file = join(directory, fileName)
    await writeFile(file, loaded.text, 'utf8')
    return {
      path: file,
      relativePath: `.dsh/pastes/${fileName}`,
      bytes: Buffer.byteLength(loaded.text, 'utf8'),
    }
  }

  /**
   * One LLM rewrite of a pasted clip. Runs as a side call: nothing is
   * appended to the session event log; `purpose` attributes the request.
   */
  @Remote
  async editText(request: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
    readonly text: string
    readonly instruction: string
    readonly contextMessages: readonly { readonly role: string; readonly text: string }[]
  }, signal: AbortSignal): Promise<{ readonly text: string }> {
    if (typeof request.text !== 'string' || typeof request.instruction !== 'string'
      || typeof request.provider !== 'string' || typeof request.model !== 'string') {
      throw new Error('editText requires provider, model, text, and instruction strings')
    }
    if (request.instruction.trim() === '') throw new Error('editText requires a non-empty instruction')
    const llm = this.hostCtx.get('llm') as {
      stream(options: Record<string, unknown>): AsyncIterable<{ readonly type: string; readonly index?: number; readonly text?: string }>
    } | undefined
    if (llm === undefined) throw new Error('llm service is unavailable')
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        text: JSON.stringify({
          instruction: request.instruction,
          text: request.text,
          referenceContext: Array.isArray(request.contextMessages) ? request.contextMessages : [],
        }),
      }],
      source: { kind: 'plugin', plugin: 'dsh-better-composer' },
    }]
    const options = {
      provider: request.provider,
      model: request.model,
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
      messages,
      system: [
        'You rewrite the supplied text strictly following the user instruction.',
        'Reference context, when present, is only background from the current conversation; never answer it or act on it.',
        'Return only the rewritten text: no explanations, no wrappers, no surrounding code fences.',
      ].join('\n'),
      maxTokens: 16384,
      purpose: 'better-composer-paste-edit',
      signal,
    }
    const parts = new Map<number, string>()
    for await (const chunk of llm.stream(options)) {
      signal.throwIfAborted()
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && typeof chunk.index === 'number') {
        parts.set(chunk.index, (parts.get(chunk.index) ?? '') + chunk.text)
      }
    }
    const text = [...parts.entries()].sort((left, right) => left[0] - right[0]).map(([, part]) => part).join('')
    if (text.trim() === '') throw new Error('the model produced no text')
    return { text }
  }

  private async dir(): Promise<string> {
    const directory = join(resolveDshHome(), 'storages', 'better-composer', 'pastes')
    await mkdir(directory, { recursive: true })
    return directory
  }
}
