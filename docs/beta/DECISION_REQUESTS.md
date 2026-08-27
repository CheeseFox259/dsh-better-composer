# RICH-EDITOR-BETA decision requests

There are no open M0 architecture or product decision requests.

Resolved decisions:

- /Users/superhacker/Codefield/dsh_plugins/dsh-rich-editor is the standalone out-of-tree plugin root. Its Git baseline and minimal package metadata may be created when M0-SPIKE is approved.
- M0 makes no permanent or public DSH Core change. M0-C may use one explicitly temporary local InputBar/backdrop projection patch in DSH test/source code, isolated in one commit and reverted after evidence. It is not an APPROVED_CORE_CHANGE or production API.
- M0-C does not establish a plugin DOM adapter, production client entry, public decoration registry, or other plugin integration seam. M1 separately designs the generic decoration API after geometry feasibility.
- M3 separately designs the generic atomic edit API.
- M0 geometry uses Chromium in the existing DSH web lane at its normal test DPR with the existing wide/narrow viewport controls. Missing WebKit, Firefox, and real OS IME evidence is assigned to M8 or user-run hardening and does not downgrade a passing M0 gate.
- M0-SPIKE may add only the smallest temporary local test wiring required for the projection experiment. It may not add a public registry, Core API, toolbar, commands, preview, diagnostics, expanded mode, contenteditable surface, InputBar fork, or second editor.
