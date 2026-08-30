# RICH-EDITOR-BETA decision requests

No open M10 decision requests remain. The implementation adds no new public Core plugin API.

## Resolved decisions

- **Settings:** Use the existing namespaced Settings service and `installSettingsSection` on the Host, `ctx.settingsScope.bind({ namespace })` in the browser, and the keyed `settings.plugin.item` slot. Persist `enabled`, `markdownVisual`, `diagnostics`, and `toolbarMode`; keep Preview visibility session-local.
- **Composition:** The package declares a self-contained `dsh.bundle` patch so `dsh plugin add` can activate it in a normal profile. No shared profile or DSH Core file is changed.
- **Ownership:** InputMachine and InputBar remain authoritative for draft, occurrences, transactions, DOM, selection, IME, scrolling, references, submission, Queue, and Steer. The plugin owns only optional Markdown projection and controls.
- **Failure:** Provider, action, Settings, and slot failures are isolated per contribution; the native Composer remains usable. No local storage, second editor, DOM adapter, public registry, or new reference provider is permitted.
- **References:** Complete native occurrences may move inside an action result only when Core can map each occurrence exactly and unambiguously; partial overlap, mutation, deletion, duplication, or reordering is rejected.
- **Acceptance:** Real ordinary-session interaction at `http://127.0.0.1:3096/` satisfies M10. Real Chinese/Japanese OS IME remains the sole `USER_RUN_REQUIRED` item.
