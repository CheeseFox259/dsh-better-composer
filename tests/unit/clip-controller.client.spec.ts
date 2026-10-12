// @vitest-environment jsdom
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BetterComposerRemoteService } from '../../src/remote.ts'
import { betterComposerRemoteContribution } from '../../src/client/remote.ts'
import {
  CLIP_SOURCE,
  clipMention,
  PasteClipController,
  planPasteAction,
  readPasteEvent,
} from '../../src/client/clip-controller.ts'
import { ClipStore, type ClipEntry } from '../../src/client/clip-store.ts'
import type { InputActions, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'

const homes: string[] = []

async function fakeHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bc-paste-'))
  homes.push(dir)
  process.env['DSH_HOME'] = dir
  return dir
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function stubStore(entry?: ClipEntry): ClipStore {
  return {
    create: (text, cwd, fileExtension, preview) => ({
      id: entry?.id ?? 'clip-stub',
      text,
      mode: 'inline',
      createdAt: 0,
      cwd,
      fileExtension: fileExtension ?? '.md',
      preview,
    }),
    persist: vi.fn(),
    resolve: async (id) => (entry && id === entry.id ? entry : undefined),
  } as unknown as ClipStore
}

function createFakeClipboardEvent(text: string, files: unknown[] = []): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  let immediateStopped = false
  const originalStopImmediate = event.stopImmediatePropagation
  event.stopImmediatePropagation = function () {
    immediateStopped = true
    originalStopImmediate.call(this)
  }
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (format: string) => (format === 'text/plain' ? text : ''),
      files,
    },
  })
  Object.defineProperty(event, 'immediateStopped', {
    get: () => immediateStopped,
  })
  return event
}

describe('PasteClipController planning (migrated from paste-interceptor)', () => {
  const span: TokenSpan = { start: 2, end: 4, draftRev: 7 }
  const base = {
    draft: 'abXYcd', occurrences: 0, phase: 'plain', composing: false,
    hasFiles: false, threshold: 4000, span,
  }

  it('turns a long plain paste into a pre-Core clip action', () => {
    expect(planPasteAction({ ...base, text: 'long text', threshold: 4 })).toEqual({ kind: 'clip', text: 'long text', span })
  })

  it('rebuilds an ordinary multiline paste through setDraft', () => {
    expect(planPasteAction({ ...base, text: 'one\ntwo' })).toEqual({
      kind: 'set-draft', text: 'abone\ntwocd',
    })
  })

  it('passes through chips, files, composition, and non-plain phases', () => {
    expect(planPasteAction({ ...base, text: 'one\ntwo', occurrences: 1 }).kind).toBe('pass')
    expect(planPasteAction({ ...base, text: 'one\ntwo', hasFiles: true }).kind).toBe('pass')
    expect(planPasteAction({ ...base, text: 'one\ntwo', composing: true }).kind).toBe('pass')
    expect(planPasteAction({ ...base, text: 'one\ntwo', phase: 'claimed' }).kind).toBe('pass')
  })

  it('passes an invalid captured span instead of creating a dead clip', () => {
    expect(planPasteAction({ ...base, text: 'long text', span: { start: 99, end: 100, draftRev: 7 } }).kind).toBe('pass')
    expect(planPasteAction({ ...base, text: 'one\ntwo', span: { start: 99, end: 100, draftRev: 7 } }).kind).toBe('pass')
  })

  it('reads clipboard text and file presence accurately', () => {
    const plain = createFakeClipboardEvent('hello')
    expect(readPasteEvent(plain)).toEqual({ text: 'hello', hasFiles: false })

    const withFiles = createFakeClipboardEvent('hello', [{ name: 'f.png' }])
    expect(readPasteEvent(withFiles)).toEqual({ text: 'hello', hasFiles: true })
  })
})

