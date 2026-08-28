# RICH-EDITOR-BETA M0-SPIKE Results

## Gate result

**GO — M0-B and M0-C passed in the existing DSH Chromium web lane at normal test DPR.** The result answers the M0 feasibility question: the existing single-scrollport textarea/backdrop/mirror projection carried the temporary heading, inline-code, and fenced-code visual runs without measurable decorated-versus-undecorated geometry deltas or native Composer regressions.

This was an isolated experiment, not an APPROVED_CORE_CHANGE. The temporary DSH patch was reverted before handoff. No plugin client entry, DOM adapter, public decoration registry, Core API, second editor, or production configuration was created.

## Identity and source state

| Item | Value |
| --- | --- |
| DSH base before spike | `bd5a03c09f62e85fb779e8347b1816a19b16a18e` |
| DSH branch | `codex/rich-editor-m0-spike` |
| Temporary DSH commit | `baeaf71134e116e8e471bfaae00b0d8f6e13c11b` (`test: add isolated m0 composer geometry spike`) |
| Cleanup revert commit | `0be1067cf7` (`Revert "test: add isolated m0 composer geometry spike"`) |
| DSH handoff HEAD | `0be1067cf7` |
| Preservation recovery WIP commit | `34880f9cfe7686519cd4150bcd78e171074a0f21` (lint-staged backup, recovered by Sol) |
| Plugin baseline | `50da0b4ee69846c139f42ce9d05703c04a177239` |
| Plugin root | `$PLUGIN_ROOT` (standalone out-of-tree repository) |
| Raw browser evidence | `rich_editor_control/m0/M0_SPIKE_RAW.json` in the preserved control evidence |

The pre-spike DSH status listed six unrelated tracked modifications. During the hook/stash preservation incident, lint-staged left the preservation WIP as unreachable commit `34880f9cfe7686519cd4150bcd78e171074a0f21`; Sol restored these six paths byte-for-byte from that tree and verified every blob hash: `apps/cli/config/agent-presets/minimal/agent.cordis.yml`, `packages/core/system-prompt/README.i18n.yaml`, `packages/core/system-prompt/README.md`, `packages/core/system-prompt/README.zh.md`, `packages/core/system-prompt/src/index.ts`, and `packages/core/system-prompt/tests/system-prompt.spec.ts`. The temporary commit and its revert contain only the six spike files. After Sol’s recovery, no further DSH write, cleanup, restore, or commit command was run by this task.

## Implementation path exercised

The temporary DSH commit contained exactly six project-owned files:

- `apps/web/tests/m0-rich-editor.e2e.ts`
- `apps/web/tsconfig.json`
- `packages/client/ui-conversation/src/client/input/m0-spike-decoration.ts`
- `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`
- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
- `packages/client/ui-conversation/tests/m0-rich-editor-spike.client.spec.ts`

The pure helper derived UTF-16 ranges for exactly three syntax classes: Markdown headings, inline code spans, and fenced code blocks. InputBar used the current InputMachine-backed draft projection and the existing backdrop only while a page-local test flag was enabled. Protected native reference/token ranges were clipped out of temporary runs. No draft, draftRev, occurrence, selection, IME, scroll, keyboard, trigger, submit, Queue, Steer, or final-prompt ownership moved.

The temporary CSS used only `color`, `background-color`, `opacity`, `text-decoration-color`, `text-decoration-line`, and `border-color`. It did not set font family, font size, font weight, font style, line-height, letter-spacing, width, padding, margin, display, position, or other layout properties. The existing textarea, backdrop, mirror, and scrollport DOM remained in place.

The standalone plugin was not loaded by the web test. Its committed M0 contents are package metadata, documentation, and the pure fixture set; there is no production client entry or DOM adapter.

## M0-B native baseline

The source-plane baseline ran before the decorated comparison. The two focused commands covered 15 test files and 349 tests, all passing:

```text
pnpm exec vitest run packages/client/ui-conversation/tests/input-machine.client.spec.ts packages/client/ui-conversation/tests/input-matrix.client.spec.tsx packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts packages/client/ui-conversation/tests/input-bar.client.spec.tsx packages/client/ui-conversation/tests/selection-survival.client.spec.tsx packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx packages/client/ui-input-trigger/tests/core-detect.client.spec.ts packages/client/ui-input-trigger/tests/core-menu.client.spec.ts
Test Files  9 passed (9)
Tests       238 passed (238)
```

```text
pnpm exec vitest run packages/client/ui-commands/tests/service.client.spec.ts packages/client/ui-reference/tests/browser-plugin.client.spec.ts packages/client/ui-skill/tests/browser-plugin.client.spec.ts packages/client/ui-conversation/tests/queue-dock.client.spec.tsx packages/client/runtime/tests/queue-store.client.spec.ts packages/client/runtime/tests/conversation.client.spec.ts
Test Files  6 passed (6)
Tests       111 passed (111)
```

