# Real DSH product acceptance

This checklist is the M10 product gate. Run it against the normal DSH Web entry point with an installed `@deepseek-ai/dsh-rich-editor` package, an ordinary Agent Session, and the current DSH settings provider. Fixture and unit results in [M1_RESULTS.md](./M1_RESULTS.md) are supporting evidence only. The current run remains incomplete because the required Chromium distribution is unavailable on this machine.

The ordinary-session check at `http://127.0.0.1:3080` is pre-install native-baseline evidence, not a Beta pass. The isolated clean-install profile then resolved the package bundle and served its client resource; no browser interaction was possible afterward. The official Settings seam is present in DSH, so no new Core seam is requested.

## Run record

- DSH launch command observed: `node --import tsx/esm apps/cli/src/bin.ts web`
- Actual URL observed: `http://127.0.0.1:3080`
- HTTP check: `curl -sS -o /dev/null -w 'HTTP_CODE=%{http_code}\n' http://127.0.0.1:3080/` → `HTTP_CODE=200`
- DSH displayed version: `0be1067`
- Plugin package/version: `@deepseek-ai/dsh-rich-editor@0.1.0-beta.1`
- Isolated install command: `DSH_HOME=$M10_HOME pnpm --dir $DSH_ROOT dsh plugin --profile web add $PLUGIN_ROOT/.pack-check/deepseek-ai-dsh-rich-editor-0.1.0-beta.1.tgz`
- Isolated composition: `dsh --profile web --dump-config` included `@deepseek-ai/dsh-rich-editor` as the final profile bundle row.
- Isolated Web command: `DSH_HOME=$M10_HOME node --import tsx/esm apps/cli/src/bin.ts web --no-open --host 127.0.0.1 --port 3093`
- Isolated Web result: `http://127.0.0.1:3093` returned `HTTP_CODE=200`; the process was terminated after the bounded check and no `3093` process remained.
- Browser check: Playwright wrapper could not launch because the required Chromium distribution is unavailable; no real Rich Editor UI PASS is claimed.
- Session evidence: normal Agent Session; `请只回复 OK` → `OK`; `1 turns · 1 steps`; `/api/session.prompt`
- Operator/date: Codex / 2026-08-30

## Scenarios

### A — First Use

Install the package, start DSH, open a normal Session, and type `## Task\n\nFix \`parseExpression\`.\n\n- Do not change the API.`. The package bundle resolves automatically and the native Composer remains recognizable. HTTP and profile composition passed; visual Session interaction is blocked by the unavailable Chromium distribution. Status: `IN_PROGRESS`.

### B — Chinese Agent Prompt

Type a Chinese prompt containing `@src/parser.ts`, headings, list items, and a fenced `bash` block. Confirm CJK text, native reference behavior, visual Markdown, Preview, and the sent source. The native prompt `请只回复 OK` passed in the observed Session; the installed Rich Editor path is blocked by the unavailable browser. Status: `IN_PROGRESS`.

### C — Formatting

Select `public API`, invoke Strong, then native undo and redo. Confirm the exact source transitions `public API` → `**public API**` → `public API` → `**public API**`. Status: `BLOCKED`.

### D — Shortcut

Select text and invoke the existing Ctrl/Cmd+B path. Confirm the action is suppressed during IME composition and native-reserved shortcuts remain native. Status: `BLOCKED`.

### E — Reference-heavy

Use at least two native references. The observed `@` flow opened the real candidate list and requested `/api/fileReferences/list` and `/api/sessionReferenceResolver/candidates`; format/delete/undo/Send around installed references remains unverified. Status: `IN_PROGRESS`.

### F — Preview

Open Preview, edit the source while it is open, confirm the read-only rendered view updates, close it, and confirm the draft is unchanged. Include CJK, references, fences, lists, and links. Status: `BLOCKED`.

### G — Expanded

Use a 40-line prompt, expand the Composer, continue typing, insert a reference, open Preview, and collapse. Confirm the same native textarea and input semantics remain active, including Send. Status: `BLOCKED`.

### H — Diagnostics

Enter an unclosed fenced block. Confirm a low-interference diagnostic indicator and a useful message, while Send remains enabled and the source remains editable. Status: `BLOCKED`.

### I — Running Agent

With an Agent running, enter `另外，不要修改 package.json。` and exercise the current real DSH Queue and Steer controls. Confirm the plugin does not change their semantics or labels. The actual control placement must be observed during this run, not inferred from old docs. Status: `BLOCKED`.

### J — Settings

Open Settings → Plugins → Rich Editor. Toggle `启用富文本编辑器`, `Markdown 可视化`, and `诊断提示`; switch `工具栏` between 紧凑 and 隐藏; verify the read-only shortcut list. OFF removes only plugin enhancements and native Composer, references, Send, Queue, and Steer remain usable; ON restores the contribution. The official Settings seam and card implementation are present, but browser interaction is blocked. Status: `BLOCKED`.

### K — Restart

Set non-default values, switch Session, reload Web, stop DSH, restart it, and reopen the same settings page. Confirm values survive each lifecycle step and the Composer remains usable. Status: `BLOCKED`.

## M10 acceptance matrix

| Requirement | Status | Evidence |
| --- | --- | --- |
| Normal Session | `IN_PROGRESS` | Native textarea and Enter submit observed; isolated package profile composed and Web HTTP 200, browser interaction pending. |
| Settings | `IN_PROGRESS` | Official namespace/scope/card seam is available and plugin card is implemented; real card interaction pending. |
| persistence | `BLOCKED` | Scenario K; browser prerequisite unavailable. |
| toolbar | `BLOCKED` | Scenario C; browser prerequisite unavailable. |
| preview | `BLOCKED` | Scenario F; browser prerequisite unavailable. |
| expanded | `BLOCKED` | Scenario G; browser prerequisite unavailable. |
| diagnostics | `BLOCKED` | Scenario H; browser prerequisite unavailable. |
| Native @reference | `IN_PROGRESS` | Real candidate list and resolver requests observed; installed-plugin atomic edit still pending. |
| Native submit | `IN_PROGRESS` | Native Enter submitted `请只回复 OK` → `OK`; installed-plugin path and pointer-submit recovery pending. |
| Queue/Steer | `BLOCKED` | Scenario I; observe the current busy-session controls. |
| Rich Editor ON/OFF | `BLOCKED` | Scenario J; browser prerequisite unavailable. |
| Markdown visual ON/OFF | `BLOCKED` | Scenario J; browser prerequisite unavailable. |
| Diagnostics ON/OFF | `BLOCKED` | Scenario J; browser prerequisite unavailable. |
| Toolbar Compact/Hidden | `BLOCKED` | Scenario J; browser prerequisite unavailable. |
| disable/re-enable | `BLOCKED` | Scenario J; native Composer must remain usable. |
| reload | `BLOCKED` | Scenario K; browser prerequisite unavailable. |
| restart | `BLOCKED` | Scenario K; browser prerequisite unavailable. |
| Chinese UI | `BLOCKED` | Plugin copy is Chinese-first in source; real UI display pending. |

## Evidence rules

Record the exact launch command and URL, package version, Session identifiers, controls exercised, and observed source text. A fixture-only result cannot satisfy a real DSH row. Mark `USER_RUN_REQUIRED` only for a check that the current environment genuinely cannot perform, and include the one operator action needed. Any native behavior regression is `FAIL` even when unit tests pass.
