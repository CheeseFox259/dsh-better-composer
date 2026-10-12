---
description: "Adds deterministic Markdown presentation and local editing aids to a DSH Web Composer without taking ownership of source or submission."
kind: "package-bundle"
---

# @cheesefox/dsh-better-composer

English | [中文](README.zh.md)

[![CI](https://github.com/CheeseFox259/dsh-better-composer/actions/workflows/ci.yml/badge.svg)](https://github.com/CheeseFox259/dsh-better-composer/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@cheesefox/dsh-better-composer)](https://www.npmjs.com/package/@cheesefox/dsh-better-composer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Summary

DSH Better Composer adds source-preserving Markdown presentation, and fixed local completion candidates to a DSH Web Composer. The profile layer contributes Settings and editor presentation through the public DSH composer seams. DSH Core remains the owner of source, selection, history, Context Objects, and Send/Queue/Steer. Long pastes can convert into editable reference chips whose LLM-assisted rewriting runs as an independent one-shot call outside the session event stream.

![Live Markdown presentation in the composer — syntax markers reappear on the active line](https://raw.githubusercontent.com/CheeseFox259/dsh-better-composer/main/docs/screenshots/markdown-visual.png)

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Context Doctor (experimental)

This branch integrates Context Doctor into the **Context Map** workspace. One composer donut opens four pages: overview, diagnosis, analysis, and feedback, with independent session and mode scopes. The overview retains the complete native map, including message/step/turn browsing, system and tool sources, cache statistics, growth, anchors, compaction, and forks. It defaults to the host's live composition; a separate structural view uses persisted Doctor snapshots and character/4 estimates. Both views use one interactive donut with a blue/white/gray interface, distinct muted category colors, and native DSH theme tokens. Composition totals, window occupancy, and provider-reported usage remain distinct.

Hover or keyboard focus previews a category; clicking a sector, legend, or category fixes the browse selection. Adding evidence to analysis is a separate action that retrieves canonical source text from the Host. Aggregate tool nodes first expose their source collection for selection. Diagnosis retains evidence filtering and pagination; analysis previews the range, model, and budget before an explicit start. Page navigation preserves browsing and selection, while scope changes invalidate old plans. Historical content remains readable and available for feedback; content outside the effective context cannot enter a current analysis. Candidate requirements retain original text, conditions, exceptions, and sources. Confirmed source deletion removes source excerpts and cached analysis results. Restored legacy Doctor tabs redirect to diagnosis through the public sidebar API (`0.1.7-alpha.2`). Statistics never call a model or activate a cold Agent.

The optional `@cheesefox/dsh-better-composer/doctor-compaction` entry is enabled through a mode configuration preview and explicit confirmation. It preserves the existing thresholds, model route, and output ceiling while enhancing the input of the original single summary call. It adds no verification or retries, affects new Agents only, and never adds compaction to a mode without it. Restore the basic provider before uninstalling.

Run an isolated keyless trial from the plugin root:

```sh
pnpm run bundle
node scripts/start-context-doctor-acceptance.mjs /path/to/deepseek-harness
```

The launcher creates a temporary DSH_HOME, a free port, and static fixtures. An optional third argument accepts a local corpus JSON whose entries contain public-format `header`, `rows`, `source`, and `sha256`; the public format catalog restores copies into the temporary workspace and writes an import manifest. Keep private session text outside the repository. The launcher copies no credentials, starts no model requests, and removes its temporary environment on exit. Real model analysis and summarization require user configuration and an explicit start. Published npm version `1.0.0` does not contain this branch's unreleased Context Doctor.

<a id="use-this-package"></a>
## Use this package

### Requirements

- A native DSH installation with the `web` profile available.
- DSH `0.1.7-alpha.2` or a newer release that satisfies the peer dependencies in this package. The release tested against the source tree is `@deepseek-ai/dsh@0.1.7-alpha.2`.
- Node.js `>=20` and pnpm `>=10`.
- A workspace directory that DSH can open. File-mode pasted clips need a known workspace path.

Check the native installation before adding the plugin:

```sh
dsh --version
dsh web --no-open
```

Stop the temporary web process after confirming the page opens, then install the plugin into the profile you use to run Web DSH.

### Install the published package

```sh
pnpm dsh plugin --profile web add @cheesefox/dsh-better-composer@1.0.0
pnpm dsh web --no-open
```

Open the Web URL printed by DSH. Go to **Settings → Built-in plugins → Better Composer** to verify the plugin contribution is loaded. Create a new session and confirm the Composer overlay and the `+` menu are present.

### Install directly from GitHub source

```sh
git clone https://github.com/CheeseFox259/dsh-better-composer.git
cd dsh-better-composer
pnpm install
pnpm run bundle
cd ..
pnpm dsh plugin --profile web add ./dsh-better-composer
pnpm dsh web --no-open
```

The source install is useful for development and always uses the current checkout. It does not modify DSH Core; the package is a profile bundle patch plus Host/Client plugin entries.

### Verify the first installation

1. Open a new session in the Web UI.
2. Paste text longer than the configured threshold and confirm it becomes a `粘贴文本` chip.
3. Open the chip and select **文件送达**. Choose a text or code extension in the **文件类型** selector, then save an edit and confirm the file is written under `.dsh/pastes/` when the message is sent.
4. In the clip editor, test **撤销** and **重做** after manual edits and after applying an LLM rewrite preview.
5. Open **Settings → Built-in plugins → Better Composer** and adjust the long-paste threshold. The file extension is selected per clip, not in global Settings.

### Remove the plugin

```sh
pnpm dsh plugin --profile web remove @cheesefox/dsh-better-composer
```

Restart Web DSH after changing profile composition. Removing the plugin removes its overlay, Settings card, clip source, sidebar tab, and Remote contribution; it does not modify existing DSH session history or Core source.

The package is a `dsh.bundle.patch` profile layer. The patch inserts one `dsh-better-composer` row into the active profile. The client entry is loaded only on the Web platform and depends on the public conversation, renderer, Settings, and Settings-plugin packages declared in `package.json`. The experimental Context Doctor requires the declared `0.1.7-alpha.2` public seams; its development dependencies pin that version. See the runtime verification record for the exact tested host revision.

### What you get

- Markdown visual enhancement for headings, emphasis, links, task lists, quotes, tables, fenced code, and source-preserving attachment labels.
- Deterministic local completion for approved fence-language, task-marker, and heading-spacing candidates, plus a bounded ghost for approved prompt-section headings.
- Context map (composer donut opens the right sidebar): host-projected occupancy / model window, interactive composition donut, structure stats, and per-turn growth. Full history browsing drills down message category → turn → step → source text. Each growth bar opens a turn breakdown with anchoring and jump-to-message; system prompts and tool inventory are viewable in full.

  ![Unified Context Map workspace](docs/screenshots/context-workspace-light.png)

- Context management: run `/compact` in-place (with confirmation and a compacting state; compaction checkpoints are marked on turns); fork a new session after any closed turn; pin turns as anchors shown as blue ticks and diamonds on the growth chart.
- Cache visualization: hit rate, current-context cache coverage, and read/write tokens (provider prefix caching, automatic).
- Long-paste conversion into an editable "pasted text" chip (threshold adjustable in Settings; 0 disables): delivery is selectable per chip — inline into the prompt at submit time, or materialized as a workspace file and referenced with the official `@path` file-reference syntax. The workspace file extension is selectable in the clip editor from a fixed text/code list. Clicking the chip opens a right-sidebar editor supporting manual edits and instruction-driven LLM rewriting with cancellation, preview, apply, undo, redo, and retry (a one-shot call outside the session event stream, optionally carrying recent session messages and the current reasoning effort as reference).

  ![A long paste collapses into an editable chip](https://raw.githubusercontent.com/CheeseFox259/dsh-better-composer/main/docs/screenshots/paste-clip.png)

- Four Settings controls: enable Better Composer, Markdown visual enhancement, inactive-line syntax marker display (hidden or faded), and the long-paste threshold. The per-clip workspace file extension is selected in the clip editor. The legacy `toolbarMode` field remains schema-compatible and is not a separate UI toggle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host entry in [`src/index.ts`](src/index.ts) installs the Settings schema, the client bundle, and the `betterComposer` Remote service (`@Remote` runtime markers, no generated artifacts). [`cordis.patch.yml`](cordis.patch.yml) adds the bundle to a profile. [`src/client/index.ts`](src/client/index.ts) owns effect-scoped registration and disposal for Settings, decorations, actions, the editor surface, the Settings card, the clip source, and the right-sidebar tab.

The Markdown provider parses the authoritative Composer snapshot and emits UTF-16 source ranges. The editor surface presents those ranges through Core's generic decoration and surface-extension seams. Completion acceptance and language changes use the existing Core transaction path. Ghost text, tables, and code controls are presentation only; they never create a second source, selection, history, Context Object, or submission path.

Paste clips (`@clip:<id>`) work by detecting a single-revision length jump via prefix/suffix diff, replacing the inserted span with a chip through the public `setDraft(text, references)` verb, and expanding the chip at submit time through a registered `inputTriggers` codec — either the full text (inline) or a workspace file reference such as `@.dsh/pastes/pasted-text-<id>.md` (file mode, where the Host writes the text under `<cwd>/.dsh/pastes/`). Clip payloads persist under the harness home so reloads never lose them. The right-sidebar editor registers through `sidebarRightTabs` + `sidebar.right.pane.tab`; its LLM rewrite calls the Host `editText` Remote method with an independent purpose, current model reasoning effort, cancellation, and preview/apply state, and appends nothing to the session event log.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`src/settings.ts`](src/settings.ts) — persisted Settings fields and defaults.
- [`src/client/editor.tsx`](src/client/editor.tsx) — editor presentation and interaction wiring.
- [`src/client/presentation-layout.ts`](src/client/presentation-layout.ts) — table and code presentation layout.
- [`src/markdown/provider.ts`](src/markdown/provider.ts) — source ranges and Markdown presentation data.
- [`tests/`](tests/) — focused parser, lifecycle, Settings, completion, and presentation tests.

-----

<a id="model-experience"></a>
## Model Experience

A file-mode clip reaches the model as an official-style workspace file reference (`@.dsh/pastes/...`); the file is available to the Agent's normal file tools, while an inline clip splices its full text into the user message. The LLM rewrite runs outside the session: the model sees only the clip text, the instruction, the optional recent-message excerpt, and the current reasoning effort passed explicitly by the plugin — never the session event stream. Results are previewed before they replace the clip.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The host must provide the declared public composer, Settings, input-trigger, right-Sidebar, and Remote seams; an older host missing one disables only that capability. The supported code-language and pasted-file-extension lists are finite and local. File-mode delivery requires a known session workspace path; clips created before cwd capture fail file-mode sends with an explicit error rather than silently. Pure plugin code cannot create Core's opaque attachment receipts, so file-mode clips use the official workspace `@path` reference convention rather than pretending to be native binary attachments. Paste detection cannot distinguish a paste from any other large single-step insertion (IME commits, undo); the threshold limits but does not eliminate false positives. List/quote line-break continuation is supported on Shift+Enter: the keymap arms the continuation at keydown and settles a newline-free follow-up edit (insert the marker, or drop the marker of an emptied item) once Core's native break lands in the draft, because the public InputActions seam cannot split a paragraph atomically while preserving the caret. Plain Enter remains Core's submit gesture; a mid-list ordered split renumbers the following sibling run through a chain of single-line digit edits (each its own undo step), because one atomic rewrite would span newlines the seam cannot express. For the underlying seam analysis, see [Issue #1 (RFC)](https://github.com/CheeseFox259/dsh-better-composer/issues/1). Browser acceptance belongs to the host release process; this repository's automated checks do not replace a maintainer's real-browser review.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package uses the existing DSH profile bundle mechanism and local package scripts. Run `pnpm test`, `pnpm run typecheck`, `pnpm run bundle`, and `pnpm run pack:check` from this directory.

</details>
