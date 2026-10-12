import type { ContextBrowserModel, ContextTurnStat } from './context-map.ts'
import { formatTokens } from './context-map.ts'
import { Button } from './context-doctor/ui.tsx'

export type ContextBrowserTab = 'system' | 'tools' | 'messages'
type BrowserTab = ContextBrowserTab
export interface ContextSourceActions {
  readonly sessionId: string
  readonly selectedRefs: readonly string[]
  readonly disabled?: boolean
  readonly onAdd: (ref: string) => void
  readonly onFeedback: (ref: string) => void
  readonly onInspect: (ref: string, bucket: string) => void
}
function SourceActions({ seq, actions, aggregate = false }: { seq: number; actions?: ContextSourceActions; aggregate?: boolean }) {
  if (!actions) return null
  const ref = `${actions.sessionId}:${seq}`
  const selected = actions.selectedRefs.includes(ref)
  return <div className="context-source-actions" data-source-ref={ref}><span>事件 {seq}</span>{aggregate ? <Button size="sm" variant="outline" onClick={() => actions.onInspect(ref, 'tool-definition')}>选择定义集合来源</Button> : <Button size="sm" variant="outline" disabled={actions.disabled || selected} onClick={() => actions.onAdd(ref)}>{selected ? '已加入分析' : '加入分析'}</Button>}<Button size="sm" variant="ghost" onClick={() => actions.onFeedback(ref)}>记录问题</Button></div>
}

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

/** Per-turn composition drill-down under the growth chart. */
export function TurnDetail({
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
        <div className="dsh-better-composer-ctxmap-stat"><strong>{formatTokens(stat.toolTokens)}</strong><span>工具 tokens</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{stat.toolCalls}</strong><span>工具调用</span></div>
        <div className="dsh-better-composer-ctxmap-stat"><strong>{stat.fileRefs + stat.imageCount}</strong><span>文件与图片</span></div>
      </div>
      : null}
    {browserTurn !== undefined
      ? <p className="dsh-better-composer-ctxmap-sub">{browserTurn.steps.length} 步 · 用户 {formatTokens(Math.ceil(browserTurn.userChars / 4))} tok · 助手 {formatTokens(browserTurn.outputTokens || Math.ceil(browserTurn.assistantChars / 4))} tok{browserTurn.toolChars > 0 ? ' · 工具 ' + formatTokens(Math.ceil(browserTurn.toolChars / 4)) + ' tok' : ''}</p>
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

export function ContextContentBrowser({
  tab, browser, isOpen, toggle, anchors, onAnchor, onFork, loading, sourceActions,
}: {
  readonly tab: BrowserTab
  readonly browser: ContextBrowserModel
  readonly isOpen: (key: string) => boolean
  readonly toggle: (key: string) => void
  readonly anchors: readonly number[]
  readonly onAnchor: (turn: number) => void
  readonly onFork: (endSeq: number) => Promise<void>
  readonly loading: boolean
  readonly sourceActions?: ContextSourceActions
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
          {isOpen(key) ? <><pre className="dsh-better-composer-ctxmap-pre">{node.text}</pre><SourceActions seq={node.seq} actions={sourceActions} /></> : null}
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
          {isOpen(key) ? <><p className="dsh-better-composer-ctxmap-detail">{tool.description || '（该工具没有描述）'}</p><SourceActions seq={tool.seq} actions={sourceActions} aggregate /></> : null}
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
      return <div key={key} className="dsh-better-composer-ctxmap-row-group" data-turn={turn.index}>
        <div className="dsh-better-composer-ctxmap-row" data-static>
          <button type="button" className="dsh-better-composer-ctxmap-row-expander" aria-expanded={isOpen(key)} onClick={() => { toggle(key) }}>
            <span className="dsh-better-composer-ctxmap-chevron" aria-hidden>{isOpen(key) ? '▾' : '▸'}</span>
            <span className="dsh-better-composer-ctxmap-row-main">
              <strong>第 {turn.index} 轮</strong>
              <small>{turn.steps.length} 步 · 用户 {formatTokens(Math.ceil(turn.userChars / 4))} tok · 助手 {formatTokens(turn.assistantTokens)} tok{turn.toolChars > 0 ? ' · 工具 ' + formatTokens(Math.ceil(turn.toolChars / 4)) + ' tok' : ''}</small>
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
                    <strong data-role={message.role}>{message.role === 'user' ? '用户' : message.role === 'tool' ? '工具' : '助手'}</strong>
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
                {isOpen(messageKey) ? <><pre className="dsh-better-composer-ctxmap-pre">{message.text === '' ? '（无文本内容）' : message.text}</pre><SourceActions seq={message.seq} actions={sourceActions} /></> : null}
              </div>
            }) : null}
          </div>
        }) : null}
      </div>
    })}
  </div>
}

