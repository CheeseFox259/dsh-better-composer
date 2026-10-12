import { normalizePasteFileExtension, type PasteFileExtension } from '../file-extensions.ts'
import type { ConstraintScope } from '../doctor/host/runtime.ts'


const optionalStringSchema = {
  parse(value: unknown): string | undefined {
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw new Error('expected string')
    return value
  },
}

/** Generic object transport for methods validated by the Host RPC entry. */
function doctorWire(method: string) {
  const typeSymbol = `@cheesefox/dsh-better-composer#betterComposer/${method}`
  const create = () => ({ parse: (value: unknown): unknown => value })
  return { id: typeSymbol, service: 'betterComposer', namespace: 'betterComposer', method,
    invocation: { kind: 'direct' as const },
    parameters: [{ name: 'request', wire: 'request', source: 'json' as const, codec: { mode: 'strict' as const, typeSymbol: `${typeSymbol}:request`, create } }],
    result: { mode: 'strict' as const, typeSymbol: `${typeSymbol}:result`, create },
  }
}

const clipRecordSchema = {
  parse(value: unknown): { id: string; text: string; mode: string; createdAt: number; cwd: string; fileExtension: PasteFileExtension } {
    if (value === null || typeof value !== 'object') throw new Error('expected clip record')
    const record = value as Record<string, unknown>
    if (typeof record['id'] !== 'string' || typeof record['text'] !== 'string') throw new Error('invalid clip record')
    return {
      id: record['id'],
      text: record['text'],
      mode: record['mode'] === 'file' ? 'file' : 'inline',
      createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
      cwd: typeof record['cwd'] === 'string' ? record['cwd'] : '',
      fileExtension: normalizePasteFileExtension(record['fileExtension']),
    }
  },
}

const storedResultSchema = {
  parse(value: unknown): { stored: boolean } {
    if (value === null || typeof value !== 'object') throw new Error('expected result')
    return { stored: (value as Record<string, unknown>)['stored'] === true }
  },
}

const loadResultSchema = {
  parse(value: unknown): { text: string | undefined; mode: 'inline' | 'file'; createdAt: number; cwd: string; fileExtension: PasteFileExtension } {
    if (value === null || typeof value !== 'object') throw new Error('expected result')
    const record = value as Record<string, unknown>
    const text = optionalStringSchema.parse(record['text'])
    return {
      text,
      mode: record['mode'] === 'file' ? 'file' : 'inline',
      createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
      cwd: typeof record['cwd'] === 'string' ? record['cwd'] : '',
      fileExtension: normalizePasteFileExtension(record['fileExtension']),
    }
  },
}

const doctorCapabilitiesDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorCapabilities',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorCapabilities',
  invocation: { kind: 'direct' },
  parameters: [],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorCapabilities:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorModesDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorModes',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorModes',
  invocation: { kind: 'direct' },
  parameters: [],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorModes:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorStartScanDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorStartScan',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorStartScan',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorStartScan:request',
      create: () => ({
        parse(value: unknown): { sessionIds?: string[]; modeId?: string; cutoffSeq?: number } {
          if (value === null || typeof value !== 'object') throw new Error('expected scan request')
          const record = value as Record<string, unknown>
          const sessionIds = record['sessionIds']
          return {
            ...(Array.isArray(sessionIds)
              ? { sessionIds: sessionIds.filter((id): id is string => typeof id === 'string') }
              : {}),
            ...(typeof record['modeId'] === 'string' ? { modeId: record['modeId'] } : {}),
            ...(typeof record['cutoffSeq'] === 'number' ? { cutoffSeq: record['cutoffSeq'] } : {}),
          }
        },
      }),
    },
  }],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorStartScan:result',
    create: () => ({
      parse(value: unknown): { jobId: string } {
        if (value === null || typeof value !== 'object' || typeof (value as Record<string, unknown>)['jobId'] !== 'string') {
          throw new Error('expected scan job result')
        }
        return { jobId: (value as Record<string, unknown>)['jobId'] as string }
      },
    }),
  },
} as const

const doctorJobDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorJob',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorJob',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorJob:request',
      create: () => ({
        parse(value: unknown): { jobId: string } {
          if (value === null || typeof value !== 'object' || typeof (value as Record<string, unknown>)['jobId'] !== 'string') {
            throw new Error('expected job query')
          }
          return { jobId: (value as Record<string, unknown>)['jobId'] as string }
        },
      }),
    },
  }],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorJob:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorReportDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorReport',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorReport',
  invocation: { kind: 'direct' },
  parameters: [(doctorJobDescriptor as { parameters: readonly unknown[] }).parameters[0]],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorReport:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorCancelJobDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorCancelJob',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorCancelJob',
  invocation: { kind: 'direct' },
  parameters: [(doctorJobDescriptor as { parameters: readonly unknown[] }).parameters[0]],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorCancelJob:result',
    create: () => ({
      parse(value: unknown): { cancelled: boolean } {
        if (value === null || typeof value !== 'object') throw new Error('expected cancel result')
        return { cancelled: (value as Record<string, unknown>)['cancelled'] === true }
      },
    }),
  },
} as const

const doctorFeedbackTreeDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorFeedbackTree',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorFeedbackTree',
  invocation: { kind: 'direct' },
  parameters: [],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorFeedbackTree:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorSaveFeedbackDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorSaveFeedback',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorSaveFeedback',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorSaveFeedback:request',
      create: () => ({
        parse(value: unknown): {
          problemId?: string
          targetProblemId?: string
          problemTitle?: string
          occurrenceId?: string
          occurrence: Record<string, unknown>
        } {
          if (value === null || typeof value !== 'object') throw new Error('expected feedback request')
          const record = value as Record<string, unknown>
          if (record['occurrence'] === null || typeof record['occurrence'] !== 'object') {
            throw new Error('invalid feedback request: occurrence')
          }
          return {
            ...(typeof record['problemId'] === 'string' ? { problemId: record['problemId'] } : {}),
            ...(typeof record['targetProblemId'] === 'string' ? { targetProblemId: record['targetProblemId'] } : {}),
            ...(typeof record['problemTitle'] === 'string' ? { problemTitle: record['problemTitle'] } : {}),
            ...(typeof record['occurrenceId'] === 'string' ? { occurrenceId: record['occurrenceId'] } : {}),
            occurrence: record['occurrence'] as Record<string, unknown>,
          }
        },
      }),
    },
  }],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorSaveFeedback:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorUpdateFeedbackDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorUpdateFeedback',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorUpdateFeedback',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorUpdateFeedback:request',
      create: () => ({
        parse(value: unknown): {
          kind: 'problem' | 'occurrence'
          objectId: string
          expectedRevision: number
          patch: Record<string, unknown>
        } {
          if (value === null || typeof value !== 'object') throw new Error('expected feedback update')
          const record = value as Record<string, unknown>
          if (record['kind'] !== 'problem' && record['kind'] !== 'occurrence') throw new Error('invalid feedback update: kind')
          if (typeof record['objectId'] !== 'string' || typeof record['expectedRevision'] !== 'number'
            || record['patch'] === null || typeof record['patch'] !== 'object') {
            throw new Error('invalid feedback update')
          }
          return {
            kind: record['kind'],
            objectId: record['objectId'],
            expectedRevision: record['expectedRevision'],
            patch: record['patch'] as Record<string, unknown>,
          }
        },
      }),
    },
  }],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorUpdateFeedback:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorConstraintsDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorConstraints',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorConstraints',
  invocation: { kind: 'direct' },
  parameters: [],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorConstraints:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorSaveConstraintDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorSaveConstraint',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorSaveConstraint',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorSaveConstraint:request',
      create: () => ({
        parse(value: unknown): {
          id: string
          originalText: string
          normalizedRequirement: string
          conditions?: string[]
          exceptions?: string[]
          sourceRefs: readonly string[]
          scope: ConstraintScope
        } {
          if (value === null || typeof value !== 'object') throw new Error('expected constraint request')
          const record = value as Record<string, unknown>
          for (const field of ['id', 'originalText', 'normalizedRequirement'] as const) {
            if (typeof record[field] !== 'string') throw new Error(`invalid constraint request: ${field}`)
          }
          const strings = (input: unknown): string[] | undefined =>
            Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : undefined
          return {
            id: record['id'] as string,
            originalText: record['originalText'] as string,
            normalizedRequirement: record['normalizedRequirement'] as string,
            ...(strings(record['conditions']) === undefined ? {} : { conditions: strings(record['conditions']) }),
            ...(strings(record['exceptions']) === undefined ? {} : { exceptions: strings(record['exceptions']) }),
            sourceRefs: strings(record['sourceRefs']) ?? [],
            scope: record['scope'] as ConstraintScope,
          }
        },
      }),
    },
  }],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorSaveConstraint:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorUpdateConstraintDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorUpdateConstraint',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorUpdateConstraint',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorUpdateConstraint:request',
    create: () => ({ parse(value: unknown) {
      if (value === null || typeof value !== 'object') throw new Error('expected constraint update')
      const record = value as Record<string, unknown>
      if (typeof record['id'] !== 'string' || !Number.isSafeInteger(record['expectedRevision'])
        || record['patch'] === null || typeof record['patch'] !== 'object' || Array.isArray(record['patch'])) {
        throw new Error('invalid constraint update')
      }
      return { id: record['id'], expectedRevision: record['expectedRevision'] as number, patch: record['patch'] as Record<string, unknown> }
    } }),
  } }],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorUpdateConstraint:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorAnalysisAvailableDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorAnalysisAvailable',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorAnalysisAvailable',
  invocation: { kind: 'direct' },
  parameters: [],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorAnalysisAvailable:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorPrepareAnalysisDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorPrepareAnalysis',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorPrepareAnalysis',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorPrepareAnalysis:request',
      create: () => ({ parse: (value: unknown): unknown => value }),
    },
  }],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorPrepareAnalysis:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorRunAnalysisDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorRunAnalysis',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorRunAnalysis',
  invocation: { kind: 'direct' },
  parameters: [{
    name: 'request',
    wire: 'request',
    source: 'json',
    codec: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorRunAnalysis:request',
      create: () => ({
        parse(value: unknown): { plan: unknown; idempotencyKey: string } {
          if (value === null || typeof value !== 'object' || typeof (value as Record<string, unknown>)['idempotencyKey'] !== 'string') {
            throw new Error('expected analysis run request')
          }
          return {
            plan: (value as Record<string, unknown>)['plan'],
            idempotencyKey: (value as Record<string, unknown>)['idempotencyKey'] as string,
          }
        },
      }),
    },
  }],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorRunAnalysis:result',
    create: () => ({
      parse(value: unknown): { jobId: string } {
        if (value === null || typeof value !== 'object' || typeof (value as Record<string, unknown>)['jobId'] !== 'string') {
          throw new Error('expected analysis run result')
        }
        return { jobId: (value as Record<string, unknown>)['jobId'] as string }
      },
    }),
  },
} as const

const doctorAnalysisJobDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorAnalysisJob',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorAnalysisJob',
  invocation: { kind: 'direct' },
  parameters: [(doctorJobDescriptor as { parameters: readonly unknown[] }).parameters[0]],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorAnalysisJob:result',
    create: () => ({ parse: (value: unknown): unknown => value }),
  },
} as const

const doctorCancelAnalysisDescriptor = {
  id: '@cheesefox/dsh-better-composer#betterComposer/doctorCancelAnalysis',
  service: 'betterComposer',
  namespace: 'betterComposer',
  method: 'doctorCancelAnalysis',
  invocation: { kind: 'direct' },
  parameters: [(doctorJobDescriptor as { parameters: readonly unknown[] }).parameters[0]],
  result: {
    mode: 'strict',
    typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/doctorCancelAnalysis:result',
    create: () => ({
      parse(value: unknown): { cancelled: boolean } {
        if (value === null || typeof value !== 'object') throw new Error('expected cancel result')
        return { cancelled: (value as Record<string, unknown>)['cancelled'] === true }
      },
    }),
  },
} as const

/** Hand-written Remote contribution; the host side is discovered via SRC markers. */
export const betterComposerRemoteContribution = {
  package: '@cheesefox/dsh-better-composer',
  descriptors: [doctorWire('doctorEvidence'), doctorWire('doctorPrepareProvider'), doctorWire('doctorApplyProvider'), doctorCapabilitiesDescriptor, doctorModesDescriptor, doctorStartScanDescriptor,
    doctorJobDescriptor, doctorReportDescriptor, doctorCancelJobDescriptor, doctorFeedbackTreeDescriptor, doctorSaveFeedbackDescriptor,
    doctorUpdateFeedbackDescriptor,
    doctorSaveConstraintDescriptor, doctorUpdateConstraintDescriptor, doctorConstraintsDescriptor,
    doctorAnalysisAvailableDescriptor, doctorPrepareAnalysisDescriptor, doctorRunAnalysisDescriptor,
    doctorAnalysisJobDescriptor, doctorCancelAnalysisDescriptor, {
    id: '@cheesefox/dsh-better-composer#betterComposer/storePaste',
    service: 'betterComposer',
    namespace: 'betterComposer',
    method: 'storePaste',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'strict', typeSymbol: '@cheesefox/dsh-better-composer#ClipRecord', create: () => clipRecordSchema },
    }],
    result: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/storePaste:result',
      create: () => storedResultSchema,
    },
  }, {
    id: '@cheesefox/dsh-better-composer#betterComposer/loadPaste',
    service: 'betterComposer',
    namespace: 'betterComposer',
    method: 'loadPaste',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/loadPaste:request',
        create: () => ({
          parse(value: unknown): { id: string } {
            if (value === null || typeof value !== 'object') throw new Error('expected request')
            const id = (value as Record<string, unknown>)['id']
            if (typeof id !== 'string') throw new Error('invalid clip id')
            return { id }
          },
        }),
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/loadPaste:result',
      create: () => loadResultSchema,
    },
  }, {
    id: '@cheesefox/dsh-better-composer#betterComposer/publishPaste',
    service: 'betterComposer',
    namespace: 'betterComposer',
    method: 'publishPaste',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/publishPaste:request',
        create: () => ({
          parse(value: unknown): { id: string; cwd: string } {
            if (value === null || typeof value !== 'object') throw new Error('expected request')
            const record = value as Record<string, unknown>
            if (typeof record['id'] !== 'string' || typeof record['cwd'] !== 'string') throw new Error('invalid publish request')
            return { id: record['id'], cwd: record['cwd'] }
          },
        }),
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/publishPaste:result',
      create: () => ({
        parse(value: unknown): { path: string; relativePath: string; bytes: number } {
          if (value === null || typeof value !== 'object') throw new Error('expected result')
          const record = value as Record<string, unknown>
          if (typeof record['path'] !== 'string' || typeof record['relativePath'] !== 'string' || typeof record['bytes'] !== 'number') throw new Error('invalid publish result')
          return { path: record['path'], relativePath: record['relativePath'], bytes: record['bytes'] }
        },
      }),
    },
  }, {
    id: '@cheesefox/dsh-better-composer#betterComposer/editText',
    service: 'betterComposer',
    namespace: 'betterComposer',
    method: 'editText',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/editText:request',
        create: () => ({
          parse(value: unknown): {
            provider: string
            model: string
            reasoningEffort?: string
            text: string
            instruction: string
            contextMessages: readonly { role: string; text: string }[]
          } {
            if (value === null || typeof value !== 'object') throw new Error('expected request')
            const record = value as Record<string, unknown>
            for (const field of ['provider', 'model', 'text', 'instruction'] as const) {
              if (typeof record[field] !== 'string') throw new Error(`invalid edit request: ${field}`)
            }
            const contextMessages = Array.isArray(record['contextMessages']) ? record['contextMessages'] : []
            return {
              provider: record['provider'] as string,
              model: record['model'] as string,
              ...(typeof record['reasoningEffort'] === 'string' ? { reasoningEffort: record['reasoningEffort'] } : {}),
              text: record['text'] as string,
              instruction: record['instruction'] as string,
              contextMessages: contextMessages.filter((entry): entry is { role: string; text: string } =>
                entry !== null && typeof entry === 'object'
                && typeof (entry as Record<string, unknown>)['role'] === 'string'
                && typeof (entry as Record<string, unknown>)['text'] === 'string'),
            }
          },
        }),
      },
    }],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict',
      typeSymbol: '@cheesefox/dsh-better-composer#betterComposer/editText:result',
      create: () => ({
        parse(value: unknown): { text: string } {
          if (value === null || typeof value !== 'object') throw new Error('expected result')
          const text = (value as Record<string, unknown>)['text']
          if (typeof text !== 'string') throw new Error('invalid edit result')
          return { text }
        },
      }),
    },
  }],
} as const

