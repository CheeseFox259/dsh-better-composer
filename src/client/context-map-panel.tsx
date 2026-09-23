import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import {
  formatTokens, loadTurnAnchors, saveTurnAnchors, summarizeContextWindow,
  buildContextBrowser,
  type ContextBrowserModel,
  type ContextSummary,
  type ContextTurnStat,
} from './context-map.ts'

/** The context-map tab's registry identity and page kind. */
export const CONTEXT_MAP_TAB_ID = '@noleftbutright/dsh-better-composer.contextmap'
export const CONTEXT_MAP_TAB_KIND = 'better-composer.contextmap'

/** Page-type definition registered into the right Sidebar. */
export function contextMapTabDefinition() {
  return {
    id: CONTEXT_MAP_TAB_ID,
    kind: CONTEXT_MAP_TAB_KIND,
    title: () => '上下文地图',
  }
}

/** Push-only session probe: one version counter for every source the map reads. */
export interface ContextMapProbe {
  /** Bumped on any projection/event/draft change. */
  version(): number
  subscribe(listener: () => void): () => void
  projection(key: 'contextPressure' | 'contextBreakdown' | 'tokenUsage'): unknown
  events(): { readonly entries: readonly unknown[]; readonly revision: number }
  draftClips(): number
  /** True while the full-history pull is paging earlier events in. */
  historyLoading(): boolean
  /** Page the event window back to the session start (idempotent, fail-open). */
  loadAllHistory(): void
  /** Run `/compact` on the session. */
  compact(): Promise<void>
  /** Fork the session after the turn ending at `endSeq`. */
  forkAt(endSeq: number): Promise<void>
}

interface PressureView {
  readonly contextWindow?: number
  readonly pressureTokens?: number
  readonly projectedTokens?: number
  readonly surfaceTokens?: number
}

interface BreakdownView {
  readonly systemTokens?: number
  readonly toolsTokens?: number
  readonly messageTokens?: number
}

