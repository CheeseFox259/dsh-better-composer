# RICH-EDITOR-BETA M0 Implementation Plan

> **For agentic workers:** M0-A is complete. Execute M0-SPIKE only after Sol approval, and stop after the M0 gate. M1 and later milestones are outside this plan.

**Goal:** Establish the native Composer baseline and determine whether the existing textarea/backdrop/mirror projection can carry geometry-safe Markdown runs without changing native behavior.

**Architecture:** InputMachine remains the sole draft owner and DSH remains the only final-prompt serializer. M0-C uses one explicitly temporary, local DSH InputBar/backdrop projection patch, gated only for the spike and reverted afterward; it does not establish a plugin DOM adapter, a public decoration API, or a production client entry.

**Tech Stack:** DSH TypeScript/React client packages, the existing Vitest/jsdom tests, the existing Playwright Chromium web lane at normal test DPR, launchWebScaffold, and the existing textarea/backdrop/mirror layout.

---

## M0-A — current state and plan

M0-A has produced the source-backed ownership record in [BETA_CURRENT_STATE.md](./BETA_CURRENT_STATE.md), this M0-SPIKE plan, and the resolved-decision record in [DECISION_REQUESTS.md](./DECISION_REQUESTS.md). No plugin skeleton, temporary InputBar patch, geometry probe, or plugin-enabled test exists yet.

The DSH source baseline resolves workspace aliases to src. The real web lane first rebuilds DSH package lib artifacts and apps/web/dist, then launchWebScaffold serves the rebuilt artifact plane. The existing native baseline passed before this documentation revision; no product test or build is run as part of this revision.

## M0-SPIKE — future work after approval

### Scope guard

M0-SPIKE has two ordered substages:

1. M0-B runs the native DSH baseline with the temporary patch disabled.
2. M0-C enables the temporary local InputBar/backdrop projection and measures decorated-versus-undecorated geometry.

The temporary projection decorates exactly three syntax classes:

- Markdown headings.
- Inline code spans.
- Fenced code blocks.

It uses only geometry-safe visual properties: color, background or background-color, opacity, underline through text-decoration, and border color through an already dimensioned border. It must not set or change font family, font size, font weight, font style, line-height, letter-spacing, inline width, padding, margin, display, position, or any other layout-affecting property.

M0-SPIKE does not add a public registry, DSH Core API, toolbar, command, preview, diagnostic, expanded mode, contenteditable surface, InputBar fork, second editor, plugin DOM adapter, or production client entry. The temporary patch is not an APPROVED_CORE_CHANGE and is never a released API. M1 separately designs the generic decoration registry after geometry feasibility; the absence of that registry is not an M0 NO_GO condition.

Native reference occurrences remain DSH-rendered atomic ranges. The temporary projection skips or clips its ranges around those occurrences and never wraps or edits their child nodes. InputMachine, draftRev, selection, IME, keyboard, scroll, trigger, submit, Queue, and Steer ownership remain unchanged.

### Exact files intended for the spike

These files are planned, not created by M0-A:

- /Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/package.json: standalone Git-root package metadata only; M0 does not require a runtime or browser client entry from this package.
- /Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/docs/beta/M0_SPIKE_RESULTS.md: measured evidence and the final GO, CONDITIONAL_GO, or NO_GO result.
- /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/m0-spike-decoration.ts: temporary pure range derivation for headings, inline code, and fenced code only.
- /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx: temporary test-only flag and local backdrop projection branch; no public prop or export.
- /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css: temporary decoration rules limited to the allowed visual properties.
- /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/tests/m0-rich-editor-spike.client.spec.tsx: temporary exact-range, native-reference, and forbidden-style coverage.
- /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/apps/web/tests/m0-rich-editor.e2e.ts: real web-lane baseline and geometry test; it enables the temporary InputBar flag, not a plugin.
- /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/rich_editor_control/m0/M0_SPIKE_RAW.json: isolated raw measurements if the result document needs a machine-readable companion.

