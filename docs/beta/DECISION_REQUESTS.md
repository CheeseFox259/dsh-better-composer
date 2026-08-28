# RICH-EDITOR-BETA decision requests

## DR-FB-001 — Minimal generic composer interaction face

**Status: APPROVED BY SOL — refined option 1**

**Question**

May the one-pass Beta add the smallest generic Core interaction face required for selection-preserving format actions, shortcut arbitration, and same-textarea expanded mode?

**Facts**

InputMachine already provides one transactional `draft-changed` path, optional `EditRange`, `draftRev`, occurrence reconciliation, and undo/redo. `InputActions.setDraft(text)` is public but has no selection or edit range. `ComposerKeyboard.setDraft(text, editRange?)`, `selectionOf()`, `beforeinput`, IME guards, and native key routing are private to InputBar. Existing composer slots expose `InputZone { session, input }`, not the live DOM selection.

**Evidence**

`$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/input/machine.ts` records one transaction per accepted draft mutation. `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/input/contract.ts` exposes the full edit-range form only on the InputBar-private `ComposerKeyboard`; `$DSH_CORE_WORKTREE/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` owns selection, composition, native keyboard precedence, and the single textarea/backdrop/mirror scrollport.

**Options**

1. Approve a conversation-owned `ComposerActionRegistry`. Providers return one pure edit transform; InputBar alone reads selection, validates the result, performs one transaction, and restores selection. A session-scoped `conversation.input.editor` slot exposes `runAction(id)`, `expanded`, and `setExpanded(value)` to presentation contributions.
2. Keep the existing public faces only. This supports projection and read-only preview, but it cannot prove one format action is one machine transaction while preserving selection and native occurrence ownership.

**Impact**

Option 1 adds a small generic Core seam and focused tests; it does not expose DOM, Markdown types, prompt serialization, or a second editor. Option 2 makes the full Beta acceptance criteria impossible without violating InputBar ownership or using an unsafe plugin DOM path.

**Recommendation**

Approved as refined above. The plugin receives no mutable `replace()` callback, DOM reference, machine, occurrence codec, or serializer. Expanded state is slot-scoped rather than part of the global registry. DSH also exports its existing generic `parseGfm()` function so the plugin does not create another Markdown grammar.

**Blocking scope**

Resolved for the final one-pass implementation. No additional Core interface may be added without a new Sol decision. This does not reopen the frozen M0 decision or decoration-registry ownership.
