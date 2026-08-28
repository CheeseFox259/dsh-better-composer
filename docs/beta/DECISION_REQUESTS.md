# RICH-EDITOR-BETA decision requests

No open decision requests remain for the final Beta implementation.

## DR-FB-001 — resolved

- **Question:** What minimal generic Core face permits selection-preserving composer actions and same-textarea expanded presentation?
- **Facts:** InputMachine remains the sole draft and transaction owner; InputBar privately owns selection, IME, native keyboard arbitration, references, and the textarea/backdrop/mirror scrollport.
- **Evidence:** Existing InputBar `ComposerKeyboard.setDraft(text, editRange?)` already supplies the required single transaction path, while the public `InputActions.setDraft(text)` does not carry the edit range or returned selection.
- **Options:** Keep public faces only, or add the conversation-owned pure action registry and session-scoped editor slot.
- **Impact:** The approved option permits one action result, one InputMachine transaction, native occurrence protection, keyboard arbitration, and expanded state without exposing DOM, InputMachine, codecs, serializers, or a second editor.
- **Recommendation:** **Approved — Option 1.** Add only `ctx.conversation.actions`, the pure action/context/result/range faces, optional generic shortcut metadata for native-key arbitration, and `conversation.input.editor` with `runAction`, `expanded`, and `setExpanded`. Reuse existing `parseGfm()`; keep all Markdown behavior in the plugin.
- **Blocking scope:** Resolved. No additional Core API is authorized by this record; the M0 decoration decision and the later generic decoration/edit API decisions remain closed as already frozen.
