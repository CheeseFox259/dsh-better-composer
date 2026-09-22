---
description: "Adds deterministic Markdown presentation and local editing aids to a DSH Web Composer without taking ownership of source or submission."
kind: "package-bundle"
---

# @noleftbutright/dsh-better-composer

English | [中文](README.zh.md)

## Summary

DSH Better Composer adds source-preserving Markdown presentation, fixed local completion candidates, diagnostics, and deterministic writing hints to a DSH Web Composer. The profile layer contributes Settings and editor presentation through the public DSH composer seams. DSH Core remains the owner of source, selection, history, Context Objects, and Send/Queue/Steer. Long pastes can convert into editable reference chips whose LLM-assisted rewriting runs as an independent one-shot call outside the session event stream.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

Install the published package from npm:

```sh
pnpm dsh plugin --profile web add @noleftbutright/dsh-better-composer
```

Or install from source:

```sh
git clone https://github.com/NoLeftButRight/dsh-better-composer.git
pnpm dsh plugin --profile web add ./dsh-better-composer
```

Remove it with:

```sh
pnpm dsh plugin --profile web remove @noleftbutright/dsh-better-composer
```

The package is a `dsh.bundle.patch` profile layer. The patch inserts one `dsh-better-composer` row into the active profile. The client entry is loaded only on the Web platform and depends on the public conversation, renderer, Settings, and Settings-plugin packages declared in `package.json`.

### What you get

- Markdown visual enhancement for headings, emphasis, links, task lists, quotes, tables, fenced code, and source-preserving attachment labels.
- Deterministic local completion for approved fence-language, task-marker, and heading-spacing candidates, plus a bounded ghost for approved prompt-section headings.
- Non-blocking diagnostics for the supported incomplete Markdown constructs.
- Optional deterministic writing assistance based only on one current Core Composer snapshot.
- Context map (composer toolbar icon opens the right sidebar): occupancy gauge (measured tokens / model window), composition stack, structure stats, and per-turn growth — all push-updated live; the composition card drills down 消息 → turn → step (trace) → full message text, with the system prompt and tool inventory (from request/header) also viewable in full.
- Context management: run `/compact` in-place (with confirmation and a compacting state; compaction checkpoints are marked on turns); fork a new session after any closed turn; pin turns as anchors shown as gold ticks on the growth chart.
- Cache visualization: hit rate, current-context cache coverage, and read/write tokens (provider prefix caching, automatic).
- Long-paste conversion into an editable "pasted text" chip (threshold adjustable in Settings; 0 disables): delivery is selectable per chip — inline into the prompt at submit time, or materialized as a workspace file the agent reads on demand. Clicking the chip opens a right-sidebar editor supporting manual edits and instruction-driven LLM rewriting (a one-shot call outside the session event stream, optionally carrying recent session messages as reference).
- Five Settings controls: enable Better Composer, Markdown visual enhancement, Markdown syntax hints, deterministic writing assistance, and the long-paste threshold. The legacy `toolbarMode` field remains schema-compatible and is not a separate UI toggle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host entry in [`src/index.ts`](src/index.ts) installs the Settings schema, the client bundle, and the `betterComposer` Remote service (`@Remote` runtime markers, no generated artifacts). [`cordis.patch.yml`](cordis.patch.yml) adds the bundle to a profile. [`src/client/index.ts`](src/client/index.ts) owns effect-scoped registration and disposal for Settings, decorations, actions, the editor surface, the Settings card, the clip source, and the right-sidebar tab.

The Markdown provider parses the authoritative Composer snapshot and emits UTF-16 source ranges. The editor surface presents those ranges through Core's generic decoration and surface-extension seams. Completion acceptance and language changes use the existing Core transaction path. Ghost text, diagnostics, tables, code controls, and deterministic assistance are presentation only; they never create a second source, selection, history, Context Object, or submission path.

Paste clips (`@clip:<id>`) work by detecting a single-revision length jump via prefix/suffix diff, replacing the inserted span with a chip through the public `setDraft(text, references)` verb, and expanding the chip at submit time through a registered `inputTriggers` codec — either the full text (inline) or a workspace-file handle (file mode, where the Host writes the text under `<cwd>/.dsh/pastes/`). Clip payloads persist under the harness home so reloads never lose them. The right-sidebar editor registers through `sidebarRightTabs` + `sidebar.right.pane.tab`; its LLM rewrite calls the Host `editText` Remote method with an independent purpose and appends nothing to the session event log.

The assistance rule is intentionally small: it may show a fixed Validation-section reminder when a current text segment contains a recognized Goal or Task heading and a fenced code block without a recognized Validation or Acceptance Criteria heading. It does not score prompts, infer intent, rewrite source, or call a model.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`src/settings.ts`](src/settings.ts) — persisted Settings fields and defaults.
- [`src/client/editor.tsx`](src/client/editor.tsx) — editor presentation and interaction wiring.
- [`src/client/presentation-layout.ts`](src/client/presentation-layout.ts) — table and code presentation layout.
- [`src/markdown/provider.ts`](src/markdown/provider.ts) — source ranges and Markdown presentation data.
- [`tests/`](tests/) — focused parser, lifecycle, Settings, completion, diagnostics, and presentation tests.

-----

<a id="model-experience"></a>
## Model Experience

A file-mode clip reaches the model only as a file handle (name, byte count, saved path, and a hint to read it with file tools); an inline clip splices its full text into the user message. The LLM rewrite runs outside the session: the model sees only the clip text, the instruction, and the optional recent-message excerpt the plugin passes explicitly — never the session event stream.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The host must provide the declared public composer, Settings, input-trigger, right-Sidebar, and Remote seams; an older host missing one disables only that capability. The supported code-language list is finite and local. File-mode delivery requires a known session workspace path; clips created before cwd capture fail file-mode sends with an explicit error rather than silently. Paste detection cannot distinguish a paste from any other large single-step insertion (IME commits, undo); the threshold limits but does not eliminate false positives. Browser acceptance belongs to the host release process; this repository's automated checks do not replace a maintainer's real-browser review.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package uses the existing DSH profile bundle mechanism and local package scripts. Run `pnpm test`, `pnpm run typecheck`, `pnpm run bundle`, and `pnpm run pack:check` from this directory.

</details>
