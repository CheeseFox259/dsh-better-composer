# RICH-EDITOR-BETA M1 results

## Recommendation

`M1_GATE = GO` is recommended for Sol review. The generic decoration seam, focused regression coverage, assembled Chromium smoke, external adapter, fail-open behavior, and required documentation are complete. M2 parsing and product presentation were not started.

## Baseline and commits

- DSH base: `bd5a03c09f62e85fb779e8347b1816a19b16a18e`.
- DSH branch: `codex/rich-editor-m1-decoration` in `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness-rich-editor-m1`.
- DSH Core commit: `0e7e996863` (`feat(ui-conversation): add generic composer decoration seam`), 24 files, 982 insertions, 7 deletions.
- Plugin branch: `main` in `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor`.
- Plugin adapter/docs commit: `5a88590` (`feat: add composer decoration adapter`), 13 files, 231 insertions, 323 deletions.
- The result record is committed separately after the focused verification rerun; its commit is listed in the final handoff.

The isolated DSH worktree was created from the approved base and the shared runtime checkout was not modified, cleaned, staged, or committed.

## Implementation path

`@deepseek-ai/dsh-client-ui-conversation` owns the public `ctx.conversation.decorations` registry. `register(provider)` returns an idempotent disposer; providers implement synchronous `decorate(context)`. The public context contains only `sessionId`, the exact draft, `draftRev`, and generic native ranges. Ranges are half-open UTF-16 offsets with fixed `syntax` and `diagnostic` layers, numeric priority, deterministic provider order plus id, native clipping, surrogate-pair boundary validation, and per-provider fail-open diagnostics through the injected Cordis logger.

The registry is root-scoped by the conversation service and publishes one version source. The existing InputBar derives native token, reference, and text-reference ranges from its current decoration state, collects plugin segments, and inserts spans only in native-free plain backdrop text. The textarea, mirror, single scrollport, caret, selection, IME, keyboard, slash and at-sign triggers, references, submit, Queue, and Steer paths remain native/InputMachine-owned. Zero providers return an empty contribution and preserve the old backdrop projection.

The out-of-tree plugin registers an inert normal provider and a test-only opt-in range/throw probe through `ctx.conversation.decorations`; both registrations are owned by adapter effects. It has no DOM adapter, Markdown parser, serializer, edit API, toolbar, preview, or product behavior.

## Exact checks and results

All commands below ran against the isolated DSH worktree unless a plugin path is explicit.

1. `pnpm run build` — attempted in the isolated worktree; `build:lib:host` stopped on host-aggregate `TS6059`/`TS6307` rootDir diagnostics plus existing `vendor/hmr` strictness diagnostics before the client build. No M1 source error was reported in that failure.
2. `pnpm run build:lib:client` — passed; it typechecked the client aggregate and bundled the client artifacts, including `packages/client/ui-conversation/lib/client.js` and its source map.
3. `pnpm exec tsc -b packages/client/ui-conversation/tsconfig.json --pretty false` — passed.
4. `pnpm exec vitest run packages/client/ui-conversation/tests/composer-decoration.client.spec.ts packages/client/ui-conversation/tests/input-decoration.client.spec.tsx packages/client/ui-conversation/tests/input-bar.client.spec.tsx packages/client/ui-conversation/tests/input-matrix.client.spec.tsx packages/client/ui-conversation/tests/service-orchestration.client.spec.ts --reporter=dot` — passed, 5 files and 112 tests.
5. `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/composer-draft-scroll.e2e.ts --reporter=dot` — passed, 1 file and 10 tests.
6. `pnpm exec tsc -p /Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/tsconfig.json --pretty false` — passed.
7. `pnpm exec tsdown --config /Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/tsdown.config.ts` — passed; generated ignored `lib/index.js` and `lib/client.js` artifacts.
8. `pnpm exec vitest run --config /Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/vitest.config.ts tests/m1/decoration-adapter.client.spec.ts --reporter=dot` — passed, 1 file and 1 test.
9. `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/composer-decoration.e2e.ts --reporter=verbose` — passed, 1 file and 3 tests in assembled Chromium.
10. `pnpm run verify-agent-note-format` — passed, 597 Agent Notes checked.
11. `pnpm run verify-translation-pairing .agents/notes/implemented/architecture/2026-08-28-generic-composer-decoration-seam.md packages/client/ui-conversation/README.md` — passed, 2 named pairs consistent.
12. `git diff --check` and staged whitespace checks — passed; the DSH Core commit hook also passed translation pairing, lint, whitespace, and vendor manifest checks.

