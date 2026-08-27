# RICH-EDITOR-BETA M1 Generic Composer Decoration Seam Design Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the approved M1 design and stop for Sol review before creating an M1 branch or implementing DSH Core changes. Steps use checkbox syntax for tracking.

**Goal:** Design a generic, read-only, lifecycle-scoped, fail-open Composer decoration registry that lets optional client plugins contribute visual range classes while InputBar remains the only owner of Composer DOM, caret, selection, IME, scroll, and native keyboard behavior.

**Architecture:** The registry is a generic service face owned by the existing Composer package, while the renderer keeps all native token, reference, and text-reference runs authoritative. Providers receive an immutable session-scoped draft snapshot and return synchronous UTF-16 ranges; InputBar clips and composes those ranges into the existing backdrop projection without creating a second editor or serializer.

**Tech Stack:** DSH TypeScript client packages, Cordis services and reversible effects, the existing `ui-conversation` InputBar/backdrop/mirror projection, Vitest source-plane tests, `fast-check` property tests, and the real Chromium `launchWebScaffold` artifact-plane lane.

---

## M1-DESIGN scope

M0 is complete with `GO`; its measured evidence is in [M0_SPIKE_RESULTS.md](./M0_SPIKE_RESULTS.md). This plan covers M1 generic seam design only. It does not implement a DSH type, service, registry, renderer change, plugin client entry, Markdown parser, atomic edit transaction, toolbar, preview, diagnostics, expanded mode, contenteditable surface, InputBar fork, or second editor.

The M1 Core change remains approval-gated. The design uses no Markdown or Rich Editor name in a public Core type, method, module, CSS contract, or service name. Markdown range derivation and all product behavior remain outside DSH in the plugin and are M2 or later work.

Frozen decisions remain closed:

- InputMachine remains the sole draft, revision, occurrence, undo/redo, and submission owner.
- Rich Editor remains a projection and never serializes the final prompt.
- Native atomic occurrences and native interaction behavior win.
- M1 designs the generic decoration API; M3 separately designs the generic atomic edit API.
- Zero providers must leave the native Composer projection unchanged.

## Current native projection and insertion point

The current path is source-backed and must remain the implementation spine:

1. `InputBar` receives the session's `InputState` through `useInput`; `draft` is `input?.draft ?? ''`. The machine and its `draftRev` remain in `input/facade.ts` and `input/machine.ts`.
2. At `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:583-586`, `deriveDecorations(input, lexicon)` produces the native claim token, structured occurrence chips, plain text-reference ranges, and ghost hint.
3. At `InputBar.tsx:587-678`, the component builds one backdrop child list. A claim token, then native chip/text-reference boundaries, then plain draft text are rendered in draft order. Native chip nodes retain their icons and atomic range ownership.
4. At `InputBar.tsx:720-768`, `[data-input-scroll]` contains `.grow`, the absolute `[data-input-backdrop]`, the absolute transparent `<textarea>`, and the in-flow `[data-input-mirror]`. `.scroll` is the only scrollport; `.input`, `.backdrop`, and `.mirror` share wrapping metrics from `InputBar.module.css:119-230`.
5. `InputBar` retains all `beforeinput`/change, selection, composition, paste/cut, keyboard, trigger, submit, Queue, and Steer handlers. A decoration provider has no access to these handlers or DOM nodes.

The planned insertion point is immediately after native `deriveDecorations()` and before the current boundary list is rendered. InputBar will form a `ComposerDecorationContext` from the already-published draft and native protected ranges, invoke the internal registry collector, and pass the normalized plugin ranges to a pure composition helper. The helper adds class-bearing text segments only inside native-free plain spans; it does not replace the current chip/token/text-reference branch and does not mutate or query DOM.

## Proposed public API

### Owning package and public face

The recommended owner is the existing `@deepseek-ai/dsh-client-ui-conversation` package because it already owns InputBar, the native backdrop projection, the `ctx.conversation` service, and the session-scoped input provider. Public types live in:

`/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/contract/composer-decoration.ts`

The type-only public export is added from:

`/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/index.ts`

The service face is exposed as `ctx.conversation.decorations`. The concrete registry and render collector remain internal to:

