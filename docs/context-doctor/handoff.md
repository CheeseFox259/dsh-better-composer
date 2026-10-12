# 上下文地图 × Context Doctor 集成交接 — 2026-09-27

状态：**LOCAL_ACCEPTANCE_PASS / FRONTEND_ACCEPTANCE_PASS**。已按用户确认方案完成插件内集成、一次两轴定向 Review、本地回归和新隔离 DSH 的实际界面验收。真实外部分析和摘要未执行，属于 **LIVE_PROVIDER_ACCEPTANCE_USER_RUN_REQUIRED**；模型行为使用本地确定性 fixture。

本记录取代之前独立 Doctor 侧栏和第二个入口的当前状态。上轮 UI 交接与来源记录保存在 `docs/archive/2026-09-26-doctor-ui/`，原 Kimi 交接保留为历史。原3080/PID79496、源会话和 `~/.dsh` 保持不变；不执行历史交接里的终止3080指令。

## 实现

- Composer 只有一个共用圆环入口；统一宿主原地图 tab kind，右栏名称「上下文地图」。旧 Doctor tab 经公开 `replaceTab` 转入会话绑定的诊断页，公共侧栏接口固定到 `0.1.7-alpha.2`。
- 当前会话 / 模式预设独立；概览 / 诊断 / 分析 / 反馈四页。当前概览保留整个原地图，模式概览保留样本、版本与组件统计。模式页不混入当前会话的压缩或分叉。
- 主环图与微图共用 `composition-chart.tsx`。悬停/焦点预览4px，点击固定选择6px，过渡140ms，减少动态效果时直接切换。键盘方向/Home/End移动焦点，Enter/Space选择。环心固定表示构成总量，窗口占用单独展示。
- 默认宿主三类 `contextBreakdown`；结构细分用独立 Doctor 持久化快照/字符估算。不缩放、不相加、不把未知填零。界面以蓝白灰为主体，按用户后续要求给分类增加不同色相；环图、图例和标签一致，主题继承 DSH，343px侧栏上下排列图与图例。
- `context-map.ts` 共用真实事件索引：native turn/step ID（包括0）和真实 `event.seq` 保持稳定，分页、重叠或 transient 不改变来源、锚点、分叉位置。注入用户角色消息归属现有轮，旧无边界日志保留回退。
- `context-map-data.ts` 共用 probe 数据和事件折叠缓存；`context-content-browser.tsx` 复用完整地图浏览。各工作区拥有浏览/任务状态，切页保留，隐藏时释放活跃订阅，不重复触发 Doctor 扫描。
- 原文与诊断共用来源选择。分类选择只浏览，「加入分析」独立向 Host 请求规范来源文本；工具聚合先展示定义集合供选择。`doctorEvidence.refs` 为可选扩展，保留分页/cutoff。已压缩或失效原文可浏览与反馈，但不能加入当前有效分析。
- 分析范围跨页保持，换对象清空并使旧计划失效。开始准备或执行会使未完成的来源查找失效，防止迟到响应改变计划。保留原预算、Host计划绑定、候选审阅、约束确认、配置预览/应用/恢复、反馈撤回及取消保障。

## 定向 Review 与修复

Spec / Standards 两路独立只读审查均已完成，比较范围为本次集成相对于 `/tmp/context-workspace-integration-baseline` 的变更。共确认三个重叠边界问题，均先由回归复现，再修复并验证：

1. 较早分页出现零编号边界时，不能重编号已经加载的轮和步骤；采用原生ID作为稳定身份。
2. 隐藏并重新进入概览时，保留结构证据已加载页；仅来源、会话或cutoff改变时失效。
3. 迟到的「加入分析」查找不能改写已准备/运行范围；准备/开始同步提升选择epoch并冻结写回。

相关32项测试通过后运行全量测试。未开启第二轮全库审计。

## 验收范围

macOS / Node `v26.5.0` / pnpm `10.13.1`。DSH revision `00102833dfaee1da9f48a3a8eae9d34005a75218`。

| Exact command | Result |
| --- | --- |
| `pnpm test` | 48 files / 320 tests PASS，0 skipped |
| `pnpm run typecheck` | PASS |
| `pnpm run pack:check` | PASS；内含tsc、tsdown，打包三入口与声明 |
| `node --check scripts/start-context-doctor-acceptance.mjs` | PASS |
| `git diff --check` | PASS |

