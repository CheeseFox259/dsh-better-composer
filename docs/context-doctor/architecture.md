# Context Doctor：数据可得性与架构约束

版本：v1.0，设计定稿。仅设计与只读源码核查；不是已实现 API、运行集成验证或性能测试。

## 1. 核查环境与证据范围

- 宿主：`/Users/superhacker/Codefield/Work/Codefield/deepseek-harness`，HEAD `00102833dfaee1da9f48a3a8eae9d34005a75218`（0.1.7-alpha.2）。核查代理报告该 checkout 干净；这不代表运行中的服务已加载相同构建。
- 插件：`/Users/superhacker/Codefield/dsh_plugins/dsh-better-composer`，HEAD `2426975`，工作树有大量先前未提交修改。本次以当前文件为准，不恢复旧工作、不覆盖实现改动。
- `package.json` 声明多项 DSH devDependency 为 alpha.1；实际只读检查 session-controller、typert-protocol、ui-conversation 安装包均为 alpha.2。其余包不能据此推断已全部一致。
- 下表路径相对宿主根；行号来自本轮 checkout。由三个独立只读调查汇总，父代理复核请求组装、usage、只读持久化、follow 激活、composition 字段、fork 边界等关键契约。未做运行时调用、真实日志取样、网络探测或测试。
- 公共宿主服务可通过插件 Host 半调用，不要求原本已存在 Remote 方法；但必须验证导出与实际服务可用性。内部实现仅用于理解语义，不作为待依赖的导入路径。

## 2. 核心数据边界

四种数据不能互称：
1. **事件轨迹**：曾经发生过什么，包括已被压缩遮蔽的内容。
2. **有效表面**：按 SurfaceOp 处理后仍保留哪些消息节点。
3. **宿主请求重建**：表面派生消息与当时 request/header 工具及配置；其可复原程度受边界、消息投影实现及版本影响。
4. **供应商实际请求**：适配器/中间件序列化及处理后的输入；本轮未确认公共旁路捕获接口。

表面节点重建可确定；不能因此声称已精确还原供应商 token 序列。历史重建要保存 assembly 版本或声明缺失。不完整事件、未知消息投影、重试 attempt 边界不清时降低覆盖等级。

## 3. 数据可得性矩阵

分类：H=历史已有；R=历史有条件重建；N=仅从今后观测；U=本轮未证实可观测。U 不代表永远无法实现。

