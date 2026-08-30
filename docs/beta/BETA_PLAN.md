# RICH-EDITOR-BETA M10 implementation record

## Scope and result

M0 is `GO` in [M0_SPIKE_RESULTS.md](./M0_SPIKE_RESULTS.md). M1 is the approved generic decoration, action, and editor baseline in [M1_RESULTS.md](./M1_RESULTS.md). M10 keeps all Markdown behavior in this plugin, uses the existing Core faces, and does not modify DSH Core or the shared DSH checkout.

The plugin implementation now contains the four live Settings fields, the Settings card, Markdown projection, eleven pure actions, compact/hidden toolbar behavior, read-only Preview, same-editor Expanded control, diagnostics, Chinese UI copy, effect-owned registration, and a self-contained `dsh.bundle` profile entry. The package was installed into an isolated temporary DSH profile; its bundle was present in the composed config and its Web server returned HTTP 200. Real browser interaction is `ACCEPTANCE_PENDING` because this machine has no usable Chromium distribution for the required Playwright lane.

## B1-B6 completion record

### B1 — Normal Composer integration

`src/client/index.ts` registers the production provider, eleven actions, the `conversation.input.editor` contribution, and the keyed Settings card through independent effect-owned disposers. The contribution receives only the existing generic editor props. `src/client/editor.tsx` renders a compact first row, `更多`, read-only `MarkdownText` Preview, diagnostics, and the existing `expanded` setter. `src/client/styles.css` keeps decoration rules to `color`, `background-color`, `opacity`, and `text-decoration`; toolbar layout CSS is separate UI presentation.

`cordis.patch.yml` and `package.json` declare the package as a profile bundle. The isolated DSH `--dump-config` output included `@deepseek-ai/dsh-rich-editor`, and the package client resource was served by the temporary Web process. The ordinary profile at `http://127.0.0.1:3080` was observed before this package was mounted and remains only native-baseline evidence.

### B2 — Settings

`src/index.ts` uses `settingsNamespace(...)`, `installSettingsSection(...)`, and the official schema path. `src/settings.ts`, `src/client/settings-store.ts`, and `src/client/settings-card.tsx` define and bind `enabled`, `markdownVisual`, `diagnostics`, and `toolbarMode: 'compact' | 'hidden'`, with defaults `true`, `true`, `true`, and `compact`. The card uses `settings.plugin.item`, Chinese-first labels, and a read-only shortcut list. The browser bundle keeps Settings implementation imports type-only.

The four values are persisted through the DSH Settings scope; the plugin does not create local storage or another persistence service. The focused lifecycle test proves independent provider, action, slot, and Settings listener disposal. Real card interaction and restart persistence remain unverified.

### B3 — Lifecycle and persistence

The store normalizes malformed snapshots, subscribes to the official scope, delegates writes to that scope, and disposes its listener. `enabled` gates provider output and action transforms; the other switches independently gate visual ranges, diagnostics, and toolbar presentation. Native Composer behavior is never removed by the plugin. The package's clean-install profile booted successfully, but Web reload, session switch, restart, and failed-write recovery require a working browser session and remain pending.

### B4 — Native behavior and actions

`src/commands/actions.ts` and `src/commands/action-transforms.ts` retain the pure transform contract: draft, revision, selection, and native ranges in; one `ComposerEditResult` or `undefined` out. InputBar remains the executor and owns occurrence atomicity, IME, selection, undo/redo, `/`, `@`, submit, Queue, and Steer. Toolbar `mousedown` preserves the native selection. Focused unit and prior M1 InputBar evidence cover the transaction and native-priority rules; the installed ordinary-session matrix is pending.

### B5 — UX polish

The current labels and tooltips are Chinese-first, the frequent four actions are direct in Compact mode, lower-frequency actions are under `更多`, and Hidden mode keeps `预览` and `展开`. No shortcut remapping, theme, drag/drop toolbar, WYSIWYG, AI, template, upload, new reference provider, or M11 work was added. Narrow/wide visual fit and disabled-state behavior need the real Chromium pass.

### B6 — Acceptance