| 方案能力 | 证据与实际结果 |
| --- | --- |
| 原生索引/历史加载 | L1–L2：零ID、注入消息、分页重叠、transient、来源seq和结束seq回归。L5：真实样本分别显示1/2/1/3个native轮；两轮样本未因注入消息增加轮数 |
| 圆环/分类交互 | L1：hover4px、固定6px、移开恢复、分类同步、键盘和微图不可交互。L5：Home焦点仅预览系统，消息浏览不变；Enter固定系统，图例切换工具，同页全文可展开 |
| 完整地图 | L1–L2：消息/系统/工具来源、文件/MCP/调用、缓存/结构/增长、压缩标记、真实边界回归。L5：系统全文、26个工具及路由、轮→步→消息全文、缓存/结构、增长柱明细、定位与锚点 |
| 压缩 | L1–L2：二次确认、pending禁用/失败反馈、native摘要fixture。L5：确认出现，离页后清除；没有执行真实摘要 |
| 锚点/分叉 | L1：保持原存储键、实际endSeq和成功/失败。L5：锚点reload后仍在增长图；定位展开目标轮；从第二轮后native fork成功，新会话的parentSession正确 |
| 两种计量 | L1：未知和零区别、不与pressure混合。L5：两轮样本实时构成16.6k、独立占用15.2k/1.0M、结构快照16.5k；没有缩放为一致总量 |
| 规范来源/分析 | L1–L2：refs校验、分页、cutoff/压缩/删除、Host计划绑定、预算、竞争、开始前取消、本地模型。L5：集合来源先供选择且已选0；单条消息加入后跨页保持1项/2字符，预算预览成功，未点开始 |
| 浏览/范围状态 | L1：分页跨页、失效cutoff拒绝旧页、迟到来源拒绝、跨对象隔离。L5：返回概览保持原文展开与选择，结构口径和当前会话独立 |
| Doctor保留 | L1–L2：候选/约束、版本、来源失效、提供方预览/应用/恢复、取消和反馈。L5：模式分组/组件与漏斗；反馈保存、reload保留、撤回；提供方配置实机证据沿用上轮，接口未改动 |
| 旧tab兼容 | L1：可见旧tab通过公开openTab/replaceTab进入诊断；session绑定保持。新profile没有历史旧tab，未以L5冒充恢复验收 |
| 四份真实数据 | L4–L5：新home通过public format catalog导入4会话/150源事件，四份地图可读。测试fork+空会话使模式候选为6，其中2 eligible且computable |
| 主题/窄栏 | L5：1280×720、960×760和343px侧栏，深浅主题、数值完整、无横向溢出；System主题/default viewport已恢复 |
| 最终来源 | L4–L7本地：新build/home/install/browser；三个installed entry与当前build相同，浏览器combo含完整规范化client字节。无外部L6 |

浏览器warning/error记录为空。Vitest仍有已发布primitives缺失sourcemap及既有Editor SSR的非失败警告，未改无关包。精确输出：`/tmp/context-integration-{tests,typecheck,pack,review-green}.log`，origin receipt：`/tmp/context-integration-origin.json`。

## 交接与运行

