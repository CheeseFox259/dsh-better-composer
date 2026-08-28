# RICH-EDITOR-BETA Final Beta One-Pass Implementation Plan

> For the implementation worker: execute Tasks A–E in order in the isolated roots, preserving the commit boundaries and focused checks below. The shared runtime checkout is read-only; do not run `pnpm run clean`, `git clean`, push, or open a PR.

**Goal:** Ship a usable Markdown Composer contribution that keeps InputMachine and the native textarea authoritative while providing visual projection, atomic formatting, read-only preview, diagnostics, expanded mode, and a real installed-session acceptance path.

**Architecture:** The plugin reuses DSH’s existing `parseGfm()` and `MarkdownText`, maps MDAST positions to pure UTF-16 decoration ranges, and registers them through the generic decoration registry. InputBar remains the owner of the textarea, selection, IME, native keyboard, scrollport, references, and submission. The only additional Core faces are the approved pure `ComposerActionRegistry` and session-scoped `conversation.input.editor`.

**Tech Stack:** TypeScript/ESM, Cordis effects and scopes, React slot contributions, the existing textarea/backdrop/mirror projection, Vitest source tests, and the existing Chromium web lane.

---

## Starting point and fixed decisions

- M0 is `GO` in [M0_SPIKE_RESULTS.md](./M0_SPIKE_RESULTS.md). The existing single textarea/backdrop/mirror scrollport passed the approved Chromium normal-DPR geometry and native-interaction feasibility gate.
- The M1 candidate is Core `0e7e996863f49bd947fe65f501389b1afb8f15b1` and plugin commits `5a88590dff3a29f1213e8aeee22f33aa0295bf17`, `ec5e46faf96ad72bd2740bf6f5cdd55e536b8559`, and `f4978ed77448a7826ec9eaae1f6fa0f71929edfb`. It is candidate input, not final acceptance evidence.
- Task A clears the eight prior Sol blockers: self-contained Core smoke; no personal/absolute paths; no production smoke hooks; narrow decoration exports; non-quadratic sweep; passing host/client builds; paired docs; and portable plugin configuration while retaining its three local config files.
- DSH Core writes use `$DSH_CORE_WORKTREE`; plugin writes use `$PLUGIN_ROOT`; `$SHARED_DSH_CHECKOUT` remains read-only. The six shared user-file blobs and `rich_editor_control` are preserved.
- Frozen authority is `rich_editor_control/DECISIONS.md` ADR-013/014 and resolved `DR-FB-001`: Core may add only M1 hardening, public `ui-primitives.parseGfm()`, pure `ComposerActionRegistry`, and session-scoped `conversation.input.editor` with `runAction`, `expanded`, and `setExpanded`.
- `ComposerAction` is a pure transform: read-only `draft`, `draftRev`, `selection`, and `nativeRanges` in; one `ComposerEditResult` out. It exposes no DOM, InputMachine, mutable callback, occurrence codec, or serializer.
- Markdown logic, commands, toolbar, preview, diagnostics, and CSS stay in the plugin. Expanded mode reuses the same textarea/backdrop/mirror/scrollport. Native IME, `/`, `@`, references, submit, Queue, and Steer semantics win.

## Ownership and implementation classification