| ID | 数据 / 接口 | 证据 | 分类与语义 | 设计约束 |
|---|---|---|---|---|
| A01 | `sessionPersistence.list/stat/open(id,'read')`、handle.read/close | `packages/session/session-persistence/README.zh.md:34–65`；`src/index.ts:153–201` | H：公开存储服务、版本/计数、分页原始事件 | Host 侧读句柄，不拿写所有权，不直接读数据库文件；读取结束必关闭 |
| A02 | `sessionController.list/page` | `packages/api/session-controller/src/index.ts:251–254,449–464`；`src/list.ts:126–144`；`src/history.ts:77–112` | H：业务列表和反向历史页；列表 cursor 未真正分页 | 先枚举业务可见候选，再限定模式与扫描范围；元数据列表仍有 O(S) 开销 |
| A03 | `sessionController.follow` / client retain | `packages/api/session-controller/src/history.ts:192–212` | 不是纯冷读取：prepared source 会 promote | 跨会话扫描禁止用此路径；不得宣称激活必然产生 LLM 调用，但会改变运行时状态 |
| A04 | SurfaceOp、`foldSurface`、derive message 语义 | `packages/core/session/src/types.ts:439–478`；`src/surface.ts:120–158,250–258,600–615` | R：公开类型/折叠函数可复原消息节点 | 不能以“最新压缩之后”截断代替折叠；使用匹配版本公开入口，不调用 deprecated 同步 Session 读方法 |
| A05 | request/header、request/context | `packages/core/agent-loop/src/agent.ts:581–645`；`packages/core/session/src/types.ts:240–263,390–402` | H/R：变更时写 header；相同后续步骤继承，不是每请求一条 | Header 数不是请求数；system 文本在消息而非 header.system |
| A06 | 供应商最终输入 | 同上，buildRequest 为私有方法，随后进入 llm 层 | U：未证实最终 wire 可旁路采集 | 不为观测包裹或篡改私有请求实现；第一轮以宿主重建标识，不宣称 wire 精确 |
| A07 | assistant/message/attempt usage、retry | `packages/llm/token-meter/src/usage-projection.ts:77–150` | H：供应商经适配器报告；可能缺失，重试/同槽替换有规则 | 称“供应商报告量”而非无条件精确；聚合保留 observed attempts / eligible attempts，不将缺失算零 |
| A08 | contextPressure | `packages/llm/token-meter/src/usage-projection.ts:67–75,152–218` | H/R：pressure 最近观测，projected 经表面差值预测；window 单独更新 | numerator/window 不是原子同请求；wire view **不含 surfaceTokens**，该值是内部状态，不照抄插件宽松 interface |
| A09 | contextBreakdown | `packages/llm/token-meter/src/breakdown-projection.ts:48–81`；`src/estimate.ts:12–20,88–102` | R：system/tools/messages 均启发式估计 | 不当精确分项或强制平摊 usage；不同内容类型估计误差影响占比 |
| A10 | fork inheritedEventCount / isOwnSeq | `packages/core/session/src/index.ts:669–676`；`src/types.ts:106–146,427` | H：子会话继承前缀和父 ID | seq < inheritedEventCount 是继承，等于边界属于 own；继承不算重新执行，后续真的送模仍算携带 |
| A11 | 模式 ID | `packages/preset/agent-preset-registry/src/session.ts:20–44`；SessionHeader.agentPreset | H/R：header + 空白期 selected 事件 | 不只看创建 header；ID 不是完整配置版本 |
| A12 | 模式历史代际 | `packages/preset/agent-preset-registry/src/index.ts:28–34`；`README.zh.md:56–58,95` | U（旧历史）：代际内存管理，旧插件实现不持久化 | 旧模式版本留 unknown；模型/tool/skill 可见指纹是另一维度，不假冒配置版本 |
| A13 | 当前模式 roster 与 compositionInventory | `packages/preset/agent-preset-registry/src/index.ts:157–179,340–350`；`src/composition-inventory.ts:21–49,154–169` | N：Host 公开方法及导出类型；Remote roster 不含 composition | composition 只有模块、entryId、enabled/condition/fiberState，**不包含完整 config/提示词/技能正文**；桥接可做，完整配置来源需另查 |
| A14 | Skill catalog | `packages/skill/tool-skill/src/index.ts:34–41,213–251` | H/R：user/message source.kind=skill-catalog，entries name/description | 目录是稀疏更新，须结合表面和清空事件；不带正文版本及来源层级 |
| A15 | Skill 正文加载两条路径 | `packages/skill/tool-skill/src/index.ts:81–160,177–204` | H：tool call/result 或 skill-invocation user 消息 | 渲染正文可做 hash；它是“加载实例内容指纹”，含参数/模板时不是原 SKILL.md 版本 |
| A16 | Skill 辅助资源 | `packages/skill/skill/src/index.ts:42–47,171–214` | R/U：resourceBase 给路径线索；无自动资源读取事件归属保证 | 普通 read 路径与资源关系最多显式可匹配时关联，不能认定读文件就是遵循 Skill |
| A17 | Native 工具曝光与结果 | A05；`packages/core/session/src/types.ts:341–361`；`packages/core/tools/src/index.ts:660–667` | H/R：header.tools；tool/call, tool/result；结构化 HarnessError | 已发起不等于执行成功；未知 error 保持未知，不凭文本确定模型/权限/环境责任 |
| A18 | PTC 工具入口/子调用 | `packages/core/tools/src/index.ts:1021–1025`；`src/types.ts:31–58`；`src/ptc.ts:586–612` | H/R：run_code + tools:sdk；ptc-dispatch-start/dispatch | 普通工具列表不是 PTC 能力全集；子调用使用 subCallId，外层 run_code 不与子调用混成一个分母 |
| A19 | MCP 归属 | `packages/mcp/mcp-client/src/tools.ts:81–87`；`README.zh.md:107–122` | R：公开名字约定；长名 hash 截断不可完全逆向 | 只对无歧义的名字关联 server；无法归属保留 unresolved；不碰 WeakMap |
| A20 | MCP 错误与非工具贡献 | `packages/mcp/mcp-client/src/tools.ts:297–299`；`src/server-context.ts:32–39`；`packages/mcp/mcp-resources/src/index.ts:59–71` | H/R/U：结果可见；server 指令融入 system；resource 经共享工具 | 普通 Error 可能丢结构化分类；文本标题解析是证据较弱的来源映射，不等同结构化 provenance |
| A21 | MCP Prompts | `packages/mcp/mcp-client/README.zh.md:12,209` | 不支持的当前能力 | 不展示 0% 使用率；标不适用，不因通用 MCP 规范支持就宣称 DSH 已实现 |
| A22 | 用户反馈 | 插件当前无 Doctor 反馈对象 | N：本功能新增用户操作记录 | 仅设计采集，不推断历史未报告问题；保留可编辑/撤回与证据失效 |

## 4. 推荐读取路径与边界

候选数据流：

用户选范围并启动 → Host 业务可见列表 → 模式 ID 初筛 → 持久化 read 句柄有界分页 → 冻结各会话分析截止 seq → 标准化并建立来源索引 → 指标/模式聚合 → 结果摘要与证据分页 → 客户端图表。