`/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/decoration-registry.ts`

The one remaining owner choice is recorded in [DECISION_REQUESTS.md](./DECISION_REQUESTS.md). No Core code is written until Sol resolves it.

### Proposed types

```ts
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Public registration face for optional, visual-only Composer range providers. */
export interface ComposerDecorationRegistry {
  /** Register one provider; duplicate ids throw and the returned disposer is idempotent. */
  register(provider: ComposerDecorationProvider): () => void
}

/** One plugin-owned provider. The callback is synchronous, pure, and read-only. */
export interface ComposerDecorationProvider {
  /** Non-empty registry-wide identity; duplicate ids are rejected. */
  readonly id: string
  /** Provider roster order; defaults to 0. Lower values are considered first. */
  readonly order?: number
  /** Derive ephemeral ranges for one current session/draft snapshot. */
  readonly derive: (context: ComposerDecorationContext) => readonly ComposerDecorationRange[]
}

/** The only draft facts a visual provider receives. All offsets use UTF-16 units. */
export interface ComposerDecorationContext {
  readonly sessionId: SessionId
  readonly draft: string
  readonly draftRev: number
  /** Native draft ranges that are authoritative and unavailable to providers. */
  readonly nativeRanges: readonly ComposerNativeRange[]
}

/** One native protected range in draft coordinates. */
export interface ComposerNativeRange {
  readonly start: number
  readonly end: number
  readonly kind: 'token' | 'reference' | 'text-reference'
}

/** One visual-only plugin range in draft coordinates. */
export interface ComposerDecorationRange {
  readonly start: number
  readonly end: number
  /** One CSS class token supplied by the provider's own CSS module. */
  readonly className: string
  /** Composition lane; defaults to 0. */
  readonly layer?: number
  /** Winner within one layer at one text segment; defaults to 0. */
  readonly priority?: number
}
```

The public face deliberately contains no `InputState`, `Occurrence` codec, textarea ref, selection, caret, IME state, DOM node, React node, inline style object, callback to mutate draft, serializer, or final-prompt field. `draftRev` is an observation coordinate for provider memoization and diagnostics; it is not a write capability or an ownership transfer.

### Range semantics

`start` and `end` are half-open `[start, end)` offsets in JavaScript UTF-16 code units against the exact `context.draft` value. `0 <= start < end <= draft.length` is required. The collector rejects a range whose boundary splits a UTF-16 surrogate pair, because separate text nodes must not turn one scalar value into two replacement glyphs. Providers must derive ranges against the supplied draft and may not normalize line endings or rewrite text. Native range offsets use the same coordinate system.

The collector validates provider results at the plugin boundary: the return must be a synchronous array; every range must have an integer in-bounds interval, a finite integer `layer` and `priority` when supplied, and a non-empty whitespace-free `className` token. A malformed range invalidates that provider's result for the current render rather than partially applying it.

## Registry lifecycle and session ownership

The registry is constructed once in `ui-conversation` `apply()` beside `InputHub` and `ComposerBlockRegistry`. `ConversationController` receives the registry in its apply-time configuration and exposes only the `ComposerDecorationRegistry` face on `IConversation`. The concrete registry is not a second session or draft store.

A plugin registers through its own fiber effect, following the existing `ui-reference` and `ui-skill` pattern:

```ts
ctx.effect(
  () => ctx.conversation.decorations.register(provider),
  'plugin: composer decoration provider',
)
```

The registry returns an idempotent disposer. Disposal removes the exact provider instance, frees its id, increments the roster version, and notifies current Composer consumers. A stale or repeated disposer is a no-op. Duplicate non-empty ids throw synchronously before changing the roster or version. A provider registration is never silently replaced.

Provider ordering is deterministic and independent of Cordis activation timing: sort the roster by `(order ?? 0, id)`. A provider's range order is the returned-array ordinal after validation; the ordinal is retained only as a deterministic tie-breaker. Late registration and disposal republish the same stable version source so an already-mounted InputBar re-renders without a manual subscription.

