# RICH-EDITOR-BETA M10 results

## Gate

Result: `ACCEPTANCE_PENDING`.

M0 remains `GO`. M10 changes are plugin-only. The package now declares a portable `dsh.bundle` profile patch and was installed into an isolated temporary DSH profile. The profile composed `@deepseek-ai/dsh-rich-editor`, the Web server returned HTTP 200, and the package client resource was served. Real Composer interaction could not run because the required Chromium distribution is unavailable on this machine.

Plugin implementation commit: `9bfe9ae` (`feat: integrate rich editor beta into DSH profiles`). No M10 DSH Core commit was created; the approved M1 Core baseline remains unchanged.

## Implementation

The plugin implements four official Settings fields (`enabled`, `markdownVisual`, `diagnostics`, and `toolbarMode`), the keyed Settings card, Markdown projection from DSH `parseGfm()`, eleven pure actions, compact/hidden toolbar behavior, read-only Preview, same-textarea Expanded control, three diagnostics, Chinese-first copy, and independent effect-owned cleanup. No DSH Core source, shared profile, InputMachine, InputBar, local storage, second editor, production smoke hook, or DOM adapter was changed.

The package version is `0.1.0-beta.1`. The profile patch is `cordis.patch.yml`; it inserts the installed package as `dsh-rich-editor`, following the existing DSH bundle convention.

## Checks run

Commands were run from `$PLUGIN_ROOT` unless stated otherwise.

```text
pnpm exec vitest run tests/unit/settings.client.spec.ts tests/m1/decoration-adapter.client.spec.ts tests/unit/registry-lifecycle.client.spec.ts --reporter=dot
3 files, 8 tests passed

pnpm test -- --reporter=dot
8 files, 15 tests passed

pnpm run typecheck
passed

pnpm run bundle
passed; lib/index.js 33.54 kB, lib/client.js 26.56 kB

pnpm run pack:check
passed; @deepseek-ai/dsh-rich-editor@0.1.0-beta.1

git diff --check
passed
```

The focused tests cover settings normalization and live gating, Settings store disposal, independent production registration disposers, action transforms, parser/masking, diagnostics, performance budget observations, and the M1 adapter. The performance test records 1k, 10k, and 50k projection timings without a machine-specific threshold.

The latest performance observation was `1k=7.388 ms`, `10k=7.150 ms`, and `50k=24.389 ms` on this machine.

The pack payload contains `cordis.patch.yml`, `lib`, types, README, beta docs, and the existing focused M0/M1 fixtures. It contains no source checkout path. A portable-path/forbidden-hook scan found no personal path, smoke global, or throwing production provider in the current implementation/docs set.

## Isolated DSH installation and Web smoke

The temporary profile used these symbolic roots to avoid persisting machine-specific paths:

```text
DSH_HOME=$M10_HOME pnpm --dir $DSH_ROOT dsh plugin --profile web add $PLUGIN_ROOT/.pack-check/deepseek-ai-dsh-rich-editor-0.1.0-beta.1.tgz
DSH_HOME=$M10_HOME pnpm --dir $DSH_ROOT dsh --profile web --dump-config
```

The add command succeeded with a peer-dependency warning. The config dump ended with the package bundle row:

```text
# == @deepseek-ai/dsh-rich-editor
- id: dsh-rich-editor
  name: '@deepseek-ai/dsh-rich-editor'
```

The bounded Web command was:

```text
DSH_HOME=$M10_HOME node --import tsx/esm apps/cli/src/bin.ts web --no-open --host 127.0.0.1 --port 3093
```

It printed `dsh web: http://127.0.0.1:3093`; curl returned `HTTP_CODE=200`. Additional bounded checks at ports 3094 and 3095 returned HTTP 200; the page served the plugin client resource with a non-empty response. The known PIDs from the first wrapper launch and the direct launch were terminated, and read-only process checks found no remaining M10 test Web process on ports 3092–3095.

The ordinary DSH Web baseline at `http://127.0.0.1:3080` displayed version `0be1067`. Before this package was mounted, a normal Agent Session accepted `请只回复 OK` and returned `OK` in `1 turns · 1 steps`; `/api/session.prompt` was observed. Native `@` opened candidates and requested `/api/fileReferences/list` and `/api/sessionReferenceResolver/candidates`. No Rich Editor UI was visible in that pre-install session.

## Product evidence

The required Playwright command was attempted with the bundled wrapper:

```text
$PWCLI open http://127.0.0.1:3080 --headed
failed: Chromium distribution is unavailable
```

Therefore the following are not claimed as real DSH PASS: toolbar placement/use, Preview, same-textarea Expanded identity, diagnostics display, native reference formatting/deletion/undo, IME arbitration, Send, Queue, Steer, Settings card interaction, disable/re-enable, failed-write recovery, reload, restart, or Chinese UI display. Fixture/unit evidence supports the mechanics only. The detailed statuses are in [REAL_DSH_PRODUCT_ACCEPTANCE.md](./REAL_DSH_PRODUCT_ACCEPTANCE.md).

## Recovery and limitations

The Settings implementation uses the official Host namespace installer and browser scope; it does not create another persistence layer. The package install emitted a peer warning because `@deepseek-ai/dsh-settings` and `@deepseek-ai/schemastery` are direct Host runtime faces but are not currently declared in the plugin manifest. The DSH installation fallback supplied them for the bounded Web HTTP smoke. A dependency-authorization guard refused the attempted manifest addition, so clean-install portability of that Host path remains a release blocker until the dependency declaration is explicitly authorized.

The temporary profile directory remains available under the run's `$M10_HOME` for evidence; its Web processes were stopped. No shared DSH cleanup or write command was run. The shared checkout retained its known dirty user changes and `rich_editor_control`; this task made no write, restore, build, or clean call there.

Only real Chinese/Japanese OS IME is `USER_RUN_REQUIRED` by product policy, but the current missing Chromium prerequisite prevents reaching that step. No other unverified feature is promoted to Beta acceptance.