The baseline matrix covered basic and multiline typing, 40-line drafts, soft wrapping, long lines, trailing and multiple trailing newlines, paste, cut, undo, redo, keyboard and drag selection, `/`, `@`, reference insertion and deletion, automated composition events, scrolling, submit, Queue, and Steer through the existing InputMachine, InputBar, trigger, reference, runtime, and queue tests.

The source-to-artifact build then passed:

```text
pnpm run build
exit 0
Vite: ✓ built in 1.14s
build: recorded 200 client artifact(s) with 1 public value(s)
```

Only the repository's known build warnings appeared: unsupported native-platform notices, plugin timing/dependency hints, and a large-chunk warning.

The existing native web controls also passed against the rebuilt DSH artifact plane:

```text
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/composer-draft-scroll.e2e.ts apps/web/tests/composer-tab-geometry.e2e.ts
Test Files  2 passed (2)
Tests       17 passed (17)
```

Those controls confirmed the existing invariants: 14 visible lines in the native scroll probe, one textarea scroll offset, equal textarea/backdrop/mirror wrap widths, zero gap shift during scroll, caret/glyph alignment, and trailing-newline visibility. The Chat and Trajectory card positions remained stable in the wide and narrow layout controls; their existing negative-control compensation probe moved by 4 px as expected.

## M0-C geometry and interaction evidence

The real web test used `launchWebScaffold` against the rebuilt `apps/web/dist` artifact plane. It ran two pages per probe: the same DSH Composer with the temporary flag enabled and an undecorated control page. No plugin loader wiring was enabled.

### Browser and viewports

```text
User agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36
Device pixel ratio: 1
Viewports: 1680x1000 and 800x1000
```

The approved Chromium normal-DPR lane and its existing wide/narrow viewport controls were used. WebKit, Firefox, and real OS IME evidence remain M8/user-run hardening and do not downgrade this M0 gate.

### Full geometry matrix

The 9-case matrix ran at both viewports, for 18 decorated/control comparisons. Every numeric comparison key in the raw report had a maximum absolute decorated-minus-control delta of `0`: textarea width, backdrop width, mirror width, textarea scrollability, scroll height, client height, scroll top, scroll maximum, and measured mirror marker top/left.

| Case | 1680x1000 decorated = control | 800x1000 decorated = control |
| --- | --- | --- |
| Short Latin | width 778; height 52; marker `(16, 7)` | width 478; height 52; marker `(16, 7)` |
| Chinese | width 778; height 52; marker `(16, 7)` | width 478; height 52; marker `(16, 7)` |
| Japanese | width 778; height 52; marker `(16, 7)` | width 478; height 52; marker `(16, 7)` |
| Mixed CJK + Latin + emoji | width 778; height 52; marker left `52.1875` | width 480; height 52; marker left `52.1875` |
| Soft-wrapped line | width 778; scroll height 388; client 336; max 52 | width 485; scroll height 652; client 336; max 316 |
| Long multiline, 40 lines / 999 UTF-16 units | width 778; scroll height 964; client 336; initial top 52; max 628 | width 485; scroll height 964; client 336; initial top 316; max 628 |
| One trailing newline | width 778; height 52 | width 497; height 52 |
| Three trailing newlines | width 778; height 100 | width 497; height 100 |
| Exact Markdown runs | width 778; height 148; marker `(16, 79)` | width 497; height 148; marker `(16, 79)` |

The exact Markdown probe value was:

````text
# Heading `inline`
中文 日本語 mixed 😀
```ts
const value = `fenced`
```
after
````

The decorated page reported marker kinds `heading`, `heading,inline-code`, and `fenced-code`; the control page reported no M0 marker kinds. No extra syntax class was painted.

### Scroll, selection, and native references

The forced-bottom scroll probe produced identical decorated/control values: width `652`, scroll height `964`, client height `336`, scroll top and maximum `628`, textarea scrollability `0`, and marker top/left `(-621, 16)`. This preserved the single scrollport and mirror scroll projection.

The active-selection probe preserved `selectionStart=0`, `selectionEnd=25` for both pages, with equal width `666`, height `52`, marker `(16, 7)`, and textarea scrollability `0`. The browser test also exercised keyboard and drag selection; both paths passed.

The native reference probe produced the same decorated/control value and one reference occurrence on each page:

```text
# Heading
@reference.txt  `tail`
```

Both pages measured width `702`, height `52`, marker `(30.375, 31)`, and reference count `1`. The decorated page reported only `heading` and `inline-code` M0 kinds. The reference occurrence remained a single DSH-owned atomic chip/range and was not wrapped or partially decorated.

### Interaction matrix

The real DSH browser probe passed all of the following and wrote the booleans to the raw report:

```text
paste=true
cut=true
undo=true
redo=true
compositionstart/update/end=true
slash trigger=true
@ trigger and native reference insertion=true
submit=true
Queue=true
Steer=true
mode=replay
```

