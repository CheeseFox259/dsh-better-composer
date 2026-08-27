# RICH-EDITOR-BETA current state

## Scope

This record covers M0-A only: current-state inspection and M0-SPIKE planning. No Rich Editor implementation or geometry spike has been performed.

## Baselines

- DSH: `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness`, `master`, HEAD `bd5a03c09f62e85fb779e8347b1816a19b16a18e`, five commits ahead of `origin/master`.
- DSH has unrelated tracked edits in the minimal preset and system-prompt package, plus an untracked `rich_editor_control/`; these remain untouched.
- Before this audit, the requested plugin path had no files, Git metadata, or plugin-specific `AGENTS.md`. It now contains only the three files in `docs/beta/`; the plugin still has no Git baseline.
- Source-plane tests resolve workspace aliases to `src` through `vitest.config.ts` and `tsconfig.base.json`; existing `lib` outputs are not used by those tests. The web lane requires `apps/web/dist`, which was rebuilt before the real-composition smoke.

## Ownership findings

| Concern | Actual owner | Evidence |
| --- | --- | --- |
| `draft`, `draftRev`, occurrences, claim phase | One `InputMachine` per session | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/machine.ts:117-133`; published through `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/contract.ts` |
| Draft mutations and reference atomicity | `InputMachine.dispatch()` transactions | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/machine.ts:168-204,215-256`; edits reconcile ranges, update text, bump `draftRev`, and push one undo unit |
| Undo/redo | `InputMachine.log` and `redoStack`; `InputBar` intercepts the platform chord | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/machine.ts:128-129,378-404`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:400-414` prevents browser history |
| Textarea DOM, caret, selection, IME | Native `<textarea>` rendered and handled by `InputBar` | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:138-154,314-345,348-445,727-767`; the machine publishes no selection or IME state |
| Backdrop and mirror | `InputBar` derives decorations and renders `[data-input-backdrop]` plus `[data-input-mirror]` | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:635-684,727-767`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css:119-230` |
| Draft scroll | `InputBar` owns `[data-input-scroll]`, one box containing textarea/backdrop/mirror; wheel edges chain to the conversation host | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:203-236,286-309`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css:119-134,184-230` |
| Transcript scroll and composer seat | `ConversationRoot` owns `[data-conversation-scroll]`; the active composer seat is sticky or overlay-positioned | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx:181-190`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css:230-309` |
| `ComposerKeyboard` | A private structural command face supplied by `SessionInputShell`; `InputBar` is its only consumer | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/contract.ts:100-137`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/hub.ts:144-156` |
| `/` trigger and menu | `InputTriggerController` calls `detectTrigger`; `ui-commands` registers `command` and `ui-skill` registers `skill` | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-input-trigger/src/client/controller.ts:89-112`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-input-trigger/src/core/detect.ts:48-76`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-commands/src/client/service.ts:146-152`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-skill/src/client/index.ts:134-185` |
| `@` trigger and references | `detectTrigger` uses the file-reference grammar; `ui-reference` owns file/session candidates and `ReferenceInsert` values | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-input-trigger/src/core/detect.ts:50-61`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-reference/src/client/index.ts:34-89` |
| Submit and final prompt serialization | `InputMachine` starts the attempt; `SessionInputShell` executes adjudication, command submission, reference serialization, and the default sink | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/facade.ts:209-243,448-599`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/contract.ts:170-205` |
| Queue projection and row mutation | Runtime `SessionQueueMirror` and `SessionFace.updateQueue()`; `QueueDock` renders and mutates rows | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/runtime/src/client/sessions/queue-mirror.ts:23-71`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/runtime/src/client/sessions/session.ts:289-291,477-488`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/queue/QueueDock.tsx:31-64,190-217` |
| Draft Queue/Steer gestures | `InputBar` resolves the keyboard mode; `InputHub` performs whole-queue strict steering; the Host owns admission | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx:182-183,416-431`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/hub.ts:178-218`; `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/packages/client/ui-conversation/src/client/input/submission-policy.ts:42-76` |

Native references stay in the machine as complete display text plus occurrence ranges. `SessionInputShell` mirrors `projectClipboard()` to persistence and expands occurrences through the owning codec only during the submit attempt; it never delegates final prompt serialization to a rich editor.

## Baseline evidence

- Source-plane focused input/trigger suites: 15 files, 349 tests passed.
- `pnpm run build`: passed and rebuilt all DSH libraries plus `apps/web/dist`.
- Real DSH web smoke using the rebuilt artifact plane: `reference-composer.e2e.ts` and `steering.e2e.ts`, 2 files and 9 tests passed.
- Existing geometry suites were inspected but intentionally not run: `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/apps/web/tests/composer-draft-scroll.e2e.ts` and `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness/apps/web/tests/composer-tab-geometry.e2e.ts` remain the proposed M0-SPIKE controls.
