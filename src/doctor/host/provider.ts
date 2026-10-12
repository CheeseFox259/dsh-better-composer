import { canonicalize, contentHash } from '../versions.ts'

const BASIC_PROVIDER = '@deepseek-ai/dsh-compaction-basic'
export const DOCTOR_PROVIDER = '@cheesefox/dsh-better-composer/doctor-compaction'

interface PluginRow {
  readonly id?: string
  readonly name?: string
  readonly disabled?: unknown
  readonly group?: boolean
  readonly config?: unknown
}

export interface ConfigEntry {
  readonly options: { readonly id: string; readonly config?: unknown }
}

/** Public ConfigEditor operations; the editor owns persistence and reconciliation. */
export interface DoctorConfigEditor {
  entries(): readonly ConfigEntry[]
  edit(entry: ConfigEntry, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}

export interface ProviderPlan {
  readonly id: string
  readonly modeId: string
  readonly enabled: boolean
  readonly before: string
  readonly after: string
  readonly appliesTo: 'new-agents'
}

function replaceProvider(rows: readonly PluginRow[], from: string, to: string): { rows: PluginRow[]; matches: PluginRow[] } {
  const matches: PluginRow[] = []
  const next = rows.map((row) => {
    if (row.disabled !== true && row.name === from) {
      matches.push(row)
      return { ...row, name: to }
    }
    if (row.group === true && Array.isArray(row.config)) {
      const nested = replaceProvider(row.config, from, to)
      matches.push(...nested.matches)
      return { ...row, config: nested.rows }
    }
    return row
  })
  return { rows: next, matches }
}

/** One-shot, version-bound provider edits. No mode gains a new compaction capability. */
export class DoctorProviderPlans {
  private readonly plans = new Map<string, { plan: ProviderPlan; entry: ConfigEntry; fingerprint: string }>()
  private nextId = 1
  constructor(private readonly editor?: DoctorConfigEditor) {}

  prepare(modeId: string, enabled: boolean): ProviderPlan {
    if (this.editor === undefined) throw new Error('当前宿主不提供配置编辑服务')
    const entry = this.editor.entries().find((item) => (item.options.config as { id?: string } | undefined)?.id === modeId)
    const config = entry?.options.config as { plugins?: PluginRow[] } | undefined
    if (entry === undefined || !Array.isArray(config?.plugins)) throw new Error('模式配置不可编辑')
    const from = enabled ? BASIC_PROVIDER : DOCTOR_PROVIDER
    const to = enabled ? DOCTOR_PROVIDER : BASIC_PROVIDER
    const replacement = replaceProvider(config.plugins, from, to)
    if (replacement.matches.length !== 1) throw new Error('需要恰好一个已启用的兼容压缩提供方；不会为无压缩模式添加压缩')
    const row = replacement.matches[0]!
    const plan: ProviderPlan = {
      id: `provider-plan-${this.nextId++}`, modeId, enabled, appliesTo: 'new-agents',
      before: JSON.stringify({ name: from, config: row.config ?? {} }, null, 2),
      after: JSON.stringify({ name: to, config: row.config ?? {} }, null, 2),
    }
    this.plans.set(plan.id, { plan, entry, fingerprint: contentHash(canonicalize(entry.options.config)) })
    return plan
  }

  async apply(id: string): Promise<void> {
    const prepared = this.plans.get(id)
    if (prepared === undefined || this.editor === undefined) throw new Error('配置计划已失效，请重新预览')
    await this.editor.edit(prepared.entry, (current) => {
      if (contentHash(canonicalize(current)) !== prepared.fingerprint) throw new Error('模式配置已变化，请重新预览')
      const from = prepared.plan.enabled ? BASIC_PROVIDER : DOCTOR_PROVIDER
      const to = prepared.plan.enabled ? DOCTOR_PROVIDER : BASIC_PROVIDER
      const replacement = replaceProvider(current['plugins'] as PluginRow[], from, to)
      if (replacement.matches.length !== 1) throw new Error('压缩提供方已变化')
      return { ...current, plugins: replacement.rows }
    })
    this.plans.delete(id)
  }
}
