---
description: "为 DSH Web Composer 提供确定性的 Markdown 视觉呈现与本地编辑辅助，不接管 source 或提交。"
kind: "package-bundle"
---

# @noleftbutright/dsh-better-composer

[English](README.md) | 中文

## 摘要

DSH Better Composer 为 DSH Web Composer 增加保留 source 的 Markdown 视觉呈现、固定的本地补全候选、诊断和确定性写作提示。配置层通过 DSH 公开的 Composer seam 提供 Settings 与编辑器 presentation。source、selection、history、Context Objects 以及 Send/Queue/Steer 仍由 DSH Core 拥有。超长粘贴可自动转为可编辑的引用（chip），其大模型辅助编辑经 Host 侧独立的一次性调用完成，不写入会话事件流。

## 目录

- [使用本包](#使用本包)
- [了解实现](#了解实现)
- [进一步阅读](#进一步阅读)
- [模型体验](#模型体验)
- [已知限制与暂不处理事项](#已知限制与暂不处理事项)
- [开发说明](#开发说明)

-----

<a id="使用本包"></a>
## 使用本包

### 安装到 profile

从 npm 安装已发布的包：

```sh
pnpm dsh plugin --profile web add @noleftbutright/dsh-better-composer
```

或从源码安装：

```sh
git clone https://github.com/NoLeftButRight/dsh-better-composer.git
pnpm dsh plugin --profile web add ./dsh-better-composer
```

移除：

```sh
pnpm dsh plugin --profile web remove @noleftbutright/dsh-better-composer
```

本包是 `dsh.bundle.patch` profile layer。该 patch 向当前 profile 插入一个 `dsh-better-composer` 行。客户端入口只在 Web 平台加载，并依赖 `package.json` 声明的 conversation、renderer、Settings 和 Settings-plugin 公开包。

### 提供的能力

- 为标题、强调、链接、任务列表、引用、表格、围栏代码和保留 source 的文件引用标签提供 Markdown 视觉增强。
- 为已批准的 fence language、task marker 和 heading spacing 提供确定性的本地补全，并为已批准的 prompt section heading 提供有界 ghost。
- 对支持的未完成 Markdown 结构提供不阻塞发送的诊断。
- 只基于一次当前 Core Composer snapshot 的可选确定性写作辅助。
- 上下文地图（composer 工具栏图标打开右栏）：占用仪表（实测 token / 模型窗口）、构成堆叠条、结构统计与逐轮增长图，全部推送式实时更新；「构成」内可按 消息 → 轮 → 步骤（trace）→ 消息全文 钻取，系统提示词与工具清单（来自 request/header）同样可查看全文。
- 上下文管理：地图内直接执行 /compact（带确认与压缩中状态，压缩点在轮次上标记）；任意已结束轮次可一键分叉（fork 出新会话）；轮次可锚定并在增长图上显示金色刻线。
- 缓存可视化：命中率、当前上下文缓存覆盖与读/写 tokens（provider 前缀缓存自动生效）。
- 超长粘贴自动转为「粘贴文本」引用 chip（阈值可在 Settings 调整，0 关闭）：发送方式可选「直接进上下文」（提交时完整文本内联）或「以文件形式送达」（文本落盘为工作区文件，Agent 用 read 工具自取）；点击 chip 打开右侧栏编辑器，可手动修改，也可由大模型按指令改写（独立的一次性调用，不写入当前会话事件流，可携带最近若干条会话消息作为参考）。
- 五个 Settings 控件：启用 Better Composer、Markdown 视觉增强、Markdown 语法提示、确定性写作辅助和超长粘贴转引用阈值。旧的 `toolbarMode` 字段继续兼容读取，但不单独增加 UI 开关。

-----

<a id="了解实现"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`src/index.ts`](src/index.ts) 中的 Host 入口安装 Settings schema、client bundle 和 `betterComposer` Remote 服务（`@Remote` 运行时标记，无需生成工件）。[`cordis.patch.yml`](cordis.patch.yml) 把 bundle 加入 profile。[`src/client/index.ts`](src/client/index.ts) 通过 effect-scoped 注册与清理管理 Settings、decorations、actions、editor surface、Settings card、clip source 与右侧栏 tab。

Markdown provider 读取权威 Composer snapshot 并输出 UTF-16 source range。editor surface 通过 Core 的通用 decoration 与 surface-extension seam 呈现这些 range。补全接受和语言变更都走现有 Core transaction path。ghost、diagnostics、table、code controls 和确定性辅助都只是 presentation；它们不会创建第二份 source、selection、history、Context Object 或提交路径。

粘贴引用（`@clip:<id>`）的实现：editor surface 用单 revision 长度突增 + 前后缀 diff 检测超长粘贴，经公开的 `setDraft(text, references)` 把片段替换为 chip；`inputTriggers.registerSource` 注册的 codec 在提交时按送达模式展开为完整文本（inline）或工作区文件句柄（file，Host 将文本写入 `<cwd>/.dsh/pastes/`）。chip 原文持久化于 harness home（`storages/better-composer/pastes/`），刷新不丢。右侧栏编辑器经 `sidebarRightTabs` + `sidebar.right.pane.tab` 注册；「用大模型编辑」调用 Host 侧 `editText` Remote 方法，以独立 purpose 发起一次性 LLM 请求，不 append 任何会话事件。

辅助规则保持很小：当当前文本片段包含已识别的 Goal 或 Task 标题、围栏代码，并且没有已识别的 Validation 或 Acceptance Criteria 标题时，可以显示固定的 Validation section 提醒。它不评分、不推断意图、不改写 source，也不调用模型。

</details>

-----

<a id="进一步阅读"></a>
## 进一步阅读

- [`src/settings.ts`](src/settings.ts) — 持久化 Settings 字段与默认值。
- [`src/client/editor.tsx`](src/client/editor.tsx) — editor presentation 与交互 wiring。
- [`src/client/presentation-layout.ts`](src/client/presentation-layout.ts) — table 与 code presentation layout。
- [`src/markdown/provider.ts`](src/markdown/provider.ts) — source range 与 Markdown presentation 数据。
- [`tests/`](tests/) — parser、lifecycle、Settings、completion、diagnostics 和 presentation focused tests。

-----

<a id="模型体验"></a>
## 模型体验

「以文件形式送达」的粘贴引用在 prompt 里只呈现为一个文件句柄（文件名、字节数、保存路径与"需要时用 read 工具读取"的指引）；「直接进上下文」则把完整文本内联进用户消息。「用大模型编辑」在会话外发起独立请求，模型看不到会话事件流，只看到插件显式携带的文本、指令和可选的近期消息摘录。

<a id="已知限制与暂不处理事项"></a>
## 已知限制与暂不处理事项

宿主必须提供声明的 Composer、Settings、input-trigger、右栏与 Remote 公开 seam；老宿主缺失某一项时对应能力单独关闭。支持的代码语言列表是有限且本地的。file 送达模式要求会话工作区路径已知；旧 clip（cwd 捕获前创建）切到 file 模式会在发送时以明确错误阻止而不是静默失败。粘贴检测无法区分粘贴与其他单步大插入（IME 整段提交、undo），阈值可降低误判但不能归零。浏览器验收属于宿主 release 流程；本仓库的自动化检查不能替代维护者的真实浏览器复核。

<a id="开发说明"></a>
### 开发说明

<details>
<summary>维护者工作说明 — 点击展开</summary>

本包使用现有 DSH profile bundle 机制和本地 package scripts。在此目录运行 `pnpm test`、`pnpm run typecheck`、`pnpm run bundle` 和 `pnpm run pack:check`。

</details>