| Surface | Classification | Evidence and rule |
| --- | --- | --- |
| Draft, `draftRev`, occurrences, reconciliation, undo/redo, submit snapshot | `PLUGIN_ONLY` consumer | `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/input/machine.ts` owns these in `InputMachine.dispatch()`. The plugin reads snapshots and never serializes a final prompt. |
| One action → one revision/undo unit | `NEED_CORE` approved action face | `SessionInputShell` already accepts `setDraft(text, editRange?)` internally and the machine records one transaction; public `InputActions.setDraft(text)` cannot receive the action result or exact selection. InputBar will apply one `ComposerEditResult` through its existing private keyboard face. |
| Native occurrence atomicity | `NEED_CORE` validation in InputBar | `InputMachine.reconcile()` removes an occurrence intersected by a draft edit. InputBar rejects a result that partially or fully overlaps a native range unless the result is a no-op, so actions cannot split or replace DSH-owned references. |
| Selection, caret, IME, `/`, `@`, Enter, Queue, Steer, undo/redo | `NEED_CORE` executor; InputBar remains owner | `InputBar.tsx` owns `selectionOf`, `beforeinput`, composition guards, native shortcut handling, trigger arbitration, and queue steering. `ComposerAction` receives a snapshot only; InputBar decides whether and how to apply it. |
| Backdrop, mirror, scroll, geometry | `PLUGIN_ONLY` ranges/CSS; `NEED_CORE` editor state | InputBar renders the three native projection layers inside one scrollport. Plugin CSS is restricted to `color`, `background-color`, `opacity`, and `text-decoration`; `conversation.input.editor.expanded` changes only the existing InputBar sizing state. |
| Markdown parsing and MDAST projection | `PLUGIN_ONLY` | Reuse `@deepseek-ai/dsh-client-ui-primitives/client` `parseGfm()` and `MarkdownText`; no second grammar or renderer. Native ranges are masked before position mapping. |
| Preview | `PLUGIN_ONLY` | A session-scoped `conversation.input.editor` contribution renders read-only `MarkdownText` from the current input snapshot. It has no textarea, edit path, or serializer. |
| Diagnostics | `PLUGIN_ONLY` | Exactly three deterministic diagnostics: unclosed fenced code, unclosed inline-code delimiter run, and malformed explicit link. Provider invalid output/throw fails open per provider through the Core logger. |
| Prompt serialization and delivery | `PLUGIN_ONLY` consumer; no Core seam | `SessionInputShell` and the Host retain reference expansion, final prompt assembly, submit, Queue, and Steer semantics. |

No M3/M4/M6 seam is assumed. If a proposed Core edit is expressible using the approved action result and existing private InputBar executor, delete that Core change before committing.

## File map and cross-repository boundaries

Paths are symbols rooted at execution time; no symbol or local absolute path is written into source, manifests, or persistent evidence.

### DSH Core

- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/contract/composer-decoration.ts` — public provider/context/range/native-range/layer types; normalized segment remains internal.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/input/decoration-registry.ts` — provider validation, native clipping, event sweep, deterministic layer/priority/order composition, diagnostics, and disposal.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/input/decorations.ts` — native token/reference/text-reference projection used by InputBar.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/contract/composer-action.ts` — public pure `ComposerAction`, `ComposerEditResult`, read-only input, and `ComposerActionRegistry` types; no DOM or mutable edit callback.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/input/action-registry.ts` — idempotent action registration/disposal, duplicate-id rejection, deterministic ordering, and per-action fail-open diagnostics.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/contract/slots.ts` — session-scoped `conversation.input.editor` owner/injection types, with render/collector internals kept private.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/apply.ts` and `service.ts` — construct and dispose the decoration/action registries and expose only the approved conversation service faces.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` and `InputBar.module.css` — execute pure results, preserve native precedence, render the editor contribution, and reuse the existing scrollport for expanded state.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/index.ts` — export only provider/context/range/native-range/layer, `ComposerAction`/result/registry types, and the approved editor face; never export normalized segments or collector/render types.
- `$DSH_CORE_WORKTREE/packages/client/ui-primitives/src/client/markdown.ts` and `index.ts` — expose the existing generic `parseGfm()` from the public client entry; do not add Markdown-specific Rich Editor APIs.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/tests/composer-decoration.client.spec.ts` — one focused registry/projection spec.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/tests/composer-action.client.spec.ts` — one focused action-registry/result spec.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/tests/input-decoration.client.spec.tsx` — one InputBar matrix: zero/single provider, native occurrence, late disposal, IME, Enter/Queue/Steer, undo/redo, and one action application.
- `$DSH_CORE_WORKTREE/packages/client/ui-conversation/tests/input-bar.client.spec.tsx`, `input-matrix.client.spec.tsx`, `input-scenarios.client.spec.tsx`, `skeleton.client.spec.tsx`, and `apply-inject.client.spec.tsx` — update private fixtures only.
- `$DSH_CORE_WORKTREE/packages/test-support/composer-decoration-fixture/package.json`, `tsconfig.json`, `tsdown.config.ts`, `src/index.ts`, and `src/client/index.ts` — self-contained test-only healthy/throwing providers for the Core browser smoke; never production and never plugin-dependent.
- `$DSH_CORE_WORKTREE/apps/web/tests/composer-decoration.e2e.ts` and `composer-decoration.fixture.overlay.yml` — one assembled Chromium test and repository-local fixture overlay. The default test loads only the repository fixture; the clean-install acceptance command may set `DSH_RICH_EDITOR_PACKAGE` to an installed package and the test writes its overlay under its temporary harness home.
- `$DSH_CORE_WORKTREE/apps/web/tsconfig.json`, `tsconfig.host.json`, and `tsconfig.client.json` — preserve host/client project boundaries and remove the prior `TS6059`/`TS6307` crossing.
- `$DSH_CORE_WORKTREE/docs/architecture.md`, `docs/architecture.zh.md`, `packages/client/ui-conversation/README.md`, `packages/client/ui-conversation/README.zh.md`, and paired Agent Note files — document generic ownership, action purity, lifecycle, and fail-open behavior in both languages.