describe('PasteClipController attach lifecycle and integration', () => {
  it('converts long paste into chip, persists entry, shows toast, and prevents default', () => {
    const store = stubStore({ id: 'clip-1', text: 'long payload', mode: 'inline', createdAt: 0, cwd: '/w' })
    let insertedRef: unknown = null
    const bailMock = vi.fn((name: string, payload: unknown) => {
      if (name === 'slash/input-insert-reference') {
        insertedRef = payload
        return true
      }
      return undefined
    })

    const controller = new PasteClipController({
      store,
      scopeResolver: () => ({ bail: bailMock } as never),
    })

    const inputElement = document.createElement('div')
    const capturedSpan: TokenSpan = { start: 0, end: 0, draftRev: 1 }
    let draftSet = ''
    const actions: InputActions = {
      captureInsertion: () => capturedSpan,
      setDraft: (t: string) => { draftSet = t },
      insertText: vi.fn(),
    } as unknown as InputActions

    const sessionInput = {
      state: {
        getSnapshot: () => ({ draft: 'initial', draftRev: 1, occurrences: [] }),
      },
      setDraft: vi.fn(),
      notify: vi.fn(),
    }

    const detach = controller.attach(inputElement, actions, {
      sessionId: 'session-test',
      sessionInput,
      readState: () => ({
        draft: 'initial',
        occurrences: 0,
        phase: 'plain',
        composing: false,
        threshold: 5,
      }),
    })

    const event = createFakeClipboardEvent('long payload here')
    inputElement.dispatchEvent(event as unknown as Event)

    expect(bailMock).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect((event as unknown as { immediateStopped: boolean }).immediateStopped).toBe(true)
    expect(store.persist).toHaveBeenCalled()
    expect(controller.getToast()).toContain('超长粘贴已转为引用')

    detach()
  })

  it('retains original input and shows failure toast when insertion is refused', () => {
    const store = stubStore()
    const bailMock = vi.fn(() => false) // insertion refused by Lexical/phase

    const controller = new PasteClipController({
      store,
      scopeResolver: () => ({ bail: bailMock } as never),
    })

    const inputElement = document.createElement('div')
    const capturedSpan: TokenSpan = { start: 0, end: 0, draftRev: 1 }
    const actions: InputActions = {
      captureInsertion: () => capturedSpan,
      setDraft: vi.fn(),
    } as unknown as InputActions

    const sessionInput = {
      state: {
        getSnapshot: () => ({ draft: 'initial', draftRev: 1, occurrences: [] }),
      },
      setDraft: vi.fn(),
      notify: vi.fn(),
    }

    controller.attach(inputElement, actions, {
      sessionId: 'session-test',
      sessionInput,
      readState: () => ({
        draft: 'initial',
        occurrences: 0,
        phase: 'plain',
        composing: false,
        threshold: 5,
      }),
    })

    const event = createFakeClipboardEvent('long payload here')
    inputElement.dispatchEvent(event as unknown as Event)

    // Insertion refused: default NOT prevented so browser native paste inserts raw text
    expect(event.defaultPrevented).toBe(false)
    expect(store.persist).not.toHaveBeenCalled()
    expect(controller.getToast()).toContain('超长粘贴转引用受阻，已保留原始输入。')
  })

  it('manages toast notifications with subscribe and dismiss', () => {
    const controller = new PasteClipController()
    let toastValue: string | null = null
    const unsubscribe = controller.subscribeToast(() => {
      toastValue = controller.getToast()
    })

    controller.showToast('测试提示', 1000)
    expect(toastValue).toBe('测试提示')
    expect(controller.getToast()).toBe('测试提示')

    controller.dismissToast()
    expect(toastValue).toBeNull()
    expect(controller.getToast()).toBeNull()

    unsubscribe()
  })
})

describe('clip source serialization (migrated from clip-source)', () => {
  it('inlines the full text in inline mode', async () => {
    const entry: ClipEntry = { id: 'clip-a', text: 'payload', mode: 'inline', createdAt: 0, cwd: '/w' }
    const controller = new PasteClipController({ store: stubStore(entry) })
    await expect(controller.source.codec!.serialize('clip-a', AbortSignal.abort())).resolves.toBe('payload')
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
    const controller = new PasteClipController({
      store: stubStore(entry),
      getRemote: () => face as never,
    })
    const serialized = await controller.source.codec!.serialize('clip-b', AbortSignal.abort())

    expect(published).toEqual({ id: 'clip-b', cwd: '/w/a' })
    expect(serialized).toBe('@.dsh/pastes/pasted-text-clip-b.md')
    expect(serialized).not.toContain('7 bytes')
    expect(serialized).not.toContain('payload')
  })

  it('blocks the send with a clear error when the workspace path is unknown', async () => {
    const entry: ClipEntry = { id: 'clip-c', text: 'payload', mode: 'file', createdAt: 0, cwd: '' }
    const controller = new PasteClipController({ store: stubStore(entry) })
    await expect(controller.source.codec!.serialize('clip-c', AbortSignal.abort())).rejects.toThrow('workspace path')
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
    const controller = new PasteClipController({
      store: stubStore(entry),
      getRemote: () => face as never,
    })
    const serialized = await controller.source.codec!.serialize('clip-persist', AbortSignal.abort())

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
    const controller = new PasteClipController({
      store: stubStore(entry),
      getRemote: () => face as never,
    })
    await expect(controller.source.codec!.serialize(entry.id, AbortSignal.abort())).rejects.toThrow('disk full')
    expect(face.publishPaste).not.toHaveBeenCalled()
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
    const controller = new PasteClipController({
      store: stubStore(entry),
      getRemote: () => face as never,
      resolveCwd: () => '/dynamic/ws',
    })
    const serialized = await controller.source.codec!.serialize('clip-fallback-cwd', AbortSignal.abort())
    expect(published.cwd).toBe('/dynamic/ws')
    expect(serialized).toContain('pasted-text-clip-fallback-cwd.md')
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
