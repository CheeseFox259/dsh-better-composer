import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BetterComposerRemoteService } from '../../src/remote.ts'
import { createClipSource } from '../../src/client/clip-source.ts'
import { ClipStore, type ClipEntry } from '../../src/client/clip-store.ts'
import { betterComposerRemoteContribution } from '../../src/client/remote.ts'

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
        return { ok: true as const, value: { path: '/w/a/.dsh/pastes/pasted-text-clip-b.md', relativePath: '.dsh/pastes/pasted-text-clip-b.md', bytes: 7 } }
      },
    }
    const source = createClipSource(stubClip(entry) as ClipStore, () => {}, () => face as never)
    const serialized = await source.codec!.serialize('clip-b', AbortSignal.abort())

    expect(published).toEqual({ id: 'clip-b', cwd: '/w/a' })
    expect(serialized).toBe('@.dsh/pastes/pasted-text-clip-b.md')
    expect(serialized).not.toContain('7 bytes')
    expect(serialized).not.toContain('payload')
    expect(serialized).not.toContain('Read that path')
  })

  it('blocks the send with a clear error when the workspace path is unknown', async () => {
    const entry: ClipEntry = { id: 'clip-c', text: 'payload', mode: 'file', createdAt: 0, cwd: '' }
    const source = createClipSource(stubClip(entry) as ClipStore, () => {}, () => undefined)
    await expect(source.codec!.serialize('clip-c', AbortSignal.abort())).rejects.toThrow('workspace path')
  })

  it('declares valid Typert strict codecs with create() factories on all descriptors', () => {
    expect(betterComposerRemoteContribution.descriptors.length).toBeGreaterThan(0)
    for (const descriptor of betterComposerRemoteContribution.descriptors) {
      for (const parameter of descriptor.parameters) {
        if (parameter.codec.mode === 'strict') {
          expect(typeof (parameter.codec as { create?: unknown }).create).toBe('function')
        }
      }
      if (descriptor.result.mode === 'strict') {
        expect(typeof (descriptor.result as { create?: unknown }).create).toBe('function')
      }
    }
  })

  it('ensures the clip is stored before publishing in file mode', async () => {
    const stored: unknown[] = []
    const published: { id?: string; cwd?: string } = {}
    const entry: ClipEntry = { id: 'clip-persist', text: 'heavy content', mode: 'file', createdAt: 12345, cwd: '/workspace/dir', fileExtension: '.md' }
    const face = {
      storePaste: vi.fn(async (request: unknown) => {
        stored.push(request)
        return { ok: true as const, value: { stored: true } }
      }),
      publishPaste: vi.fn(async (request: { id: string; cwd: string }) => {
        published.id = request.id
        published.cwd = request.cwd
        return { ok: true as const, value: { path: '/workspace/dir/.dsh/pastes/pasted-text-clip-persist.md', relativePath: '.dsh/pastes/pasted-text-clip-persist.md', bytes: 13 } }
      }),
    }
    const source = createClipSource(stubClip(entry) as ClipStore, () => {}, () => face as never)
    const serialized = await source.codec!.serialize('clip-persist', AbortSignal.abort())

    expect(face.storePaste).toHaveBeenCalledWith({
      id: 'clip-persist',
      text: 'heavy content',
      mode: 'file',
      createdAt: 12345,
      cwd: '/workspace/dir',
      fileExtension: '.md',
    })
    expect(face.publishPaste).toHaveBeenCalledWith({ id: 'clip-persist', cwd: '/workspace/dir' })
    expect(serialized).toContain('pasted-text-clip-persist.md')
  })

  it('reports the Remote storage error before attempting publication', async () => {
    const entry: ClipEntry = { id: 'clip-storage-error', text: 'payload', mode: 'file', createdAt: 0, cwd: '/w' }
    const face = {
      storePaste: async () => ({ ok: false as const, error: new Error('disk full') }),
      publishPaste: vi.fn(async () => ({ ok: true as const, value: { path: '/w/pasted.md', bytes: 7 } })),
    }
    const source = createClipSource(stubClip(entry) as ClipStore, () => {}, () => face as never)
    await expect(source.codec!.serialize(entry.id, AbortSignal.abort())).rejects.toThrow('disk full')
    expect(face.publishPaste).not.toHaveBeenCalled()
  })

  it('awaits the remote service when remote is an async getter or promise', async () => {
    const entry: ClipEntry = { id: 'clip-async', text: 'payload', mode: 'file', createdAt: 0, cwd: '/w/a' }
    const face = {
      publishPaste: async () => ({ ok: true as const, value: { path: '/w/a/.dsh/pastes/pasted-text-clip-async.md', relativePath: '.dsh/pastes/pasted-text-clip-async.md', bytes: 7 } }),
      storePaste: async () => ({ ok: true as const, value: { stored: true } }),
    }
    let resolveFace: (val: typeof face) => void
    const pendingFace = new Promise<typeof face>(r => { resolveFace = r })
    const source = createClipSource(
      stubClip(entry) as ClipStore,
      () => {},
      () => pendingFace as never,
    )
    const serializePromise = source.codec!.serialize('clip-async', AbortSignal.abort())
    resolveFace!(face)
    const result = await serializePromise
    expect(result).toContain('pasted-text-clip-async.md')
  })

  it('falls back to dynamic cwd resolver when entry.cwd is empty', async () => {
    const entry: ClipEntry = { id: 'clip-fallback-cwd', text: 'payload', mode: 'file', createdAt: 0, cwd: '' }
    const published: { id?: string; cwd?: string } = {}
    const face = {
      publishPaste: async (request: { id: string; cwd: string }) => {
        published.id = request.id
        published.cwd = request.cwd
        return { ok: true as const, value: { path: '/dynamic/ws/.dsh/pastes/pasted-text-clip-fallback-cwd.md', relativePath: '.dsh/pastes/pasted-text-clip-fallback-cwd.md', bytes: 7 } }
      },
    }
    const source = createClipSource(
      stubClip(entry) as ClipStore,
      () => {},
      () => face as never,
      () => '/dynamic/ws',
    )
    const serialized = await source.codec!.serialize('clip-fallback-cwd', AbortSignal.abort())
    expect(published.cwd).toBe('/dynamic/ws')
    expect(serialized).toContain('pasted-text-clip-fallback-cwd.md')
  })

  it('restores file delivery metadata after a reload fallback', async () => {
    const store = new ClipStore({
      store: () => {},
      load: async () => ({ text: 'payload', mode: 'file', createdAt: 42, cwd: '/workspace', fileExtension: '.txt' }),
    })
    await expect(store.resolve('clip-reloaded')).resolves.toEqual({
      id: 'clip-reloaded', text: 'payload', mode: 'file', createdAt: 42, cwd: '/workspace', fileExtension: '.txt',
    })
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
    await service.storePaste({ id: 'clip-x', text: 'stored payload', mode: 'file', createdAt: 0, cwd: '', fileExtension: '.json' })

    const published = await service.publishPaste({ id: 'clip-x', cwd: workspace })

    expect(published.path).toBe(join(workspace, '.dsh', 'pastes', 'pasted-text-clip-x.json'))
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