### Plugin

- `$PLUGIN_ROOT/package.json` — standalone metadata, explicit peer/dev dependencies, and portable scripts.
- `$PLUGIN_ROOT/tsconfig.json`, `$PLUGIN_ROOT/vitest.config.ts`, `$PLUGIN_ROOT/tsdown.config.ts` — retain, remove absolute worktree references, and use only relative/package dependencies.
- `$PLUGIN_ROOT/src/client/index.ts` — effect-register exactly the production decoration/action/slot contributions; no smoke globals or throwing production provider.
- `$PLUGIN_ROOT/src/client/decoration-provider.ts` — adapter around the pure Markdown provider.
- `$PLUGIN_ROOT/src/markdown/ast-ranges.ts`, `native-mask.ts`, `diagnostics.ts`, and `provider.ts` — `parseGfm()`/MDAST position mapping, native masking, the three diagnostics, and pure provider output.
- `$PLUGIN_ROOT/src/commands/actions.ts`, `action-transforms.ts`, `$PLUGIN_ROOT/src/client/editor.tsx`, `styles.ts`, and `styles.css` — complete command set, toolbar, read-only preview, stylesheet lifecycle, and geometry-safe CSS.
- `$PLUGIN_ROOT/tests/unit/parser.client.spec.ts`, `action-transform.client.spec.ts`, `diagnostics.client.spec.ts`, `registry-lifecycle.client.spec.ts`, and `performance.client.spec.ts` — focused unit/action/diagnostic/lifecycle tests and only 1k/10k/50k performance measurements.
- `$PLUGIN_ROOT/tests/m1/decoration-adapter.client.spec.ts` and `tests/m1/composer-decoration.overlay.yml` — production-registration cleanup proof and portable installed-package overlay.
- `$PLUGIN_ROOT/README.md` and `docs/beta/M1_RESULTS.md` — concise consumer contract and final evidence; no test-orchestration history or machine paths.

### Ownership/load/unload order

The conversation service constructs registries before client contributions load. The plugin registers each provider, action, slot, and stylesheet through its own effect; every `register()` disposer is retained independently. `conversation.input.editor` is session-scoped and is removed with the session fiber. On HMR/unload, slot, action, decoration, and style effects dispose in reverse order; repeated cleanup is idempotent. Zero plugin contributions render the native baseline.

## One-pass tasks

### Task A — M1 hardening and portable seam

**Implementation:**