The plugin root may receive its standalone Git baseline, package metadata, documentation, and pure fixtures after approval, but M0 does not require a plugin loader entry or browser client. No result may be called plugin-enabled. The temporary DSH patch is isolated in one commit, and its commit hash is recorded before it is reverted.

### M0-B — native baseline

- [ ] Initialize the standalone plugin Git repository and minimal package metadata if reproducibility work is approved; do not add a production plugin entry, public registry, or DSH Core API.
- [ ] Create the temporary DSH InputBar/backdrop patch in one commit. Keep the test-only flag disabled by default and preserve existing DSH behavior when the flag is absent.
- [ ] Run the existing source-plane baseline for InputMachine, InputBar, triggers, references, Queue, and Steer:

    pnpm exec vitest run packages/client/ui-conversation/tests/input-machine.client.spec.ts packages/client/ui-conversation/tests/input-matrix.client.spec.tsx packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts packages/client/ui-conversation/tests/input-bar.client.spec.tsx packages/client/ui-conversation/tests/selection-survival.client.spec.tsx packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx packages/client/ui-input-trigger/tests/core-detect.client.spec.ts packages/client/ui-input-trigger/tests/core-menu.client.spec.ts
    pnpm exec vitest run packages/client/ui-commands/tests/service.client.spec.ts packages/client/ui-reference/tests/browser-plugin.client.spec.ts packages/client/ui-skill/tests/browser-plugin.client.spec.ts packages/client/ui-conversation/tests/queue-dock.client.spec.tsx packages/client/runtime/tests/queue-store.client.spec.ts packages/client/runtime/tests/conversation.client.spec.ts

- [ ] Map the baseline cases to existing tests and the M0 web test: basic and multiline typing; a 40-line draft; soft wrapping; a long line; one and multiple trailing newlines; paste; cut; undo; redo; keyboard selection; drag selection; /; @; reference insertion and deletion; automated compositionstart, compositionupdate, and compositionend events; draft and transcript scrolling; submit; Queue; and Steer.
- [ ] Build DSH with the temporary flag disabled and run the existing native geometry controls: /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/apps/web/tests/composer-draft-scroll.e2e.ts and /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/apps/web/tests/composer-tab-geometry.e2e.ts.
- [ ] Record native reference, caret, selection, scroll, trigger, submission, Queue, and Steer observations as the undecorated comparison values. Native baseline failure is NO_GO; do not continue to M0-C.

### M0-C — temporary geometry feasibility

- [ ] Enable the temporary local InputBar flag only from /Users/superhacker/Codefield/Work/Codefield/deepseek-harness/apps/web/tests/m0-rich-editor.e2e.ts. The test must not load a plugin client entry or mutate the textarea/backdrop from outside InputBar.
- [ ] Derive only heading, inline-code, and fenced-code ranges in m0-spike-decoration.ts. Treat the result as ephemeral render data; do not cache a second draft or revision.
- [ ] Apply only the allowed visual properties in the existing InputBar backdrop branch. Keep textarea, backdrop, mirror, and scrollport DOM ownership unchanged. Keep all existing native handlers for beforeinput, composition, selection, keyboard, paste, triggers, submit, Queue, and Steer.
- [ ] Run the same cases with the flag enabled and compare against the undecorated run. The geometry matrix must include Latin, Chinese, Japanese, mixed CJK+Latin, emoji, short lines, soft-wrapped lines, long multiline drafts, scrolled state, native references, and an active selection.
- [ ] For each matrix case, compare the native textarea's caret/selection offsets and measured caret reveal/selection geometry with the corresponding backdrop glyph and decoration rectangles. Record textarea, backdrop, mirror, and scrollport bounds; wrap width; scroll offsets; line positions; caret-to-glyph delta; selection start/end; and reference range positions. Compare decorated-minus-undecorated deltas, not only absolute values.
- [ ] Reuse the existing exact invariants where available: one [data-input-scroll] scrollport; equal textarea/backdrop/mirror wrap widths; no independent textarea scroll offset; unchanged caret-to-glyph gap during one scroll task; end visibility after typing or paste; and stable composer-card position across wide and narrow Chat and Trajectory layouts.
- [ ] Inject one deliberate temporary projection failure through the test-only flag, such as throw-on-first-decoration, and assert that the native textarea remains editable, native selection and scrolling remain available, references remain intact, and DSH can still submit. The failure must disable only the temporary projection and must not create a fallback prompt serializer.
- [ ] Write /Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/docs/beta/M0_SPIKE_RESULTS.md with DSH/plugin commit IDs, browser/DPR/viewport, exact commands, native and decorated measurements, failure-injection output, forbidden-style audit, and the gate result.

