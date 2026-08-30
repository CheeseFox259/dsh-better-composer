# RICH-EDITOR-BETA decision requests

No open M10 decision requests remain. The implementation uses `NO_NEW_CORE_API`.

## Resolved decisions

- **Settings:** Use the existing namespaced Settings service and `installSettingsSection` on the Host, `ctx.settingsScope.bind({ namespace })` in the browser, and the keyed `settings.plugin.item` slot. Persist `enabled`, `markdownVisual`, `diagnostics`, and `toolbarMode`; keep Preview visibility session-local.
- **Composition:** The package declares a self-contained `dsh.bundle` patch so `dsh plugin add` can activate it in a normal profile. No shared profile or DSH Core file is changed.
- **Ownership:** InputMachine and InputBar remain authoritative for draft, occurrences, transactions, DOM, selection, IME, scrolling, references, submission, Queue, and Steer. The plugin owns only optional Markdown projection and controls.
- **Failure:** Provider, action, Settings, and slot failures are isolated per contribution; the native Composer remains usable. No local storage, second editor, DOM adapter, public registry, or new reference provider is permitted.
- **Acceptance:** The isolated loader and HTTP checks are supporting evidence. Real ordinary-session browser interaction is required for the Beta gate. Real Chinese/Japanese OS IME is `USER_RUN_REQUIRED`; the current browser prerequisite is an environmental blocker, not a new architecture request.