- 不对所有 session 建 client binding；不激活冷 Agent。
- 列表目前无真实服务端分页；不能通过 UI 分页声称底层已分页。列表成本单独记录，正文分批处理与缓存依然可行。
- A02 为业务可见全集基线，A01 为其 ID 的正文读取。发现列表/持久化集合差异时作为覆盖信息，不以 `cwd === undefined` 自造“软删除”产品语义；该过滤不证明所有此类记录都是已删除。
- 错误会话、旧格式不支持、读取中被删除分别记失败或跳过原因。不能为统计自动迁移/修复源日志。
- 活跃会话用截止 seq 定义快照；新增事件触发报告过期提示而不是偷偷改变同一次计算分母。
- 历史扫描可在 Host 做单会话流式折叠，不需把全部原文传到浏览器。持久索引、保留期、后台增量采集范围留至第一轮决策后细化。

## 5. 请求身份与重建保守契约

已确认无全局 request UUID，设计使用插件自己的分析键，不伪造宿主字段：origin session + own event boundary + turn/step + 可证实 attempt ordinal。

- Header 变更仅作配置边界；不能按 header 条数计请求。
- 以 assistant settlement / attempt stream 及 step/retry 事件重建调用观察。缺 start/attempt 区分时只展示“可识别模型调用”，同时给覆盖，不称完整请求全集。
- 重建位置在该 assistant 输出进入表面前，避免把本次输出算到自身输入。
- 插件/适配器消息投影无法按历史版本重放时，不证明精确宿主消息文本。下游 wire 始终单列未知。
- 供应商 usage 与重建块计量分别保存；未知开销不是自动可加总的 token 残差，不通过缩放各块强行凑齐总量。

## 6. 模式指纹不能偷换概念

建议三个独立键：
1. modeId：原始会话模式标识。
2. observedCapabilityFingerprint：当时可见工具定义、技能目录/已加载内容等观测的指纹；可部分由历史获得。
3. configurationVersion：经完整权威配置来源确认的版本；当前旧历史没有，不据 1/2 自动补齐。

compositionInventory 的模块列表 hash 只是 composition signature；模块 config 变了而列表不变时该 signature 不变。完整配置、用户补丁、运行中 Agent 旧代际和动态 MCP 能力如何关联，仍是架构阶段的明确待核实项。不能承诺“现在开始截图当前列表就能追踪所有实际版本”。

## 7. 模型分析与增强（边界，后续细化）

- 确定性数据不因诊断而外发；必要模型分析手动触发，复用已有模型路由。
- 原文作为待分析数据，不作为执行命令；模型不自动调用用户工具。
- 多会话语义输入仅在用户选择证据范围后考虑，不能默认发送全量历史。
- 动态 runtime-context 可作为用户确认要求的候选承载机制，但极简关闭 runtime context、complete persona 都构成限制；这里不决策采用机制。
- 不监听 turn-stopping 以阻止完成、不 steer 催促、不为验收打开测试环境。场景中“反复遗漏”是反馈/诊断证据，不是自动执行触发器。

## 8. 本轮结论与后续核查

可确认：公开离线读取路径、模式 ID、历史工具 schema、Skill 两类加载、消息表面折叠、usage 缺失/累计特征、PTC 特殊路径。

仍待实现前契约核查：
- 相关公开服务在插件发布依赖/宿主模块表的可用性与最低兼容版本；不能由三个 alpha.2 包外推所有包。
- mode 完整配置与真实 Agent 代际映射；配置 inventory 不够。
- PTC SDK 曝光的结构化边界及历史可复原程度。
- 跨重试的可识别请求边界、adapter 中间件变换和字段覆盖。
- MCP 来源与连接状态历史缺失能否通过支持的只读服务补充；若无则维持 unknown。

这些未知已转化为指标降级与第一轮问题，不以“全部准确可得”结案。完整 RPC schema、索引与持久化生命周期、取消预算、资源清理及升级迁移在阶段 3 定稿。

## 9. 归档、轮次与时效补核

- `packages/api/session-controller/src/list.ts:121–144` 公开 list 的实现包含所有业务可见的活跃及持久会话，没有归档过滤；仅冷会话无cwd时跳过。父代理复核了这一路径，不能用前端默认工作区树的可见列表代替模式样本全集。
- `packages/workspace/workspace/src/spec.ts:62`、`src/index.ts:340–342` 以 `archivedSessionIds` 保存归档状态；`packages/client/ui-workspace/src/client/tree.ts:231–262` 才进行显示过滤。归档不改会话日志，未保存归档发生时间。归档标记的公开读取服务在架构定稿前确认；即使暂取不到标记，也不能漏掉已由list返回的会话。
- `packages/core/session/src/types.ts:288–309` 定义turn/start/end；user/message中有用户及注入来源。`packages/core/agent-loop/src/agent.ts:166–168` 与 `inbox.ts:227–235` 表明steer进入next-step而非新turn。门槛不能通过user/message数量或tool calls数量推导。
- `packages/core/session/src/types.ts:499` 的event.time为事件时间；`packages/api/session-controller/src/list.ts:327–329` 的summary.updatedAt取创建时间与lastPromptAt最大值，不是所有工作完成时间。
- request/header是稀疏快照，其time不能代表全部请求开始时间。模型调用时效必须使用该attempt可证实的边界/settlement并注明时间依据。
- 自有轮次仍按turn/start.seq与inheritedEventCount切分；取消/中断与成功结束分开记录，不能用是否成功代替是否确有交互。

