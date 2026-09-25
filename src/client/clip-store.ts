import { DEFAULT_PASTE_FILE_EXTENSION, normalizePasteFileExtension, type PasteFileExtension } from '../file-extensions.ts'

/** Delivery mode of one stored pasted-text clip. */
export type ClipMode = 'inline' | 'file'

/** One stored pasted-text clip. */
export interface ClipEntry {
  readonly id: string
  readonly text: string
  readonly mode: ClipMode
  readonly createdAt: number
  /** Workspace cwd captured at creation; file-mode delivery materializes under it. */
  readonly cwd: string
  /** Extension selected when this clip was created. */
  readonly fileExtension: PasteFileExtension
}

/** Persistence bridge supplied by the Remote wiring; both are fire-safe. */
export interface ClipPersistence {
  readonly store: (entry: ClipEntry) => void
  readonly load: (id: string) => Promise<Pick<ClipEntry, 'text' | 'mode' | 'createdAt' | 'cwd' | 'fileExtension'> | undefined>
}

/**
 * Session-local clip table with Remote-backed persistence. Memory is the hot
 * path (submit serialization must answer from the current page); persistence
 * is the reload fallback.
 */
export class ClipStore {
  private readonly entries = new Map<string, ClipEntry>()
  private sequence = 0

  constructor(private readonly persistence: ClipPersistence) {}

  /** Store one freshly detected paste and return its entry. */
  create(text: string, cwd = '', fileExtension: PasteFileExtension = DEFAULT_PASTE_FILE_EXTENSION, persist = true): ClipEntry {
    this.sequence += 1
    const entry: ClipEntry = {
      id: `clip-${Date.now().toString(36)}-${this.sequence}`,
      text,
      mode: 'inline',
      createdAt: Date.now(),
      cwd,
      fileExtension,
    }
    this.entries.set(entry.id, entry)
    if (persist) this.persistence.store(entry)
    return entry
  }

  /** Persist a previously created entry after its reference insertion succeeds. */
  persist(entry: ClipEntry): void {
    if (this.entries.get(entry.id) === entry) this.persistence.store(entry)
  }

  /** The in-memory entry, when the clip was created by this page. */
  get(id: string): ClipEntry | undefined {
    return this.entries.get(id)
  }

  /** Resolve clip text, falling back to the persisted copy after a reload. */
  async resolve(id: string): Promise<ClipEntry | undefined> {
    const cached = this.entries.get(id)
    if (cached !== undefined) return cached
    const persisted = await this.persistence.load(id)
    if (persisted === undefined) return undefined
    const entry: ClipEntry = { id, ...persisted, fileExtension: normalizePasteFileExtension(persisted.fileExtension) }
    this.entries.set(id, entry)
    return entry
  }

  /** Update the text (sidebar edits) and re-persist. */
  update(id: string, text: string): ClipEntry | undefined {
    const current = this.entries.get(id)
    if (current === undefined) return undefined
    const next: ClipEntry = { ...current, text }
    this.entries.set(id, next)
    this.persistence.store(next)
    return next
  }

  /** Switch the delivery mode and re-persist. */
  setMode(id: string, mode: ClipMode): ClipEntry | undefined {
    const current = this.entries.get(id)
    if (current === undefined) return undefined
    const next: ClipEntry = { ...current, mode }
    this.entries.set(id, next)
    this.persistence.store(next)
    return next
  }

  /** Switch the workspace file extension and re-persist. */
  setFileExtension(id: string, fileExtension: PasteFileExtension): ClipEntry | undefined {
    const current = this.entries.get(id)
    if (current === undefined) return undefined
    const next: ClipEntry = { ...current, fileExtension: normalizePasteFileExtension(fileExtension) }
    this.entries.set(id, next)
    this.persistence.store(next)
    return next
  }
}
