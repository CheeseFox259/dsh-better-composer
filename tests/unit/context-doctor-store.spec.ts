/**
 * W3 tests: DoctorStore — atomic writes, optimistic revisions, LRU cache
 * bounds, schema migration, and crash-shape discipline (AT36/AT37).
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DoctorStore, StoreConflictError, StoreReadOnlyError } from '../../src/doctor/host/store.ts'

let roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

async function makeStore(maxCacheBytes?: number) {
  const root = await mkdtemp(join(tmpdir(), 'doctor-store-'))
  roots.push(root)
  return new DoctorStore(root, { maxCacheBytes })
}

describe('DoctorStore feedback records (AT36)', () => {
  it('keeps problems, occurrences and constraints in separate lists across restart', async () => {
    const store = await makeStore()
    await store.saveProblem({ title: 'P' }, 'p1')
    await store.addOccurrence('p1', { sessionId: 's1' }, 'o1')
    await store.saveConstraint({ originalText: 'keep scope' }, 'c1')
    const restarted = new DoctorStore(roots[0]!)
    expect((await restarted.listProblems()).map((item) => item.id)).toEqual(['p1'])
    expect((await restarted.listOccurrences('p1')).map((item) => item.id)).toEqual(['o1'])
    expect((await restarted.listConstraints()).map((item) => item.id)).toEqual(['c1'])
  })

  it('creates with revision 1 and updates only on a matching expectedRevision', async () => {
    const store = await makeStore()
    const created = await store.saveProblem({ title: 'Missing acceptance env' }, 'idem-1')
    expect(created.revision).toBe(1)

    const updated = await store.updateProblem(created.id, 1, (problem) => ({ ...problem, title: 'Missing acceptance env (edited)' }))
    expect(updated.revision).toBe(2)

    await expect(
      store.updateProblem(created.id, 1, (problem) => problem),
    ).rejects.toBeInstanceOf(StoreConflictError)
  })

  it('idempotent submit keys do not create duplicate occurrences', async () => {
    const store = await makeStore()
    const problem = await store.saveProblem({ title: 'P' }, 'submit-key')
    const first = await store.addOccurrence(problem.id, { sessionId: 's1', evidenceRefs: [] }, 'dup-key')
    const second = await store.addOccurrence(problem.id, { sessionId: 's1', evidenceRefs: [] }, 'dup-key')
    expect(second.id).toBe(first.id)
    expect(second.revision).toBe(first.revision)

    const listed = await store.listOccurrences(problem.id)
    expect(listed).toHaveLength(1)
  })

  it('withdrawn occurrences stay stored but stop counting (AT21)', async () => {
    const store = await makeStore()
    const problem = await store.saveProblem({ title: 'P' }, 'k')
    const occurrence = await store.addOccurrence(problem.id, { sessionId: 's1', evidenceRefs: [] }, 'o1')
    const withdrawn = await store.updateOccurrence(occurrence.id, occurrence.revision, (record) => ({
      ...record,
      withdrawn: true,
    }))
    expect(withdrawn.data.withdrawn).toBe(true)
    expect((await store.listOccurrences(problem.id))[0]!.data.withdrawn).toBe(true)
  })
})

describe('DoctorStore atomicity and crash shape (AT37)', () => {
  it('writes through a temp file plus rename: no half-JSON survives', async () => {
    const store = await makeStore()
    await store.saveProblem({ title: 'atomic' }, 'k')
    const files = await readdir(join(roots[0]!, 'feedback', 'problem'))
    expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(1)
    expect(files.every((file) => !file.endsWith('.tmp'))).toBe(true)
  })

  it('a torn tmp file from a simulated crash is ignored, the old version still reads', async () => {
    const store = await makeStore()
    const problem = await store.saveProblem({ title: 'before-crash' }, 'k')
    const file = join(roots[0]!, 'feedback', 'problem', `${problem.id}.json`)
    await writeFile(`${file}.tmp`, '{"schemaVersion":1,"kind":"prob', 'utf8')
    const read = await store.getProblem(problem.id)
    expect(read?.data).toEqual({ title: 'before-crash' })
  })

  it('rejects path-traversal ids', async () => {
    const store = await makeStore()
    await expect(store.saveProblem({ title: 'x' }, '../escape')).rejects.toThrow()
    await expect(store.saveProblem({ title: 'x' }, 'a/b')).rejects.toThrow()
  })
})

describe('DoctorStore report cache (AT37)', () => {
  it('evicts rebuildable cache by LRU capacity but never touches feedback', async () => {
    const store = await makeStore(2500)
    const problem = await store.saveProblem({ title: 'keep me' }, 'k')
    const oneK = 'x'.repeat(1024)
    await store.putReport({ id: 'r1', data: oneK })
    await store.putReport({ id: 'r2', data: oneK })

    // Three 1KiB reports exceed 2.5KiB: the oldest goes, newer ones stay.
    await store.putReport({ id: 'r3', data: oneK })
    expect(await store.getReport('r1')).toBeUndefined()
    expect(await store.getReport('r2')).toBeDefined()
    expect(await store.getReport('r3')).toBeDefined()

    // Feedback survives cache eviction untouched.
    expect((await store.getProblem(problem.id))?.data).toEqual({ title: 'keep me' })
  })

  it('explicit cache clear keeps feedback records', async () => {
    const store = await makeStore()
    const problem = await store.saveProblem({ title: 'labor' }, 'k')
    await store.putReport({ id: 'r1', data: 'cache' })
    await store.clearCache()
    expect(await store.getReport('r1')).toBeUndefined()
    expect(await store.getProblem(problem.id)).toBeDefined()
  })
})

describe('DoctorStore schema lifecycle (AT37)', () => {
  it('refuses an update that first discovers a future schema', async () => {
    const store = await makeStore()
    await store.saveProblem({ title: 'future' }, 'future')
    const file = join(roots[0]!, 'feedback', 'problem', 'future.json')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...raw, schemaVersion: 99 }), 'utf8')
    await expect(store.updateProblem('future', 1, () => ({ title: 'overwrite' })))
      .rejects.toBeInstanceOf(StoreReadOnlyError)
    expect(JSON.parse(await readFile(file, 'utf8')).data.title).toBe('future')
  })

  it('migrates older schemas with a backup, then serves the migrated record', async () => {
    const store = await makeStore()
    await store.saveProblem({ title: 'v1 record' }, 'k')
    await writeFile(
      join(roots[0]!, 'feedback', 'legacy.json'),
      JSON.stringify({ schemaVersion: 0, kind: 'problem', id: 'legacy', revision: 3, data: { title: 'legacy title' }, updatedAt: 1 }),
      'utf8',
    )

    const migrated = await store.getProblem('legacy')
    expect(migrated?.data).toEqual({ title: 'legacy title' })
    expect(migrated?.revision).toBe(3)
    const files = await readdir(join(roots[0]!, 'feedback', 'problem'))
    expect(files.some((name) => name.endsWith('.bak'))).toBe(true)
  })

  it('enters read-only mode when a newer schema appears, refusing writes', async () => {
    const store = await makeStore()
    await store.saveProblem({ title: 'current' }, 'k')
    const file = join(roots[0]!, 'feedback', 'problem', 'k.json')
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    raw['schemaVersion'] = 99
    await writeFile(file, JSON.stringify(raw), 'utf8')

    expect((await store.getProblem('k'))?.data).toEqual({ title: 'current' })
    expect(store.readOnlyReason).toBeDefined()
    await expect(store.saveProblem({ title: 'new' }, 'k2')).rejects.toBeInstanceOf(StoreReadOnlyError)
  })
})
