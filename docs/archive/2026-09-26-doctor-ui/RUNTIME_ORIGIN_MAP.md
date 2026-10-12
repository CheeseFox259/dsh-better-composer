# Context Doctor runtime origin — 2026-09-26

Canonical package: `@cheesefox/dsh-better-composer@1.0.0`, experimental checkout at `/Users/superhacker/Codefield/dsh_plugins/dsh-better-composer`. The npm release with the same version does not contain this uncommitted feature.

| Stage | Verified origin |
| --- | --- |
| Source | `src/doctor/`, `src/client/context-doctor/`, Host/client wiring and `tsdown.config.ts` in this checkout |
| Build | `pnpm run pack:check` runs `tsc` and `tsdown`, producing the three entries below |
| Installed package | `/var/folders/dw/zngwgn892pl1p6kzf_k99r9w0000gn/T/context-doctor-acceptance-aJMSQg/profiles/web/node_modules/@cheesefox/dsh-better-composer` |
| Symlink, read before resolving | `../../../../../../../../../../../Users/superhacker/Codefield/dsh_plugins/dsh-better-composer` |
| Resolved package | `/Users/superhacker/Codefield/dsh_plugins/dsh-better-composer`; all three installed entry hashes equal the current build |
| Host | The web profile binds the package root to `lib/index.js`; the native Remote is registered and reports catalog/archive/persistence available. Native config editing resolves the separate `./doctor-compaction` export. |
| Browser | Page-assets inventory observed the exact combo URL below; its executable contains the current complete client entry after native debug-trailer normalization |

| Current build | SHA-256 |
| --- | --- |
| `lib/index.js` | `ed0c660f1fd445162f56fecec211bd7cabe66f5b257398facd47362f622a4bd3` |
| `lib/client.js` | `d30950cec8ccf721ca7670db2a0c07f1f36736e329c880c9c06e9ad4790782e3` |
| `lib/doctor-compaction.js` | `5b34c7046c6003d8fbb95cae6794d13c9fd6b32289bfb2d31cbd5aed4a48a3fb` |

Observed browser combo:

```text
http://127.0.0.1:50067/plugins/??@deepseek-ai/dsh-api-session-controller/client.js,@deepseek-ai/dsh-client-connection/client.js,@deepseek-ai/dsh-client-ui-deliverables/client.js,@cheesefox/dsh-better-composer/client.js,@deepseek-ai/dsh-api-workspace-controller/client.js&rev=7f443f8f86d8
```

Combo SHA-256: `abedba5ab08ffdd1e5c8993350bd4c7c6387d8ea8b48fae9fcb19a2878a012e2`.

The native client-module service strips trailing `sourceURL`/`sourceMappingURL` directives and adds a final newline before concatenation (`packages/client/modules/src/index.ts`, `prepareSource`). Applying that exact transformation yields client SHA-256 `442546fb7cf3017e2ba8b74f38322eb341ac9ea761d12184e23a3d47b27f7d2e`. Those complete bytes occur in the observed combo, rather than merely matching a label or short string.

The local origin receipt is `/tmp/context-doctor-delivery-origin.json`; served executable evidence is `/tmp/context-doctor-delivery-served.js`. No session text or credentials are included in this document. See [canonical runtime](CANONICAL_RUNTIME.md) and [handoff](docs/context-doctor/handoff.md) for scope and remaining live gates.
