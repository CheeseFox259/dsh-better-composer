/** One turn's contribution to context growth, for the mini-bar chart. */
export interface ContextTurnStat {
  /** 1-based turn ordinal. */
  readonly index: number
  /** Estimated user-side tokens (chars / 4). */
  readonly userTokens: number
  /** Provider-reported assistant output tokens when present, else estimated. */
  readonly assistantTokens: number
  /** Tool calls executed inside this turn. */
  readonly toolCalls: number
  /** Estimated tokens from tool results. */
  readonly toolTokens: number
  /** Raw characters from tool results. */
  readonly toolChars: number
  /** File blocks carried by this turn's messages. */
  readonly fileRefs: number
  /** Image blocks carried by this turn's messages. */
  readonly imageCount: number
}

/** Defensive digest of one session event window for the context map. */
export interface ContextSummary {
  readonly revision: number
  readonly userMessages: number
  readonly assistantMessages: number
  readonly toolCalls: number
  readonly toolResults: number
  readonly fileRefs: number
  readonly imageCount: number
  readonly clipRefs: number
  /** Estimated user+assistant message tokens (chars / 4 when usage is absent). */
  readonly estimatedMessageTokens: number
  /** Provider-reported output tokens across settled assistant messages. */
  readonly assistantOutputTokens: number
  readonly turns: readonly ContextTurnStat[]
}

const CHARS_PER_TOKEN = 4
const TURN_LIMIT = 20

/**
 * Shared turn bucketing for the summary and the browser. Explicit `turn`
 * fields always win; without them a user message starts the next sequential
 * turn while assistant/tool events join the current one. Both folds use this
 * tracker so the growth chart and the message drill-down never disagree about
 * which turn an event belongs to.
 */
interface TurnTracker {
  /** A user message: explicit turn, else the next sequential turn. */
  userTurn(explicit: number | undefined): number
  /** A non-user event: explicit turn, else the current turn (1 when none). */
  currentTurn(explicit: number | undefined): number
}

function createTurnTracker(): TurnTracker {
  let last = 0
  const note = (explicit: number | undefined): number | undefined => {
    if (explicit === undefined) return undefined
    last = Math.max(last, explicit)
    return explicit
  }
  return {
    userTurn(explicit) {
      const noted = note(explicit)
      if (noted !== undefined) return noted
      last += 1
      return last
    },
    currentTurn(explicit) {
      return note(explicit) ?? Math.max(1, last)
    },
  }
}

function explicitTurn(data: { readonly turn?: unknown } | undefined): number | undefined {
  return typeof data?.turn === 'number' && Number.isInteger(data.turn) && data.turn > 0 ? data.turn : undefined
}

interface RawEvent {
  readonly type?: string
  readonly data?: {
    readonly role?: string
    readonly content?: unknown
    readonly usage?: unknown
    readonly name?: string
    readonly turn?: number
    readonly message?: { readonly source?: { readonly callId?: unknown } }
  }
}

interface RawEntry {
  readonly type?: string
  readonly event?: RawEvent
}

function textLengthOf(content: unknown): { chars: number; files: number; images: number } {
  if (!Array.isArray(content)) return { chars: 0, files: 0, images: 0 }
  let chars = 0
  let files = 0
  let images = 0
  for (const block of content as readonly unknown[]) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { readonly type?: string; readonly text?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') chars += record.text.length
    else if (record.type === 'file') files += 1
    else if (record.type === 'image') images += 1
  }
  return { chars, files, images }
}

