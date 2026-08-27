# RICH-EDITOR-BETA M1 decision requests

M0 has no open decision requests. The following is the one genuine M1 public-architecture choice that remains unresolved; it does not reopen any frozen ownership, geometry, atomic-edit, or milestone decisions.

## DR-M1-001 — owner of the generic decoration registry

### Question

Should the generic Composer decoration registry be exposed as `ctx.conversation.decorations` on the existing `@deepseek-ai/dsh-client-ui-conversation` service, or should DSH create a new `@deepseek-ai/dsh-client-ui-composer` package and service for that face?

### Facts

- InputBar, the native backdrop projection, the session input provider, and the existing `ctx.conversation` service are all owned by `@deepseek-ai/dsh-client-ui-conversation`.
- `ctx.conversation` already exposes cross-plugin input registries such as `input` and `blocks`.
- The proposed registry is read-only visual projection data. It does not own draft text, occurrences, prompt serialization, selection, IME, keyboard, scroll, or text edits.
- The registry must be generic and must not contain Markdown or Rich Editor naming.

### Evidence

- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/service.ts:35-50,100-115` defines the public `IConversation` face and its apply-fiber service lifetime.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts:171-192,280-365` constructs the per-apply registries, provides session input state, and registers the resident InputBar.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:583-678,720-768` derives native ranges and renders the existing backdrop inside the single scrollport.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/blocks.ts:27-75` is the closest existing per-plugin registry pattern in the owning package.
- `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-input-trigger/src/client/service.ts:40-68` and `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-input-trigger/tests/service.client.spec.ts:97-155` establish duplicate rejection, disposer behavior, late registration, and fiber teardown patterns.

### Options

1. **Extend `ctx.conversation` with `decorations` (recommended).** Put public types in `packages/client/ui-conversation/src/client/contract/composer-decoration.ts`, keep the concrete registry in `src/client/input/decoration-registry.ts`, and bridge the roster into InputBar through its existing private inject hooks.
2. Create a new `ui-composer` package and service that owns the registry, with a new loader row, public package entry, Core dependency, and an explicit bridge back into `ui-conversation`.

### Impact

Option 1 adds one generic property to an existing public service and keeps the registry beside the only renderer that can consume it. It minimizes activation edges, package count, and cross-package bridge code while preserving a future extraction path if Composer becomes an independent domain.

Option 2 gives the seam an independent package boundary immediately, but requires a new service and bundle surface for a registry whose first consumer remains InputBar. It increases activation, artifact, lifecycle, and compatibility testing without changing the ownership model.

### Recommendation

Choose Option 1. `ctx.conversation.decorations` is the smallest public generic face that follows the current ownership graph, existing registry conventions, and M0 geometry result. Keep the implementation private and export only the generic types and registry face.

### Blocking scope

Sol approval is required before creating the M1 branch or changing DSH Core. Once resolved, this choice blocks only the M1 registry/service wiring; it does not block independent plugin documentation or future M2 parser design.

Frozen decisions remain resolved: M0 made no permanent Core change; M1 owns generic decoration-seam design; M3 separately owns generic atomic edit design; InputMachine remains the sole draft owner; and native occurrences/interactions remain authoritative.
