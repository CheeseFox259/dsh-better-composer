import { describe, expect, it } from 'vitest'
import { BetterComposerRemoteService } from '../../src/remote.ts'

describe('Better Composer rewrite remote', () => {
  it('passes the current reasoning effort and cancellation signal to the side call', async () => {
    let options: Record<string, unknown> | undefined
    const llm = {
      stream: async function* (next: Record<string, unknown>) {
        options = next
        yield { type: 'text-delta', index: 1, text: 'second' }
        yield { type: 'text-delta', index: 0, text: 'first' }
      },
    }
    const ctx = {
      get: (name: string) => name === 'llm' ? llm : undefined,
      reflect: { provide: () => () => {} },
    }
    const service = new BetterComposerRemoteService(ctx as never)
    const signal = new AbortController().signal

    await expect(service.editText({
      provider: 'provider',
      model: 'model',
      reasoningEffort: 'high',
      text: 'draft',
      instruction: 'rewrite',
      contextMessages: [],
    }, signal)).resolves.toEqual({ text: 'firstsecond' })

    expect(options).toMatchObject({ provider: 'provider', model: 'model', reasoningEffort: 'high', signal })
  })

  it('does not return a successful empty rewrite', async () => {
    const ctx = {
      get: () => ({ stream: async function* () { yield { type: 'finish', index: 0 } } }),
      reflect: { provide: () => () => {} },
    }
    const service = new BetterComposerRemoteService(ctx as never)

    await expect(service.editText({
      provider: 'provider', model: 'model', text: 'draft', instruction: 'rewrite', contextMessages: [],
    }, new AbortController().signal)).rejects.toThrow('no text')
  })
})