interface UsageTotals {
  readonly uncachedInputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

export type ContextMapPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & {
  readonly probe: ContextMapProbe
  /** Session identity supplied by the framework at runtime. */
  readonly sessionId?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

type BrowserTab = 'system' | 'tools' | 'messages'

/** Clamp long text for row previews; full text stays one click away. */
function preview(text: string, limit = 160): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`
}

/** MCP tools follow the `mcp__server__tool` naming convention. */
function isMcpTool(name: string): boolean {
  return /^mcp__/i.test(name) || name.toLowerCase().startsWith('mcp_')
}

/** Human labels for user-message source kinds entering the context. */
function sourceLabel(kind: string): string {
  if (kind === 'skill-catalog' || kind === 'skill') return '✦ skill'
  if (kind === 'agent-instructions') return '⌘ 指令'
  if (kind === 'plugin') return '插件'
  return kind
}

/** Right-sidebar context map: occupancy, composition, browser, management. */
export function ContextMapPanel({ sessionId = '', probe }: ContextMapPanelProps) {
  const version = useSyncExternalStore(listener => probe.subscribe(listener), () => probe.version(), () => 0)

  const events = probe.events()
  const summary = useMemo(
    () => summarizeContextWindow(events.entries, events.revision),
    [events.revision],
  )
  const browser = useMemo(
    () => buildContextBrowser(events.entries),
    // Rebuild on any event change; the fold is one linear pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events.revision, version],
  )

  const pressure = asRecord(probe.projection('contextPressure')) as PressureView
  const breakdown = asRecord(probe.projection('contextBreakdown')) as BreakdownView
  const usage = asRecord(probe.projection('tokenUsage')) as UsageTotals
  const clips = probe.draftClips()

  const [tab, setTab] = useState<BrowserTab>('messages')
  const [hoverKind, setHoverKind] = useState<BrowserTab | undefined>()
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [selectedTurn, setSelectedTurn] = useState<number | undefined>()
  const [confirmingCompact, setConfirmingCompact] = useState(false)
  const [compactError, setCompactError] = useState('')
  const [forkNotice, setForkNotice] = useState('')
  const [anchors, setAnchors] = useState<readonly number[]>(() => loadTurnAnchors(String(sessionId)))

  useEffect(() => { probe.loadAllHistory() }, [probe])
  useEffect(() => { setAnchors(loadTurnAnchors(String(sessionId))) }, [sessionId])
  useEffect(() => {
    if (forkNotice === '') return
    const timer = setTimeout(() => { setForkNotice('') }, 4000)
    return () => { clearTimeout(timer) }
  }, [forkNotice])

  const toggle = (key: string): void => {
    setExpanded(previous => previous.includes(key)
      ? previous.filter(candidate => candidate !== key)
      : [...previous, key])
  }
  const isOpen = (key: string): boolean => expanded.includes(key)
  const revealTurn = (index: number): void => {
    setTab('messages')
    const key = `turn:${index}`
    setExpanded(previous => previous.includes(key) ? previous : [...previous, key])
  }
  const toggleAnchor = (turn: number): void => {
    setAnchors(previous => {
      const next = previous.includes(turn) ? previous.filter(candidate => candidate !== turn) : [...previous, turn]
      saveTurnAnchors(String(sessionId), next)
      return next
    })
  }

  const system = numberOf(breakdown.systemTokens) ?? 0
  const toolsTokens = numberOf(breakdown.toolsTokens) ?? 0
  const messagesTokens = numberOf(breakdown.messageTokens) ?? summary.estimatedMessageTokens
  const measuredTotal = system + toolsTokens + messagesTokens
  const projected = numberOf(pressure.projectedTokens) ?? measuredTotal
  const window = numberOf(pressure.contextWindow)
  const estimated = pressure.projectedTokens === undefined
  const occupancy = window !== undefined && window > 0 ? Math.min(1, projected / window) : undefined

  const compositionTotal = Math.max(1, measuredTotal)
  const turnMax = Math.max(1, ...summary.turns.map(turn => Math.max(turn.userTokens, turn.assistantTokens)))

  const input = numberOf(usage.uncachedInputTokens) ?? 0
  const output = numberOf(usage.outputTokens) ?? 0
  const cacheRead = numberOf(usage.cacheReadTokens) ?? 0
  const cacheWrite = numberOf(usage.cacheWriteTokens) ?? 0
  const hasUsage = input > 0 || output > 0
  const cacheHit = cacheRead + input > 0 ? cacheRead / (cacheRead + input) : undefined
  const cacheCover = cacheRead > 0 && projected > 0 ? Math.min(1, cacheRead / projected) : undefined

  const runCompact = async (): Promise<void> => {
    if (!confirmingCompact) {
      setConfirmingCompact(true)
      return
    }
    setConfirmingCompact(false)
    setCompactError('')
    try {
      await probe.compact()
    } catch (error) {
      setCompactError(error instanceof Error ? error.message : String(error))
    }
  }

  const runFork = async (endSeq: number): Promise<void> => {
    try {
      await probe.forkAt(endSeq)
      setForkNotice('已创建分叉会话（在侧边栏会话列表中打开）')
    } catch (error) {
      setForkNotice(`分叉失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return <div className="dsh-better-composer-ctxmap" data-ctxmap>
    <section className="dsh-better-composer-ctxmap-card" aria-label="上下文占用">
      <header className="dsh-better-composer-ctxmap-card-head">
        <span className="dsh-better-composer-ctxmap-card-title">上下文占用</span>
        {estimated ? <span className="dsh-better-composer-ctxmap-badge">估算</span> : null}
        {browser.compacting ? <span className="dsh-better-composer-ctxmap-badge" data-live>压缩中…</span> : null}
      </header>
      <div className="dsh-better-composer-ctxmap-figure">
        <span className="dsh-better-composer-ctxmap-big">{formatTokens(projected)}</span>
        <span className="dsh-better-composer-ctxmap-unit">{window !== undefined ? `/ ${formatTokens(window)} tokens` : 'tokens'}</span>
      </div>
      <div
        className="dsh-better-composer-ctxmap-gauge"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={occupancy === undefined ? undefined : Math.round(occupancy * 100)}
      >
        <div
          className="dsh-better-composer-ctxmap-gauge-fill"
          data-level={occupancy === undefined ? 'unknown' : occupancy < 0.6 ? 'low' : occupancy < 0.85 ? 'mid' : 'high'}
          style={{ width: `${occupancy === undefined ? 0 : Math.max(2, occupancy * 100)}%` }}
        />
      </div>
      <div className="dsh-better-composer-ctxmap-actions">
        <button
          type="button"
          className="dsh-better-composer-ctxmap-action"
          data-danger={confirmingCompact ? 'true' : undefined}
          disabled={browser.compacting}
          onClick={() => { void runCompact() }}
        >{confirmingCompact ? '确认压缩？将摘要替换历史' : browser.compacting ? '压缩中…' : '压缩上下文'}</button>
        <span className="dsh-better-composer-ctxmap-action-note">
          {compactError !== '' ? compactError : '/compact · 摘要替换较早历史'}
        </span>
      </div>
      {forkNotice !== '' ? <p className="dsh-better-composer-ctxmap-sub" role="status">{forkNotice}</p> : null}
    </section>

    <section className="dsh-better-composer-ctxmap-card" aria-label="上下文构成">
      <header className="dsh-better-composer-ctxmap-card-head">
        <span className="dsh-better-composer-ctxmap-card-title">构成</span>
        <span className="dsh-better-composer-ctxmap-card-note">合计 {formatTokens(measuredTotal)} tok</span>
        <div className="dsh-better-composer-ctxmap-tabs" role="tablist" aria-label="上下文浏览">
          {([['messages', '消息'], ['tools', '工具'], ['system', '系统']] as const).map(([value, label]) => <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className="dsh-better-composer-ctxmap-tab"
            onClick={() => { setTab(value) }}
            onMouseEnter={() => { setHoverKind(value) }}
            onMouseLeave={() => { setHoverKind(undefined) }}
          >{label}</button>)}
        </div>
      </header>
      <div className="dsh-better-composer-ctxmap-stack" aria-hidden>
        {([['system', system], ['tools', toolsTokens], ['messages', messagesTokens]] as const).map(([kind, value]) => {
          const focused = hoverKind ?? tab
          return <span
            key={kind}
            className="dsh-better-composer-ctxmap-stack-seg"
            data-kind={kind}
            data-active={focused === kind ? 'true' : undefined}
            data-dim={focused !== kind ? 'true' : undefined}
            style={{ width: `${value / compositionTotal * 100}%` }}
          />
        })}
      </div>
      <ul className="dsh-better-composer-ctxmap-legend">
        <li onMouseEnter={() => { setHoverKind('system') }} onMouseLeave={() => { setHoverKind(undefined) }}><i data-kind="system" />系统 · {formatTokens(system)}</li>
        <li onMouseEnter={() => { setHoverKind('tools') }} onMouseLeave={() => { setHoverKind(undefined) }}><i data-kind="tools" />工具 · {formatTokens(toolsTokens)}</li>
        <li onMouseEnter={() => { setHoverKind('messages') }} onMouseLeave={() => { setHoverKind(undefined) }}><i data-kind="messages" />消息 · {formatTokens(messagesTokens)}</li>
      </ul>
      <BrowserSection tab={tab} browser={browser} isOpen={isOpen} toggle={toggle} anchors={anchors} onAnchor={toggleAnchor} onFork={runFork} loading={probe.historyLoading()} />
    </section>

    {hasUsage || cacheRead > 0
      ? <section className="dsh-better-composer-ctxmap-card" aria-label="缓存">
        <header className="dsh-better-composer-ctxmap-card-head">
          <span className="dsh-better-composer-ctxmap-card-title">缓存</span>
          {cacheHit !== undefined
            ? <span className="dsh-better-composer-ctxmap-card-note">命中率 {Math.round(cacheHit * 100)}%</span>
            : null}
        </header>
        {cacheCover !== undefined
          ? <div className="dsh-better-composer-ctxmap-gauge" aria-hidden>
            <div className="dsh-better-composer-ctxmap-gauge-fill" data-level="cache" style={{ width: `${Math.max(2, cacheCover * 100)}%` }} />
          </div>
          : null}
        <div className="dsh-better-composer-ctxmap-grid">
          <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(cacheRead)}</strong><span>缓存读取</span></div>
          <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(cacheWrite)}</strong><span>缓存写入</span></div>
          <div className="dsh-better-composer-ctxmap-stat"><strong>{cacheCover !== undefined ? `${Math.round(cacheCover * 100)}%` : '—'}</strong><span>当前上下文覆盖</span></div>
        </div>
        <p className="dsh-better-composer-ctxmap-sub">由 provider 前缀缓存自动生效，无需手动标记。</p>
      </section>
      : null}

    <section className="dsh-better-composer-ctxmap-card" aria-label="结构统计">
      <header className="dsh-better-composer-ctxmap-card-head">
        <span className="dsh-better-composer-ctxmap-card-title">结构</span>
      </header>
      <div className="dsh-better-composer-ctxmap-grid">
        <div className="dsh-better-composer-ctxmap-stat"><strong>{summary.userMessages}</strong><span>用户消息</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{summary.assistantMessages}</strong><span>助手消息</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{summary.toolCalls}</strong><span>工具调用</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{summary.fileRefs + summary.imageCount}</strong><span>文件与图片</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{clips}</strong><span>粘贴引用</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(summary.assistantOutputTokens)}</strong><span>输出 tokens</span></div>
      </div>
    </section>

    <section className="dsh-better-composer-ctxmap-card" aria-label="逐轮增长">
      <header className="dsh-better-composer-ctxmap-card-head">
        <span className="dsh-better-composer-ctxmap-card-title">逐轮增长</span>
        <span className="dsh-better-composer-ctxmap-card-note">最近 {summary.turns.length} 轮</span>
      </header>
      {summary.turns.length === 0
        ? <p className="dsh-better-composer-ctxmap-sub">{probe.historyLoading() ? '正在加载更早历史…' : '暂无对话内容'}</p>
        : <div className="dsh-better-composer-ctxmap-bars" role="group" aria-label="逐轮 tokens">
          {summary.turns.map(turn => <button
            key={turn.index}
            type="button"
            className="dsh-better-composer-ctxmap-bar"
            data-anchored={anchors.includes(turn.index) ? 'true' : undefined}
            data-selected={selectedTurn === turn.index ? 'true' : undefined}
            aria-pressed={selectedTurn === turn.index}
            aria-label={`第 ${turn.index} 轮 · ${formatTokens(turn.userTokens + turn.assistantTokens)} tokens`}
            title={`第 ${turn.index} 轮 · ${formatTokens(turn.userTokens + turn.assistantTokens)} tokens${anchors.includes(turn.index) ? ' · 已锚定' : ''}`}
            onClick={() => { setSelectedTurn(previous => previous === turn.index ? undefined : turn.index) }}
          >
            <i data-kind="assistant" style={{ height: `${turn.assistantTokens / turnMax * 100}%` }} />
            <i data-kind="user" style={{ height: `${turn.userTokens / turnMax * 100}%` }} />
          </button>)}
        </div>}
      {selectedTurn !== undefined ? <TurnDetail
        turn={selectedTurn}
        stat={summary.turns.find(candidate => candidate.index === selectedTurn)}
        browser={browser}
        anchored={anchors.includes(selectedTurn)}
        onAnchor={toggleAnchor}
        onReveal={revealTurn}
      /> : null}
      <p className="dsh-better-composer-ctxmap-sub">点击轮次柱查看该轮构成；锚定后此处显示金色刻线。</p>
    </section>
  </div>
}

