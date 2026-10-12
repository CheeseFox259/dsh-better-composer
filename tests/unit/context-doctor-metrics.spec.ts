/**
 * W2 metric tests built from the acceptance worked examples (AT01–AT11,
 * E1/E4/E5). Every expectation comes from docs/context-doctor/acceptance.md
 * or metrics.md §5 — never from the implementation.
 *
 * Candidate 4: assertions go through structured computeSessionMetrics output.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assistantMessageEvent,
  compactionReplacementEvent,
  fixtureCallId,
  requestHeaderEvent,
  skillCatalogEvent,
  skillInvocationEvent,
  snapshotOf,
  systemMessageEvent,
  toolCallEvent,
  toolResultEvent,
  userMessageEvent,
} from '../helpers/doctor-events.ts'
import {
  attributeMcpServer,
  buildSessionView,
  computeSessionMetrics,
  issueContribution,
  type SessionView,
} from '../../src/doctor/metrics.ts'

describe('request input and real tool contracts', () => {
  it('counts only the input that existed before each assistant response, including before later compaction', () => {
    const events = [userMessageEvent(0, 0, 'hi'), assistantMessageEvent(1, 0, 0, 'answer')]
    expect(computeSessionMetrics(buildSessionView(snapshotOf(events))).carrying.cumulativeCarry.value).toBe(2)
    const compacted = [...events, compactionReplacementEvent(2, 1, 0, 0, 1, 'S'), userMessageEvent(3, 1, 'x'), assistantMessageEvent(4, 1, 0, 'y')]
    expect(computeSessionMetrics(buildSessionView(snapshotOf(compacted))).carrying.cumulativeCarry.value).toBe(4)
  })

  it('assigns ordinary tool results to tools and reads published flat tool names', () => {
    const callId = fixtureCallId()
    const events = [
      requestHeaderEvent(0, { tools: [{ name: 'shell', description: 'Shell', parameters: { type: 'object' } }] } as never, 'initial' as never),
      toolCallEvent(1, 0, 0, callId, 'shell', {}),
      toolResultEvent(2, 0, 0, callId, 'stdout'),
      assistantMessageEvent(3, 0, 1, 'done'),
    ]
    const view = buildSessionView(snapshotOf(events))
    expect(view.toolDefinitions[0]?.name).toBe('shell')
    const metrics = computeSessionMetrics(view)
    expect(metrics.composition.buckets.find((row) => row.bucket === 'tool-result')?.bytes).toBe(6)
    expect(metrics.composition.buckets.some((row) => row.bucket === 'skill-body')).toBe(false)
  })
})

function viewOf(events: SessionEvent[], inheritedEventCount = 0): SessionView {
  return buildSessionView(snapshotOf(events, inheritedEventCount))
}

function toolSchema(name: string) {
  return {
    name, description: `${name} tool`, parameters: { type: 'object', properties: {} },
  }
}

describe('C02 composition buckets (AT01/E1, AT02)', () => {
  it('places skill body arriving via tool result in the skill-body bucket, role tool, counted once', () => {
    const callId = fixtureCallId()
    const view = viewOf([
      systemMessageEvent(0, 0, 0, 'sys'),
      userMessageEvent(1, 0, 'use the skill'),
      toolCallEvent(2, 0, 0, callId, 'skill', { name: 'reviewer' }),
      toolResultEvent(3, 0, 0, callId, 'SKILL BODY TEXT', undefined, 2),
      assistantMessageEvent(4, 0, 0, 'ok'),
    ])
    const skillBlocks = view.blocks.filter((block) => block.bucket === 'skill-body')
    expect(skillBlocks).toHaveLength(1)
    expect(skillBlocks[0]!.role).toBe('tool')

    const { buckets } = computeSessionMetrics(view).composition
    const total = buckets.reduce((sum, bucket) => sum + bucket.bytes, 0)
    const skillBytes = buckets.find((bucket) => bucket.bucket === 'skill-body')!.bytes
    // Counted exactly once: role view and purpose view never add up (AT02).
    expect(skillBytes).toBe(Buffer.byteLength('SKILL BODY TEXT'))
    expect(total).toBe(Buffer.byteLength('sysuse the skillSKILL BODY TEXTok'))
  })

  it('E1: duplicate contribution combines per-bucket shares = 10%', () => {
    // 40k tool-result with 8k extra copies; 10k skill-body with 2k extra.
    const contribution = issueContribution({
      bucketBytes: { 'tool-result': 40_000, 'skill-body': 10_000, 'message': 50_000 },
      issueBytesByBucket: { 'tool-result': 8_000, 'skill-body': 2_000 },
    })
    expect(contribution).toBeCloseTo(0.1, 10)
  })

  it('AT04: a tiny critical bucket is not diluted by big duplicate buckets', () => {
    const contribution = issueContribution({
      bucketBytes: { 'tool-result': 999_960, 'message': 40 },
      issueBytesByBucket: { 'message': 40 },
    })
    // The small issue keeps its own independent line: 40 bytes = 0.004%,
    // listed as a critical-item issue, never averaged away.
    expect(contribution).toBeCloseTo(0.00004, 10)
  })
})

describe('C05 exact duplicates (AT01) and precomputed issues', () => {
  it('counts only the 2nd+ identical instance within the latest request input and precomputes proxy issue', () => {
    const repeated = 'x'.repeat(100)
    const view = viewOf([
      userMessageEvent(0, 0, repeated),
      assistantMessageEvent(1, 0, 0, repeated), // exact copy of user text
      userMessageEvent(2, 1, 'tail'),
      assistantMessageEvent(3, 1, 1, 'answer'),
    ])
    // Latest request input = 100+100+4 bytes; one extra
    // copy of `repeated`.
    const metrics = computeSessionMetrics(view)
    const metric = metrics.composition.exactDuplicates
    expect(metric.numerator).toBe(100)
    expect(metric.denominator).toBe(204)
    expect(metric.value).toBeCloseTo(100 / 204, 10)

    const proxyIssue = metrics.issues.find((issue) => issue.kind === 'proxy')
    expect(proxyIssue).toBeDefined()
    expect(proxyIssue!.text).toContain('额外精确副本 100 bytes')
  })
})

describe('C01 observed usage vs estimates (AT03)', () => {
  it('reports the provider subtotal independently; estimates stay a separate method', () => {
    const view = viewOf([
      userMessageEvent(0, 0, 'hi'),
      assistantMessageEvent(1, 0, 0, 'a', { inputTokens: 40_000, outputTokens: 2_800, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      userMessageEvent(2, 1, 'more'),
      assistantMessageEvent(3, 1, 1, 'b', { inputTokens: 2_000, outputTokens: 1_000, cacheReadTokens: 800, cacheWriteTokens: 0 }),
    ])
    const metrics = computeSessionMetrics(view)
    const metric = metrics.composition.observedUsage
    // 42.8k reported input tokens — never rescaled to match an estimate.
    expect(metric.value).toBe(42_800)
    expect(metric.unit).toBe('observed-tokens')
    expect(metric.observedCount).toBe(2)
    expect(metric.eligibleCount).toBe(2)

    const cache = metrics.carrying.cacheReadRatio
    expect(cache.numerator).toBe(800)
    expect(cache.denominator).toBe(42_800)
    expect(cache.value).toBeCloseTo(800 / 42_800, 10)
  })

  it('missing usage is not zero-filled (AT07 basis)', () => {
    const view = viewOf([
      userMessageEvent(0, 0, 'hi'),
      assistantMessageEvent(1, 0, 0, 'a', { inputTokens: 100, outputTokens: 10 }),
      userMessageEvent(2, 1, 'more'),
      assistantMessageEvent(3, 1, 1, 'b'), // usage not reported
    ])
    const metric = computeSessionMetrics(view).composition.observedUsage
    expect(metric.value).toBe(100)
    expect(metric.observedCount).toBe(1)
    expect(metric.eligibleCount).toBe(2)
    expect(metric.missingReasons).toContain('usage-not-reported')
  })
})

describe('C03 add/remove and C04 carry (E4)', () => {
  it('counts net block-instance change between adjacent requests', () => {
    const view = viewOf([
      systemMessageEvent(0, 0, 0, 'sys'),
      userMessageEvent(1, 0, 'a'.repeat(100)),
      assistantMessageEvent(2, 0, 0, 'r1'),
      userMessageEvent(3, 1, 'b'.repeat(50)),
      assistantMessageEvent(4, 1, 1, 'r2'),
    ])
    const metric = computeSessionMetrics(view).carrying.addRemove
    // Growth = previous assistant response ('r1', 2) + new user message (50).
    expect(metric.numerator).toBe(52)
    expect(metric.value).toBe(52)
  })

  it('E4: fork carry counts inherited content in the child own requests, execution stays separate', () => {
    const inherited: SessionEvent[] = [
      userMessageEvent(0, 0, 'p'.repeat(1000)),
      assistantMessageEvent(1, 0, 0, 'pa', { inputTokens: 1000, outputTokens: 0 }),
    ]
    const own: SessionEvent[] = [
      userMessageEvent(2, 1, 'c'.repeat(2000)),
      assistantMessageEvent(3, 1, 1, 'ca', { inputTokens: 3000, outputTokens: 0 }),
    ]
    // Child view over own interval only: its single request carries the
    // inherited prefix (1000 + 2) plus own input (2000) = 3002 bytes.
    const view = viewOf([...inherited, ...own], 2)
    const metrics = computeSessionMetrics(view)
    const carry = metrics.carrying.cumulativeCarry
    expect(carry.value).toBe(3002)
    // Execution ledger: only the child's own usage (3000), never 9000.
    const usage = metrics.composition.observedUsage
    expect(usage.value).toBe(3000)
  })
})

describe('C06 repeated tool results', () => {
  it('counts distinct calls producing identical result text', () => {
    const first = fixtureCallId()
    const second = fixtureCallId()
    const view = viewOf([
      userMessageEvent(0, 0, 'run twice'),
      toolCallEvent(1, 0, 0, first, 'read_file', { path: 'a' }),
      toolResultEvent(2, 0, 0, first, 'same content', undefined, 1),
      toolCallEvent(3, 0, 1, second, 'read_file', { path: 'a' }),
      toolResultEvent(4, 0, 1, second, 'same content', undefined, 3),
      assistantMessageEvent(5, 0, 2, 'done'),
    ])
    const metrics = computeSessionMetrics(view)
    const c06 = metrics.composition.repeatedToolResults
    expect(c06.value).toBe(1)
  })
})

describe('C10 pairing and precomputed structural issues', () => {
  it('pairs by callId, lists pending and orphans separately and precomputes issue', () => {
    const ok = fixtureCallId()
    const pending = fixtureCallId()
    const orphan = fixtureCallId()
    const view = viewOf([
      userMessageEvent(0, 0, 'go'),
      toolCallEvent(1, 0, 0, ok, 'a', {}),
      toolResultEvent(2, 0, 0, ok, 'fine', undefined, 1),
      toolCallEvent(3, 0, 1, pending, 'b', {}),
      toolResultEvent(4, 0, 2, orphan, 'lost', undefined, 99),
      assistantMessageEvent(5, 0, 3, 'done'),
    ])
    const metrics = computeSessionMetrics(view)
    const metric = metrics.tools.pairing
    expect(metric.numerator).toBe(1)
    expect(metric.denominator).toBe(2)
    expect(metric.warnings).toContain('pending-at-cutoff')
    expect(metric.warnings!.some((warning) => warning.startsWith('orphan-results:'))).toBe(true)

    const structuralIssue = metrics.issues.find((issue) => issue.kind === 'structural')
    expect(structuralIssue).toBeDefined()
    expect(structuralIssue!.text).toBe('存在未配对的工具结果')
  })
})

describe('C12 compaction change (E7)', () => {
  it('reports before/after byte change and lists the retained suffix apart', () => {
    const view = viewOf([
      systemMessageEvent(0, 0, 0, 'sys'),
      userMessageEvent(1, 0, 'a'.repeat(1000)),
      assistantMessageEvent(2, 0, 0, 'b'.repeat(500)),
      compactionReplacementEvent(3, 1, 0, 1, 2, 's'.repeat(200)),
      userMessageEvent(4, 1, 'next'),
      assistantMessageEvent(5, 1, 1, 'answer'),
    ])
    const metric = computeSessionMetrics(view).carrying.compactionChange
    // 1 - 200/1500
    expect(metric.value).toBeCloseTo(1 - 200 / 1500, 10)
    // Retained suffix = final-surface nodes after the replacement node
    // (system head precedes the replaced region and is not part of the suffix).
    expect(view.compactions[0]!.retainedBytes)
      .toBe(Buffer.byteLength('next') + Buffer.byteLength('answer'))
  })
})

describe('C14 capability changes', () => {
  it('locates header positions where the visible tool set changed', () => {
    const view = viewOf([
      requestHeaderEvent(0, { config: { provider: 'p', model: 'm' }, tools: [toolSchema('a')] }, 'initial'),
      userMessageEvent(1, 0, 'hi'),
      assistantMessageEvent(2, 0, 0, 'r1'),
      requestHeaderEvent(3, { config: { provider: 'p', model: 'm' }, tools: [toolSchema('a'), toolSchema('b')] }, 'change'),
      userMessageEvent(4, 1, 'more'),
      assistantMessageEvent(5, 1, 1, 'r2'),
    ])
    const metric = computeSessionMetrics(view).carrying.capabilityChanges
    expect(metric.value).toBe(1)
    expect(metric.sourceRefs![0]!.seq).toBe(3)
  })
})

describe('Tool metrics (AT06, AT08/E5, AT07)', () => {
  it('T04: structured failure and success are distinct; unknown stays unknown', () => {
    const fail = fixtureCallId()
    const ok = fixtureCallId()
    const view = viewOf([
      userMessageEvent(0, 0, 'go'),
      toolCallEvent(1, 0, 0, fail, 'deploy', {}),
      toolResultEvent(2, 0, 0, fail, 'boom', { name: 'HarnessError', code: 'E_DEPLOY' }, 1),
      toolCallEvent(3, 0, 1, ok, 'deploy', {}),
      toolResultEvent(4, 0, 1, ok, 'ok', undefined, 3),
      assistantMessageEvent(5, 0, 2, 'done'),
    ])
    const rows = computeSessionMetrics(view).tools.status
    const deploy = rows.find((row) => row.name === 'deploy')!
    expect(deploy.error).toBe(1)
    expect(deploy.success).toBe(1)
    expect(deploy.unknown).toBe(0)
  })

  it('T08/E5: run_code entry calls and SDK subcalls are separate ledgers (8/12 read share)', () => {
    const events: SessionEvent[] = [userMessageEvent(0, 0, 'go')]
    let seq = 1
    const readSubCalls = 8
    const writeSubCalls = 4
    for (let call = 0; call < 3; call += 1) {
      const rootCallId = fixtureCallId()
      events.push(toolCallEvent(seq, 0, call, rootCallId, 'run_code', { code: 'x' }))
      seq += 1
      const subTotal = call === 0 ? readSubCalls + writeSubCalls : 0
      for (let sub = 0; sub < subTotal; sub += 1) {
        const subCallId = `${rootCallId}:ptc:${sub}`
        events.push({
          type: 'tool/ptc-dispatch-start',
          seq: seq as never,
          time: 0,
          data: { rootCallId, parentCallId: rootCallId, subCallId, name: sub < readSubCalls ? 'read' : 'write' },
        } as SessionEvent)
        seq += 1
      }
      events.push(toolResultEvent(seq, 0, call, rootCallId, 'ran', undefined, seq - subTotal - 1))
      seq += 1
    }
    events.push(assistantMessageEvent(seq, 0, 3, 'done'))

    const view = viewOf(events)
    const metric = computeSessionMetrics(view).tools.ptcFacts
    expect(metric.value).toBe(12)
    expect(metric.numerator).toBe(12)
    expect(metric.denominator).toBe(3)
    expect(metric.missingReasons).toContain('sdk-exposure-unparsed')

    const readShare = view.toolCalls
      .flatMap((call) => call.subCalls)
      .filter((sub) => sub.name === 'read').length / 12
    expect(readShare).toBeCloseTo(8 / 12, 10)
  })

  it('T01/T02: exposure denominator is requests with observable headers; missing headers are not zero (AT07)', () => {
    const view = viewOf([
      requestHeaderEvent(0, { config: { provider: 'p', model: 'm' }, tools: [toolSchema('shell')] }, 'initial'),
      userMessageEvent(1, 0, 'hi'),
      assistantMessageEvent(2, 0, 0, 'a'),
      userMessageEvent(3, 1, 'more'),
      assistantMessageEvent(4, 1, 1, 'b'), // no later header; inherits the first
    ])
    const exposure = computeSessionMetrics(view).tools.exposure
    expect(exposure.numerator).toBe(2)
    expect(exposure.denominator).toBe(2)

    const withoutHeaders = viewOf([
      userMessageEvent(0, 0, 'hi'),
      assistantMessageEvent(1, 0, 0, 'a'),
    ])
    const missing = computeSessionMetrics(withoutHeaders).tools.exposure
    expect(missing.value).toBeNull()
    expect(missing.missingReasons).toContain('no-samples')
  })

  it('T05: identical arguments within one turn are repeat candidates', () => {
    const view = viewOf([
      userMessageEvent(0, 0, 'poll it'),
      toolCallEvent(1, 0, 0, fixtureCallId(), 'status', { id: 7 }),
      toolCallEvent(2, 0, 1, fixtureCallId(), 'status', { id: 7 }),
      toolCallEvent(3, 0, 2, fixtureCallId(), 'status', { id: 8 }),
      assistantMessageEvent(4, 0, 3, 'done'),
    ])
    const rows = computeSessionMetrics(view).tools.repeatArgs
    const status = rows.find((row) => row.name === 'status')!
    expect(status.repeats).toBe(1)
    expect(status.total).toBe(3)
  })
})

describe('Skill metrics (AT09, AT10)', () => {
  it('S01/S02: catalog visibility plus loads by path, funnels never mixed', () => {
    const callId = fixtureCallId()
    const events: SessionEvent[] = [
      skillCatalogEvent(0, 0, [{ name: 'reviewer', description: 'Reviews code' }]),
      userMessageEvent(1, 0, 'review this'),
      toolCallEvent(2, 0, 0, callId, 'skill', { name: 'reviewer' }),
      toolResultEvent(3, 0, 0, callId, 'SKILL BODY', undefined, 2),
      assistantMessageEvent(4, 0, 1, 'done'),
      skillInvocationEvent(5, 1, 'reviewer', 'GESTURE BODY'),
      assistantMessageEvent(6, 1, 1, 'ok'),
    ]

    const view = viewOf(events)
    const metrics = computeSessionMetrics(view)
    expect(metrics.extensions.skillCatalog.value).toBe(1)
    expect(metrics.extensions.skillLoadsByPath).toEqual([{ path: 'tool', loads: 1 }, { path: 'gesture', loads: 1 }])
  })

  it('S03: reload while resident counts; reload after compaction removal does not (AT10)', () => {
    const callA = fixtureCallId()
    const callB = fixtureCallId()
    const callC = fixtureCallId()
    const view = viewOf([
      userMessageEvent(0, 0, 'one'),
      toolCallEvent(1, 0, 0, callA, 'skill', { name: 'x' }),
      toolResultEvent(2, 0, 0, callA, 'BODY', undefined, 1),
      toolCallEvent(3, 0, 1, callB, 'skill', { name: 'x' }),
      toolResultEvent(4, 0, 1, callB, 'BODY', undefined, 3),
      assistantMessageEvent(5, 0, 2, 'mid'),
      compactionReplacementEvent(6, 1, 0, 0, 5, 'checkpoint'),
      userMessageEvent(7, 1, 'two'),
      toolCallEvent(8, 1, 1, callC, 'skill', { name: 'x' }),
      toolResultEvent(9, 1, 1, callC, 'BODY', undefined, 8),
      assistantMessageEvent(10, 1, 2, 'done'),
    ])
    const metric = computeSessionMetrics(view).extensions.skillReloads
    expect(metric.numerator).toBe(1) // resident reload before compaction
    expect(metric.denominator).toBe(3)
  })
})

describe('MCP attribution (AT11)', () => {
  it('attributes unambiguous mcp__server__tool names; unknown errors stay unresolved', () => {
    expect(attributeMcpServer('mcp__fs__read_file')).toBe('fs')
    expect(attributeMcpServer('mcp__a1b2c3_truncated')).toBeUndefined()
    expect(attributeMcpServer('ordinary_tool')).toBeUndefined()
  })

  it('M01/M03: components classified native vs mcp; reachability by evidence class', () => {
    const mcpCall = fixtureCallId()
    const failCall = fixtureCallId()
    const view = viewOf([
      requestHeaderEvent(0, {
        config: { provider: 'p', model: 'm' },
        tools: [toolSchema('shell'), toolSchema('mcp__fs__read_file'), toolSchema('mcp__a1b2c3d4e5f6_long_hash_truncated_name_x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4j3')],
      }, 'initial'),
      userMessageEvent(1, 0, 'go'),
      toolCallEvent(2, 0, 0, mcpCall, 'mcp__fs__read_file', {}),
      toolResultEvent(3, 0, 0, mcpCall, 'file', undefined, 2),
      toolCallEvent(4, 0, 1, failCall, 'mcp__fs__write_file', {}),
      toolResultEvent(5, 0, 1, failCall, 'denied', { name: 'Error', code: 'UNKNOWN' }, 4),
      assistantMessageEvent(6, 0, 2, 'done'),
    ])
    const metrics = computeSessionMetrics(view)
    const components = metrics.extensions.components
    expect(components.find((component) => component.name === 'shell')!.kind).toBe('native')
    expect(components.find((component) => component.name === 'mcp__fs__read_file')).toEqual({
      name: 'mcp__fs__read_file',
      kind: 'mcp',
      server: 'fs',
    })
    // Truncated hash-style name: segments < 3 → unresolved, never assigned.
    const hashed = components.find((component) => component.name.includes('x9y8'))!
    expect(hashed.kind).toBe('native') // falls back: cannot prove MCP

    const reachability = metrics.extensions.mcpReachability
    const fs = reachability.find((row) => row.server === 'fs')!
    expect(fs.success).toBe(1)
    expect(fs.recordedFailure).toBe(1)
    expect(fs.unobserved).toBe(false)
  })
})