The provider registry is root/plugin-fiber scoped, not session scoped. InputBar's existing session-maybe inject receives a package-private `useDecorationVersion` hook and a collector callback. The hook observes roster changes; each InputBar render supplies its own `sessionId`, current `draft`, `draftRev`, and native ranges to the collector. No provider result is cached in Core by session, and no session id is retained after a render. A plugin that needs per-session state owns that state and its session-scope disposer; the Core registry only retains the provider until the registering plugin fiber ends.

When `ui-conversation` is disposed, the registry clears providers and subscribers. Provider disposers that run after registry teardown are harmless. Session disposal unmounts the session's InputBar and its hook source; session switching creates no additional provider registration. The lifecycle tests must prove no callback runs after provider fiber disposal, session teardown, root teardown, or re-registration.

## Native precedence and clipping

Before collecting plugin ranges, InputBar converts the existing native product into protected ranges:

- `deco.token` becomes `kind: 'token'`.
- Each `deco.chips` range becomes `kind: 'reference'`.
- Each `deco.textRefs` range becomes `kind: 'text-reference'`.

The existing native renderer remains first-class. The native token, chip, text-reference, and hint paths are not converted into plugin classes, and the hint is outside draft coordinates.

The collector subtracts the union of all native protected intervals from every valid plugin range. A plugin range enclosing a native interval becomes up to two plugin fragments; a plugin range wholly inside or touching a native interval disappears. A native interval always remains a hard boundary, so no plugin class can wrap a chip, touch part of an occurrence, or style a native trigger token. Native ranges are not editable through this API, and the provider receives no codec or serializer.

The renderer then runs the existing native boundary loop. For each plain gap, the generic composition plan partitions text at all surviving plugin start/end offsets. Native runs are emitted exactly as today; plain segments receive the computed class list, or remain raw text when no plugin class is active. The concatenated text of all runs must equal `draft` exactly.

## Overlap, layers, priority, and composition

The API permits nested and crossing plugin ranges because the renderer does not attempt to nest DOM wrappers. It partitions at every boundary and emits one text span per segment, so crossing ranges cannot create invalid DOM nesting or alter glyph advances.

For each plain segment:

1. Collect all active plugin fragments.
2. Group them by `layer` (default `0`).
3. Within each layer, keep only the active ranges with the greatest `priority` (default `0`). Lower-priority ranges in that layer do not contribute classes on that segment.
4. Compose all equal-winning ranges across layers. Sort class tokens by ascending layer, provider order, provider id, then provider range ordinal, and remove duplicate class tokens while retaining the first occurrence.
5. Render the segment once with the deterministic space-separated class list.

Different layers therefore compose for nested or crossing syntax, while priority gives one provider a deterministic winner within a layer. Equal-priority overlaps compose instead of depending on DOM nesting. Class-list order is deterministic, but M1 does not pretend that HTML class order controls CSS cascade; providers must not use competing declarations for the same property unless their CSS rules define the intended result. The Core API accepts class tokens only, not inline styles or layout instructions.

Examples:

- Nested ranges `[1,5)` layer 0 and `[2,4)` layer 1 render segments `[1,2)` with the first class, `[2,4)` with both classes, and `[4,5)` with the first class.
- Crossing ranges `[1,4)` and `[3,6)` render `[1,3)`, `[3,4)` with both active classes, and `[4,6)`; no nested wrapper is created.
- Same-layer overlap with priorities 2 and 1 renders only the priority-2 class in the overlap. Equal priority renders both in the deterministic order above.

## Failure and fail-open model

Provider invocation and normalization are isolated per provider and per render:

- A provider throw is caught, logged with provider id and error to `console.error`, and contributes no ranges for that render.
- A non-array return, malformed range, invalid class token, invalid number, out-of-bounds interval, or surrogate-splitting boundary is treated as an invalid provider result, logged with provider id and reason, and contributes no ranges for that render.
- Other providers continue after one provider fails. If every provider fails, the plugin contribution is empty.
- The developer diagnostic excludes draft text and reference payloads. It does not call `input.notify`, create a toast, mutate InputMachine, reject submission, or alter native trigger/selection/IME behavior.
- A failed provider is not automatically deregistered. The provider remains eligible on the next render, while its current bad output is discarded. This keeps transient provider bugs observable and lets HMR or a plugin-owned fix recover without a hidden registry mutation.
- If collection itself encounters an unexpected error, the outer InputBar decoration branch catches it and uses the existing native backdrop product. No fallback serializer or alternate editor exists.

