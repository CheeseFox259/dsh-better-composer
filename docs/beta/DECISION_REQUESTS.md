# RICH-EDITOR-BETA M1 decision requests

There are no open M1 decision requests. Sol resolved the public owner as Option 1: `ctx.conversation.decorations` on `@deepseek-ai/dsh-client-ui-conversation`.

The shipped seam uses `register(provider)`, `decorate(context)`, half-open UTF-16 ranges, `syntax` and `diagnostic` layers, numeric priority, deterministic provider order plus id, per-provider fail-open diagnostics through the injected logger, and native token/reference precedence. M0 Core remains unchanged except for the temporary experiment already recorded in [M0_SPIKE_RESULTS.md](./M0_SPIKE_RESULTS.md); M1 owns the generic decoration seam, and M3 separately owns any generic atomic edit API.