The source plane was checked before the DSH build and focused tests. The assembled browser test loads the built DSH client artifact and the linked external plugin through a temporary harness-home profile symlink; it does not claim plugin-enabled coverage before the loader overlay and symlink are created in the test setup.

## Chromium smoke evidence

The assembled web lane used Playwright Chromium with viewport `1680x1000` and normal test DPR `1`. The smoke draft contains Latin, Chinese, Japanese, mixed CJK and Latin, emoji, a native `@src/` text reference, and 36 additional lines. It exercises the zero-provider control, opt-in decoration, native clipping, a throwing provider, native selection, and native typing after the failure.

The decorated and undecorated captures compared textarea, backdrop, mirror, and scrollport `clientWidth`, `clientHeight`, CSS width, CSS height, and `scrollHeight`; every delta was `<=0.5px`:

| layer | client width | client height | CSS width | CSS height | scroll height |
| --- | ---: | ---: | ---: | ---: | ---: |
| textarea | 778 | 940 | 778 | 940 | 940 |
| backdrop | 778 | 940 | 778 | 940 | 940 |
| mirror | 778 | 940 | 778 | 940 | 940 |
| scrollport | 778 | 336 | 778 | 336 | 940 |

The decorated capture normalized the scrollport to `scrollTop=0`; the control capture was auto-scrolled to `scrollTop=601` while filling the long draft, so scroll offset was recorded but intentionally not treated as a layer-geometry delta. The decorated and control backdrop text both equal the draft. For `before @src/ after`, native text is exactly `@src/`, plugin text is `before ` and ` after`, and the plugin segments never contain the native reference.

The deliberate throwing provider did not remove the healthy probe or native reference. The native textarea accepted selection and appended `!` after the throw, and the browser tripwire reported `pageErrors=[]`. The registry unit test captured the injected diagnostics `returned an invalid range result` and `threw while decorating: provider failed` for their respective provider ids. Browser console-warning output was not used as evidence because the Cordis browser logger retains structured diagnostics rather than exporting every warning to the page console.

## Cleanup and deviations

The assembled test closes Chromium and the web scaffold and removes its temporary harness home recursively; the plugin symlink exists only below that temporary home. Generated plugin `lib/` output is ignored. The isolated DSH worktree has no tracked temporary loader, DOM adapter, or production spike configuration; no `pnpm run clean` was run. The shared runtime checkout and `rich_editor_control` were preserved.

The plugin could not use DSH's `clientBundle()` helper because that helper requires the package manifest to live under `packages/*/*`. The standalone plugin therefore has a minimal local `tsdown.config.ts` and maps its two public DSH type imports to the isolated DSH built declarations. This is plugin-local build wiring and does not change the public Core seam. The full repository build remains a host-aggregate diagnostic outside the focused M1 client build; the successful client artifact build and assembled smoke are the M1 evidence.

## Limitations and risks

Evidence is Chromium-only at DPR 1 with the existing web-lane viewport controls. WebKit, Firefox, and real OS IME hardening remain later work. M1 intentionally skips broad property fuzzing, exhaustive range permutations, large reload loops, and unrelated full suites. The external adapter's range and throw providers are private smoke probes and contribute no production styling or Markdown behavior. Crossing overlap composition is deterministic and covered by representative nested/crossing cases, not an exhaustive permutation matrix.

The main follow-up risk is provider CSS: the seam validates class tokens and geometry-neutral rendering ownership, while each provider remains responsible for safe class rules. Future edit or Markdown capabilities must use separately approved M3/M2 work and must not expand this registry.