function outputTokensOf(usage: unknown): number {
  if (usage === null || typeof usage !== 'object') return 0
  const value = (usage as { readonly outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Fold one session event window into the context-map digest. Single pass,
 * lengths only — tool payloads and message bodies are measured, never copied.
 * Turn bucketing starts a new turn at each settled user message.
 */
export function summarizeContextWindow(
  entries: readonly unknown[],
  revision: number,
): ContextSummary {
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  let toolResults = 0
  let fileRefs = 0
  let imageCount = 0
  let clipRefs = 0
  let estimatedChars = 0
  let assistantOutputTokens = 0
  const tracker = createTurnTracker()
  interface MutableTurn {
    index: number
    userTokens: number
    assistantTokens: number
    toolCalls: number
    toolTokens: number
    toolChars: number
    fileRefs: number
    imageCount: number
  }
  const turns: MutableTurn[] = []

  const turnAt = (index: number): MutableTurn => {
    const last = turns.at(-1)
    if (last !== undefined && last.index === index) return last
    const existing = turns.find(candidate => candidate.index === index)
    if (existing !== undefined) return existing
    const created: MutableTurn = {
      index, userTokens: 0, assistantTokens: 0, toolCalls: 0,
      toolTokens: 0, toolChars: 0, fileRefs: 0, imageCount: 0,
    }
    turns.push(created)
    return created
  }

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const candidate = entry as RawEntry
    if (candidate.type !== 'event') continue
    const event = candidate.event
    if (event === null || typeof event !== 'object') continue
    const data = event.data
    switch (event.type) {
      case 'user/message': {
        const { chars, files, images } = textLengthOf(messageData(data).content)
        userMessages += 1
        fileRefs += files
        imageCount += images
        estimatedChars += chars
        const current = turnAt(tracker.userTurn(explicitTurn(data)))
        current.userTokens += Math.ceil(chars / CHARS_PER_TOKEN)
        current.fileRefs += files
        current.imageCount += images
        break
      }
      case 'assistant/message': {
        const parts = messageData(data)
        const { chars, files, images } = textLengthOf(parts.content)
        const output = outputTokensOf(parts.usage)
        assistantMessages += 1
        fileRefs += files
        imageCount += images
        estimatedChars += chars
        assistantOutputTokens += output
        const current = turnAt(tracker.currentTurn(explicitTurn(data)))
        current.assistantTokens += output > 0 ? output : Math.ceil(chars / CHARS_PER_TOKEN)
        current.fileRefs += files
        current.imageCount += images
        break
      }
      case 'tool/call': {
        toolCalls += 1
        turnAt(tracker.currentTurn(explicitTurn(data))).toolCalls += 1
        break
      }
      case 'tool/result': {
        toolResults += 1
        const parts = messageData(data)
        const { chars, files, images } = textLengthOf(parts.content)
        const current = turnAt(tracker.currentTurn(explicitTurn(data)))
        current.toolChars += chars
        current.toolTokens += Math.ceil(chars / CHARS_PER_TOKEN)
        current.fileRefs += files
        current.imageCount += images
        break
      }
      default:
        break
    }
  }

  return {
    revision,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    fileRefs,
    imageCount,
    clipRefs,
    estimatedMessageTokens: Math.ceil(estimatedChars / CHARS_PER_TOKEN),
    assistantOutputTokens,
    turns: turns.slice(-TURN_LIMIT),
  }
}

/** Format a token count compactly for card display. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

/** One message inside a step of the context browser. */
export interface BrowserMessage {
  readonly role: 'user' | 'assistant' | 'tool'
  /** user/message source kind ('direct' | 'injected' | ...) when present. */
  readonly source?: string
  readonly chars: number
  readonly text: string
  /** Provider-reported output tokens on assistant messages. */
  readonly outputTokens?: number
  readonly interrupted?: boolean
  /** This user message replaced the surface (a compaction checkpoint). */
  readonly surfaceReplace?: boolean
  /** File names carried by this message's content blocks. */
  readonly files?: readonly string[]
}

/** One step (trace entry): a model call plus its tool executions. */
export interface BrowserStep {
  readonly index: number
  /** Seq of the step's step/start event (fork anchor). */
  readonly startSeq: number
  readonly messages: readonly BrowserMessage[]
  /** Tool call names executed in this step (chronological). */
  readonly toolNames: readonly string[]
}

/** One turn: user input plus the steps answering it. */
export interface BrowserTurn {
  readonly index: number
  /** Seq of turn/start (fork anchors at the preceding turn/end when present). */
  readonly startSeq: number
  /** Seq of turn/end, when the turn closed. */
  readonly endSeq?: number
  readonly steps: readonly BrowserStep[]
  readonly userChars: number
  readonly assistantChars: number
  readonly toolChars: number
  readonly outputTokens: number
  /** Same effective token count as ContextTurnStat.assistantTokens. */
  readonly assistantTokens: number
}

/** A rendered system prompt node on the surface. */
export interface BrowserSystemNode {
  readonly seq: number
  readonly text: string
  readonly chars: number
}

/** One tool definition from the latest request/header. */
export interface BrowserTool {
  readonly name: string
  readonly description: string
  /** JSON schema size in chars (token estimate = /4). */
  readonly schemaChars: number
}

/** Drill-down model for the context browser. */
export interface ContextBrowserModel {
  readonly systemNodes: readonly BrowserSystemNode[]
  readonly tools: readonly BrowserTool[]
  readonly headerRoute?: string
  readonly turns: readonly BrowserTurn[]
  /** An unclosed compaction/start is in flight. */
  readonly compacting: boolean
  /** Turns containing a compaction surface-replace checkpoint. */
  readonly compactTurns: readonly number[]
}

interface BrowserEventData {
  readonly turn?: number
  readonly step?: number
  readonly reason?: string
  readonly content?: unknown
  readonly usage?: unknown
  readonly message?: unknown
  readonly interrupted?: boolean
  readonly surfaceOp?: { readonly op?: string }
  readonly source?: { readonly kind?: string; readonly plugin?: string }
  readonly header?: {
    readonly config?: { readonly provider?: string; readonly model?: string }
    readonly tools?: readonly unknown[]
  }
  readonly compactionId?: string
}

function textBlocksOf(content: unknown): { text: string; chars: number; files: number; fileNames: string[] } {
  if (!Array.isArray(content)) return { text: '', chars: 0, files: 0, fileNames: [] }
  let text = ''
  const fileNames: string[] = []
  for (const block of content as readonly unknown[]) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { readonly type?: string; readonly text?: unknown; readonly name?: unknown }
    if (record.type === 'text' && typeof record.text === 'string') text += text
      === '' ? record.text : `\n${record.text}`
    else if (record.type === 'file') {
      fileNames.push(typeof record.name === 'string' && record.name !== '' ? record.name : '未命名文件')
    }
  }
  return { text, chars: text.length, files: fileNames.length, fileNames }
}

/**
 * Message-event fields are split across two levels: `assistant/message` nests
 * `content` under `data.message` while `usage`/`interrupted` sit at the data
 * top level; `user/message` carries everything at the top. Merge both levels
 * so neither measurement path reads the wrong shape.
 */
function messageData(data: BrowserEventData | undefined): {
  content?: unknown
  usage?: unknown
  interrupted?: boolean
  surfaceOp?: { readonly op?: string }
  source?: { readonly kind?: string; readonly plugin?: string }
} {
  if (data === null || data === undefined) return {}
  const inner = data.message !== null && typeof data.message === 'object'
    ? data.message as Record<string, unknown>
    : {}
  const interrupted = data.interrupted ?? inner['interrupted']
  const surfaceOp = data.surfaceOp ?? inner['surfaceOp']
  const source = data.source ?? inner['source']
  return {
    content: inner['content'] ?? data.content,
    usage: data.usage ?? inner['usage'],
    ...(interrupted === undefined || typeof interrupted === 'boolean' ? { interrupted } : {}),
    ...(surfaceOp !== null && typeof surfaceOp === 'object' ? { surfaceOp: surfaceOp as { readonly op?: string } } : {}),
    ...(source !== null && typeof source === 'object' ? { source: source as { readonly kind?: string; readonly plugin?: string } } : {}),
  }
}

/**
 * Fold the event window into the drill-down browser model. Text payloads are
 * kept by reference (the window already owns them); previews clamp at render.
 */
export function buildContextBrowser(entries: readonly unknown[]): ContextBrowserModel {
  const systemNodes: BrowserSystemNode[] = []
  const tools: BrowserTool[] = []
  let headerRoute: string | undefined
  interface MutableStep { index: number; startSeq: number; messages: BrowserMessage[]; toolNames: string[] }
  interface MutableTurn { index: number; startSeq: number; endSeq?: number; steps: MutableStep[]; userChars: number; assistantChars: number; toolChars: number; outputTokens: number; assistantTokens: number }
  const turns: MutableTurn[] = []
  const tracker = createTurnTracker()
  let compacting = false
  const compactTurns: number[] = []
  const openCompactions = new Set<string>()

  const turn = (index: number, startSeq: number): MutableTurn => {
    const existing = turns.find(candidate => candidate.index === index)
    if (existing !== undefined) return existing
    const current: MutableTurn = { index, startSeq, endSeq: undefined, steps: [], userChars: 0, assistantChars: 0, toolChars: 0, outputTokens: 0, assistantTokens: 0 }
    turns.push(current)
    return current
  }
  const step = (turnIndex: number, stepIndex: number, startSeq: number): MutableStep => {
    const currentTurn = turn(turnIndex, startSeq)
    let current = currentTurn.steps.at(-1)
    if (current === undefined || current.index !== stepIndex) {
      current = { index: stepIndex, startSeq, messages: [], toolNames: [] }
      currentTurn.steps.push(current)
    }
    return current
  }

  let seq = 0
  for (const entry of entries) {
    seq += 1
    if (entry === null || typeof entry !== 'object') continue
    const candidate = entry as { readonly type?: string; readonly event?: { readonly type?: string; readonly data?: BrowserEventData } }
    if (candidate.type !== 'event') continue
    const event = candidate.event
    if (event === null || typeof event !== 'object') continue
    const data = event.data
    switch (event.type) {
      case 'system/message': {
        const message = messageData(data)
        const { text, chars } = textBlocksOf(message.content)
        systemNodes.push({ seq, text, chars })
        break
      }
      case 'request/header': {
        const header = data?.header
        if (header === null || typeof header !== 'object') break
        const record = header as NonNullable<BrowserEventData['header']>
        if (record.config !== undefined) {
          headerRoute = `${String(record.config.provider ?? '')}/${String(record.config.model ?? '')}`.replace(/^\//, '')
        }
        tools.length = 0
        for (const tool of record.tools ?? []) {
          if (tool === null || typeof tool !== 'object') continue
          const schema = tool as { readonly name?: unknown; readonly description?: unknown }
          tools.push({
            name: typeof schema.name === 'string' ? schema.name : '(未命名工具)',
            description: typeof schema.description === 'string' ? schema.description : '',
            schemaChars: JSON.stringify(tool).length,
          })
        }
        break
      }
      case 'turn/start':
        if (explicitTurn(data) !== undefined) turn(tracker.currentTurn(explicitTurn(data)), seq)
        break
      case 'turn/end': {
        if (typeof data?.turn !== 'number') break
        const current = turns.find(candidate => candidate.index === data.turn)
        if (current !== undefined) current.endSeq = seq
        break
      }
      case 'step/start':
        if (explicitTurn(data) !== undefined && typeof data?.step === 'number') step(tracker.currentTurn(explicitTurn(data)), data.step, seq)
        break
      case 'user/message': {
        const message = messageData(data)
        const { text, chars, fileNames } = textBlocksOf(message.content)
        const turnIndex = tracker.userTurn(explicitTurn(data))
        const stepIndex = typeof data?.step === 'number' ? data.step : 1
        const currentStep = step(turnIndex, stepIndex, seq)
        const replace = message.surfaceOp?.op === 'replace'
        currentStep.messages.push({
          role: 'user',
          source: message.source?.kind,
          chars,
          text,
          surfaceReplace: replace || undefined,
          ...(fileNames.length === 0 ? {} : { files: fileNames }),
        })
        const currentTurn = turns.find(candidate => candidate.index === turnIndex)
        if (currentTurn !== undefined) currentTurn.userChars += chars
        if (replace && !compactTurns.includes(turnIndex)) compactTurns.push(turnIndex)
        break
      }
      case 'assistant/message': {
        const message = messageData(data)
        const { text, chars } = textBlocksOf(message.content)
        const output = outputTokensOf(message.usage)
        const turnIndex = tracker.currentTurn(explicitTurn(data))
        const stepIndex = typeof data?.step === 'number' ? data.step : 1
        const currentStep = step(turnIndex, stepIndex, seq)
        currentStep.messages.push({
          role: 'assistant',
          chars,
          text,
          outputTokens: output > 0 ? output : undefined,
          interrupted: message.interrupted === true || undefined,
        })
        const currentTurn = turns.find(candidate => candidate.index === turnIndex)
        if (currentTurn !== undefined) {
          currentTurn.assistantChars += chars
          currentTurn.outputTokens += output
          currentTurn.assistantTokens += output > 0 ? output : Math.ceil(chars / CHARS_PER_TOKEN)
        }
        break
      }
      case 'tool/result': {
        const message = messageData(data)
        const { text, chars } = textBlocksOf(message.content)
        const turnIndex = tracker.currentTurn(explicitTurn(data))
        const stepIndex = typeof data?.step === 'number' ? data.step : 1
        step(turnIndex, stepIndex, seq).messages.push({ role: 'tool', chars, text })
        turns.find(candidate => candidate.index === turnIndex)!.toolChars += chars
        break
      }
      case 'tool/call': {
        const call = data as {
          readonly name?: unknown
          readonly turn?: number
          readonly step?: number
          readonly message?: { readonly source?: { readonly name?: unknown } }
        } | undefined
        const name = typeof call?.name === 'string' && call.name !== ''
          ? call.name
          : typeof call?.message?.source?.name === 'string' ? call.message.source.name : ''
        const callTurn = explicitTurn(call)
        if (name !== '' && callTurn !== undefined && typeof call?.step === 'number') {
          step(tracker.currentTurn(callTurn), call.step, seq).toolNames.push(name)
        }
        break
      }
      case 'compaction/start':
        compacting = true
        if (typeof data?.compactionId === 'string') openCompactions.add(data.compactionId)
        break
      case 'compaction/end':
        if (typeof data?.compactionId === 'string') openCompactions.delete(data.compactionId)
        compacting = openCompactions.size > 0
        break
      default:
        break
    }
  }

  // Keep turns ordered and deduplicated by index (replacement events replay
  // within the same window only once, but defensive).
  const seen = new Set<number>()
  const orderedTurns = turns.filter(candidate => {
    if (seen.has(candidate.index)) return false
    seen.add(candidate.index)
    return true
  })

  return {
    systemNodes,
    tools,
    headerRoute,
    turns: orderedTurns.map(({ index, startSeq, endSeq, steps, userChars, assistantChars, toolChars, outputTokens, assistantTokens }) => ({
      index, startSeq, endSeq, steps, userChars, assistantChars, toolChars, outputTokens, assistantTokens,
    })),
    compacting,
    compactTurns,
  }
}

/** Load pinned turn anchors for one session (localStorage-backed). */
export function loadTurnAnchors(sessionId: string): readonly number[] {
  try {
    const raw = globalThis.localStorage?.getItem(`dsh-better-composer.anchors.${sessionId}`)
    const parsed: unknown = raw === undefined || raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : []
  } catch {
    return []
  }
}

/** Persist pinned turn anchors for one session. */
export function saveTurnAnchors(sessionId: string, turns: readonly number[]): void {
  try {
    globalThis.localStorage?.setItem(`dsh-better-composer.anchors.${sessionId}`, JSON.stringify(turns))
  } catch {
    // Storage unavailable (private mode): anchors stay session-local in memory.
  }
}