1. Commit the current plugin plan documents first, then verify the isolated Core branch/base and shared-checkout status without modifying the shared checkout. Preserve candidate commits and keep Core/plugin commit boundaries separate.
2. Replace the external-plugin Core smoke with the DSH test-only fixture package and repository-local overlay. The fixture uses draft markers to select a healthy range or throw; the production Core and plugin have no smoke flag, global, symlink, or throwing provider.
3. Shrink `/client` exports. `ComposerDecorationSegment`, `collectDecorations`, `renderSlot` plumbing, and `ComposerBarInjected` remain internal; update internal tests to import source-local types.
4. Replace `boundaries × ranges` with sorted start/end events and a per-layer priority heap/count map. Preserve `syntax → diagnostic`, priority, provider order/id/range ordinal, native clipping, deterministic class composition, and adjacent merging. Add one deterministic many-non-overlapping-range test.
5. Add the approved pure action-registry types/implementation only as specified in ADR-013, and expose no other Core API. Fix host/client project references rather than widening `rootDir`.
6. Retain the plugin’s three config files and convert them to relative/package-based configuration. Remove all absolute paths, globals, and production smoke providers. The HMR test stores every cleanup in an array and asserts every production registration is disposed once.
7. Update paired architecture/README/Agent Note prose and portable result records.

**Red → green:** first run the focused registry/action/InputBar checks and `pnpm run build:lib:host` to capture the candidate red evidence; after the edits run `pnpm run build:lib:host` and `pnpm run build:lib:client`, then the same focused checks. The green result must show current source-to-artifact resolution, no public segment/collector leak, no O(n²) full scan, and complete disposal.

**Commit boundary:** plugin documentation commit first; DSH Core hardening/self-contained-fixture commit; plugin portability/adapter commit. No product Markdown code in the Core commit.

**Failure/stop:** if the host error is not a project-boundary issue, stop before unrelated package edits and report the exact compiler edge. If the action API exceeds the four approved Core additions, remove the excess and stop for a precise decision.

### Task B — Markdown projection using existing GFM/MDAST

**Classification:** `PLUGIN_ONLY`.

**Implementation:**

1. Call the public DSH `parseGfm()` and consume MDAST node positions. Convert positions to UTF-16 half-open ranges; do not hand-write delimiter parsing or create a second Markdown renderer.
2. Mask generic `nativeRanges` before mapping positions, preserving newlines and string length. Native token/reference/text-reference ranges are never emitted as plugin segments.
3. Map heading, strong, emphasis, inline code, fenced code, quote, bullet list, ordered list, task, link, and strike nodes to syntax ranges. Fence nodes suppress inline children according to the MDAST tree.
4. Keep `decorate(context)` pure and synchronous:

```ts
const tree = parseGfm(maskNative(context.draft, context.nativeRanges))
return mapGfmPositions(tree, context.draft.length)
```

5. Reuse `MarkdownText` for preview data; the projection provider returns only public range records.

**Red → green:** parser unit tests first fail for missing node mappings, UTF-16 CJK/emoji offsets, native masking, and fence precedence; they pass after MDAST mapping and registry clipping are wired. Repeated input produces byte-for-byte identical ranges.

**Commit boundary:** plugin parser/projection commit only.

**Failure/stop:** if `parseGfm()` or its positions cannot represent a required visual, do not add a second parser; record the exact DSH API gap as a decision request and stop Task B.

### Task C — Pure actions, full command set, toolbar, and keyboard arbitration

**Classification:** action transforms and toolbar are `PLUGIN_ONLY`; action registration/execution is the approved `NEED_CORE` seam.

**Implementation:**

1. Implement the public pure contracts exactly:

```ts
interface ComposerActionContext {
  readonly draft: string
  readonly draftRev: number
  readonly selection: ComposerActionSelection
  readonly nativeRanges: readonly ComposerNativeRange[]
}

interface ComposerEditResult {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

interface ComposerAction {
  readonly id: string
  readonly order?: number
  readonly shortcut?: ComposerActionShortcut
  transform(context: ComposerActionContext): ComposerEditResult | undefined
}

interface ComposerActionRegistry {
  register(action: ComposerAction): () => void
}
```

