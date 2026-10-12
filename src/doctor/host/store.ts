/**
 * Context Doctor durable store (W3). Host-plugin directory storage per
 * architecture.md §14.3: a single-process serial write queue, temp file plus
 * atomic rename, path-traversal-proof ids, LRU eviction that touches only
 * rebuildable caches, and schema versioning that migrates older records with
 * a backup while refusing writes against newer ones.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DOCTOR_SCHEMA_VERSION = 1
const DEFAULT_MAX_CACHE_BYTES = 256 * 1024 * 1024

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export class StoreConflictError extends Error {
  constructor(readonly objectId: string, readonly expectedRevision: number, readonly actualRevision: number) {
    super(`revision conflict for ${objectId}: expected ${expectedRevision}, found ${actualRevision}`)
  }
}

export class StoreReadOnlyError extends Error {
  constructor(readonly reason: string) {
    super(`doctor store is read-only: ${reason}`)
  }
}

interface Envelope<T> {
  readonly schemaVersion: number
  readonly kind: 'problem' | 'occurrence' | 'report' | 'session-index' | 'constraint'
  readonly id: string
  readonly revision: number
  readonly data: T
  readonly updatedAt: number
}

interface CacheEntry {
  readonly id: string
  readonly bytes: number
  readonly lastAccess: number
}

export interface StoreOptions {
  readonly maxCacheBytes?: number
  readonly now?: () => number
}

/**
 * File-backed store under one root directory. `feedback/` holds user labor
 * (problems, occurrences, constraints) and is never evicted; `cache/` holds
 * rebuildable reports and per-session indexes under an LRU byte budget.
 */
export class DoctorStore {
  private readonly root: string
  private readonly maxCacheBytes: number
  private readonly now: () => number
  private queue: Promise<unknown> = Promise.resolve()
  private readonly cacheAccess = new Map<string, CacheEntry>()
  readOnlyReason: string | undefined

  constructor(root: string, options: StoreOptions = {}) {
    this.root = root
    this.maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES
    this.now = options.now ?? (() => Date.now())
  }

  private async enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private assertWritable(): void {
    if (this.readOnlyReason !== undefined) throw new StoreReadOnlyError(this.readOnlyReason)
  }

  private assertId(id: string): void {
    if (!ID_PATTERN.test(id)) throw new Error(`invalid doctor store id ${JSON.stringify(id)}`)
  }

  private dir(kind: Envelope<unknown>['kind']): string {
    switch (kind) {
      case 'problem':
      case 'occurrence':
      case 'constraint':
        return join(this.root, 'feedback', kind)
      case 'report':
      case 'session-index':
        return join(this.root, 'cache')
    }
  }

  private async pathFor(kind: Envelope<unknown>['kind'], id: string): Promise<string> {
    this.assertId(id)
    const directory = this.dir(kind)
    await mkdir(directory, { recursive: true })
    return join(directory, `${id}.json`)
  }

