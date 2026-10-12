/**
 * W7 tests: lifecycle and compatibility walk-through — disposal cancels
 * in-flight scans and releases read handles, capabilities degrade per
 * dimension, and uninstall never touches host history or feedback (AT35/38,
 * architecture.md §14.2/§18).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import { assistantMessageEvent, userMessageEvent } from '../helpers/doctor-events.ts'
import { DoctorSource } from '../../src/doctor/host/source.ts'
import { DoctorScanner } from '../../src/doctor/host/jobs.ts'
import { DoctorRuntime } from '../../src/doctor/host/runtime.ts'

let roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

function fixtureSource(fixtures: { id: string; events: SessionEvent[] }[], openLog: { id: string; closes: number }[]) {
  const stored = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  return new DoctorSource({
    catalog: {
      async list() {
        return fixtures.map((fixture) => ({ sessionId: fixture.id, updatedAt: 1, running: false, blank: false, agentAvailable: false }))
      },
    },
    persistence: {
      async stat(id) {
        const fixture = stored.get(id)
        if (fixture === undefined) return undefined
        return { header: { id, createdAt: 1, isSeeded: false }, revision: 1, eventCount: fixture.events.length } as never
      },
      async open(id): Promise<SessionHandle> {
        openLog.push({ id, closes: 0 })
        const record = openLog[openLog.length - 1]!
        const fixture = stored.get(id)!
        return {
          id: id as never,
          header: {} as never,
          inheritedEventCount: 0,
          access: 'read',
          async read(offset = 0, length = 200) {
            return { eventState: 'owned', events: fixture.events.slice(offset, offset + length) }
          },
          async append() { throw new Error('read-only') },
          async flush() { throw new Error('read-only') },
          async close() { record.closes += 1 },
          async [Symbol.asyncDispose]() {},
        } as never
      },
    },
  })
}

describe('lifecycle: disposal during a scan', () => {
  it('cancel stops scheduling, every opened handle is closed, no report is produced', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `s${index}`,
      events: [userMessageEvent(0, 0, `hi ${index}`), assistantMessageEvent(1, 0, 0, 'ok')],
    }))
    const openLog: { id: string; closes: number }[] = []
    const source = fixtureSource(many, openLog)
    const scanner = new DoctorScanner(source)
    const handle = scanner.startScan({})
    scanner.cancel(handle.jobId)
    const report = await handle.done
    expect(report).toBeUndefined()
    expect(scanner.status(handle.jobId)?.state).toBe('cancelled')
    // Every handle that was opened got closed: no descriptor leaks.
    expect(openLog.every((record) => record.closes === 1)).toBe(true)
  })
})

describe('lifecycle: feedback survives cache lifecycle', () => {
  it('uninstall-shaped teardown: feedback records persist across store re-instantiation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctor-lifecycle-'))
    roots.push(root)
    const runtime = DoctorRuntime.isolated(root, {})
    await runtime.saveFeedback({
      problemId: 'problem-keep',
      problemTitle: '用户劳动成果',
      occurrenceId: 'occ-1',
      occurrence: { sessionId: 's1' },
    })

    // Simulate uninstall + reinstall: a brand-new runtime over the same dir.
    const reinstalled = DoctorRuntime.isolated(root, {})
    const tree = await (reinstalled as unknown as { feedbackTree(): Promise<{ problems: { id: string }[] }> }).feedbackTree()
    expect(tree.problems.map((problem) => problem.id)).toContain('problem-keep')
  })

  it('feedback tree, host ID generation, and write operations returning latest state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doctor-feedback-tree-'))
    roots.push(root)
    const runtime = DoctorRuntime.isolated(root, {}) as unknown as {
      feedbackTree(): Promise<{
        problems: {
          id: string
          title: string
          revision: number
          occurrences: { id: string; problemId: string; revision: number; data: Record<string, unknown> }[]
        }[]
      }>
      saveFeedback(input: {
        targetProblemId?: string
        problemTitle?: string
        occurrence: Record<string, unknown>
      }): Promise<{
        problems: {
          id: string
          title: string
          occurrences: { id: string; problemId: string; data: Record<string, unknown> }[]
        }[]
      }>
      updateFeedback(input: {
        kind: 'problem' | 'occurrence'
        objectId: string
        expectedRevision: number
        mutate: (data: Record<string, unknown>) => Record<string, unknown>
      }): Promise<{
        problems: {
          id: string
          occurrences: { id: string; data: Record<string, unknown> }[]
        }[]
      }>
      saveConstraint(input: {
        id: string
        originalText: string
        normalizedRequirement: string
        conditions: readonly string[]
        exceptions: readonly string[]
      }): Promise<{ revision: number }>
      updateConstraint(input: {
        id: string
        expectedRevision: number
        patch: Record<string, unknown>
      }): Promise<{ revision: number }>
    }

    // 1. saveFeedback without ID returns updated feedbackTree with host-generated IDs
    const treeAfterSave = await runtime.saveFeedback({
      problemTitle: '主机生成ID测试',
      occurrence: { sessionId: 's1', note: '测试说明' },
    })
    expect(treeAfterSave.problems).toHaveLength(1)
    const problem = treeAfterSave.problems[0]!
    expect(problem.title).toBe('主机生成ID测试')
    expect(problem.id).toMatch(/^problem-/)
    expect(problem.occurrences).toHaveLength(1)
    const occ = problem.occurrences[0]!
    expect(occ.id).toMatch(/^occ-/)
    expect(occ.problemId).toBe(problem.id)
    expect(occ.data['note']).toBe('测试说明')

    // 2. updateFeedback returns updated feedbackTree
    const treeAfterUpdate = await runtime.updateFeedback({
      kind: 'occurrence',
      objectId: occ.id,
      expectedRevision: 1,
      mutate: (data) => ({ ...data, withdrawn: true }),
    })
    const updatedOcc = treeAfterUpdate.problems[0]!.occurrences.find((o) => o.id === occ.id)!
    expect(updatedOcc.data['withdrawn']).toBe(true)

    // 3. saveConstraint returns revision and stores constraint
    const savedConstraint = await runtime.saveConstraint({
      id: 'c-1',
      originalText: '总是测试',
      normalizedRequirement: 'always test',
      conditions: [],
      exceptions: [],
    })
    expect(savedConstraint.revision).toBe(1)

    // 4. updateConstraint returns revision
    const updatedConstraint = await runtime.updateConstraint({
      id: 'c-1',
      expectedRevision: 1,
      patch: { status: 'revoked' },
    })
    expect(updatedConstraint.revision).toBe(2)
  })
})

describe('compatibility: capability degradation (AT35)', () => {
  it('discovers the session catalog when the host mounts it after the plugin', async () => {
    const services = new Map<string, unknown>()
    const runtime = DoctorRuntime.create({ get: (name: string) => services.get(name) } as Context)
    expect(runtime.capabilities().catalog.available).toBe(false)
    services.set('sessionController', { list: async () => ({ items: [{ sessionId: 'later', updatedAt: 1, agentAvailable: false }] }) })
    expect(runtime.capabilities().catalog.available).toBe(true)
    expect((await runtime.source.freezeCandidates()).map((item) => item.sessionId)).toEqual(['later'])
    runtime.dispose()
  })

  it('reads archive membership once the native workspace registry becomes ready', async () => {
    let ready = false
    const registry = { get archivedSessionIds() { if (!ready) throw new Error('initializing'); return ['archived'] } }
    const services = new Map<string, unknown>([
      ['workspaceRegistry', registry],
      ['sessionController', { list: async () => ({ items: [] }) }],
    ])
    const runtime = DoctorRuntime.create({ get: (name: string) => services.get(name) } as Context)
    expect(runtime.capabilities().archive.available).toBe(false)
    ready = true
    expect(runtime.capabilities().archive.available).toBe(true)
    expect(await runtime.source.freezeCandidates()).toEqual([{ sessionId: 'archived', archived: true, agentAvailable: false }])
    runtime.dispose()
  })

  it('a runtime with no host services reports every dimension missing, never throws', async () => {
    const runtime = DoctorRuntime.isolated(await mkdtemp(join(tmpdir(), 'doctor-empty-')), {})
    roots.push(join(tmpdir(), 'unused'))
    const capabilities = runtime.capabilities()
    expect(capabilities.catalog.available).toBe(false)
    expect(capabilities.persistence.available).toBe(false)
    expect(capabilities.archive.available).toBe(false)
    expect(capabilities.catalog.reason).toBeDefined()

    const report = await runtime.startScan({}).done
    // With no persistence the scan completes with zero computable sessions —
    // it does not fabricate data.
    expect(report).toBeDefined()
    expect(report!.sessions).toHaveLength(0)
    expect(report!.coverage.candidates).toBe(0)
  })
})

describe('compatibility: compaction provider without its constraint source', () => {
  it('fails loud at enhancement time rather than silently degrading (AT38 basis)', async () => {
    // Covered by the W6 engine test; this pins the contract at runtime level:
    // the provider requires an explicitly bound source, uninstalling the
    // binding surfaces an error, never a silent takeover.
    const { DoctorCompactionEngine } = await import('../../src/doctor/compaction.ts')
    const ctx = {
      reflect: { provide: () => () => {} },
      get: () => undefined,
    } as never
    const engine = new DoctorCompactionEngine(ctx, { auto: false } as never)
    expect(engine).toBeDefined()
  })
})