The replay-backed submit path used the native Composer action and the Queue/Steer paths used their native controls. The temporary projection did not add an action, command, serializer, or alternate submit path.

## Failure and recovery

The web test enabled the deliberate failure mode `throw-on-first-decoration`. The temporary projection threw during its first decoration attempt; InputBar caught the temporary failure and retained the native backdrop path. The recorded evidence was:

```text
injected: throw-on-first-decoration
nativeBackdropAvailable: true
nativeDraftAfterFailure: exact original sentinel prompt
nativeSubmit: true
recoveredBeforeQueueAndSteer: true
```

The sentinel prompt remained unchanged, native submission still completed, and recovery was confirmed before the Queue and Steer assertions. No fallback serializer or second draft owner was introduced.

## Commands and test results

The final focused source command included the 15 M0-B files plus the temporary pure helper test:

```text
pnpm exec vitest run packages/client/ui-conversation/tests/input-machine.client.spec.ts packages/client/ui-conversation/tests/input-matrix.client.spec.tsx packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts packages/client/ui-conversation/tests/input-bar.client.spec.tsx packages/client/ui-conversation/tests/selection-survival.client.spec.tsx packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx packages/client/ui-input-trigger/tests/core-detect.client.spec.ts packages/client/ui-input-trigger/tests/core-menu.client.spec.ts packages/client/ui-commands/tests/service.client.spec.ts packages/client/ui-reference/tests/browser-plugin.client.spec.ts packages/client/ui-skill/tests/browser-plugin.client.spec.ts packages/client/ui-conversation/tests/queue-dock.client.spec.tsx packages/client/runtime/tests/queue-store.client.spec.ts packages/client/runtime/tests/conversation.client.spec.ts packages/client/ui-conversation/tests/m0-rich-editor-spike.client.spec.ts
Test Files  16 passed (16)
Tests       354 passed (354)
```

The final combined real-web command passed:

```text
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/composer-draft-scroll.e2e.ts apps/web/tests/composer-tab-geometry.e2e.ts apps/web/tests/m0-rich-editor.e2e.ts
Test Files  3 passed (3)
Tests       19 passed (19)
```

The standalone M0 browser file also passed immediately before cleanup: 1 file and 2 tests. All tests above ran before the temporary commit was reverted; cleanup was verified afterward.

During implementation, the temporary hook/build loop exposed and corrected non-gate issues: a strict TypeScript narrowing error, the host e2e file's client-project exclusion, a trigger publication assumption, a Vitest/Playwright matcher mismatch, replay control sequencing, and a browser cut-event simulation that did not exercise Chromium's native shortcut. The final source, build, and web commands above passed after those corrections. None was a native baseline or M0 geometry-gate failure.

## Cleanup and final tree

The temporary patch was isolated in one commit, then removed with:

```text
git revert --no-edit baeaf71134e116e8e471bfaae00b0d8f6e13c11b
```

`pnpm run clean` removed 242 repository build paths. Verification found 84 untracked compiler artifacts created by the build in nine exact source directories, with zero tracked files among them; those artifacts were removed from only those directories. The final DSH tree was checked for the six temporary paths and contains none. The plugin retains its standalone baseline, M0 documentation, fixtures, and this results report. The raw browser report remains in the control root.

After Sol’s recovery, the final DSH status contains the six restored unrelated tracked modifications, the pre-existing `.dsh-eui-2/session-ui-projects.json`, and the pre-existing/task evidence under `rich_editor_control/`; no temporary spike file or generated artifact remains. The plugin repository is clean after recording this report.

The hook/stash preservation incident is resolved and is not an M0 behavioral deviation. Sol performed the restoration and verified the six restored blob hashes; this task did not modify those files.

## Known limitations and risks

- Measurements are Chromium Headless 149 at DPR 1 on the existing 1680x1000 and 800x1000 controls. Absolute pixel values can vary on another platform; the gate used decorated-minus-control deltas.
- WebKit, Firefox, and real operating-system IME behavior were not tested. They are later hardening/user-run work under the frozen M0 decision.
- The local InputBar/backdrop experiment was removed, so M1 must design the generic decoration API independently after this feasibility result. M3 must separately design the generic atomic edit API.
- The result does not authorize a DSH Core change, a public registry, a plugin loader seam, production Markdown behavior, or any M1 feature.

## Recommended gate

Accept the M0 behavioral result as **GO**. All approved M0-B native baseline and M0-C Chromium normal-DPR invariants passed; the single textarea/backdrop/mirror scroll projection preserved geometry, native references remained atomic, native interactions remained usable, the deliberate projection failure failed open, cleanup removed the temporary DSH experiment, and Sol restored the unrelated user files byte-for-byte. Proceed only under Sol approval to the separately scoped M1 generic decoration-API design.
