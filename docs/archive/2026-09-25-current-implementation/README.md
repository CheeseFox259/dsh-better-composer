# Better Composer 当前实现归档（2026-09-25）

这是纯插件化迁移前的冻结记录。归档对应两个工作区当时的未提交状态，不是 Git commit。

## 工作区

- 插件：`/Users/superhacker/Codefield/dsh_plugins/dsh-better-composer`
- DSH Core：`/Users/superhacker/Codefield/Work/Codefield/deepseek-harness`
- 当前插件包：`@cheesefox/dsh-better-composer@0.1.0`
- 当前本地 Core：官方 DSH `0.1.7-alpha.2` 加本归档中的两个实现改动。

## 当前功能组成

插件通过官方 `conversation.input.overlay` 注入 composer overlay，使用 DOM 映射和 CSS Highlight 做 Markdown 视觉层；使用 `InputActions`、session `slash/input-insert-reference` bail、`ctx.inputTriggers.registerSource()` 和 Typert Remote 实现结构化编辑、长文本 clip、文件送达、补全、诊断、表格/代码控件。

当前插件工作区包含此前未提交的视觉层、Markdown parser/provider、结构化编辑、clip/Remote、context map、settings 等改动。完整文件状态见迁移前的工作区 `git status`；本归档重点冻结 Core 依赖和迁移边界。

## 对 Core 的额外要求（迁移前）

当前本地端到端验证依赖以下两个非插件化 Core 改动：

1. `packages/client/ui-conversation/src/client/input/editor/runtime.ts`
   - `DraftEditorRuntime.paste()` 将多行粘贴拆成逐段落插入；
   - 官方版本直接 `selection.insertText(clean)`，多行会落入单个段落/文本节点。
2. `packages/client/ui-conversation/src/client/input/editor/span-map.ts`
   - `$replaceDetectSpanWithText()` 将含换行的结构化替换拆成段落；
   - 官方版本直接 `selection.insertText(text)`，列表续行的 `"\n- "` 会留在同一段落。

对应测试改动只用于冻结这些行为，见 `core-local-modifications.patch` 和 `core-modified-files/`；归档时 Core 工作区状态见 `core-git-status-at-archive.txt`。

因此，当时的真实结论是：**在未经修改的官方 Core 上，当前插件不能保证多行粘贴富渲染和结构化列表续行与本地验证一致**。长文本 Remote/codec 和补全 Enter 修复主要属于插件代码，但长文本曾采用“粘贴后 effect diff”路径，仍有 revision 漂移风险。

## 官方 seam 记录

- `conversation.input.overlay`：挂载插件视觉层和输入 DOM 监听。
- `InputActions.captureInsertion()`：获取 revision-guarded detect span（纯插件迁移调查后更正：registry 的 client 类型声明为其直接导出，当前 workspace bridge 需显式补齐）。
- `InputActions.insertText()`：插入普通单行文本。
- `InputActions.setDraft()`：整段重建草稿；官方 Core 内部按 `\n` 建立段落，但会把光标放到文末，且不能无损保留已有 chip。
- session `slash/input-insert-reference`：插入正式 ReferenceChipNode。
- `ctx.inputTriggers.registerSource()`：发送时通过 codec 序列化 chip。
- `ctx.remote.$mount()`：Remote 文件存储/发布。

## 已验证命令（迁移前）

插件：

- `pnpm test`：22 文件 / 146 tests
- `pnpm run typecheck`
- `pnpm run bundle`
- `pnpm run pack:check`
- `git diff --check`

Core：

- `pnpm run typecheck`
- `npx vitest run packages/client/ui-conversation`：36 文件 / 488 tests

这些结果对应“本地 Core 改动存在”的状态，不能作为纯净 Core 兼容性证明。

## 恢复方式

若需要恢复本地 Core 验证状态，在官方 Core 工作树干净且目标文件版本匹配时运行：

```bash
git apply docs/archive/2026-09-25-current-implementation/core-local-modifications.patch
```

如果只需要查看，不要应用 patch；`core-modified-files/` 是对应实现文件的完整副本。

## 迁移进展（本次开发后）

- Core 两个实现文件和两个 Core 回归测试已恢复为官方版本；Core 工作区相关状态已验证为空。
- 新增 `src/client/paste-interceptor.ts`：capture 阶段处理长文本和普通多行粘贴。长文本先通过正式 `slash/input-insert-reference` 插入 chip，再持久化 clip；普通多行无 chip 草稿走官方 `setDraft`。
- 删除了 editor 中“粘贴后 React diff 再转换”的主路径，避免 revision 漂移和死 `@clip:id`；旧纯函数文件暂留仅用于历史性能测试。
- 普通 Enter 和 Shift+Enter 已 fail-open 给官方 Core；官方公开 `InputActions` 没有可验证的段落分裂/光标恢复 seam，因此不再向官方 Core 的 `insertText` 发送包含换行的结构化编辑。Tab/Shift+Tab 仍由插件处理。
- 纯净 Core + 当前插件真实浏览器验证通过：多行普通粘贴富渲染、长文本 chip/file 送达、补全不抢 Enter、`+` 菜单可用。
- 已知纯插件边界：官方 Core 的 Shift+Enter 在当前公开路径下表现为同一段落内的 managed line break；插件不调用 Lexical 私有 API，也不再修改 Core。

## 迁移目标

纯插件化版本应：

- 在 paste capture 阶段前置处理超长文本，直接生成 ReferenceChipNode；
- 对无 chip 的普通多行粘贴使用官方 `setDraft` seam；
- 将结构化换行拆为原生段落分裂 + 单行前缀插入，或在不支持时 fail-open；
- 恢复官方 Core 两个实现文件和测试文件，不把 Core patch 发布为插件依赖。
