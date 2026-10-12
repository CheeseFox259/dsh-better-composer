# Context Doctor 续接交接 — 2026-09-26

状态：**LOCAL_ACCEPTANCE_PASS / FRONTEND_ACCEPTANCE_PASS**。本地构建、隔离 DSH、真实数据界面和最终来源核对已完成。真实模型分析及摘要调用为 **LIVE_PROVIDER_ACCEPTANCE_USER_RUN_REQUIRED**，没有运行外部或付费模型。

这份记录取代之前交接中“侧栏未接线、候选审阅未实现、配置 Diff 待做、尚无真实宿主走查”的当前状态。历史 Kimi 交接 `.kimi/handoff.md` 保留；冻结规格继续以 `acceptance.md`、`architecture.md`、`experience.md`、`metrics.md` 与仓库 `CONTEXT.md` 为准。

## 当前交付

- Composer 显示实际数据的 SVG 构成微图和估算量，随持久化事件更新；点击打开原生右栏。
- 侧栏使用 DSH 字体、语义颜色、按钮、分段控件和复选框。当前会话/模式作为分析对象，概览/证据/分析/反馈作为工作页面。概览环图、图例下钻和模式样本漏斗都显示实际数据。
- 证据可分页、筛选、展开、勾选；切换页面保留选择，改变对象重新建立范围。分析先预览范围、模型与预算，用户明确开始才调用模型。候选保留原文、条件、例外、来源与适用范围，确认后才成为有效要求。
- 反馈从原文发起，绑定正确的 session 和事件；保存、关联、刷新持久化和撤回均可用，类型使用中文。
- 可选压缩提供方有独立公开导出。模式配置先预览，再显式应用；等待时禁用重复操作，完成后明确提示。只替换一个基础提供方，保留阈值、路由、输出上限，适用于新 Agent；已在测试 profile 应用并恢复基础提供方。
- 只读复制 4 个已关闭真实会话、150 个源事件到临时工作区，覆盖短会话、完整往返、工具调用及中断。凭据不复制，语料原文不进入仓库。源文件 SHA-256 保持一致。

## 续接修复

修正按 kind 存储/读取及约束 RPC codec、历史请求前缀和当前有效表面的不同统计口径、普通工具结果与 Skill 正文归属、字符/4 与字节数混用，以及未知版本、归档候选、模式分母和组件样本筛选。

Host 保存并绑定分析计划和原始证据，阻止调用方篡改预算/内容；重复开始复用原作业，原文变化或删除使旧计划失效；结果、错误、取消和 usage 可轮询。确认约束带会话/模式范围，源确认删除后清除可还原摘录和结果。压缩增强复用 `super.summarize` 的一次原有摘要请求，无事后 judge 或重试。

真实数据走查另发现并修复：JSONL `stat.eventCount` 可缺失，不能当作 0；宿主目录服务可能后挂载，归档 getter 可能在启动时尚未就绪；分析开始 RPC 返回前取消必须记住取消意图；来源/目的切换后旧响应不能覆盖新范围，预览不能卡在准备中。均有行为回归。

## 验证范围

环境：macOS，Node `v26.5.0`；插件使用 package-manager 声明的 pnpm `10.13.1`。日期 2026-09-26，DSH revision `00102833dfaee1da9f48a3a8eae9d34005a75218`。插件开发依赖固定需要的已发布 `0.1.7-alpha.2` seam。

| Gate / exact command | Result | Scope |
| --- | --- | --- |
| `pnpm test` | 44 files / 298 tests PASS, 0 skipped | 本地规则、Host/RPC、分析/压缩 fixture、生命周期、客户端及有意义的异步交互回归 |
| `pnpm run typecheck` | PASS | TypeScript 编译检查 |
| `pnpm run pack:check` | PASS | 内含 `pnpm run bundle`：tsc、tsdown；三个入口及声明被打入 `.pack-check/cheesefox-dsh-better-composer-1.0.0.tgz` |
| `node --check scripts/start-context-doctor-acceptance.mjs` | PASS | 隔离启动脚本语法 |
| `git diff --check` | PASS | 现有 diff 格式检查 |