Registration-time invalid ids or ordering values fail loud to the registering plugin before the provider enters the roster. Runtime provider output is the fail-open boundary because it is executed during rendering and must not make the native Composer unavailable.

With zero providers, the roster version remains the initial empty source, collection returns `[]`, and the renderer follows the current native boundary loop without adding plugin spans or classes. This is the exact baseline case and must be asserted structurally and in Chromium geometry, not inferred from the absence of a service method.

## Plugin capability adapter boundary

The out-of-tree plugin's future M1 adapter is deliberately thin:

- `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/src/client/index.ts` will declare the `conversation` service dependency and register one provider inside `ctx.effect()`.
- `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/src/client/decoration-provider.ts` will hold the plugin-owned provider factory and CSS class names only; it will not read/query/mutate textarea, backdrop, mirror, or scroll DOM.
- `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/tests/m1/decoration-adapter.client.spec.ts` will drive the generic face with a fake service and prove registration/disposal without loading DSH internals.
- The plugin's production adapter will not serialize prompts, dispatch InputMachine edits, own occurrences, claim keyboard keys, or add a second editor. Markdown parsing remains outside this M1 adapter and belongs to M2.

The plugin package will gain a `./client` export and its normal `dsh.client` manifest only when the implementation milestone is separately approved. No loader wiring is added by this design turn.

## Exact files for a future M1 implementation

### DSH Core

- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/contract/composer-decoration.ts`: public generic provider, context, range, native-range, and registry types.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/decoration-registry.ts`: concrete root registry, stable version source, registration validation, provider invocation, native clipping, overlap composition, and developer diagnostics.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/decorations.ts`: expose the native protected-range projection from the existing `DraftDecorations` product without moving native ownership.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/service.ts`: add the registry face to `IConversation` and pass the concrete registry through the existing service configuration.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts`: add the package-private InputBar injection bridge for the version hook and collector callback; do not expose raw observables to plugin components.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts`: construct the registry, provide the absent source, wire it into the InputBar injection, and register the service with the existing apply-time lifecycle.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`: invoke collection at the native `deriveDecorations()` insertion point and render generic classes in plain backdrop gaps.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/index.ts`: export only the public generic types; keep registry implementation and render helpers internal.

### Plugin and documentation

- `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/src/client/index.ts`: thin registration adapter, only after implementation approval.
- `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/src/client/decoration-provider.ts`: plugin-owned provider factory boundary, with no DOM access.
- `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/tests/m1/decoration-adapter.client.spec.ts`: adapter registration and disposal tests.
- `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/package.json`: add the approved client export and declared dependency metadata only when the plugin implementation is started.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/README.md`: public usage and ownership documentation.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/docs/architecture.md`: generic Composer extension-point entry and package ownership.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/.agents/notes/implemented/architecture/2026-08-28-generic-composer-decoration-seam.md`: required Agent Note in the same Core PR, recording the accepted public face, range model, lifecycle, and fail-open guarantees.

This design update itself touches only the plugin documentation files named in the handoff; it does not create any file in the future implementation list.

## Test plan

### Source-plane unit tests

Add:

- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/tests/composer-decoration-registry.client.spec.ts`: registry identity, duplicate ids, order, id reuse, idempotent disposal, version publication, provider throws, invalid returns, diagnostics, zero providers, native clipping, surrogate-boundary validation, nested/crossing segmentation, layer/priority selection, deterministic class composition, and exact draft-text conservation.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/tests/input-bar-decoration.client.spec.tsx`: InputBar bridge wiring, native token/chip/text-reference precedence, absent source, no user-facing error on provider failure, and the unchanged native handler/DOM ownership path.

Extend only where lifecycle coverage belongs:

- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/tests/host.client.spec.ts`: plugin-fiber registration cleanup, root registry disposal, and no callback after teardown.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx`: session switch and re-mounted InputBar reuse the same provider roster without stale session results.

Use `fast-check` in the registry spec for random UTF-16 drafts and valid/invalid range sets. Properties must prove: output concatenates to the original draft; no emitted plugin segment intersects a native protected interval; segment boundaries are sorted and non-overlapping; same inputs produce the same class order regardless of provider registration timing; clipping is idempotent; and no range escapes `[0, draft.length)`.

Run source tests through the source plane, which resolves workspace aliases to `src`:

```text
pnpm exec vitest run packages/client/ui-conversation/tests/composer-decoration-registry.client.spec.ts packages/client/ui-conversation/tests/input-bar-decoration.client.spec.tsx packages/client/ui-conversation/tests/host.client.spec.ts packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx
```

### Browser and artifact tests

Add:

- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/apps/web/tests/composer-decoration.e2e.ts`: real `launchWebScaffold` test with zero providers, one provider, nested/crossing ranges, native references, provider throw, invalid return, late registration, disposal, session switch, reload, and no user-facing notice. Reuse the M0 wide/narrow geometry probes and compare decorated/control deltas for textarea, backdrop, mirror, caret, selection, scroll, wrapping, and native reference rectangles.
- `/Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor/tests/m1/decoration-adapter.client.spec.ts`: standalone adapter test against a fake generic registry face; it must not load DSH DOM or implementation modules.

