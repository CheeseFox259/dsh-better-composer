# RICH-EDITOR-BETA M10 results

## Gate

Result: `M10 = PASS`.

Product status: `REAL_DSH_PRODUCT_USABLE`.

The accepted package is `@deepseek-ai/dsh-rich-editor@0.1.0-beta.1`. The compatible Core worktree includes `b9150bf0ab` (`fix(ui-conversation): preserve references in composer actions`). The change adds no new public plugin API and does not modify the shared DSH checkout.

## Implementation

The package uses the official Host Settings namespace and browser Settings scope for `enabled`, `markdownVisual`, `diagnostics`, and `toolbarMode`. It registers one settings-aware decoration provider, eleven public formatting actions, three private diagnostic-selection actions, the normal Composer editor slot, and the keyed Plugins Settings card. Compact/hidden toolbar behavior, Chinese-first labels, read-only Preview, same-textarea Expanded mode, three diagnostics, and effect-owned cleanup remain plugin-owned.

Core preserves complete native reference occurrences when a composer action rewrites surrounding text. InputMachine remains the sole draft and occurrence owner; InputBar retains DOM, selection, IME, keyboard, undo/redo, Send, Queue, and Steer ownership.

## Real DSH run

The installed package was exercised from the isolated compatible Core worktree with a temporary DSH home and a deterministic local provider:

```text
DSH_HOME=$M10_HOME \
DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1 \
DEEPSEEK_API_KEY=mock-key \
node --import tsx/esm apps/cli/src/bin.ts web \
  --no-open --host 127.0.0.1 --port 3096
```

Actual URL: `http://127.0.0.1:3096/`.

The package was installed through `dsh plugin` from `deepseek-ai-dsh-rich-editor-0.1.0-beta.1.tgz`; the installed client bundle matched the package build before the run. Sessions titled `@AGENTS.md ## 任务 请检查` and `OK` supplied the Session-switch and running-Agent evidence.

## Product evidence

- Settings > Plugins displayed a styled Chinese `Rich Editor 设置` card. Enabling Markdown visual, diagnostics, and compact toolbar updated the ordinary Composer immediately.
- A 399-character Markdown/CJK draft containing native `@AGENTS.md` transformed exactly to `**${draft}**`; native undo restored the original and redo restored the formatted draft.
- The approved multi-reference flow produced `foo @AGENTS.md @README.md bar`, then exact Strong/undo/redo transitions. Submission rendered both references as native nodes and returned `OK`.
- Markdown visual DOM ranges changed `3 -> 0 -> 3` across OFF/ON without reload.
- Clicking `代码块未闭合` selected the diagnostic source while the textarea remained active. The same diagnostic did not disable Send.
- Preview remained visible beside the source, updated after typing in Expanded mode, and the same native textbox and Send control remained present. Collapse and Preview close preserved the draft.
- Rich Editor OFF removed the complete plugin contribution while keeping the textarea, draft, reference text, native edit, and Send control. ON restored the toolbar without draft loss.
- Two persisted Sessions restored their own drafts exactly. Preview and Expanded state did not leak between Sessions.
- A normal Send returned `OK`. During a deterministic 12-second response, `排队：不要修改 package.json` appeared in the native Queue dock; `Steer queued message` removed it from Queue and delivered it into the running turn.
- Reload and a full DSH stop/start both restored enabled, Markdown visual, diagnostics, compact toolbar, and the native Composer.

## Automated verification

The final package verification uses:

```text
pnpm run typecheck
pnpm test -- --reporter=dot
pnpm run bundle
pnpm run pack:check
git diff --check
```

The final run passed typecheck; 8 test files and 19 tests; Host bundle `1.51 kB`; client bundle `33.71 kB`; pack check for `0.1.0-beta.1`; and `git diff --check`. The performance observation was `1k=10.035 ms`, `10k=10.422 ms`, and `50k=41.965 ms`.

Focused Core evidence for `b9150bf0ab` covers six test files and 186 tests, the ui-conversation TypeScript face, focused type-aware Oxlint, `build:lib:client`, and 28/28 documentation gates.

## Scope and limitations

Real Chinese/Japanese OS IME remains `USER_RUN_REQUIRED`; automated composition and key-229 suppression pass. The operator action is to compose Chinese and Japanese text in the native textarea and confirm formatting shortcuts remain suppressed until composition ends.

Formatting whose selection begins directly with a native reference exposes an existing submitted-transcript parsing edge: the leading occurrence can display as plain reference text. The approved product flow formats surrounding text (`foo @reference bar`) and preserves every occurrence. This edge does not change the M10 gate and is deferred; no M11 work is included here.

No broad repository suite, coverage run, browser matrix, fuzzing, extreme-length matrix, repeated leak loop, or unrelated snapshot was added. The shared DSH checkout and its user changes were not modified.

Recommended decision: `APPROVED`.
