# `@deepseek-ai/dsh-rich-editor`

This standalone out-of-tree package is the M1 capability adapter for the generic composer decoration registry. Its client entry registers providers through `ctx.conversation.decorations` and unwinds those registrations through adapter fiber effects. The range-producing probe and throwing provider activate only when the assembled M1 browser smoke sets its private test flag; normal loading contributes no visible range.

The adapter has no Markdown parser or product presentation. It does not read or mutate editor DOM, own draft state, serialize prompts, edit occurrences, or handle keyboard, selection, IME, or scrolling. Those responsibilities remain with DSH Core and the InputMachine.

## Model Experience

None. This package contributes visual client projection only and does not reach model requests.