The package build, typecheck, focused tests, pack check, portable-path scans, isolated profile installation, profile composition, Web startup, and HTTP checks have run. Playwright could not launch because the required Chromium distribution is unavailable, so Scenarios A-K and the feature rows in [REAL_DSH_PRODUCT_ACCEPTANCE.md](./REAL_DSH_PRODUCT_ACCEPTANCE.md) remain explicit `IN_PROGRESS`, `BLOCKED`, or `NOT_STARTED` states. `M10_RESULTS.md` records the commands and evidence.

## Ownership and failure behavior

InputMachine remains the sole owner of draft, `draftRev`, occurrences, transactions, undo/redo, and submitted snapshots. InputBar remains the owner of textarea, selection, IME, keyboard arbitration, backdrop, mirror, scrollport, native triggers, references, Send, Queue, and Steer. The plugin owns only Markdown ranges, pure actions, toolbar, Preview, diagnostics, Settings UI, and CSS. It never reads editor DOM, mutates InputMachine, rewrites native occurrences, or serializes the submitted prompt.

Each provider, action, slot, stylesheet, and Settings listener is released by its own effect/disposer. A disabled or failed optional contribution returns to the native Composer. Invalid settings snapshots use safe defaults; a failed Settings write leaves the current valid snapshot and exposes only the local save state. Provider/action failures are contained by the approved Core registration path and are not user-facing errors.

## Exact plugin file map

| Path | Responsibility |
| --- | --- |
| `package.json`, `cordis.patch.yml` | Portable package metadata and automatic profile-bundle insertion. |
| `src/index.ts`, `src/settings.ts` | Host Settings namespace/schema and shared settings constants. |
| `src/client/index.ts` | Client Settings binding and independently disposable registrations. |
| `src/client/editor.tsx`, `src/client/settings-card.tsx`, `src/client/settings-store.ts` | Editor controls, Settings card, and official scope projection. |
| `src/client/styles.css`, `src/client/styles.ts` | UI and decoration styles with effect-scoped stylesheet lifetime. |
| `src/markdown/*.ts` | Existing GFM/MDAST projection, native masking, and three diagnostics. |
| `src/commands/*.ts` | Pure eleven-action table and edit transforms. |
| `tests/unit/*.spec.ts`, `tests/m1/decoration-adapter.client.spec.ts` | Focused settings, parser, diagnostics, performance, action, lifecycle, and adapter checks. |
| `README.md`, `docs/beta/*.md` | Package contract, current evidence, acceptance matrix, and M10 result. |

No DSH file, Core API, public registry, second editor, local storage, or production smoke hook is part of M10.

## Verification contract

The minimal checks are focused plugin tests, typecheck, bundle, pack, portable-path and forbidden-hook scans, doc hygiene, isolated clean install, profile composition, bounded Web startup, and one Chromium assembled flow when a supported browser is available. The existing M1 InputBar/geometry evidence is reused; no broad suite is added.

The following remain deliberately out of scope: fuzzing, exhaustive overlap permutations, WebKit, Firefox, extreme-length matrices, repeated leak loops, full-repository tests, full coverage, unrelated snapshots, AI enhance/lint, templates/history, voice/upload, new `@` providers, Mermaid/math, WYSIWYG/contenteditable, arbitrary shortcut remapping, theme customization, toolbar customization, and M11 hardening. Real Chinese/Japanese OS IME is `USER_RUN_REQUIRED` and is the only permitted user-run Beta check once the browser gate is available.

## Definition of done and gate

The final gate requires a real installed ordinary DSH Session showing Markdown decorations, formatting, Preview, same-textarea Expanded, diagnostics, native references, native Send, and the current Queue/Steer controls; Settings must persist and recover across disable/re-enable, reload, session switch, restart, and a failed write; the package must clean-install without an adjacent checkout; both repositories must be clean; the shared DSH six-file user baseline and `rich_editor_control` must be unchanged; and no temporary process or injection may remain.

Current recommendation: `ACCEPTANCE_PENDING`. The plugin code and isolated loader/HTTP evidence are present, but the real Chromium flow, native interaction matrix, Settings persistence, and final repository-clean proof are not claimed until the browser prerequisite is available. No new Core decision is requested.
