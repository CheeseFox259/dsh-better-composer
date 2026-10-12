import { describe, expect, it } from 'vitest'
import { DoctorProviderPlans, DOCTOR_PROVIDER } from '../../src/doctor/host/provider.ts'

describe('explicit mode provider configuration', () => {
  it('previews and replaces only the existing provider while retaining its settings and every other row', async () => {
    const original = { id: 'standard', plugins: [{ id: 'compact', name: '@deepseek-ai/dsh-compaction-basic', config: { auto: true, maxTokens: 3333 } }, { id: 'other', name: 'other' }] }
    const entry = { options: { id: 'preset-standard', config: original } }
    const plans = new DoctorProviderPlans({ entries: () => [entry], async edit(_entry, change) { entry.options.config = change(entry.options.config, {}) as typeof original } })
    const plan = plans.prepare('standard', true)
    expect(entry.options.config).toEqual(original)
    expect(plan.appliesTo).toBe('new-agents')
    await plans.apply(plan.id)
    expect(entry.options.config.plugins).toEqual([{ ...original.plugins[0], name: DOCTOR_PROVIDER }, original.plugins[1]])
    await plans.apply(plans.prepare('standard', false).id)
    expect(entry.options.config).toEqual(original)
  })

  it('rejects a stale preview and a mode without compaction', async () => {
    const entry = { options: { id: 'preset', config: { id: 'm', plugins: [{ name: '@deepseek-ai/dsh-compaction-basic', config: { maxTokens: 3000 } }] } } }
    const plans = new DoctorProviderPlans({ entries: () => [entry], async edit(_entry, change) { entry.options.config = change(entry.options.config, {}) as typeof entry.options.config } })
    const plan = plans.prepare('m', true)
    entry.options.config.plugins[0]!.config.maxTokens = 4000
    await expect(plans.apply(plan.id)).rejects.toThrow('已变化')
    entry.options.config.plugins = []
    expect(() => plans.prepare('m', true)).toThrow('不会为无压缩模式添加')
  })
})
