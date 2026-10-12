/**
 * W6/W7 tests: the constraint loop — reviewed candidate → confirmed → the
 * compaction provider's input; revocation and supersession drop out (AT25/26).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DoctorRuntime } from '../../src/doctor/host/runtime.ts'

let roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

async function makeRuntime() {
  const root = await mkdtemp(join(tmpdir(), 'doctor-constraints-'))
  roots.push(root)
  return DoctorRuntime.isolated(root, {})
}

describe('constraint loop', () => {
  it('does not carry a session requirement into a different session', async () => {
    const runtime = await makeRuntime()
    await runtime.saveConstraint({ id: 'scoped', originalText: 'design only', normalizedRequirement: 'design only', conditions: [], exceptions: [], sourceRefs: ['a:1'], scope: { kind: 'session', sessionId: 'a' } })
    expect(await runtime.activeConstraints({ sessionId: 'b' })).toEqual([])
    expect((await runtime.activeConstraints({ sessionId: 'a' }))[0]?.id).toBe('scoped')
    expect((await runtime.constraints())[0]?.data['sourceRefs']).toEqual(['a:1'])
  })

  it('a reviewed candidate becomes the provider input; revoke drops it out', async () => {
    const runtime = await makeRuntime()

    // Nothing confirmed yet: provider input is empty (base behavior untouched).
    expect(await runtime.activeConstraints()).toEqual([])

    const saved = await runtime.saveConstraint({
      id: 'constraint-test-env',
      originalText: '本轮只设计，不实现',
      normalizedRequirement: '本轮只做设计；代码开发需用户新的明确授权',
      conditions: ['用户明确下达开发指令'],
      exceptions: [],
    })
    expect(saved.revision).toBe(1)

    const active = await runtime.activeConstraints()
    expect(active).toHaveLength(1)
    expect(active[0]!.revision).toBe(1)
    expect(active[0]!.normalizedRequirement).toContain('新的明确授权')

    // Revoke: optimistic revision guard, then the provider input empties.
    await runtime.updateConstraint({
      id: 'constraint-test-env',
      expectedRevision: 1,
      patch: { status: 'revoked' },
    })
    expect(await runtime.activeConstraints()).toEqual([])
    const listed = await runtime.constraints()
    expect(listed[0]!.data['status']).toBe('revoked') // history preserved
  })

  it('duplicate confirmation is idempotent and concurrent edits conflict (AT36)', async () => {
    const runtime = await makeRuntime()
    const first = await runtime.saveConstraint({
      id: 'c1', originalText: 'a', normalizedRequirement: 'b', conditions: [], exceptions: [],
    })
    const again = await runtime.saveConstraint({
      id: 'c1', originalText: 'a', normalizedRequirement: 'b', conditions: [], exceptions: [],
    })
    expect(again.revision).toBe(first.revision)

    await runtime.updateConstraint({ id: 'c1', expectedRevision: 1, patch: { status: 'superseded' } })
    await expect(
      runtime.updateConstraint({ id: 'c1', expectedRevision: 1, patch: { status: 'active' } }),
    ).rejects.toThrow(/conflict/i)
  })

  it('the provider reads only the newest revision per constraint', async () => {
    const runtime = await makeRuntime()
    await runtime.saveConstraint({
      id: 'c1', originalText: '旧理解', normalizedRequirement: '旧要求', conditions: [], exceptions: [],
    })
    // Edit normalizes the requirement; revision bumps; provider sees v2 only.
    const current = await runtime.constraints()
    await runtime.updateConstraint({
      id: 'c1',
      expectedRevision: current[0]!.revision,
      patch: { normalizedRequirement: '纠正后的要求' },
    })
    const active = await runtime.activeConstraints()
    expect(active).toHaveLength(1)
    expect(active[0]!.revision).toBe(2)
    expect(active[0]!.normalizedRequirement).toBe('纠正后的要求')
  })

  it('execution receipts accumulate for the task-record view', async () => {
    const runtime = await makeRuntime()
    runtime.recordReceipt({
      operationStatus: 'enhanced-summary-complete',
      appliedConstraintRevisions: [{ id: 'c1', revision: 2 }],
      alreadyRetainedIds: [],
    })
    expect(runtime.executionReceipts()).toHaveLength(1)
    expect(runtime.executionReceipts()[0]!.operationStatus).toBe('enhanced-summary-complete')
  })
})
