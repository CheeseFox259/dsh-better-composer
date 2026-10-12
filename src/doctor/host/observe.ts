/**
 * Context Doctor observation of *live* host state (W1). Everything here is a
 * read of already-active bindings: no Agent is started, no capability is
 * probed, no Skill body is loaded (architecture.md §11.1, §14.2, AT33).
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import { standingMountFor, type PresetMount } from '@deepseek-ai/dsh-agent-preset-registry'
import type { VersionRef } from '../contracts.ts'
import { canonicalize, contentHash } from '../versions.ts'

/** `standingMountFor` returns a join-proved mount; the published root exports `PresetMount` only. */
export type ObservedStandingMount = ReturnType<typeof standingMountFor>
const bindings = new WeakMap<object, string>()
let nextBinding = 1

/** Process-local identity of a public mount object, never a durable configuration version. */
export function mountBindingIdentity(mount: PresetMount): string {
  let id = bindings.get(mount.fiber)
  if (id === undefined) { id = `${mount.presetId}:binding-${nextBinding++}`; bindings.set(mount.fiber, id) }
  return id
}

/** The registry methods Doctor observation needs; the full service satisfies this. */
export interface PresetRegistryFace {
  list(): Promise<readonly AgentPreset[]>
}

export interface ObservedModes {
  readonly available: boolean
  readonly reason?: string
  readonly modes: readonly AgentPreset[]
}

/**
 * Read the declared preset roster with activation diagnostics. Used by the
 * mode lens when the user picks a mode that has no eligible samples yet.
 */
export async function observeCurrentModes(registry: PresetRegistryFace | undefined): Promise<ObservedModes> {
  if (registry === undefined) {
    return { available: false, reason: 'agent-presets-unavailable', modes: [] }
  }
  try {
    return { available: true, modes: await registry.list() }
  } catch (error) {
    return { available: false, reason: `registry-list-failed:${(error as Error).message}`, modes: [] }
  }
}

/**
 * The standing composition one live Agent is joined to, when the caller
 * already holds that Agent's context. Agents that joined no preset resolve to
 * undefined — this never starts one.
 */
export function observeStandingMount(agentCtx: Context): ObservedStandingMount {
  return standingMountFor(agentCtx)
}

/**
 * Composition signature of one live mount's active entry rows (A13). This is
 * explicitly NOT a configuration version: module identity and enablement are
 * hashed, not module config bodies, and a preset whose config changed without
 * changing its roster keeps the same signature (architecture.md §6).
 */
export function fingerprintMountTree(mount: PresetMount): string {
  const rows = [...mount.tree.entries()].map((entry) => ({ id: entry.options.id, name: entry.options.name,
    disabled: entry.options.disabled, group: entry.options.group }))
  return contentHash(canonicalize(rows))
}

/**
 * VersionRef for one observed live mount. Coverage is always `partial`: the
 * binding proves a runtime generation inside this process, not a durable
 * configuration version that survives restarts.
 */
export function mountObservationToVersionRef(presetId: string, digest: string, bindingKey: string): VersionRef {
  return {
    kind: 'runtime-config',
    digest,
    coverage: 'partial',
    observedBinding: bindingKey,
    dependencyRefs: [presetId],
  }
}
