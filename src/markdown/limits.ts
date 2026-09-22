/** Fixed work bounds for optional local presentation scans. */
export const MAX_SYNC_PROJECTION_LENGTH = 50_000

/** Maximum draft length for synchronous live code-token presentation. */
export const MAX_LIVE_CODE_TOKEN_LENGTH = 4_096

/** Maximum ordinary text scanned by one optional diagnostics or assistance pass. */
export const MAX_OPTIONAL_SCAN_LENGTH = 50_000

/** Maximum prefix inspected when proving Markdown completion ownership. */
export const MAX_COMPLETION_SCAN_LENGTH = 32_000

/** Maximum derived projections retained by one provider instance. */
export const MAX_PROJECTION_CACHE_ENTRIES = 4

/** Do not retain large AST projections across a single render. Raised to the
 * sync-paint bound so steady-state collects (cursor moves repaint the same
 * draft) hit the cache instead of re-parsing tens of thousands of chars. */
export const MAX_CACHED_PROJECTION_LENGTH = 50_000

/** Diagnostics cache bound: range arrays only, far lighter than AST projections. */
export const MAX_CACHED_DIAGNOSTICS_LENGTH = 60_000