以上补核由只读代理提供，未访问真实用户会话。第二轮用户明确：时效由相关配置/内容版本而非日期窗口决定。event.time继续用于顺序、审计和归因，不作为默认有效性筛选。H2=A已确认：至少两个完整有效往返（U1-A1-U2-A2），纯继续恢复链归并后计数；J2仅计fork自有往返，J3不确定为恢复时按正常对话处理，均已确认。

## 10. compact 内约束保留核查（第二轮后）

核查本地alpha.2实现，以下是源码证据，不是运行验证：

- `packages/compaction/compaction/src/index.ts:88–107,119–192`：公开引擎接口为compactIfNeeded、compactNow、compactRegion；summary-error是失败恢复事件，不是成功摘要的提交前审阅钩子。不能靠session/event事后通知假装拥有提交前控制。
- `packages/compaction/compaction-basic/src/summarizer.ts:145–162`：默认摘要调用追加固定COMPACTION_INSTRUCTION，无逐次传入保护要求的参数。
- **但并非不存在受支持扩展**：`packages/compaction/compaction-basic/README.zh.md:109` 明确将 `summarize()` 描述为唯一子类钩子；`src/index.ts:237–257` 的protected summarize允许模板/远程摘要器覆盖；package.json根导出该实现入口。先前代理把子类路径一概归为私有，不采纳此判断。
- 该路径是提供/挂载定制Compaction实现，不是给现有实例加一个普通事件listener。还需核查输出类型、保留后缀可见性、导出依赖、模式内scoped注册与已有服务替换、升级/卸载恢复；不能在核查前承诺Better Composer安装后对所有模式自动接管。
- 原生默认实现没有成功summary提交前的通用veto/amend事件；仅改变retainTokens也不等于保护任意中间要求。显式compactRegion还要求开放轮及工具配对平衡，不是空闲任意文本改写API。
- 极简模式本就没有compact；不得为Doctor静默给它添加压缩。

可继续研究的推荐方向：利用官方文档支持的摘要器扩展，在既有compact调用中保留明确的约束表示，尽量不新增模型调用；其控制范围及模式配置变更必须显式说明。若需要替换压缩提供方，属于新的用户配置决策，不能从此前“辅助执行”自动推导授权。

保留判定按摘要与未压缩部分的共同覆盖处理；精确结构/原文匹配可提供证据，复杂同义表达无法由字符串不匹配证明丢失。不得以匹配失败触发整包补发，也不得默认添加LLM judge。以下给出第三轮候选契约，尚需用户确认重大取舍。

## 11. 最后一轮接口补核：可用路径与限制

### 11.1 活跃代际的配置来源

`packages/preset/agent-preset-registry/src/index.ts:17–20` 根导出 `standingMountFor`、`livePresetMounts`。`src/mount.ts:25–52,101–126` 表明：

- `standingMountFor(agent.ctx)` 定位该Agent实际绑定的mount，而不是当前默认模式定义；mount有presetId、tree和作用域key。
- `tree.entries()` 可取得实际树的配置及启用状态。不能访问私有definitions Map；不为获取旧配置启动冷Agent。
- 全局枚举须限定当前runtime root，不能因相同modeId跨嵌入runtime混用。ScopeKey是进程内绑定证据，不是持久跨重启版本ID。
- Doctor安装前的冷历史仍unknown；今后有观测的活跃代际可建立带覆盖范围的配置版本记录。当前模块清单hash不足以代替配置版本。
- root Loader只能提供当前声明配置；运行树、声明、最终渲染结果、磁盘Skill正文是四类不同来源，不互相冒充。

### 11.2 compact 输入、输出及保留区定位

根包公开BasicCompactionEngine及配置类型，但未根导出内部SummarizationInput、SummaryResult和默认summary helper。不得从未发布的src路径深导入；覆盖方法使用公开Message/ToolSchema等结构类型，最终须以已发布声明编译验证。类外索引protected方法不是受支持的类型获取方案。

完整hook签名为 `summarize(input, agent, signal)`（`src/index.ts:247–257`），不是只有input；第二参数公开Agent提供 `agent.session`。`summarizer.ts:79–107` 的input含工具及system head+选定区域Message[]，结果含summary、provider/model、usage及rawOutput。结构化参数类型与继承返回推导不要求深导入内部类型，但仍需W0对已发布声明编译核验。`region.ts:471–522` 负责持久事务，Doctor不重写其提交逻辑。

