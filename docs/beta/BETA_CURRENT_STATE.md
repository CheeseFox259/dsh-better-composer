# RICH-EDITOR-BETA current state

M0 is `GO`: the existing DSH textarea/backdrop/mirror projection passed the approved Chromium normal-DPR geometry and native-interaction feasibility gate; the evidence is recorded in [M0_SPIKE_RESULTS.md](./M0_SPIKE_RESULTS.md).

The M1 candidate consists of Core `0e7e996863f49bd947fe65f501389b1afb8f15b1` and plugin commits `5a88590dff3a29f1213e8aeee22f33aa0295bf17`, `ec5e46faf96ad72bd2740bf6f5cdd55e536b8559`, and `f4978ed77448a7826ec9eaae1f6fa0f71929edfb`. It is retained as input to the one-pass rework, not as final Beta evidence.

InputMachine owns draft text, `draftRev`, occurrences, transactions, undo/redo, and submit snapshots. InputBar owns textarea DOM, selection, IME, native keyboard precedence, backdrop, mirror, and the single draft scrollport. Native references remain DSH-owned and are never serialized by the plugin. Current public input actions do not expose a selection-preserving edit range, so Task C must prove whether the smallest generic interaction face is necessary.

`$DSH_CORE_WORKTREE` names the isolated DSH implementation root; `$PLUGIN_ROOT` names the standalone plugin root; `$SHARED_DSH_CHECKOUT` remains read-only and retains the six user modifications plus `rich_editor_control`.
