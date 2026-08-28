# `@deepseek-ai/dsh-rich-editor`

Standalone client contribution for the generic DSH composer faces. The client registers one synchronous decoration provider, eleven pure formatting actions, and the session-scoped `conversation.input.editor` slot.

The provider reuses DSH `parseGfm()` and `MarkdownText`. It returns only UTF-16 half-open visual ranges for headings, emphasis, code, quotes, lists, links, and strike-through text, plus the three approved diagnostics. Actions return one `ComposerEditResult`; InputBar owns validation, the InputMachine transaction, native occurrences, selection, IME, keyboard arbitration, scrolling, and submission.

The package never reads or mutates editor DOM, serializes prompts, or owns a second editor. Its production registration is effect-scoped and each disposer is retained independently, so removing the package restores the native composer. Build with the package scripts and provide the DSH client peer packages at runtime.