补充路径：`packages/core/session/src/index.ts:824–862` 公开 `deriveMessages()`，消息投影保持身份；`packages/llm/llm/src/message.ts` 的Message有稳定id。因此可将hook输入的消息ID与当前派生序列对齐，识别选区与未选上下文，而非按相同文本猜测。必须验证有序匹配唯一、system head处理、空消息投影及范围形状；匹配异常则停用本次保护处理，不猜范围。

摘要前与返回前复查派生身份及内容hash。自动压缩的whole-surface稳定性由宿主校验；手动压缩允许选区外追加，若追加内容可能影响活跃要求/去重，返回前拒绝过期保护候选，不用旧后缀判断提交。涉及要求版本的快照也须复查。原宿主校验仍是最终范围/缩减门槛，不被Doctor绕过。

该能力来自公开子类及公开Session方法，不等于无需配置：要在目标模式的隔离compaction组中显式改用Doctor provider；旧活跃Agent保持旧代际，新建或宿主支持的正常重新绑定后才可生效。不静默重启或迁移会话，不给无compact模式添加compact。

## 12. 推荐逻辑架构（设计契约，无实现）

### 12.1 职责与拟定文件边界

拟定模块名供开发分解，最终以已批准需求为准：

| 模块 | 拟定位置 | 责任 |
|---|---|---|
| 公共数据契约与纯规则 | `src/doctor/contracts.ts`、`metrics.ts`、`eligibility.ts`、`versions.ts` | 指标、版本、恢复链、占比聚合；无UI/网络副作用 |
| Host读适配与采集 | `src/doctor/host/source.ts`、`observe.ts` | 只读列表/分页、live mount、有限被动观测、能力检测 |
| Host索引与作业 | `src/doctor/host/store.ts`、`jobs.ts` | 原子存储、增量缓存、取消、截止边界、覆盖 |
| 可选语义分析 | `src/doctor/host/analyze.ts` | 固定任务类型、模型预算、证据校验，不执行工具 |
| 可选压缩提供方 | `src/doctor/compaction.ts`（独立可导出入口） | 在用户启用的preset中覆盖summary，沿用宿主事务 |
| Client界面 | `src/client/context-doctor/` | 两视角、指标表/图、证据、反馈、候选审阅 |
| 既有接线 | `src/index.ts`、`src/remote.ts`、`src/client/remote.ts`、`src/client/index.ts` | 注册Host与Remote、设置/侧栏、保持已有地图接口兼容 |

不把完整语料放浏览器，不构建单独HTTP服务，不增加向量数据库或后台LLM代理。纯规则模块不依赖宿主运行实例，便于用构造样本验证。

### 12.2 一次扫描

1. capability preflight识别可用服务和包契约版本；缺能力单独降级。
2. 冻结业务可见session候选列表（含归档）、每会话截至seq和版本观测。
3. Host逐批只读扫描；未持久化且无法只读得到的活跃尾部标partial，不拿写锁或follow促活。
4. 恢复归并和样本资格先于模式分母；不读完所有正文才显示进度。
5. 按指标依赖折叠，只保存必要的块归属、hash、计数及源定位；细节按需读取。
6. 计算版本分组和每项coverage，输出不可变报告；新增事件使报告“可更新”，不在阅读中悄悄改分母。
7. 取消停止调度并关闭句柄；已有报告不被半成品覆盖，部分结果独立标partial。

### 12.3 核心对象（字段级，非代码）

- `SourceRef`：runtimePartition、sessionId、originSessionId、seq、messageId、blockPath、range、contentHash、evidenceLayer。
- `VersionRef`：kind（declaration/runtime-config/rendered-content/skill-rendered）、digest、schemaVersion、coverage（complete-within-scope/partial/unknown）、observedBinding、excludedFields、dependencyRefs。
- `Eligibility`：sessionId、rawBoundaries、recoveryGroups、confirmedExchanges、possibleExchanges、status（eligible/ineligible/needs-review）、reasons、manualDecision及证据。
- `MetricValue`：id/version、scope、value、unit、methodVersion、numerator/denominator、eligible/observed数量、missingReasons、sourceRefs、computationRevision。
- `AnalysisRun`：id、kind、scope、cutoffs、sourceVersions、ruleVersions、state、progress、usageObserved、budget、reportId、errors。
- `Problem`：id、标题、用户标签、处理状态、relatedComponentRefs；不保存自动确定的modeCause。
- `Occurrence`：id、problemId、sessionId、sourceVersion、evidenceRefs、occurredAt或unknown、reportedAt、是否统计内、recordRevision、撤回状态。
- `ConstraintRevision`：id、revision、原句/确认规范文本、条件/范围/例外、authority/sourceRefs、状态active/superseded/revoked/conditional、用户确认记录、依赖版本、fingerprint。
- `Recommendation`：id、kind、reason、evidenceRefs、preconditions、affectedScope、candidateRevision、executionSupport、状态；生成不意味着采用。
- `ExecutionReceipt`：本次使用的constraintRevision、compaction关联、operationStatus、summaryRef、已知usage；只记增强操作执行情况，不含逐条保留通过/失败、语义完整度或遵循证明。

