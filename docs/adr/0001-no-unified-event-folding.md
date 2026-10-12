# 不统一上下文地图与 Context Doctor 的事件折叠

上下文地图（客户端 `src/client/context-map.ts` 的实时投影）与 Context Doctor（宿主端 `buildSessionView` / canonical `foldSurface`）各自实现会话事件折叠，存在重复逻辑（轮次切分、token 估算、工具提取）。2026-10-10 架构评审决定：**不做统一**，两轨保持独立实现。

## 理由

- 双轨是明文架构定稿：`CANONICAL_RUNTIME.md` 规定实时构成、宿主投影与 Doctor 结构快照 "are deliberately separate measurements"；`IMPLEMENTATION_PLAN.md` 规定「不混合计量依据」；`docs/context-doctor-design.md` 规定 live 投影只承担显示职责。
- 方案 A（客户端改消费宿主投影）致命：丢失未发送草稿增量感知（`draftClips()`），16ms 内存计算变为 RPC 往返，流式期间需全量序列化。
- 方案 B（抽共享同构模块）：`foldSurface` 依赖 `@deepseek-ai/dsh-session`（含 Node `Buffer`），浏览器端引入有打包与 polyfill 风险，且直接违反上述基线。
- 测试断言的是两轨独立（`context-runtime-composition.spec.ts`：`keeps composition and pressure independent instead of rescaling shares to projected input`），统一会破坏既定契约。

## Consequences

- 两轨估算约定存在已知微漂移（客户端 `Math.ceil(chars/4)` vs 宿主 `Math.round(chars/4)`，每块 ±1 token 量级），在独立计量前提下可接受，不为对齐而改。
- 未来架构评审若再次提出「统一事件折叠」，先读本 ADR；仅当双轨漂移产生真实用户可见缺陷、且 canonical 基线修订时方可重开。