/** Per-turn composition drill-down under the growth chart. */
function TurnDetail({
  turn, stat, browser, anchored, onAnchor, onReveal,
}: {
  readonly turn: number
  readonly stat: ContextTurnStat | undefined
  readonly browser: ContextBrowserModel
  readonly anchored: boolean
  readonly onAnchor: (turn: number) => void
  readonly onReveal: (turn: number) => void
}) {
  const browserTurn = browser.turns.find(candidate => candidate.index === turn)
  const toolCounts = new Map<string, number>()
  for (const step of browserTurn?.steps ?? []) {
    for (const name of step.toolNames) toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1)
  }
  const topTools = [...toolCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6)
  return <div className="dsh-better-composer-ctxmap-turn-detail" data-turn-detail={turn}>
    <div className="dsh-better-composer-ctxmap-turn-detail-head">
      <strong>第 {turn} 轮</strong>
      <span className="dsh-better-composer-ctxmap-turn-detail-actions">
        <button type="button" className="dsh-better-composer-ctxmap-icon" aria-pressed={anchored}
          aria-label={anchored ? `取消锚定第 ${turn} 轮` : `锚定第 ${turn} 轮`}
          onClick={() => { onAnchor(turn) }}>{anchored ? '◆' : '◇'}</button>
        <button type="button" className="dsh-better-composer-ctxmap-action" onClick={() => { onReveal(turn) }}>在消息中查看</button>
      </span>
    </div>
    {stat !== undefined
      ? <div className="dsh-better-composer-ctxmap-grid">
        <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(stat.userTokens)}</strong><span>用户 tokens</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(stat.assistantTokens)}</strong><span>助手 tokens</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{stat.toolCalls}</strong><span>工具调用</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{stat.fileRefs + stat.imageCount}</strong><span>文件与图片</span></div>
      </div>
      : null}
    {browserTurn !== undefined
      ? <p className="dsh-better-composer-ctxmap-sub">{browserTurn.steps.length} 步 · 用户 {formatTokens(Math.ceil(browserTurn.userChars / 4))} · 输出 {formatTokens(browserTurn.outputTokens)} tok</p>
      : null}
    {topTools.length > 0
      ? <div className="dsh-better-composer-ctxmap-chips">
        {topTools.map(([name, count]) => <span key={name} className="dsh-better-composer-ctxmap-chip" data-kind={isMcpTool(name) ? 'mcp' : 'tool'}>
          {isMcpTool(name) ? '⚙ ' : '› '}{name}{count > 1 ? ` ×${count}` : ''}
        </span>)}
      </div>
      : null}
  </div>
}

