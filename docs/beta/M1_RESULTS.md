# RICH-EDITOR-BETA final Beta evidence

Status: Sol accepted the automated Beta gate. The only user-run item is real Chinese or Japanese OS IME input.

## Identity and scope

- Base: `bd5a03c09f62e85fb779e8347b1816a19b16a18e`.
- Core commits: `9869e8e56e1fadc2bbc1e50690c35c4a2b86e2f9` (generic seam and Beta support), `0e66075a87a7a448dc36447cb991b6bed77402b` (runtime narrowing fix), and `406d11f2dd543c5152887e1340be25da15a0200b` (native shortcut arbitration and final acceptance coverage).
- Plugin implementation/docs commit: `cfecc0d0b1de2e11ba2946087c6910f70e6afd68` (`feat: deliver markdown composer beta`).
- Evidence commits: `eefa8b780609c8881e44920070fdeb796e2bb28f` (`docs: record final beta acceptance evidence`) and `e20e37b4a4552c4cf22551a922e367d05b801238` (explicit commit IDs).
- Sol lifecycle hardening commit: `b1b1f78a7b4c702a78741eeb8422c8f4fb595356`.
- Work roots are represented by `$DSH_CORE_WORKTREE` and `$PLUGIN_ROOT`; no persistent result or source file requires a local absolute path.

The Core change is limited to the approved generic decoration hardening, `parseGfm()` export, pure composer actions, InputBar action execution/shortcut arbitration, and the session-scoped `conversation.input.editor` owner. Markdown parsing, masking, commands, toolbar, preview, diagnostics, and decoration CSS remain in the plugin.

## Implemented user flow

The installed plugin contributes heading, strong, emphasis, inline code, fenced code, quote, bullet, ordered, task, link, and strike-through decorations; the eleven required actions are Strong, Emphasis, Inline Code, Link, Quote, Bullet, Ordered, Task, Code Fence, Indent, and Outdent. Toolbar and keyboard shortcuts produce one pure edit result, which InputBar applies as one native draft transaction and undo unit. Preview is read-only, expanded mode reuses the existing textarea/backdrop/mirror/scrollport, and diagnostics cover only unclosed fences, unclosed inline-code delimiter runs, and malformed explicit links.

Native references remain atomic and authoritative. Provider throws or invalid ranges fail open for that provider/action, with injected developer diagnostics and no user-facing error. Zero providers retains the native projection and keyboard behavior.

## Checks and results

Commands were run from the corresponding repository root.

Core source and artifact checks:

```text
pnpm exec vitest run packages/client/ui-conversation/tests/apply-inject.client.spec.tsx packages/client/ui-conversation/tests/input-bar.client.spec.tsx packages/client/ui-conversation/tests/input-decoration.client.spec.tsx packages/client/ui-conversation/tests/input-matrix.client.spec.tsx packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx packages/client/ui-conversation/tests/skeleton.client.spec.tsx packages/client/ui-conversation/tests/composer-action.client.spec.ts packages/client/ui-conversation/tests/composer-decoration.client.spec.ts --reporter=dot
8 files, 146 tests passed
pnpm run build:lib:host
passed
pnpm run build:lib:client
passed
pnpm exec tsx scripts/run-oxlint.ts .
passed
```

The client build initially exposed two type-narrowing errors in the final runtime-check cleanup; both were corrected before the final Core commit and the client build then passed.

Plugin checks:

```text
pnpm test -- --reporter=dot
6 files, 8 tests passed
pnpm run typecheck
passed
pnpm run bundle
passed; lib/index.js 0.15 kB, lib/client.js 14.75 kB
pnpm run pack:check
passed; tarball contains lib, README, beta docs, and focused tests only
```

The plugin performance budget test recorded approximately 4.21 ms for 1k, 5.79 ms for 10k, and 21.36 ms for 50k draft projection on the test machine. These are budget observations, not a machine-specific threshold.

Sol's independent run recorded approximately 7.57 ms for 1k, 10.68 ms for 10k, and 27.84 ms for 50k. The Core shortcut tests reject unmodified and native-reserved chords, and the InputBar integration test proves registered actions remain inactive during IME composition. Plugin registrations now give each provider, action, and slot its own effect-owned disposer; the command table checks the expected replacement text for all eleven actions.

Documentation and hygiene checks:

```text
pnpm run doc-sync
passed
pnpm run verify-export-jsdoc
passed
pnpm run verify-translation-pairing
passed
git diff --check
passed
```

## Assembled and real-runtime evidence

The self-contained Core fixture and the clean-installed plugin both ran through the assembled Chromium web lane:

```text
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/composer-decoration.e2e.ts --reporter=dot
1 file, 1 test passed (repository fixture)
DSH_RICH_EDITOR_PACKAGE=<clean-installed-package> pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/composer-decoration.e2e.ts --reporter=dot
1 file, 1 test passed (clean-installed plugin package)
```

The clean-installed flow exercised installation, mixed Markdown/CJK/emoji/reference input, native reference preservation, decoration, Strong toolbar action, Control+B arbitration, read-only Preview, same-textarea expanded mode, unclosed-fence diagnostics, and native submit. The decorated/control geometry record was:

```json
{"input":{"clientHeight":172,"clientWidth":778,"height":172,"scrollHeight":172,"width":778},"backdrop":{"clientHeight":172,"clientWidth":778,"height":172,"scrollHeight":172,"width":778},"mirror":{"clientHeight":172,"clientWidth":778,"height":172,"scrollHeight":172,"width":778},"scroll":{"clientHeight":172,"clientWidth":778,"height":172,"scrollHeight":172,"width":778}}
```

The final flow also filled a 40-line draft, marked the resident textarea, expanded the Composer, and asserted both a larger scrollport client height and the same textarea identity.

The self-contained fixture also exercised a throwing provider. The browser run recorded no page errors, the native reference remained visible, typing and Enter submit remained usable, and the provider failure did not remove the native composer.

The real DSH web smoke was run from the built isolated Core artifacts:

```text
DSH_HOME=<temporary-home> pnpm dsh web --no-open --port 0
curl -sS -o /dev/null -w 'HTTP_CODE=%{http_code}\n' <reported-url>
HTTP_CODE=200
```

The launched web process tree was stopped after the HTTP check and no matching DSH web process remained. The clean-installed package emitted only expected missing-peer warnings in its empty temporary install; the assembled DSH run supplied the host peers.

## Cleanup and repository integrity

- The Core worktree and plugin repository are clean after their final commits.
- No temporary DSH injection, smoke global, production throwing provider, second editor, or second scroll layer remains.
- The plugin tarball is portable: its configs use package dependencies and relative paths, and its source/docs contain no personal checkout path.
- The shared DSH checkout was not written, built, cleaned, restored, or committed during this implementation. Its six pre-existing tracked user-file blob hashes and `rich_editor_control` were preserved; its original dirty status remains unchanged.
- The earlier M0 hook/stash preservation incident and Sol recovery remain recorded in the M0 evidence; no new preservation incident occurred in this pass.

## Limitations and gate

Automated Beta deliberately does not add fuzzing, exhaustive overlap permutations, extreme-length matrices, leak loops, full-repository tests, full coverage, WebKit, Firefox, or repeated geometry suites. Those checks are outside the minimal contract. Real Chinese/Japanese OS IME behavior is `USER_RUN_REQUIRED`; it is the only deferred Beta check and does not block the automated gate.

Decision: `BETA_ACCEPTED`. No automated Beta feature remains incomplete.