人类反馈/确认对象与可重建缓存分库存放；清缓存不删除用户劳动。所有修改使用expectedRevision防止多页面覆盖。

## 13. 公共Remote契约与状态

在已有betterComposer命名空间增加前缀为doctor的独立方法，不改变clip方法语义。名称为设计契约，未实现。

| 方法族 | 最小输入 | 输出 / 约束 |
|---|---|---|
| `doctorCapabilities` | 无 | 公开服务可用性、支持级别、缺失原因；不启动Agent |
| `doctorModes` | 可选cursor | 当前mode元数据及配置coverage；Host内部无真实分页时不假装底层分页 |
| `doctorStartScan` | session/mode scope、版本筛选、规则版本、预算配置 | jobId、冻结范围摘要；仅确定性扫描 |
| `doctorJob` / `doctorCancelJob` | jobId | 阶段/已处理量/覆盖/结果页；取消幂等，不终止用户Agent |
| `doctorReportPage` / `doctorEvidence` | reportId、游标或不透明evidenceId | 有界结果；Host校验归属，不接受客户端任意文件路径 |
| `doctorSaveFeedback` | 类别、evidenceIds、可选problemId/说明、expectedRevision | Problem/Occurrence revision；幂等提交键避免重复点击 |
| `doctorUpdateFeedback` | objectId、expectedRevision、允许的编辑/撤回/合并操作 | 新revision或conflict；撤回重算统计，不启动分析模型 |
| `doctorPrepareAnalysis` | kind、已有报告/证据范围、模型选择 | 调用计划、输入估算、预算和数据缺口，无付费调用 |
| `doctorRunAnalysis` | planId、源版本、预算、幂等键 | jobId；超出计划/源变更拒绝，不自动扩张范围 |
| `doctorSaveConstraint` | 经审阅候选、来源、scope、expectedRevision | 已确认revision；不暗中发消息或改模式 |
| `doctorPrepareApply` / `doctorApply` | 建议ID、明确的action kind、源版本及可选constraintRevisionIds；显式确认的计划ID | 原意Diff、作用域、公开能力及执行结果；仅允许已定义的复制/草稿候选/保护计划配置等动作，不包括任意工具执行 |
| `doctorProblems` / `doctorOccurrences` | scope、problemId（实例查询）、cursor、状态过滤 | 现有问题/实例及revision，有界列表；供关联、编辑、撤回 |
| `doctorConstraints` | scope、cursor、状态 | 用户可审阅的要求及revision、来源、保护状态 |
| `doctorUpdateConstraint` | id、expectedRevision、edit/revoke/supersede操作、确认记录 | 新revision；使旧保护计划stale，禁止并发覆盖 |
| `doctorPrepareEvidenceCleanup` / `doctorCleanupEvidence` | 显式scope/对象及确认计划 | 先列影响再清理；不删除宿主会话，不把清缓存当删除反馈 |

扫描job：queued→reading→computing→complete/partial/cancelled/failed。模型job：prepared→running→complete/partial/cancelled/failed。执行计划：prepared→confirmed→applied/failed/stale。每条状态含可解释原因，不将操作成功写成质量通过。

## 14. 被动采集、版本与存储生命周期

### 14.1 版本依赖

推荐按相关来源内容寻址，不能把最后修改时间当版本，也不能每次对话新增一条消息就创造新的模式配置版本。

- 模式声明版本：完整可得的声明、顺序、启停、条件表达式及插件身份；表达式原样记录指纹，不由Doctor执行。
- 运行配置版本：实际mount的已解析配置与包身份；源字段不可安全/确定表示时标partial。
- 渲染版本：实际system/tool/Skill等内容；动态值单独记录，不静默删除“变化字段”后假称完整相同。
- 组件内容：按贡献单元hash；历史Skill渲染体与源SKILL.md版本区分。
- 本地运行时root、声明、runtime、rendered版本分别关联；一个运行Agent可在重启前后产生不同配置关联区间，不把sessionId整个生命周期锁到首次版本。

与分析无关的凭据不落正文、不传前端；可存“已排除secret字段”及相关availability观测，明确配置版本只覆盖质量相关非secret范围。脱敏不能抹掉与能力有关的可观测变化；无法判等的来源保留unknown，不靠token/apiKey字符串规则宣称万能脱敏。复用可获得的公开schema元数据；私有redact实现不深导入。

### 14.2 被动采集

