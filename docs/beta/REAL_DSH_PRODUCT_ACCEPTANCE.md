# Real DSH product acceptance

This checklist records the M10 product gate against the normal DSH Web entry point with an installed `@deepseek-ai/dsh-rich-editor@0.1.0-beta.1` package. Fixture and unit results are supporting evidence only.

## Run record

- Compatible Core: `b9150bf0ab`
- Plugin version: `0.1.0-beta.1`
- URL: `http://127.0.0.1:3096/`
- Launch: `DSH_HOME=$M10_HOME DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1 DEEPSEEK_API_KEY=mock-key node --import tsx/esm apps/cli/src/bin.ts web --no-open --host 127.0.0.1 --port 3096`
- Sessions: `@AGENTS.md ## 任务 请检查`, `OK`
- Provider: deterministic local OpenAI-compatible endpoint; normal and 12-second slow responses returned `OK`
- Operator/date: Codex / 2026-08-30

## Scenarios

### A - First use: `PASS`

The clean-installed package composes through its `dsh.bundle` patch. An ordinary Session retains the native Composer and displays the Rich Editor contribution without a separate page or editor.

### B - Chinese agent prompt: `PASS`

The real Session accepted Chinese text, headings, lists, inline code, a fence diagnostic, and native references. Markdown visual, Preview, and submission operated on the same source draft.

### C - Formatting: `PASS`

Strong transformed the selected draft exactly, native undo restored the original, and redo restored the formatted value as one action transaction.

### D - Shortcut and IME arbitration: `PASS` / `USER_RUN_REQUIRED`

Focused InputBar automation covers Ctrl/Cmd+B and suppresses plugin actions during composition/key-229 handling. Real Chinese/Japanese OS IME remains the only user-run check.

### E - Reference-heavy: `PASS`

The real Composer inserted `@AGENTS.md` and `@README.md`, formatted `foo @AGENTS.md @README.md bar`, completed undo/redo, and submitted both as native reference nodes. Existing native and assembled coverage supplies whole-occurrence deletion and undo evidence.

### F - Preview: `PASS`

Preview stayed read-only beside the source, updated after an Expanded-mode source edit, closed without changing the draft, and handled the CJK/Markdown/reference prompt.

### G - Expanded: `PASS`

A 40-line draft expanded in place, retained the same native textbox, accepted further typing, updated Preview, kept diagnostics and Send present, and collapsed without draft loss.

### H - Diagnostics: `PASS`

An unclosed fence displayed `代码块未闭合`. Clicking it selected source while the textarea stayed active, and the draft still submitted successfully.

### I - Running agent: `PASS`

During a deterministic 12-second response, a second message entered the native Queue dock. The real `Steer queued message` control removed the queued row and delivered it into the running turn; the completed transcript contained both messages and `OK` responses.

### J - Settings: `PASS`

Settings > Plugins displayed the Chinese Rich Editor card. Enabled, Markdown visual, diagnostics, and toolbar Compact/Hidden changed live. OFF removed plugin contributions while the native Composer and draft remained usable; ON restored them without reload.

### K - Restart: `PASS`

Enabled, Markdown visual, diagnostics, and compact toolbar survived Session switching, page reload, full DSH stop/start, and reopening Settings. The native Composer remained available.

## M10 acceptance matrix

| Requirement | Status | Real evidence |
| --- | --- | --- |
| Normal DSH Session integration | `PASS` | Installed package enhanced the ordinary Session Composer at 3096. |
| Settings UI | `PASS` | Styled Chinese card rendered in Settings > Plugins. |
| Settings persistence | `PASS` | Four values survived Session switch, reload, and restart. |
| Toolbar discoverability | `PASS` | Compact toolbar exposed four direct actions, 更多, 预览, and 展开. |
| Markdown visual ON/OFF | `PASS` | Decoration range count changed `3 -> 0 -> 3` live. |
| Formatting and undo/redo | `PASS` | Exact Strong, undo, and redo transitions passed with native references. |
| Preview | `PASS` | Read-only panel updated while source stayed visible. |
| Expanded | `PASS` | Same native textbox and Send control remained active. |
| Diagnostics | `PASS` | Source selection retained textarea focus and did not block Send. |
| Native references | `PASS` | Two distinct references survived approved surrounding-text formatting and submission. |
| Native submit | `PASS` | Installed-plugin Sessions returned `OK`; formatted reference draft cleared on acceptance. |
| Queue | `PASS` | Running-turn message appeared in the native Queue dock. |
| Steer | `PASS` | Native steer control delivered the queued row into the running turn. |
| Plugin disable/re-enable | `PASS` | OFF preserved native draft/edit/Send; ON restored contributions. |
| Session switch | `PASS` | A/B drafts restored exactly with no Preview/Expanded leakage. |
| Reload | `PASS` | Settings and Composer contribution restored. |
| Restart | `PASS` | Full process restart restored Settings and Composer contribution. |
| Chinese UI | `PASS` | Settings, toolbar, Preview/Expanded, and diagnostics labels rendered in Chinese. |
| Real Chinese/Japanese OS IME | `USER_RUN_REQUIRED` | Compose text with each OS IME and confirm shortcuts stay suppressed until composition ends. |

## Gate

Every required M10 product row is `PASS`. Real OS IME is the sole permitted `USER_RUN_REQUIRED` row. Result: `M10 = PASS`; product status: `REAL_DSH_PRODUCT_USABLE`.
