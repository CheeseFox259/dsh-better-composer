# Canonical Context Map trial — 2026-09-27

Current trial: [http://127.0.0.1:56251/](http://127.0.0.1:56251/). Its authenticated browser tab is retained. Open a copied session under Ungrouped, then use the Composer donut to open **上下文地图**.

| Identity | Value |
| --- | --- |
| Canonical plugin | `/Users/superhacker/Codefield/dsh_plugins/dsh-better-composer` |
| Baseline | experimental / `3625ed80654100ae754518b27579d1acedd1ed68`; changes uncommitted |
| DSH source | `/Users/superhacker/Codefield/Work/Codefield/deepseek-harness` |
| DSH revision | `00102833dfaee1da9f48a3a8eae9d34005a75218` |
| Package | `@cheesefox/dsh-better-composer@1.0.0`, unreleased local checkout |
| Temporary home | `/var/folders/dw/zngwgn892pl1p6kzf_k99r9w0000gn/T/context-doctor-acceptance-JjGh3n` |
| Listener | `127.0.0.1:56251`, PID `68909` |
| Corpus | `/tmp/context-doctor-real-corpus.json`, private local file outside the repository |
| Import | 4 closed source sessions / 150 original events, recorded in the home's `real-session-import.json` |

```sh
pnpm run pack:check
node scripts/start-context-doctor-acceptance.mjs /Users/superhacker/Codefield/Work/Codefield/deepseek-harness /tmp/context-doctor-real-corpus.json
```

The launcher creates a never-used home and free port, links the current build, restores copies with the public format catalog, and installs native browse-picker support. It copies no credentials and starts no model request. Original events, text, usage, and mode identity are retained; only the copy's working directory changes. Opening copies may add native recovery/title events to those copies. Acceptance added one temporary fork and one withdrawn feedback occurrence; neither changes the source corpus.

All catalog/archive/persistence/Doctor capabilities are available. The two-turn sample remains two native turns. Its runtime donut and Composer show 16.6k composition tokens, while host-projected occupancy is 15.2k / 1.0M. The independent Doctor structure snapshot shows 16.5k. These are deliberately separate measurements. Four copied sessions show 1 / 2 / 1 / 3 native turns. The standard-mode sample funnel shows 6 candidates after the native empty session and test fork, with 2 eligible and computable samples.

The final UI passed desktop, 343px sidebar, dark/light theme, native source browsing, independent evidence selection, budget preview, anchor persistence, growth reveal, fork success, and feedback save/reload/withdrawal. System theme and the default viewport were restored. See [handoff](docs/context-doctor/handoff.md) for the complete evidence boundary.

Source hashes confirm all four original session files are unchanged. Original port 3080/PID 79496 and `~/.dsh` were preserved; no DSH core file changed. Retired owned listeners 50067 and 54818 were stopped and their tabs closed. Their launcher-owned homes were removed on exit. Historical UI evidence remains in `docs/archive/2026-09-26-doctor-ui/`.

The current trial is left running. Stop only this listener with `kill -TERM 68909`; its launcher removes the temporary home on exit. Build identity and exact served bytes are recorded in [runtime origin map](RUNTIME_ORIGIN_MAP.md).

Real external analysis and native summarization were not run. Local model fixtures cover their Host behavior and cancellation. The live gate is **LIVE_PROVIDER_ACCEPTANCE_USER_RUN_REQUIRED**: configure a model in this temporary profile and explicitly start a minimal analysis or compaction. The read-only map, diagnostics, evidence, and feedback already work without credentials.

2026-09-27 visual follow-up: the same isolated profile now loads a fixed-size growth anchor and the revised category palette through native client HMR. Host code and listener are unchanged. Browser geometry, both composition views, 320 tests, typecheck, and packaging passed. Current byte identity is in the origin map; `/tmp/context-integration-origin.json` preserves the original integration receipt.


## 2026-09-30 读取修复验收补记

以上56251为历史试用记录，不再承诺该端口可用。本次使用新临时home `/var/folders/dw/zngwgn892pl1p6kzf_k99r9w0000gn/T/context-doctor-acceptance-Uod9ID` 和52770，含两份2轮及一份1轮本地fixture，不复制凭据、不调用模型。冷启动、不同会话切换和原文浏览通过；收尾时52770已无监听器，home保留供复现。

Desktop profile `~/.dsh/profiles/desktop` 的插件链接指向canonical checkout；最新构建已就位。保留Desktop现有后台任务、未发送草稿和源会话，没有为验证强制重启。最终Desktop构建加载确认待任务结束后重启。原3080未改动。完整验收边界见handoff最新章节及runtime origin补记。