2. InputBar obtains a read-only snapshot, runs the selected action, validates the single result against `draftRev`, UTF-16 boundaries, phase, and native ranges, applies one `keyboard.setDraft(next, editRange)`, restores the returned selection, and bumps one machine revision/undo unit. The plugin never receives a mutable callback or machine object.
3. Preserve native precedence: composing/229, native reference backspace/delete, slash/@ menu arbitration, Ctrl/Cmd undo/redo, Enter, Queue, and Steer all win. Registered actions cannot claim reserved native chords; a failed/throwing action is removed from that invocation and the textarea remains usable.
4. Implement exactly Strong, Emphasis, Inline Code, Link, Quote, Bullet, Ordered, Task, Code Fence, Indent, and Outdent. Each transform returns one contiguous edit result or `undefined`; a result touching a native occurrence is refused rather than split.
5. Render the toolbar through session-scoped `conversation.input.editor`. Button mousedown preserves textarea focus using the existing InputBar rule. No plugin event listener queries the textarea.

**Red → green:** action tests first prove that a public `setDraft(text)`-only plugin cannot retain selection/one edit range; the approved path then proves one transform result, one dispatch, one `draftRev`, one undo unit, unchanged occurrences, and native-key precedence.

**Commit boundary:** DSH Core action registry/InputBar executor commit; plugin action transforms and toolbar commit.

**Failure/stop:** if any command needs two edit results, occurrence codec access, DOM access, custom Enter handling, or a second editor, return `undefined` for that action and stop before weakening the invariant.

### Task D — Preview, expanded state, and deterministic diagnostics

**Classification:** `PLUGIN_ONLY` except the approved session-scoped editor state consumed by InputBar.

**Implementation:**

1. Register a session-scoped `conversation.input.editor` contribution with `runAction`, read-only `expanded`, and `setExpanded`. InputBar is the only executor and owns the state transition; the plugin gets no DOM or mutable edit function.
2. Render a read-only preview using DSH `MarkdownText` and the same MDAST-derived semantic data. It has no `textarea`, `contenteditable`, InputMachine, occurrence codec, or prompt serializer.
3. Implement exactly three diagnostics: unclosed fenced code, unclosed inline-code delimiter run, and malformed explicit link. Return stable diagnostic ranges with `layer: 'diagnostic'`; invalid/throwing providers fail open through the injected developer diagnostic without user-facing errors.
4. Apply expanded state only to the existing InputBar scrollport; the same textarea/backdrop/mirror nodes remain mounted. Decoration CSS sets only `color`, `background-color`, `opacity`, and `text-decoration`.
5. Add the one browser flow’s geometry comparisons for Latin, Chinese, Japanese, mixed CJK+Latin, emoji, short lines, soft wraps, long multiline drafts, scrolled state, native references, and selection.

**Red → green:** preview/diagnostic/action lifecycle tests fail on stale session contributions and nondeterministic diagnostics; the browser smoke passes with the same textarea, same reference occurrence, same scroll owner, no page error, and native submission after a provider throw.

**Commit boundary:** plugin preview/diagnostic/styles commit; only the approved editor state/slot changes belong in the DSH Core action commit.

**Failure/stop:** if expanded or preview requires a second editor, second scroll layer, font-metric CSS, or plugin DOM query, stop and remove that path.

### Task E — Packaging and real acceptance

**Implementation:**

1. Build the source plane and artifact plane in order: Core `build:lib:host`, Core `build:lib:client`, plugin `typecheck`, focused plugin tests, plugin bundle, and package payload inspection. Verify the client artifact has no smoke global, production throw provider, personal path, or adjacent checkout import.
2. Run only the Minimal test contract below, including the 1k/10k/50k timing budget measurements. Do not run full test, full coverage, fuzz, exhaustive overlap permutations, extreme-length suites, leak loops, WebKit, Firefox, or unrelated snapshots.
3. Pack the plugin and clean-install the tarball into a temporary profile with declared peer dependencies. Load it through the real DSH Loader, create/open a real session, and execute: mixed Markdown/CJK/emoji/reference input → decoration → format action → read-only preview → expanded same textarea → three diagnostics → native submit.
4. Assert final draft, native reference identity/display text, one action revision/undo unit, submit/Queue/Steer semantics, decorated/control geometry deltas, provider fail-open recovery, `pageErrors=[]`, and HTTP 200 from `pnpm dsh web --no-open --port 0` against the built artifact plane.
5. Run `pnpm run doc-sync` and `git diff --check`; check both isolated repositories, verify no temporary injection/process remains, and record commits, commands, timings, browser/DPR/viewports, install evidence, and cleanup in `docs/beta/M1_RESULTS.md`.