只监听现有公开session事件/可用配置生命周期，以实际已活跃Agent绑定做增量快照。不能为采集启动Agent、执行工具、加载所有Skill正文或探测MCP。无可靠变更事件时只在已有活动的安全边界比较指纹，不默认高频全量轮询。

首次安装提供手动历史扫描；新观测从安装后开始，不编造旧配置。采集开关与模型授权分开。卸载停止监听/任务并释放句柄，不删除宿主历史或反馈文件。

### 14.3 存储方案（推荐）

Host插件专用目录下保存版本化manifest、每会话可重建索引、报告缓存、反馈/确认记录；不写任意自定义session事件，不直接修改宿主持久日志。优先使用现有文件持久化模式，暂不新增数据库依赖。

单进程串行写队列、临时文件+原子替换；文件路径由校验后的ID派生，拒绝路径穿越。用户记录写入成功才回成功；崩溃后旧版可读而不是半个JSON。跨进程写者若无法取得单写者保证，只读并提示，不伪装全局锁已具备。

缓存按source revisions+方法版本复用，LRU按容量清理而不是按时间判断质量过期。提议可重建缓存默认上限256MiB，可调整/清空；用户反馈和确认记录不受LRU清理。J4=B已确认：只暂存主动选定证据的有界摘录，不额外复制全会话原文；确认源会话已删除后，清除对应摘录及可还原它的证据缓存，只保留问题类型、用户自行填写的说明和“证据已删除”状态，不再向UI或模型提供已删除来源的摘录。

源删除须由公开删除事实或权威持久化not-found确认；归档、临时读取失败、权限不足或列表暂缺不等于删除。历史报告引用统一通过证据存储解引用，不在报告中重复嵌入原文；每次提供证据前核对源状态，离线无法核实则暂不提供缓存正文。被动发现删除时启动本地清理，宿主停机期间不能承诺即时物理清除，恢复后优先处理清理任务。文本型诊断/候选若复制了证据内容也标同源并失效清理，避免绕过摘录删除。用户已经独立审阅确认的规范要求属于另行采用对象，不与临时摘录混存；源删除后其来源状态改变，停止依赖原证据的自动保护并提示重新确认或删除，不能偷偷利用残留原文。

旧schema升级只迁移Doctor文件，备份后原子替换；遇到比插件更新的schema进入只读状态。原始报告可保留旧算法版本，不按新公式覆写。

## 15. compact约束保护：执行型增强（最终用户选择）

### 15.1 显式可选提供方，单次摘要

不是全局接管：用户选择目标模式，确认只替换压缩提供方的配置Diff；保留既有阈值、路由和取消策略。无compact模式不自动添加。活跃旧代际标“尚未启用”，不悄悄重启；关闭/卸载恢复原provider时遵守配置版本冲突处理。

J1已接受这种产品形态。该变更形成新的模式版本；实际产品中仍需明确选择目标模式和启用，不因安装Better Composer自动改模式。本次仅设计，未修改任何运行配置。

### 15.2 能力放在摘要输入组织，而非结果验证

用户对J6的最终纠偏是“保护约束只执行，不校验”。因此不新增Doctor保留检查、语义judge、保留通过率、摘要拦截器或由保留失败触发的重试。

1. 读取本次compact开始时用户已确认且active的要求及revision，保留条件、范围、例外和来源。已明确撤销/替代的要求不提供；不让模型输出自行升级为确认要求。
2. 插件用稳定来源ID组织选中区域和未选上下文。对已明确出现在保留部分的同条规范要求，只作为“已在保留部分，无需重复”的说明；保护集合按ID/revision去重，不把同一要求多次拼接。
3. 构造一次性摘要任务：保留原有摘要职责，加入紧凑的“本次须保留的有效要求”和必要的保留部分依据；要求把相关内容融合到摘要的有效要求/关键上下文部分，保留条件与例外，已有表达合并而非重复，较新明确纠正优先于旧理解。不得把确认清单直接附加成第二份最终会话消息。
4. 自定义summary阶段通过公开LLM服务执行原本就需要的那一次compact摘要调用。输入是本次不可变快照，不修改原消息对象；不添加额外Doctor模型调用。内容来源不同仍保持其权限语义。
5. 将摘要文本按宿主返回契约交回原事务；rawOutput和usage如实记录。不重新抽取条目、不比对逐条原文是否返回、不核验“kept”标记、不按Doctor保留结论修改或拒绝摘要。没有保护条目时直接使用基类默认summary行为。
6. 压缩完成后不另发要求清单，不因关键词未出现补注入。用户之后主动要求质量分析时，可诊断当时上下文；该动作与compact执行独立，也不恢复默认的逐次保留检查。

去重主要由输入集合归并、保留部分说明及摘要融合指令实现。模型面对同义表达时不保证完全无重复；产品如实描述“已执行增强摘要”，不描述“所有要求已验证保留”。

### 15.3 操作状态与常规错误