The source-to-artifact ordering is:

```text
pnpm --filter @deepseek-ai/dsh-client-ui-conversation bundle
pnpm run build
pnpm exec vitest run packages/client/ui-conversation/tests/composer-decoration-registry.client.spec.ts packages/client/ui-conversation/tests/input-bar-decoration.client.spec.tsx
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/composer-decoration.e2e.ts apps/web/tests/composer-draft-scroll.e2e.ts apps/web/tests/composer-tab-geometry.e2e.ts
DSH_SNAPSHOT=replay pnpm run test:web
```

The first two commands produce package `lib` output and `apps/web/dist`; the browser commands consume that artifact plane through the real loader/scaffold. The source Vitest command remains separate from the artifact command. The plugin adapter test uses its standalone package setup and does not claim to be a DSH web smoke.

### Cleanup and leak coverage

The registry spec must dispose a provider fiber, attempt a stale double-dispose, reuse its id, dispose the root registry, and assert that no provider callback or version listener remains reachable through the test fake. The browser spec must reload and switch sessions, then assert that old provider calls stop and old classes do not appear in the new session. A zero-provider reload must preserve the M0 native geometry golden. These are cleanup assertions, not optional diagnostics.

## Design acceptance

M1 design is ready for Sol review when the public-owner decision is resolved and the plan above is accepted without reopening frozen M0, M1, or M3 decisions. Implementation approval requires a separate `APPROVED_CORE_CHANGE`.

The implementation gate must be `GO` only if:

- zero providers produce the existing native backdrop and geometry exactly;
- provider registration/disposal and session/root teardown leave no callbacks or listeners;
- duplicate ids fail loud without changing the existing provider;
- providers receive only the declared immutable UTF-16 context;
- native token, reference, and text-reference ranges remain authoritative and plugin ranges are clipped around them;
- nested and crossing ranges produce deterministic non-nested text segments;
- layer, priority, provider order, and class composition are deterministic;
- provider throws and invalid returns leave native editing, selection, IME, scrolling, triggers, submit, Queue, and Steer usable while leaving developer evidence without a user-facing failure;
- source and rebuilt artifact tests pass; and
- the Core diff contains only generic Composer names and no Markdown/RichEditor product behavior.

## Risks

- Choosing a new service/package instead of extending the existing `conversation` face would add a public activation and dependency seam; the choice is isolated in [DECISION_REQUESTS.md](./DECISION_REQUESTS.md).
- A registry version hook that is not wired through the existing injection cache could leave late provider registration invisible to a mounted InputBar; lifecycle tests must exercise registration after render.
- Crossing range composition can preserve text and geometry only if the renderer partitions plain spans rather than nesting arbitrary wrappers.
- CSS class conflict semantics cannot be inferred from class-list order; provider documentation and browser tests must keep visual declarations compatible.
- Provider callbacks run during render, so the first implementation must stay synchronous and un-cached. Performance-specific caching is out of scope and requires evidence.
- Native range extraction must remain coupled to `deriveDecorations()` so future occurrence or trigger changes cannot silently bypass clipping.