export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown }

export interface DoctorRemoteFace {
  doctorEvidence(request: { sessionId: string; offset?: number; cutoffSeq?: number; readonly refs?: readonly string[] }): Promise<RemoteResult<unknown>>
  doctorPrepareProvider(request: { modeId: string; enabled: boolean }): Promise<RemoteResult<unknown>>
  doctorApplyProvider(request: { planId: string }): Promise<RemoteResult<unknown>>
  doctorCapabilities(): Promise<RemoteResult<unknown>>
  doctorModes(): Promise<RemoteResult<unknown>>
  doctorStartScan(request: { sessionIds?: string[]; modeId?: string; cutoffSeq?: number }): Promise<RemoteResult<{ jobId: string }>>
  doctorJob(request: { jobId: string }): Promise<RemoteResult<unknown>>
  doctorReport(request: { jobId: string }): Promise<RemoteResult<unknown>>
  doctorCancelJob(request: { jobId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  doctorFeedbackTree(): Promise<RemoteResult<unknown>>
  doctorSaveFeedback(request: {
    problemId?: string
    targetProblemId?: string
    problemTitle?: string
    occurrenceId?: string
    occurrence: Record<string, unknown>
  }): Promise<RemoteResult<unknown>>
  doctorUpdateFeedback(request: {
    kind: 'problem' | 'occurrence'
    objectId: string
    expectedRevision: number
    patch: Record<string, unknown>
  }): Promise<RemoteResult<unknown>>
  doctorSaveConstraint(request: {
    id: string
    originalText: string
    normalizedRequirement: string
    conditions?: readonly string[]
    exceptions?: readonly string[]
    sourceRefs?: readonly string[]
    scope: ConstraintScope
  }): Promise<RemoteResult<unknown>>
  doctorUpdateConstraint(request: {
    id: string
    expectedRevision: number
    patch: Record<string, unknown>
  }): Promise<RemoteResult<unknown>>
  doctorConstraints(): Promise<RemoteResult<unknown>>
  doctorAnalysisAvailable(): Promise<RemoteResult<unknown>>
  doctorPrepareAnalysis(request: {
    readonly kind: 'session-quality' | 'mode-quality' | 'requirement-distill'
    readonly sessionId?: string
    readonly modeId?: string
    readonly reportId?: string
    readonly evidenceRefs?: readonly string[]
    readonly model: { readonly provider: string; readonly model: string }
  }): Promise<RemoteResult<unknown>>
  doctorRunAnalysis(request: { plan: unknown; idempotencyKey: string }): Promise<RemoteResult<{ jobId: string }>>
  doctorAnalysisJob(request: { jobId: string }): Promise<RemoteResult<unknown>>
  doctorCancelAnalysis(request: { jobId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
}

export interface BetterComposerRemoteFace extends DoctorRemoteFace {
  storePaste(request: { id: string; text: string; mode: string; createdAt: number; cwd: string; fileExtension: PasteFileExtension }): Promise<RemoteResult<{ stored: boolean }>>
  loadPaste(request: { id: string }): Promise<RemoteResult<{
    text: string | undefined
    mode: 'inline' | 'file'
    createdAt: number
    cwd: string
    fileExtension: PasteFileExtension
  }>>
  publishPaste(request: { id: string; cwd: string }): Promise<RemoteResult<{ path: string; relativePath: string; bytes: number }>>
  editText(request: {
    provider: string
    model: string
    reasoningEffort?: string
    text: string
    instruction: string
    contextMessages: readonly { role: string; text: string }[]
  }, signal?: AbortSignal): Promise<RemoteResult<{ text: string }>>
}

export interface BetterComposerRemoteState {
  readonly face?: BetterComposerRemoteFace
  readonly error?: string
}

let remoteState: BetterComposerRemoteState = {}
const listeners = new Set<() => void>()

/** Snapshot of the mounted Remote face, for useSyncExternalStore. */
export function remoteSnapshot(): BetterComposerRemoteState {
  return remoteState
}

/** Subscribe to Remote mount-state changes. */
export function subscribeRemote(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Publish the mounted face or the mount failure. */
export function publishRemoteState(next: BetterComposerRemoteState): void {
  remoteState = next
  for (const listener of listeners) listener()
}

/** The mounted namespace accessor, typed narrowly to the hand-written face. */
export function betterComposerRemote(ctx: { readonly get: (name: string, strict?: boolean) => unknown }): BetterComposerRemoteFace | undefined {
  const face = ctx.get('remote.betterComposer', false)
  return face === undefined || face === null ? undefined : face as BetterComposerRemoteFace
}

/**
 * Asynchronously resolve the mounted Remote face, waiting briefly if mounting is still in progress.
 */
export async function getRemoteFace(timeoutMs = 4000): Promise<BetterComposerRemoteFace | undefined> {
  if (remoteState.face !== undefined) return remoteState.face
  if (remoteState.error !== undefined) {
    throw new Error(`file-mode delivery needs the Remote service, which failed to mount: ${remoteState.error}`)
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>
    const unsubscribe = subscribeRemote(() => {
      if (remoteState.face !== undefined) {
        clearTimeout(timer)
        unsubscribe()
        resolve(remoteState.face)
      } else if (remoteState.error !== undefined) {
        clearTimeout(timer)
        unsubscribe()
        reject(new Error(`file-mode delivery needs the Remote service, which failed to mount: ${remoteState.error}`))
      }
    })
    timer = setTimeout(() => {
      unsubscribe()
      resolve(remoteState.face)
    }, timeoutMs)
  })
}