状态只反映操作：未启用/已启用、已确认要求、摘要进行中、增强摘要完成、摘要调用失败/取消、宿主提交失败。可记录本次应用了哪些确认revision，名称为ExecutionReceipt，不保存虚假的保留验证结果。

宿主原有范围稳定、取消、内容类型、工具配对、缩减与持久化规则不被移除。网络错误、空响应或宿主事务失败仍正常报错；不新增“Doctor保留校验失败”类别，也不要求用户每次验收摘要。宿主自身重试策略照常，Doctor不因保护效果追加重试。pruner先前落地的变动不能承诺回滚。

确认记录或源在执行中被用户明确撤销时，使用常规取消/过期操作处理，不能写入旧用户授权；这属于操作并发控制，不是对生成内容的保留验证。普通会话新增文字不触发无休止复核队列，最新上下文交给同一次摘要任务处理。

### 15.4 使用边界

保护能力以输入组织、版本和来源管理、摘要指令和宿主已有事务支撑。不是把所有风险交给用户反复确认；审阅只发生于采纳/修改要求或配置时。当前生效约束如何提供给下一次普通请求是明确的用户采用动作，不自动后台重注入；已有原文避免再发，选择补充时不直接发送。

开发期仍需测试归属、去重输入、参数、取消、作用域和事务兼容，测试不进入用户日常运行流程，也不等于另建模型质量评估平台。J6原A/B保留失败选择题撤销，无需再请用户选择。

## 16. 有效交互的确定性状态机（J2/J3已确认）

门槛已确认两个完整有效往返，不是四个运行turn。

- 从来源为原始用户的消息建立请求单元；tool-only assistant步骤、thinking、系统/Skill注入不形成对用户的完整响应。
- 中断原因、恢复事件和严格纯继续短语共同支持恢复链归并；有实质增量的“继续，但是…”不合并。即便turn变化也可属于同一恢复链。
- 原指令及其恢复输出按一个往返计算；未形成用户可见有效响应的中断仅记未完成候选。
- J3：无法确定属于纯恢复时，按正常对话处理，不合并、不因恢复语义不确定排除样本、不启动LLM分类。保留判定依据便于纠正；正常对话仍需实际存在有效模型回应才构成完整往返，日志缺失与回应未完成不由此规则豁免。
- J2=A：fork门槛只数本分支自身有效往返。继承仍用于理解自身输入，执行及携带计量保持原约定；复制历史不使短分支自动入组。
- 用户可在资格详情确认/纠正恢复归并；保存标注及源revision，原文变化后标注待复核。

## 17. 资源预算与模型计划

- 确定性扫描工程初值：同时最多2个会话读句柄；事件页目标200条且受返回大小约束；前端一次最多50行、证据默认8KiB，可显式继续读取。不按“页数”宣称字节硬上限。
- 单个超大事件或特殊投影可能超过预算，标该项partial并允许显式提高限制，不静默截断后声称分析完整。进度报已处理事件/会话及实际字节，取消在页/任务边界检查。
- UI目标为不卡输入；持久扫描在Host任务队列，不监听输入draft。性能为待测目标，不承诺毫秒级。
- J5已确认：用户启动的语义计划默认最多2次调用（一次主分析，必要时一次明确预算内汇总），总输入估算不超过24k tokens、每次输出上限4k且不超过模型限制。计划超过范围时先缩小证据或由用户显式扩大预算，不自动追加请求。汇总调用的输入也占用总输入预算。
- 预算tokenizer不可用时标估算并辅以字符/字节限额，不能声称精确费用上限。取消的在途费用可能仍发生，报告仅列已知usage。
- Compact调用单独遵循所选provider原有配置，不使用Doctor手动质量分析预算，不暗中更换供应商/模型。

模型预算为已确认、可由用户调整的默认值；扫描工程初值在开发测试中校准，均不构成性能或费用保证。

## 18. 兼容与开发前验证门槛

不仅检查包版本，还检测实际公开能力。当前以 alpha.2 契约作为设计基线，alpha.1 声明需在开发前对齐；不能宣称更早宿主全面支持。

核心统计缺公开历史服务时，只提供当前已观测数据并明确局限，不直接读宿主私有存储。完整模式读取缺 mount 公开契约时显示名册/unknown，不宣称完整预设评价。PTC 曝光缺解析时显示子调用事实，覆盖率为 unknown。增强缺子类契约或模式未启用时不自动接管。

开发首个工作包必须对已发布包做编译契约与构造 fixture 测试，验证 protected 结构签名、Message ID 对齐、SummaryResult rawOutput/summary 语义、provider 挂载与卸载。若契约不成立，停在对应能力而不退回私有 import。设计阶段未运行这些测试。

设计已定稿：约束保护只执行、不校验；实现阶段验证工程兼容性和正常错误处理，但不把逐次保留验证加入产品流程。