| Capability | Evidence level / observed result |
| --- | --- |
| 来源/规则/存储/RPC | L1–L2：可复算 fixture、只读分页、archive、unknown、删除与 revision 等回归 |
| 安装与真实数据 | L4–L5：独立 profile 正常启动，实际日志展示 17.9k 构成，与 Composer 一致；三项来源 capability 可用 |
| 模式汇总 | L5：standard 有 5 个候选（含宿主新建的空会话）、2 个达到完整往返门槛并可计算；ptc 显示无样本而非捏造重复率 |
| 证据与反馈 | L5：图例进入对应类型，原文关联、保存、刷新后保留、撤回；持久化记录的 source refs 核对正确 |
| 分析 | L2：本地确定性模型 fixture；L5：范围选择、页面保持和预算预览；真实 provider 开始/取消未运行 |
| 候选与约束 | L1–L2：候选/确认/revision/来源/范围；真实模型生成并人工审阅候选未运行 |
| 可选压缩 | L2：同一次 native base summarize 调用与 finish/error/cancel；L5：真实 config preview、应用、恢复基础提供方及完成提示；真实摘要未运行 |
| 视觉 | L5：1280×720 桌面、960×760 窗口和约 360px 侧栏、宿主深浅色；图表和数值可读，未捕获浏览器 warning/error |
| 最终重建 | 本地 L7：最终代码重新打包，新 home/安装/浏览器重新打开实际会话，配置应用/恢复、来源核对通过；不包含 L6 外部模型验收 |

Vite 对已发布 primitives 缺失 sourcemap 有非失败警告，既有 Editor 的 SSR `useLayoutEffect` 警告保留。本次 SVG title 警告已消除。准确命令输出保留在 `/tmp/context-doctor-final-{tests,typecheck,pack}.log`，来源 receipt 在 `/tmp/context-doctor-delivery-origin.json`。

## Review

已经消费 Spec / Standards 两路独立只读审查，修复确认的规格及标准缺口。UI 续接定向审查返回了开始 RPC 未返回时的取消窗口问题，已补回归；进一步独立复查因账号用量限制未完成，未宣称双路 UI Review 全量通过。之后完成定向自审，处理来源/目的切换竞争、原生契约、反馈文案及配置操作反馈；不启动新一轮全库审计。

## 运行、边界与交接

当前试用：[http://127.0.0.1:50067/](http://127.0.0.1:50067/)；浏览器已认证并保留。真实会话在 Ungrouped 下。进入当前会话可点组成图例查看证据，再选择分析或反馈。隔离环境没有复制模型凭据，复制会话的原模型显示不可用是预期状态。

源码为 `/Users/superhacker/Codefield/dsh_plugins/dsh-better-composer` 的 experimental checkout，HEAD 基线 `3625ed80654100ae754518b27579d1acedd1ed68`，所有续接修改仍未提交/推送；同版本 npm 发布包不包含这些未发布功能。

没有 DSH core 修改。用户 `~/.dsh`、选定源会话及原 3080/PID 79496 实例保持不变。旧的本次测试监听器、页面与 launcher-owned homes 已清理；最终试用、构建、包、截图、交接与本地证据保留。精确安装路径、监听 PID、构建 SHA 与 browser-served 字节核对见 [CANONICAL_RUNTIME.md](../../CANONICAL_RUNTIME.md) 和 [RUNTIME_ORIGIN_MAP.md](../../RUNTIME_ORIGIN_MAP.md)。

真实模型 gate 的下一步是在此临时 profile 中由用户配置可用模型，明确开始一次最小非敏感分析，再独立验证一次原生 compaction。自动统计、证据与反馈不依赖这些调用；当前请求的真实测试数据与 UI 改造已经完成。

截图：[浅色桌面](../screenshots/context-doctor-light.png)、[窄侧栏](../screenshots/context-doctor-narrow.png)、[深色](../screenshots/context-doctor-dark.png)。后两张来自同一最终 CSS 的前一轮隔离验收，最终桌面图来自当前构建。
