# RICH-EDITOR-BETA M1 Generic Composer Decoration Seam

M0 is `GO` per [M0_SPIKE_RESULTS.md](./M0_SPIKE_RESULTS.md). M1 implements the generic visual range seam only; no Markdown parsing, atomic edits, toolbar, preview, alternate editor, or serializer is included.

## Current M1 facts

`@deepseek-ai/dsh-client-ui-conversation` owns `ctx.conversation.decorations`. Providers register with `register(provider)` and implement synchronous `decorate(context)` callbacks. Ranges use half-open UTF-16 offsets, `layer: 'syntax' | 'diagnostic'` (default `syntax`), numeric priority, and a stable provider `order` plus id ordering. The context contains only `sessionId`, `draft`, `draftRev`, and generic native ranges.

The registry validates output, rejects surrogate-pair splits, clips native token/reference/text-reference ranges, composes disjoint class-bearing segments deterministically, and logs provider failures through the injected logger. Zero providers retain the native backdrop projection. InputBar remains the sole owner of DOM, caret, selection, IME, scroll, keyboard, and native interaction behavior.

## Exact implementation files

DSH Core is implemented only in the isolated worktree `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness-rich-editor-m1` on `codex/rich-editor-m1-decoration` from `bd5a03c09f62e85fb779e8347b1816a19b16a18e`.

- `packages/client/ui-conversation/src/client/contract/composer-decoration.ts`
- `packages/client/ui-conversation/src/client/input/decoration-registry.ts`
- `packages/client/ui-conversation/src/client/input/decorations.ts`
- `packages/client/ui-conversation/src/client/contract/slots.ts`
- `packages/client/ui-conversation/src/client/apply.ts`
- `packages/client/ui-conversation/src/client/service.ts`
- `packages/client/ui-conversation/src/client/index.ts`
- `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`
- `packages/client/ui-conversation/tests/composer-decoration.client.spec.ts`
- `packages/client/ui-conversation/tests/input-decoration.client.spec.tsx`
- Existing direct InputBar fixtures receive the new private hook/collector: `tests/input-bar.client.spec.tsx`, `tests/input-matrix.client.spec.tsx`, `tests/input-scenarios.client.spec.tsx`, and `tests/skeleton.client.spec.tsx`.
- `docs/architecture.md` and `.agents/notes/implemented/architecture/2026-08-28-generic-composer-decoration-seam.md` document the extension point and shipped ownership.

The standalone plugin root `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor` contains the thin `src/client` adapter, package metadata, README, and `tests/m1/decoration-adapter.client.spec.ts`.

## Essential checks

- Registry projection: zero/single/multiple providers, duplicate and idempotent disposal, native clipping, representative nested/crossing overlap, text conservation, invalid/throw fail-open, and surrogate boundaries.
- InputBar integration: zero-provider baseline, one provider, native reference precedence, and late register/dispose.
- Existing controls: focused input, trigger, reference, and composer geometry tests.
- Assembled Chromium: decorated/control geometry, native reference precedence, provider throw with developer warning and no page error, and usable native submission.
- Source-to-artifact order: typecheck/bundle `ui-conversation`, build the standalone adapter, verify the generated `lib/client.js`, then run the focused assembled browser test against those artifacts.

## Acceptance

M1 is accepted when the focused source tests and assembled Chromium smoke pass; provider failure leaves the native composer usable; the plugin adapter registers and disposes through the public face; the generic Core types contain no product-specific naming; and the DSH Core and plugin changes are in separate commits with no push or PR.