function BrowserSection({
  tab, browser, isOpen, toggle, anchors, onAnchor, onFork, loading,
}: {
  readonly tab: BrowserTab
  readonly browser: ContextBrowserModel
  readonly isOpen: (key: string) => boolean
  readonly toggle: (key: string) => void
  readonly anchors: readonly number[]
  readonly onAnchor: (turn: number) => void
  readonly onFork: (endSeq: number) => Promise<void>
  readonly loading: boolean
}) {
  const loadingNote = loading ? <p className="dsh-better-composer-ctxmap-sub" role="status">正在加载更早历史…</p> : null
  if (tab === 'system') {
    const nodes = [...browser.systemNodes].reverse()
    if (nodes.length === 0) return <div>{loadingNote ?? <p className="dsh-better-composer-ctxmap-sub">本会话暂无系统提示词记录。</p>}</div>
    return <div className="dsh-better-composer-ctxmap-browser">
      {loadingNote}
      {nodes.map((node, position) => {
        const key = `system:${node.seq}`
        return <div key={key} className="dsh-better-composer-ctxmap-row-group">
          <button type="button" className="dsh-better-composer-ctxmap-row" aria-expanded={isOpen(key)} onClick={() => { toggle(key) }}>
            <span className="dsh-better-composer-ctxmap-chevron" aria-hidden>{isOpen(key) ? '▾' : '▸'}</span>
            <span className="dsh-better-composer-ctxmap-row-main">
              <strong>{position === 0 ? '当前系统提示词' : `历史系统节点 ${nodes.length - position}`}</strong>
              <small>{preview(node.text, 90)}</small>
            </span>
            <span className="dsh-better-composer-ctxmap-row-meta">~{formatTokens(Math.ceil(node.chars / 4))} tok</span>
          </button>
          {isOpen(key) ? <pre className="dsh-better-composer-ctxmap-pre">{node.text}</pre> : null}
        </div>
      })}
    </div>
  }

  if (tab === 'tools') {
    if (browser.tools.length === 0) return <div>{loadingNote ?? <p className="dsh-better-composer-ctxmap-sub">本会话暂无工具定义记录。</p>}</div>
    return <div className="dsh-better-composer-ctxmap-browser">
      {loadingNote}
      {browser.headerRoute !== undefined && browser.headerRoute !== ''
        ? <p className="dsh-better-composer-ctxmap-sub">请求路由 · {browser.headerRoute} · {browser.tools.length} 个工具</p>
        : null}
      {browser.tools.map((tool, index) => {
        const key = `tool:${index}`
        return <div key={key} className="dsh-better-composer-ctxmap-row-group">
          <button type="button" className="dsh-better-composer-ctxmap-row" aria-expanded={isOpen(key)} onClick={() => { toggle(key) }}>
            <span className="dsh-better-composer-ctxmap-chevron" aria-hidden>{isOpen(key) ? '▾' : '▸'}</span>
            <span className="dsh-better-composer-ctxmap-row-main">
              <strong>{tool.name}{isMcpTool(tool.name) ? <span className="dsh-better-composer-ctxmap-chip" data-kind="mcp">MCP</span> : null}</strong>
              <small>{tool.description === '' ? '（无描述）' : preview(tool.description, 90)}</small>
            </span>
            <span className="dsh-better-composer-ctxmap-row-meta">~{formatTokens(Math.ceil(tool.schemaChars / 4))} tok</span>
          </button>
          {isOpen(key) ? <p className="dsh-better-composer-ctxmap-detail">{tool.description || '（该工具没有描述）'}</p> : null}
        </div>
      })}
    </div>
  }

  if (browser.turns.length === 0) return <div>{loadingNote ?? <p className="dsh-better-composer-ctxmap-sub">本会话暂无消息记录。</p>}</div>
  return <div className="dsh-better-composer-ctxmap-browser">
    {loadingNote}
    {[...browser.turns].reverse().map(turn => {
      const key = `turn:${turn.index}`
      const anchored = anchors.includes(turn.index)
      return <div key={key} className="dsh-better-composer-ctxmap-row-group" data-turn>
        <div className="dsh-better-composer-ctxmap-row" data-static>
          <button type="button" className="dsh-better-composer-ctxmap-row-expander" aria-expanded={isOpen(key)} onClick={() => { toggle(key) }}>
            <span className="dsh-better-composer-ctxmap-chevron" aria-hidden>{isOpen(key) ? '▾' : '▸'}</span>
            <span className="dsh-better-composer-ctxmap-row-main">
              <strong>第 {turn.index} 轮</strong>
              <small>{turn.steps.length} 步 · 用户 {formatTokens(Math.ceil(turn.userChars / 4))} · 输出 {formatTokens(turn.outputTokens)} tok</small>
            </span>
          </button>
          {browser.compactTurns.includes(turn.index) ? <span className="dsh-better-composer-ctxmap-badge">压缩点</span> : null}
          <button
            type="button"
            className="dsh-better-composer-ctxmap-icon"
            aria-pressed={anchored}
            aria-label={anchored ? `取消锚定第 ${turn.index} 轮` : `锚定第 ${turn.index} 轮`}
            title={anchored ? '取消锚定' : '锚定（在增长图上标记）'}
            onClick={() => { onAnchor(turn.index) }}
          >{anchored ? '◆' : '◇'}</button>
          {turn.endSeq !== undefined
            ? <button
              type="button"
              className="dsh-better-composer-ctxmap-icon"
              aria-label={`从第 ${turn.index} 轮后分叉`}
              title="从本轮结束后分叉出新会话"
              onClick={() => { void onFork(turn.endSeq!) }}
            >⑂</button>
            : null}
        </div>
        {isOpen(key) ? turn.steps.map(step => {
          const stepKey = `${key}:step:${step.index}`
          const stepTokens = step.messages.reduce((total, message) =>
            total + (message.outputTokens ?? Math.ceil(message.chars / 4)), 0)
          const toolCounts = new Map<string, number>()
          for (const name of step.toolNames) toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1)
          return <div key={stepKey} className="dsh-better-composer-ctxmap-step">
            <button type="button" className="dsh-better-composer-ctxmap-row" data-indent aria-expanded={isOpen(stepKey)} onClick={() => { toggle(stepKey) }}>
              <span className="dsh-better-composer-ctxmap-chevron" aria-hidden>{isOpen(stepKey) ? '▾' : '▸'}</span>
              <span className="dsh-better-composer-ctxmap-row-main">
                <strong>步骤 {step.index}</strong>
                <small>{step.messages.length} 条消息 · {formatTokens(stepTokens)} tok</small>
              </span>
            </button>
            {toolCounts.size > 0
              ? <div className="dsh-better-composer-ctxmap-chips" data-indent>
                {[...toolCounts.entries()].map(([name, count]) => <span key={name} className="dsh-better-composer-ctxmap-chip" data-kind={isMcpTool(name) ? 'mcp' : 'tool'}>
                  {isMcpTool(name) ? '⚙ ' : '› '}{name}{count > 1 ? ` ×${count}` : ''}
                </span>)}
              </div>
              : null}
            {isOpen(stepKey) ? step.messages.map((message, index) => {
              const messageKey = `${stepKey}:${index}`
              return <div key={messageKey} className="dsh-better-composer-ctxmap-message">
                <button type="button" className="dsh-better-composer-ctxmap-row" data-indent2 aria-expanded={isOpen(messageKey)} onClick={() => { toggle(messageKey) }}>
                  <span className="dsh-better-composer-ctxmap-dot" data-role={message.role} aria-hidden />
                  <span className="dsh-better-composer-ctxmap-row-main">
                    <strong data-role={message.role}>{message.role === 'user' ? '用户' : '助手'}</strong>
                    <small>
                      {message.role === 'user' && message.surfaceReplace ? '压缩摘要 · ' : ''}
                      {message.role === 'user' && message.source !== undefined && message.source !== 'direct' ? `${sourceLabel(message.source)} · ` : ''}
                      {message.interrupted === true ? '已中断 · ' : ''}
                      {formatTokens(message.outputTokens ?? Math.ceil(message.chars / 4))} tok
                    </small>
                  </span>
                  {message.files !== undefined && message.files.length > 0
                    ? <span className="dsh-better-composer-ctxmap-chips">
                      {message.files.slice(0, 3).map(name => <span key={name} className="dsh-better-composer-ctxmap-chip" data-kind="file">📄 {name}</span>)}
                      {message.files.length > 3 ? <span className="dsh-better-composer-ctxmap-chip" data-kind="file">+{message.files.length - 3}</span> : null}
                    </span>
                    : <span className="dsh-better-composer-ctxmap-row-meta">{preview(message.text, 60)}</span>}
                </button>
                {isOpen(messageKey) ? <pre className="dsh-better-composer-ctxmap-pre">{message.text === '' ? '（无文本内容）' : message.text}</pre> : null}
              </div>
            }) : null}
          </div>
        }) : null}
      </div>
    })}
  </div>
}

/** Module-level opener handle: the plugin publishes it at registration time. */
let contextMapOpener: (() => void) | undefined
const openerListeners = new Set<() => void>()

/** Publish the opener (called once from the client apply). */
export function publishContextMapOpener(open: () => void): void {
  contextMapOpener = open
  for (const listener of openerListeners) listener()
}

function useContextMapOpener(): () => void {
  return useSyncExternalStore(
    listener => { openerListeners.add(listener); return () => { openerListeners.delete(listener) } },
    () => contextMapOpener,
    () => undefined,
  ) ?? (() => {})
}

/** Composer toolbar button that opens the context map for the session. */
export type ContextMapButtonProps = PropsRuntime<'conversation.input.right'>

export function ContextMapButton(_props: ContextMapButtonProps) {
  const openMap = useContextMapOpener()
  return <button
    type="button"
    className="dsh-better-composer-ctxmap-button"
    aria-label="上下文地图"
    title="上下文地图"
    onClick={openMap}
  >
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 13.5V9.5" />
      <path d="M8 13.5V5.5" />
      <path d="M13.5 13.5V2.5" />
    </svg>
  </button>
}