**Red → green:** clean-install and assembled Chromium are red if the packed plugin needs a workspace checkout or changes native semantics; green requires the real Loader, real session, full flow, HTTP 200, and clean isolated repositories.

**Commit boundary:** final plugin packaging/docs/result commit after Core and plugin implementation commits are locally verified. No push or PR.

**Failure/stop:** any automated Beta failure is `NO_GO` until repaired. Only real OS Chinese/Japanese IME may remain `USER_RUN_REQUIRED`; it does not downgrade the automated gate.

## Minimal test contract

- Focused Core registry/projection/action tests: zero/single/multiple providers, duplicate/dispose, native clipping, representative nested/crossing ranges, text conservation, invalid/throw fail-open, surrogate boundaries, deterministic many-non-overlapping sweep, action ordering, and one-result validation.
- One InputBar integration matrix: native occurrence, IME guard, `/`, `@`, reference insertion/deletion, Enter, Queue, Steer, selection, undo/redo, late registration/disposal, and action application.
- Focused plugin parser/masking, action-transform, diagnostic, lifecycle/fail-open, and one performance file with only 1k/10k/50k measurements.
- One real clean-install assembled Chromium happy path covering installation, real session, mixed Markdown/CJK/emoji/reference, decoration, formatting, preview, expanded mode, diagnostics, submit, and geometry.
- Build/typecheck/doc/pack/clean-install checks. Real OS Chinese/Japanese IME is `USER_RUN_REQUIRED`.

Explicitly deleted from the Beta test contract: fuzzing, exhaustive overlap permutations, WebKit/Firefox, extreme lengths, large leak/reload loops, full-repository tests, full coverage, repeated geometry suites, and unrelated snapshots.

## Definition of Done

- All eleven commands work: Strong, Emphasis, Inline Code, Link, Quote, Bullet, Ordered, Task, Code Fence, Indent, and Outdent. Visuals cover heading, strong, emphasis, code, fence, quote, lists, task, link, and strike. Preview is read-only; expanded mode uses the same textarea/backdrop/mirror/scrollport; diagnostics are exactly the three approved cases.
- InputMachine remains sole draft/transaction owner; native references remain atomic; Rich Editor never serializes the final prompt; IME, native triggers, references, submit, Queue, and Steer remain native.
- All eight M1 rework blockers are cleared. Core smoke is self-contained; public API is narrow; sweep is event-based; host/client builds pass; docs are paired; plugin configs are portable; production smoke hooks are absent; no personal paths remain.
- The packed plugin installs without the workspace checkout, real DSH web returns HTTP 200, the assembled main flow passes, and provider failure recovers without a page error. Both isolated repositories are clean, with separate reviewable commits and no temporary process/injection. Shared DSH user blobs and `rich_editor_control` remain unchanged.
- No automated Beta feature is deferred. The only remaining non-automated item is real OS Chinese/Japanese IME (`USER_RUN_REQUIRED`).

## Risks and stop conditions

| Risk | Stop condition |
| --- | --- |
| Host/client compiler graph still crosses `rootDir` | Stop before unrelated package edits; report exact `TS6059`/`TS6307`. |
| `parseGfm()` positions cannot support a visual | Do not write a second parser; record a precise API request and stop. |
| Action result overlaps a native occurrence | Reject the one result; never rewrite or split the occurrence. |
| Provider/action throws or returns invalid output | Drop only that contribution through the injected developer diagnostic; keep native Composer usable. |
| Decoration changes glyph metrics or scroll geometry | Remove the style and fail the geometry check; do not compensate with another layer. |
| Expanded/preview path adds an editor or scroll owner | Remove the path and stop; the Beta gate rejects it. |
| Clean install resolves an adjacent checkout | `NO_GO` for packaging until the tarball and declared dependencies work independently. |

**Remaining decision:** none. `DR-FB-001` is resolved by ADR-013/014 and the Core scope above.