### Source-to-artifact and real DSH path

After approval and after the temporary patch is committed, run the stages in this order:

    pnpm --dir /Users/superhacker/Codefield/Work/Codefield/deepseek-harness run build
    pnpm --dir /Users/superhacker/Codefield/Work/Codefield/deepseek-harness exec vitest run --config vitest.web.config.ts apps/web/tests/composer-draft-scroll.e2e.ts apps/web/tests/composer-tab-geometry.e2e.ts apps/web/tests/m0-rich-editor.e2e.ts

The first command emits DSH package lib entries and apps/web/dist from the temporary source patch. The second boots the real DSH Loader composition through launchWebScaffold, runs the native geometry controls with the flag disabled, then runs the M0 test with the flag enabled, and exercises the rebuilt artifact plane. Source-plane Vitest checks remain separate and resolve DSH workspace aliases to src. A standalone plugin package, if created, is not part of this web artifact path and must not be described as loaded.

### Failure path and cleanup

A temporary patch exception, range-derivation failure, or forbidden-style check failure must disable only the temporary backdrop contribution and leave InputBar usable. The native textarea, InputMachine, draftRev, occurrences, selection, IME, scroll, keyboard, triggers, submit, Queue, and Steer remain authoritative. Stale native draftRev or occurrence ranges remain DSH CAS failures. The temporary code must never serialize a final prompt or replace a failed DSH submission.

Before cleanup, record the temporary DSH commit hash, DSH HEAD, plugin baseline if one exists, exact commands, raw measurements, and failure output. Revert the one temporary DSH commit and remove the temporary InputBar helper, CSS, unit test, and web test. Remove any temporary plugin test fixture unless it is explicitly retained as non-production evidence. Retain M0_SPIKE_RESULTS.md and the raw report only; no experimental client entry, public registry, or production configuration remains.

### Gate evidence

- GO: every approved M0-B and M0-C Chromium normal-DPR invariant passes; decorated-versus-undecorated geometry preserves the single-scrollport textarea/backdrop/mirror projection; references remain atomic; selection, automated composition events, triggers, submit, Queue, and Steer are unchanged; the deliberate failure leaves the native Composer usable; and no forbidden style or architecture change appears. Missing WebKit, Firefox, and real OS IME evidence assigned to M8 or user-run work does not downgrade GO.
- CONDITIONAL_GO: a localized M0-lane issue or bounded measurement uncertainty remains, but it can be fixed without changing InputMachine or InputBar ownership, introducing a second scroll layer or editor, violating native behavior, or adding a public/Core API. Later browser or real-OS-IME coverage alone is not a reason for CONDITIONAL_GO.
- NO_GO: any approved native baseline or Chromium geometry invariant fails; a native reference is wrapped or partially editable; caret/selection/decorations move outside the accepted comparison tolerance; a second scrollport or editable surface appears; a forbidden style is used; or temporary projection failure affects native editing or submission. The absence of an M1 decoration registry is not NO_GO.

### Risks

- The temporary DSH patch must be kept to one isolated commit and completely reverted; leaving it in production would turn an experiment into an unapproved Core change.
- The current InputBar backdrop has no public plugin decoration registry, which is expected in M0 and belongs to M1 design rather than this feasibility gate.
- Native selection, composition, scrolling, trigger arbitration, references, submit, Queue, and Steer are coupled across InputBar, InputMachine, InputTriggerController, InputHub, and runtime session state.
- Exact Chromium geometry evidence does not cover WebKit, Firefox, or real OS IME; those remain later hardening or user-run evidence and do not change the M0 Chromium gate.
