# RICH-EDITOR-BETA M10 product integration plan

## Goal and status

M10 integrates the installed `@deepseek-ai/dsh-rich-editor@0.1.0-beta.1` package into the ordinary DSH Session Composer and Settings flow. The accepted result is `M10 = PASS` and `REAL_DSH_PRODUCT_USABLE`; M11 is not approved.

The Composer remains the native DSH textarea. Rich Editor contributes Markdown decoration, eleven formatting actions, Preview, Expanded mode, three diagnostics, and four Settings fields through existing plugin faces. InputMachine retains draft, occurrence, transaction, undo/redo, and submission ownership.

## Fixed scope

- Plugin work is limited to the package checkout and its beta documents.
- Generic reference-preserving composer actions use the isolated Core worktree at `b9150bf0ab`.
- The shared DSH checkout is runtime/control infrastructure only; M10 writes there only under `rich_editor_control/`.
- No new public Core plugin API, second editor, `contenteditable`, local-storage settings, AI feature, template system, custom keymap, theme editor, or M11 hardening belongs in M10.

## Product flow

1. Start DSH with the installed package and open an ordinary Session.
2. Type Markdown in the native Composer; visual ranges appear without changing source text.
3. Use the compact toolbar or existing shortcuts; actions remain one InputMachine transaction.
4. Insert native references, format surrounding text, Preview, expand, diagnose, and submit.
5. While the Agent runs, use the native Queue dock and Steer control.
6. Manage `enabled`, `markdownVisual`, `diagnostics`, and `toolbarMode` in Settings > Plugins.
7. Switch Sessions, reload, and restart DSH; drafts and persisted Settings remain correctly scoped.

## Implementation units

### B1 - Normal Composer integration

`src/client/index.ts` registers the decoration provider, fourteen action entries (eleven user actions and three private diagnostic selectors), the `conversation.input.editor` slot, and the keyed Settings card. Each registration has an independent disposer. `src/client/editor.tsx` renders Chinese-first controls around the resident textarea.

### B2 - Settings integration

`src/index.ts` exports the canonical `Config` schema and installs the official Settings namespace. `src/client/settings-store.ts` consumes the browser scope. `src/client/settings-card.tsx` exposes the four persisted fields and read-only shortcuts. `src/client/styles.css` supplies the Settings card and compact Composer presentation.

### B3 - Persistence and lifecycle

Settings writes go through the DSH Settings service. Decoration registration refreshes when `enabled`, `markdownVisual`, or `diagnostics` changes so visual state invalidates immediately. Toolbar state is rendered from the same external Settings snapshot. Preview and Expanded state remain manual and reset on Session change.

### B4 - Native behavior

Actions receive an immutable draft, revision, selection, and native ranges, then return one `ComposerEditResult`. Core validates and remaps complete native reference occurrences. InputBar retains selection, textarea focus, IME, undo/redo, Send, Queue, and Steer arbitration. Diagnostic navigation uses a private action that selects source without owning DOM.

### B5 - Product presentation

Compact mode shows 加粗, 斜体, 行内代码, 链接, 更多, 预览, and 展开. Hidden mode removes the Rich Editor toolbar. Diagnostics remain low-interference and never block Send. The Settings card explains that visual enhancement does not change submitted source.

### B6 - Acceptance

The release evidence is the installed product flow in [REAL_DSH_PRODUCT_ACCEPTANCE.md](./REAL_DSH_PRODUCT_ACCEPTANCE.md), supported by focused package tests and the Core reference-action tests. The final package checks are typecheck, eight focused test files, bundle, pack check, payload/path inspection, and `git diff --check`.

## Failure and recovery

- Disabled or disposed contributions leave the native Composer usable with its draft intact.
- A failed optional provider/action contributes no result; DSH retains native behavior.
- A failed Settings write keeps the last valid snapshot and displays the local save error.
- A stale composer revision rejects the action rather than applying to a newer draft.
- DSH restart reads the same Settings namespace; no plugin-owned recovery store exists.

## Gate

M10 passes only when the real installed Session proves Settings, Markdown visual state, toolbar formatting, native references, Preview, Expanded, diagnostics, undo/redo, Send, Queue, Steer, disable/re-enable, Session switching, reload, restart, and Chinese UI. Real Chinese/Japanese OS IME remains the sole `USER_RUN_REQUIRED` item; automated composition and key-229 guards remain supporting evidence.