  private async writeEnvelope<T>(kind: Envelope<T>['kind'], envelope: Envelope<T>): Promise<void> {
    this.assertWritable()
    const file = await this.pathFor(kind, envelope.id)
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(envelope), 'utf8')
    await rename(tmp, file)
  }

  private async readEnvelope<T>(kind: Envelope<T>['kind'], id: string): Promise<Envelope<T> | undefined> {
    this.assertId(id)
    let raw: string
    try {
      raw = await readFile(join(this.dir(kind), `${id}.json`), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (kind === 'report' || kind === 'session-index') return undefined
      try {
        raw = await readFile(join(this.root, 'feedback', `${id}.json`), 'utf8')
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError
        return undefined
      }
    }
    const parsed = JSON.parse(raw) as Envelope<T>
    if (parsed.schemaVersion > DOCTOR_SCHEMA_VERSION) {
      this.readOnlyReason = `future-schema:${parsed.schemaVersion}`
    }
    return parsed.kind === kind ? parsed : undefined
  }

  /** Migrate an older envelope in place, keeping a one-time backup. */
  private async migrate<T>(kind: Envelope<T>['kind'], envelope: Envelope<T>): Promise<Envelope<T>> {
    if (envelope.schemaVersion >= DOCTOR_SCHEMA_VERSION) return envelope
    const file = await this.pathFor(kind, envelope.id)
    const upgraded: Envelope<T> = { ...envelope, schemaVersion: DOCTOR_SCHEMA_VERSION }
    await writeFile(`${file}.bak`, JSON.stringify(envelope), 'utf8')
    await this.writeEnvelope(kind, upgraded)
    return upgraded
  }

  // ---- Feedback records (user labor; never evicted) ----

  async saveProblem(data: Record<string, unknown>, id: string): Promise<{ readonly id: string; readonly revision: number }> {
    this.assertWritable()
    return this.enqueue(async () => {
      const existing = await this.readEnvelope<Record<string, unknown>>('problem', id)
      if (existing !== undefined) return { id, revision: existing.revision }
      await this.writeEnvelope('problem', {
        schemaVersion: DOCTOR_SCHEMA_VERSION,
        kind: 'problem',
        id,
        revision: 1,
        data,
        updatedAt: this.now(),
      })
      return { id, revision: 1 }
    })
  }

  async getProblem(id: string): Promise<Envelope<Record<string, unknown>> | undefined> {
    const envelope = await this.readEnvelope<Record<string, unknown>>('problem', id)
    if (envelope === undefined) return undefined
    return this.migrate('problem', envelope)
  }

  async updateProblem(
    id: string,
    expectedRevision: number,
    mutate: (data: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Envelope<Record<string, unknown>>> {
    this.assertWritable()
    return this.enqueue(async () => {
      const envelope = await this.readEnvelope<Record<string, unknown>>('problem', id)
      if (envelope === undefined) throw new Error(`unknown problem ${id}`)
      const current = await this.migrate('problem', envelope)
      if (current.revision !== expectedRevision) {
        throw new StoreConflictError(id, expectedRevision, current.revision)
      }
      const next: Envelope<Record<string, unknown>> = {
        ...current,
        revision: current.revision + 1,
        data: mutate(current.data),
        updatedAt: this.now(),
      }
      await this.writeEnvelope('problem', next)
      return next
    })
  }

  async listProblems(): Promise<Envelope<Record<string, unknown>>[]> {
    return this.listEnvelopes('problem')
  }

  async addOccurrence(
    problemId: string,
    data: Record<string, unknown>,
    id: string,
  ): Promise<Envelope<Record<string, unknown>>> {
    this.assertWritable()
    return this.enqueue(async () => {
      const existing = await this.readEnvelope<Record<string, unknown>>('occurrence', id)
      if (existing !== undefined) return existing
      const envelope: Envelope<Record<string, unknown>> = {
        schemaVersion: DOCTOR_SCHEMA_VERSION,
        kind: 'occurrence',
        id,
        revision: 1,
        data: { ...data, problemId },
        updatedAt: this.now(),
      }
      await this.writeEnvelope('occurrence', envelope)
      return envelope
    })
  }

  async updateOccurrence(
    id: string,
    expectedRevision: number,
    mutate: (data: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Envelope<Record<string, unknown>>> {
    this.assertWritable()
    return this.enqueue(async () => {
      const envelope = await this.readEnvelope<Record<string, unknown>>('occurrence', id)
      if (envelope === undefined) throw new Error(`unknown occurrence ${id}`)
      const current = await this.migrate('occurrence', envelope)
      if (current.revision !== expectedRevision) {
        throw new StoreConflictError(id, expectedRevision, current.revision)
      }
      const next: Envelope<Record<string, unknown>> = {
        ...current,
        revision: current.revision + 1,
        data: mutate(current.data),
        updatedAt: this.now(),
      }
      await this.writeEnvelope('occurrence', next)
      return next
    })
  }

  async listOccurrences(problemId: string): Promise<Envelope<Record<string, unknown>>[]> {
    const all = await this.listEnvelopes('occurrence')
    return all.filter((envelope) => envelope.data['problemId'] === problemId)
  }

  // ---- Constraints (confirmed requirements; the compaction provider reads these) ----

  async saveConstraint(data: Record<string, unknown>, id: string): Promise<{ readonly id: string; readonly revision: number }> {
    this.assertWritable()
    return this.enqueue(async () => {
      const existing = await this.readEnvelope<Record<string, unknown>>('constraint', id)
      if (existing !== undefined) return { id, revision: existing.revision }
      await this.writeEnvelope('constraint', {
        schemaVersion: DOCTOR_SCHEMA_VERSION,
        kind: 'constraint',
        id,
        revision: 1,
        data,
        updatedAt: this.now(),
      })
      return { id, revision: 1 }
    })
  }

  async getConstraint(id: string): Promise<Envelope<Record<string, unknown>> | undefined> {
    const envelope = await this.readEnvelope<Record<string, unknown>>('constraint', id)
    if (envelope === undefined) return undefined
    return this.migrate('constraint', envelope)
  }

  async updateConstraint(
    id: string,
    expectedRevision: number,
    mutate: (data: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Envelope<Record<string, unknown>>> {
    this.assertWritable()
    return this.enqueue(async () => {
      const envelope = await this.readEnvelope<Record<string, unknown>>('constraint', id)
      if (envelope === undefined) throw new Error(`unknown constraint ${id}`)
      const current = await this.migrate('constraint', envelope)
      if (current.revision !== expectedRevision) {
        throw new StoreConflictError(id, expectedRevision, current.revision)
      }
      const next: Envelope<Record<string, unknown>> = {
        ...current,
        revision: current.revision + 1,
        data: mutate(current.data),
        updatedAt: this.now(),
      }
      await this.writeEnvelope('constraint', next)
      return next
    })
  }

  async listConstraints(): Promise<Envelope<Record<string, unknown>>[]> {
    return this.listEnvelopes('constraint')
  }

  private async listEnvelopes(kind: Envelope<unknown>['kind']): Promise<Envelope<Record<string, unknown>>[]> {
    const { readdir } = await import('node:fs/promises')
    const directories = kind === 'report' || kind === 'session-index'
      ? [this.dir(kind)] : [this.dir(kind), join(this.root, 'feedback')]
    const names = new Set<string>()
    for (const directory of directories) {
      try {
        for (const name of await readdir(directory)) names.add(name)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const out: Envelope<Record<string, unknown>>[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const envelope = await this.readEnvelope<Record<string, unknown>>(kind, name.slice(0, -'.json'.length))
      if (envelope !== undefined) out.push(await this.migrate(kind, envelope))
    }
    return out
  }

  // ---- Rebuildable cache (LRU-bounded) ----

  async putReport(report: { readonly id: string; readonly data: unknown }): Promise<void> {
    this.assertWritable()
    await this.enqueue(async () => {
      const serialized = JSON.stringify(report.data)
      await this.writeEnvelope('report', {
        schemaVersion: DOCTOR_SCHEMA_VERSION,
        kind: 'report',
        id: report.id,
        revision: 1,
        data: { serialized },
        updatedAt: this.now(),
      })
      this.cacheAccess.set(report.id, { id: report.id, bytes: serialized.length, lastAccess: this.now() })
      await this.evictIfNeeded()
    })
  }

  async getReport(id: string): Promise<unknown | undefined> {
    const envelope = await this.readEnvelope<{ serialized: string }>('report', id)
    if (envelope === undefined) return undefined
    const entry = this.cacheAccess.get(id)
    if (entry !== undefined) this.cacheAccess.set(id, { ...entry, lastAccess: this.now() })
    return JSON.parse(envelope.data.serialized) as unknown
  }

  async clearCache(): Promise<void> {
    this.assertWritable()
    await this.enqueue(async () => {
      const directory = this.dir('report')
      const { readdir } = await import('node:fs/promises')
      let names: string[]
      try {
        names = await readdir(directory)
      } catch {
        return
      }
      for (const name of names) {
        if (name.endsWith('.json')) await rm(join(directory, name), { force: true })
      }
      this.cacheAccess.clear()
    })
  }

  private async evictIfNeeded(): Promise<void> {
    const total = [...this.cacheAccess.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    if (total <= this.maxCacheBytes) return
    const byAge = [...this.cacheAccess.values()].sort((left, right) => left.lastAccess - right.lastAccess)
    for (const entry of byAge) {
      if ([...this.cacheAccess.values()].reduce((sum, item) => sum + item.bytes, 0) <= this.maxCacheBytes) break
      const { readdir } = await import('node:fs/promises')
      void readdir
      await rm(join(this.dir('report'), `${entry.id}.json`), { force: true })
      this.cacheAccess.delete(entry.id)
    }
  }
}
