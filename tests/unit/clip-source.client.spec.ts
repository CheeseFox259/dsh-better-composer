import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BetterComposerRemoteService } from '../../src/remote.ts'
import { createClipSource } from '../../src/client/clip-source.ts'
import type { ClipEntry, ClipStore } from '../../src/client/clip-store.ts'

const homes: string[] = []

async function fakeHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bc-paste-'))
  homes.push(dir)
  process.env['DSH_HOME'] = dir
  return dir
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function stubClip(entry: ClipEntry): Pick<ClipStore, 'resolve'> {
  return { resolve: async id => id === entry.id ? entry : undefined }
}

describe('clip source serialization', () => {
  it('inlines the full text in inline mode', async () => {
    const entry: ClipEntry = { id: 'clip-a', text: 'payload', mode: 'inline', createdAt: 0, cwd: '/w' }
    const source = createClipSource(stubClip(entry) as ClipStore, () => {}, () => undefined)
    await expect(source.codec!.serialize('clip-a', AbortSignal.abort())).resolves.toBe('payload')
  })

  it('returns a workspace file handle in file mode', async () => {
    const published: { id?: string; cwd?: string } = {}
    const entry: ClipEntry = { id: 'clip-b', text: 'payload', mode: 'file', createdAt: 0, cwd: '/w/a' }
    const face = {
      publishPaste: async (request: { id: string; cwd: string }) => {
        published.id = request.id
        published.cwd = request.cwd
        return { ok: true as const, value: { path: '/w/a/.dsh/pastes/pasted-text-clip-b.md', bytes: 7 } }
      },
    }
    const source = createClipSource(stubClip(entry) as ClipStore, () => {}, () => face as never)
    const serialized = await source.codec!.serialize('clip-b', AbortSignal.abort())

    expect(published).toEqual({ id: 'clip-b', cwd: '/w/a' })
    expect(serialized).toContain('pasted-text-clip-b.md')
    expect(serialized).toContain('7 bytes')
    expect(serialized).not.toContain('payload')
    expect(serialized).toContain('Read that path')
  })

  it('blocks the send with a clear error when the workspace path is unknown', async () => {
    const entry: ClipEntry = { id: 'clip-c', text: 'payload', mode: 'file', createdAt: 0, cwd: '' }
    const source = createClipSource(stubClip(entry) as ClipStore, () => {}, () => undefined)
    await expect(source.codec!.serialize('clip-c', AbortSignal.abort())).rejects.toThrow('workspace path')
  })
})

describe('host publishPaste', () => {
  it('materializes the stored clip under the workspace .dsh directory', async () => {
    const home = await fakeHome()
    const workspace = await mkdtemp(join(tmpdir(), 'bc-workspace-'))
    homes.push(workspace)
    const ctx = {
      get: () => undefined,
      reflect: { provide: () => () => {} },
    } as never
    const service = new BetterComposerRemoteService(ctx)
    await service.storePaste({ id: 'clip-x', text: 'stored payload', mode: 'file', createdAt: 0, cwd: '' })

    const published = await service.publishPaste({ id: 'clip-x', cwd: workspace })

    expect(published.path).toBe(join(workspace, '.dsh', 'pastes', 'pasted-text-clip-x.md'))
    expect(published.bytes).toBe(Buffer.byteLength('stored payload', 'utf8'))
    expect(await readFile(published.path, 'utf8')).toBe('stored payload')
    expect(home).not.toBe('')
  })

  it('rejects non-absolute workspace paths', async () => {
    await fakeHome()
    const service = new BetterComposerRemoteService({ get: () => undefined, reflect: { provide: () => () => {} } } as never)
    await expect(service.publishPaste({ id: 'clip-x', cwd: 'relative/path' })).rejects.toThrow('absolute')
  })
})
