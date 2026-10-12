# Canonical Context Doctor trial — 2026-09-26

The current trial is [http://127.0.0.1:50067/](http://127.0.0.1:50067/). Its browser tab is authenticated and retained for the user.

| Identity | Value |
| --- | --- |
| Canonical plugin source | `/Users/superhacker/Codefield/dsh_plugins/dsh-better-composer` |
| Plugin baseline | experimental / `3625ed80654100ae754518b27579d1acedd1ed68`, changes uncommitted |
| DSH source | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness` |
| DSH revision | `00102833dfaee1da9f48a3a8eae9d34005a75218` |
| Package | `@cheesefox/dsh-better-composer@1.0.0`; unreleased checkout, linked only to the temporary profile |
| Temporary DSH_HOME | `/var/folders/dw/zngwgn892pl1p6kzf_k99r9w0000gn/T/context-doctor-acceptance-aJMSQg` |
| Web listener | `127.0.0.1:50067`, PID `91878` |
| Source corpus | `/tmp/context-doctor-real-corpus.json`, local private file outside the repository |
| Import manifest | Temporary home `real-session-import.json`; 4 selected closed sessions, 150 original events |

Reproduce from this checkout:

```sh
pnpm run pack:check
node scripts/start-context-doctor-acceptance.mjs /Users/superhacker/Codefield/Work/Codefield/deepseek-harness /tmp/context-doctor-real-corpus.json
```

The launcher creates a never-used home and free localhost port, links the current build, uses native browse-picker support, restores copies through the public format catalog, and initiates no model call. Without the corpus argument it creates static fixtures. Original messages, events, usage and mode identity are retained; only the copy's working directory changes. Opening a copy can add native recovery/title events to that copy.

The final profile started with all three read capabilities available. Composer and overview both display approximately 17.9k estimated tokens for the selected real session. Native compaction config preview/application/restoration succeeds, with an explicit completion message. The trial ends with the basic provider restored.

Protected user runtime: `127.0.0.1:3080`, PID `79496`, and `~/.dsh` are preserved. SHA-256 checks confirm all four source session files are unchanged. No DSH core file was modified; DSH status remains its initial untracked `.dsh/` only.

Older owned trial listeners and tabs were stopped/closed. Their launcher-owned homes were removed on exit; the initial owned `/tmp/context-doctor-acceptance.vaZV0k` was also removed. Current build, packed package, local logs/origin receipts, screenshots, handoff, and the real source corpus are retained as evidence. Only this final trial stays running. Stop its listener with `kill -TERM 91878`; the launcher then removes this temporary home.

External model analysis and real summarization are **LIVE_PROVIDER_ACCEPTANCE_USER_RUN_REQUIRED**. They require configuring a model in this temporary profile and explicitly starting a minimal non-sensitive analysis or native compaction. They were not run in this task. Package/build/browser identity is proved in [runtime origin map](RUNTIME_ORIGIN_MAP.md); local gates and UI observations are in [handoff](docs/context-doctor/handoff.md).
