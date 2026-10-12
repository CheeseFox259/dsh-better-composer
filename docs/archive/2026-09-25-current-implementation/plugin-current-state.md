# Plugin current state at archive time

## Major modules

- `src/client/editor.tsx`: official overlay integration, visual controller, table/code visual layers, completion layer, current post-paste long-insertion effect.
- `src/client/dom-mapping.ts`, `visual-controller.ts`, `decoration-composer.ts`, `highlights.ts`: DOM/source mapping and Markdown paint.
- `src/markdown/provider.ts`, `completion.ts`, `structural-editing.ts`: parser-driven decoration, Tab completion, structural commands.
- `src/client/clip-convert.ts`, `clip-store.ts`, `clip-source.ts`, `clip-panel.tsx`, `remote.ts`, `src/remote.ts`: clip persistence, chip/reference source, file delivery and Remote RPC.
- `src/client/index.ts`: settings, overlay slot, clip source registration, Remote mount and side-panel registration.

## Current long-paste path

A paste first reaches official Core. `editor.tsx` stores the previous draft, detects a large insertion in a later React effect, and calls `convertInsertionToClip`. That function tries the official session `slash/input-insert-reference` bail event using a revision-guarded span, then falls back to ordinary `insertText('@clip:id')` or `setDraft`.

The fallback can leave plain `@clip:id` text rather than a ReferenceChipNode. Core only serializes registered input-trigger occurrences, so pure-plugin migration must move long-paste conversion to capture phase before the original text enters Core.

## Current file delivery path

The plugin registers `clip` through `ctx.inputTriggers.registerSource()`. A real chip is serialized at submit time. File mode waits for the Remote face, persists the clip, publishes a workspace file, and returns a read-only file instruction. Reload metadata currently restores `text`, `mode`, `createdAt`, and `cwd` through the modified Remote contract.

## Current completion path

Bare `#` no longer projects a completion. Other popup candidates are accepted only by Tab; Enter passes to Core. The popup layer is rendered inside the Core scroll content and anchored to the caret.

## Migration result and boundaries

- The current plugin now intercepts paste before Core: long text uses a captured `InputActions` span plus `slash/input-insert-reference`; ordinary multiline text without occurrences uses `InputActions.setDraft`.
- `InputActions.setDraft` is safe for whole-draft plain text without chips, but places the caret at the document end and cannot preserve chip nodes.
- `InputActions.insertText` is safe for single-line replacement only on official Core; it does not split a `\n` into paragraphs.
- `slash/input-insert-reference` is the supported way to create a chip; the old post-paste fallback path is no longer active in the editor flow.
- Lexical internals and a second Lexical bundle must not be imported by the plugin.
- Mixed clipboard files/directories remain on the official Core paste path.
- Enter and Shift+Enter intentionally fail open to official Core. Tab/Shift+Tab indentation remains plugin-owned; the public seam has no reliable paragraph-break plus caret-preservation operation.

## Archive scope

This archive freezes the Core dependency separately. The plugin repository itself remains the working copy of the current implementation; use `git status`, `git diff`, and the tracked/untracked file list from the archive creation turn to reconstruct its full state. No commit or publish was performed.