当前试用：[http://127.0.0.1:56251/](http://127.0.0.1:56251/)。Ungrouped下是四份副本与一次测试分叉；当前显示两轮样本。点击Composer圆环可浏览地图，切换诊断、分析或反馈。临时profile没有模型凭据；预算预览不执行模型。

本轮未提交、未推送，保留之前未提交工作。没有DSH core修改，core状态仅为最初的untracked `.dsh/`。四个源文件hash复核未改变。已退休的50067/54818监听器与owned tab已停止/关闭，launcher-owned home退出后清理；当前56251、源码、构建、包、语料和历史证据保留。

来源、精确home/PID和清理边界见 [CANONICAL_RUNTIME.md](../../CANONICAL_RUNTIME.md)，完整字节核对见 [RUNTIME_ORIGIN_MAP.md](../../RUNTIME_ORIGIN_MAP.md)。真实模型gate的下一步由用户在临时profile配置可用模型并明确开始一次最小非敏感分析，再独立验证native compaction；本次集成和本地fixture验收不依赖这些外部调用。

集成阶段验收截图（分类配色调整前）：[浅色](../screenshots/context-workspace-light.png)、[343px窄栏](../screenshots/context-workspace-narrow.png)、[深色](../screenshots/context-workspace-dark.png)。

## 2026-09-27 视觉修正

用户指出增长图长斜线和选中消息/淡化工具颜色相近。改动仅涉及 `context-doctor.css`：增长图锚点原先继承整根柱宽再旋转45°，现为固定6×6px、居中的菱形；消息改青绿 `#4C9B8F`，工具保留蓝，结构细分使用金棕、紫、陶红、钢蓝等柔和类别色，避免重复浅蓝。缓存进度条继续沿用原蓝色。

浏览器回归先复现锚点约182×182px，再验证修正后约8.5×8.5px（包含旋转）；锚定与选中同时存在时无长斜线。两种环图选中消息、淡化工具时仍清楚区分，环图与图例共用颜色。相关11项回归及全量48文件/320测试、typecheck、pack通过；未改功能、事件索引或Host。

现有隔离环境56251通过原生client HMR加载修正，无需停止或重建用户正在使用的临时profile。来源字节核对见更新的runtime origin map和 `/tmp/context-workspace-polish-origin.json`；浏览器warning/error为空。输出为 `/tmp/context-workspace-polish-{test,full-test,typecheck,pack}.log`。本次是小改动的定向检查，没有另开全库审查。

当前截图：[修正后的增长图](../screenshots/context-workspace-growth-fixed.png)、[实时构成配色](../screenshots/context-workspace-colors.png)、[结构细分配色](../screenshots/context-workspace-structure-colors.png)。先前截图保留为历史。


## 2026-09-30 Desktop 会话事件读取修复

**状态：LOCAL_ACCEPTANCE_PASS / FRONTEND_ACCEPTANCE_PASS。** 用户确认提示词润色没有消失，本次只修复会话事件读取和相关测试启动器，不修改该功能。

Desktop 0.2.0-rc.2 的右栏可能早于会话绑定与历史尾页打开。旧探针固定创建时的事件源，过早调用 `loadThrough(1)` 又被宿主跳过，导致宿主占用正常而地图为0条/0轮。客户端现在通过公开 `retainInfo` 跟随当前绑定，重新连接事件、投影、会话和输入订阅；等会话处于open且没有其他历史加载时补载。Doctor事件监听也跟随当前事件源。卸载时释放订阅，保留同一绑定的历史加载记录，避免 React 重新订阅引起重复加载循环。

- 实现：`src/client/index.ts`、`src/client/session-face.ts`。
- 回归：`tests/unit/context-map-probe.client.spec.ts`，3项覆盖旧绑定替换、晚到绑定、打开时序；包含旧源解绑、清理和重新订阅不重复读取的断言。
- 测试启动器：`scripts/start-context-doctor-acceptance.mjs`，将样本关联到workspace，并使用合法的原生turn/step边界。

| 检查 | 结果及边界 |
| --- | --- |
| `pnpm test` | 49 files / 323 tests PASS |
| `pnpm run typecheck` | PASS |
| `pnpm run pack:check` | PASS，包含类型、构建及打包验证 |
| `git diff --check` | PASS |
| L4–L5 隔离浏览器 | 新home冷启动；2轮PTC与1轮standard往返切换，地图计数与原生一致；展开第2轮→步骤→原文，真实事件7可读；切到诊断再返回保留展开状态。浏览器warning/error记录为空 |
| Desktop只读观察 | 现场原生7轮，地图7轮、16条用户消息、453条助手消息、483次工具调用。没有执行重启，也没有证明最终一次bundle已加载；不将此升级为Desktop冷启动验收 |
| 外部模型/压缩 | 本次没有发起请求；与读取修复无关 |

隔离环境为52770，home为 `/var/folders/dw/zngwgn892pl1p6kzf_k99r9w0000gn/T/context-doctor-acceptance-Uod9ID`；收尾复核时已无监听器。保留该owned home供复现，不继续把52770或历史56251列为可用服务。截图：[读取恢复后的原文浏览](../screenshots/context-map-session-reading-fixed.png)。原3080实例、用户Desktop后台任务和未发送草稿、源会话及既有未提交工作均保留。没有DSH core改动，没有提交或推送。

Desktop已安装的包链接指向 `/Users/superhacker/Codefield/dsh_plugins/dsh-better-composer`，当前最新构建已在该目录。**待用户现有任务结束后重启 Desktop，再打开上下文地图确认加载最新版本。** 最新源/构建身份与现场加载限制见 `RUNTIME_ORIGIN_MAP.md` 的2026-09-30补记。
