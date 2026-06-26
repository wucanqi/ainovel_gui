# Host + Orchestrator 优化施工清单与里程碑

## 1. 使用说明

本文档用于将 [HOST_ORCHESTRATOR_OPTIMIZATION_PLAN.md](/Volumes/SandDisk/MyProject/novel_tool/docs/HOST_ORCHESTRATOR_OPTIMIZATION_PLAN.md) 拆解为可执行施工清单。

适用对象：

1. 产品/技术负责人做排期
2. 开发同学按批次推进
3. 测试同学按里程碑准备验收

建议推进方式：

1. 每个里程碑单独评审
2. 每个里程碑结束后做一次真实链路回归
3. 不跨里程碑并发改状态机核心逻辑，避免诊断困难

---

## 2. 总体里程碑

建议拆为 5 个里程碑：

1. `M1` 编排边界收口
2. `M2` 前置条件与状态模型统一
3. `M3` Host 执行协议改造
4. `M4` 恢复/补偿/异常回退收敛
5. `M5` 测试补齐与灰度验收

建议节奏：

1. `M1-M2` 先做设计与骨架
2. `M3-M4` 再动真实执行链
3. `M5` 最后做稳定性收口

### 2.1 当前状态（截至 2026-06-26，代码核实）

1. `M1` ✅ 完成
   - `Host` 是唯一真实运行入口（start/resume/pause/reset/steer），`flow-router` 承担核心路由判断。
   - `Host -> Route/Recovery -> Action -> 执行 -> 再归约` 主干结构已成型。

2. `M2` 🟡 基本完成（缺正式文档）
   - 章节级 `chapterReadiness` 已落地，`knowledge_contract_ready` 纳入 writing 前置。
   - `foundationComplete`（项目基础）与"当前章可写"（章节门禁）已拆分为两层判断。
   - `flow-router` 在 routing 时检查 readiness，缺 contract 绝不派发 Writer。
   - **剩余**：未产出正式的字段语义表、放行/回退矩阵文档。

3. `M3` 🟡 部分完成
   - `HostAction` 模型（dispatch_agent/wait/transition/recover）已全面落地。
   - Host 静默补契约路径已移除，收敛为项目状态重算入口。
   - Writer 后真实执行 `plan_gate`（4 种 verdict: pass→writing, replan→contract_generation, escalate→wait, 其余→修订计划）。
   - Writer 后真实执行 `draft_gate`（5 种 verdict: pass→commit+重算路由, polish→polishing, rewrite→chapter_rewrite, replan→architecting, escalate→chapter_rewrite升级模型）。
   - 导入 Markdown 原文全量注入 Host context，不受 RAG chunk 裁切影响。
   - **剩余**：`volume_review` 未在 Host 侧（`inferHostOrchestratorState`）显式处理，依赖 Orchestrator 的 tick() 承接。

4. `M4` 🟡 部分完成
   - 恢复前重算（reconcileProjectState → LoadState → Route → decideRecoveryAction）已成标准流程。
   - 子任务失败显式回退已覆盖 Writer（draft_gate / plan_gate / contract_generation）、Editor（arc_review_pending）、Architect（contract_generation / architecting）。
   - `completed` 项目禁止重复启动，`transition` action 可正常结束 Host loop。
   - Draft Gate pass 后提交章节并按最新事实重算路由，不再手写固定跳转。
   - Editor 完成后的 verdict 消费已落地（polishing / chapter_rewrite / architecting）。
   - **剩余**：`volume_review` 链在 Host 侧无显式状态映射；Editor 评审尚未严格按 `arc_id / volume / target_id` 精确绑定最新记录。

5. `M5` ❌ 未完成
   - Router 层测试：4 个用例（缺 contract 场景路由验证）✅。
   - Host 真实路径测试：仅 1 个（completed 项目守卫），其余缺失 ❌。
   - 恢复/中断测试：缺失 ❌。
   - 灰度验收链路：未开始 ❌。

### 2.2 当前进度标记

1. ✅ 已完成
   - `HostAction` 基础模型（4 种 action 类型）
   - 章节级 `chapterReadiness`（含 `knowledge_contract_ready` 判定）
   - `knowledge_contract` 缺失阻塞 Writer（flow-router 层 + `decideHostAction` 层双重拦截）
   - Host 启动/恢复时执行状态同步（`syncExecutionState`）
   - 导入 Markdown 原文全量入库 + 全量注入 Host context
   - Writer 后真实执行 `plan_gate`（4 种 verdict 全覆盖：pass / replan / escalate / 修订计划）
   - Writer 后真实执行 `draft_gate`（5 种 verdict 全覆盖：pass / polish / rewrite / replan / escalate）
   - Draft Gate 通过后提交章节并按最新事实重算路由（`commitChapterFromGate` + `decidePostCommitAction`）
   - 子任务失败显式回退：Writer（draft_gate / plan_gate / contract_generation）、Editor（arc_review_pending）、Architect（contract_generation / architecting）
   - `completed` 项目禁止重复启动（`start()` 入口守卫）
   - `generate_chapter_contract / generate_knowledge_contract` 工具内部兜底补建缺失 chapter 实体
   - Draft Gate / Plan Gate 违规点回灌到后续 Writer / Architect 任务 prompt
   - 支持通过 `steer` 写入项目级全局审核规则与全局禁用短语
   - foundation 层与 chapter gate 层分层判断（`foundationMissing` vs `chapterReadiness.readyToWrite`）
   - Editor 完成 verdict 消费（`decideEditorFollowUpAction` → polishing / chapter_rewrite / architecting）

2. 🟡 部分完成
   - `M2` 状态模型文档
     - 代码层 readiness / gate 判定已就绪，但未产出正式的**字段语义表**与**放行/回退矩阵**文档
   - `M3` Host 执行协议
     - 启动/恢复/自动推进大体共用同一协议，但 `Host -> decide -> execute -> reduce` 未彻底从实现层解耦
     - `volume_review` 状态未在 `inferHostOrchestratorState()` 中显式映射（仍依赖 Orchestrator tick() 承接）
   - `M4` 恢复/补偿/异常回退
     - Writer / Editor / Architect 子任务失败已有显式回退，但弧末/卷末（`volume_review`）回退在 Host 侧未覆盖
     - Editor 评审回退尚未严格按 `arc_id / volume / target_id` 精确绑定最新评审记录
   - 全局审核规则
     - 已接入 Draft Gate / Plan Gate 检查与 Host context
     - 当前以"规则文本 + 禁用短语 + 反 AI 味基础模式"实现，未形成独立 UI 管理页与更丰富的规则 DSL
   - `plan_gate` verdict 持久化
     - plan_gate 判决已生效但 verdict 复用 `draft_gate_verdicts` 表存储，无独立持久化与审计链

3. ❌ 未开始或基本未开始
   - `M5-T2` Host 真实路径测试补齐（当前仅 1 个测试用例）
   - `M5-T3` 恢复/中断测试补齐
   - `M5-T4` 灰度验收链路
   - 面向团队协作的状态字段语义文档、职责矩阵、异常回退矩阵正式稿

4. 🔴 当前阻塞
   - `vitest` 运行受 `better-sqlite3` ABI 不匹配影响，Host 真实链路测试无法稳定执行
   - `plan_gate` verdict 复用 `draft_gate_verdicts` 表，未建独立审计链
   - `volume_review` 在 Host 侧无显式状态映射，卷末链路依赖 Orchestrator tick() 间接处理

---

## 3. 里程碑 M1：编排边界收口

### 3.1 目标

明确当前系统中：

1. 谁是唯一运行入口
2. 谁是唯一决策源
3. 哪些逻辑必须迁出 `Host`
4. 哪些逻辑必须保留在 `Orchestrator`

本里程碑不追求大规模改行为，先把边界说清楚、图画清楚、接口定清楚。

### 3.2 任务清单

#### M1-T1 梳理现有真实链路

输出内容：

1. 前端启动链路图
2. 前端恢复链路图
3. 自动推进链路图
4. 手工单步/执行入口链路图

重点回答：

1. 当前哪些 IPC 实际走 `Host`
2. 当前哪些测试直接走 `Orchestrator`
3. 当前 phase / state / flow 是谁在改

验收标准：

1. 能清楚画出“启动一次写作”经过哪些模块
2. 能定位每个状态字段的写入点

#### M1-T2 输出职责边界表

输出一张职责表，至少包含：

1. 状态迁移归谁
2. contract 校验归谁
3. 当前章选择归谁
4. Agent 派发归谁
5. 补偿逻辑归谁
6. 暂停恢复归谁
7. 事件广播归谁

验收标准：

1. 每类职责只保留一个主责任模块
2. 不再出现“两个模块都能决定是否进入 writing”

#### M1-T3 定义目标调用协议

输出目标协议：

1. `UI -> Host`
2. `Host -> Orchestrator.decide`
3. `Host.execute(action)`
4. `Host -> Orchestrator.reduce`

验收标准：

1. 团队对“谁决定、谁执行”形成统一结论
2. 后续实现任务都按这套协议展开

### 3.3 交付物

1. 编排现状图
2. 目标边界图
3. 职责矩阵表
4. 调用协议草案

### 3.4 风险

1. 只改文档不改认知，后续实现仍会混边界
2. 若未统一入口，后续测试仍可能走错链路

### 3.5 里程碑完成标准

满足以下条件视为 `M1` 完成：

1. 团队确认 `Host` 是唯一运行入口
2. 团队确认 `Orchestrator` 是唯一决策源
3. 已明确现有冗余职责的迁移方向

---

## 4. 里程碑 M2：前置条件与状态模型统一

### 4.1 目标

建立单一、章节级、显式的 readiness / gate 模型，让“能不能写”只在一处定义。

### 4.2 任务清单

#### M2-T1 统一状态字段语义

明确并固化：

1. `phase` 的职责
2. `orchestrator_state` 的职责
3. `flow` 的职责
4. `active_agent` 的职责

输出内容：

1. 状态字段语义表
2. 状态字段允许写入点表

验收标准：

1. `phase` 不再承担章节门禁语义
2. `orchestrator_state` 成为核心门禁状态

#### M2-T2 定义章节级 readiness 模型

建议至少定义：

1. `architecture_ready`
2. `current_arc_selected`
3. `current_chapter_selected`
4. `chapter_contract_ready`
5. `knowledge_contract_ready`
6. `chapter_plan_ready`
7. `plan_gate_passed`
8. `draft_present`
9. `draft_gate_passed`
10. `chapter_committed`

输出内容：

1. readiness 字段列表
2. 每个字段的数据来源
3. 每个字段的判断粒度

验收标准：

1. 所有 gate 条件都能映射到 readiness 字段
2. 不再使用项目级“存在任意一条记录”替代章节级判定

#### M2-T3 定义放行与回退规则表

输出一张规则表：

1. 当前状态
2. 前置条件
3. 满足时下一状态
4. 不满足时回退状态
5. 阻塞说明

最少覆盖：

1. `architecting -> contract_generation`
2. `contract_generation -> plan_gate`
3. `plan_gate -> writing`
4. `writing -> draft_gate`
5. `draft_gate -> chapter_commit`

验收标准：

1. 任何状态迁移都有明确放行条件
2. 任何失败都有明确回退落点

#### M2-T4 收敛 foundation 完成定义

重新定义 `foundationComplete`：

1. 它只用于“项目是否具备写作基础”
2. 它不能替代“当前章节是否具备写作前置条件”

验收标准：

1. foundation 层和 chapter gate 层彻底分开
2. 不再出现 foundation complete 就直接派发 writer

### 4.3 交付物

1. 状态字段语义文档
2. readiness 模型文档
3. 放行/回退规则表
4. foundation 定义修订稿

### 4.4 风险

1. 若 readiness 定义不够细，后续仍会出现隐式判断
2. 若章节粒度没收住，后续 bug 只会换位置再出现

### 4.5 里程碑完成标准

满足以下条件视为 `M2` 完成：

1. 当前章可写条件可以被一组显式字段完整描述
2. `writing` 放行条件与 `Writer` prompt 前置要求完全一致

---

## 5. 里程碑 M3：Host 执行协议改造

### 5.1 目标

把 `Host` 从“隐式第二状态机”改造成“按回合执行 Orchestrator 决策的壳层”。

### 5.2 任务清单

#### M3-T1 定义 action 模型

建议至少包含：

1. `dispatch_agent`
2. `transition`
3. `wait`
4. `recover`

输出内容：

1. action 类型表
2. 每种 action 的输入/输出定义
3. 哪些 action 会触发 DB 状态变更

验收标准：

1. `Host` 的每一步都能归类到固定 action
2. 不再依赖散落逻辑临时决定行为

#### M3-T2 定义单回合协议

回合步骤固定为：

1. 读取状态
2. 计算 action
3. 执行动作
4. 收集结果
5. 归约到新状态

验收标准：

1. 启动、恢复、自动推进都共用同一回合协议
2. 任何一次推进都可以打印出“这回合做了什么 action”

#### M3-T3 下放 Host 的放行权

清点并迁出 `Host` 里这些能力：

1. 自动进入 `writing`
2. 自动认定 contract 已齐
3. 自动派发 `writer`
4. 自动补偿后直接继续推进

验收标准：

1. `Host` 不再拥有关键状态放行权
2. 所有关键迁移都来自 `Orchestrator`

#### M3-T4 收敛 UI 入口

统一：

1. 启动
2. 恢复
3. 自动推进
4. 手工执行下一回合

都经过同一 `Host` 执行协议。

验收标准：

1. 不再有多条不同的推进主链
2. 可解释“为什么这次派发了某个 agent”

### 5.3 交付物

1. action 模型说明
2. 单回合协议说明
3. Host 权限瘦身清单
4. 统一入口流程图

### 5.4 风险

1. 若入口不统一，后续仍会出现“测试过但线上不一样”
2. 若 `Host` 仍保留部分放行权，会再次演化成双中枢

### 5.5 里程碑完成标准

满足以下条件视为 `M3` 完成：

1. `Host` 只执行 `Orchestrator` 决策
2. 启动/恢复/自动推进共享同一执行协议

---

## 6. 里程碑 M4：恢复、补偿、异常回退收敛

### 6.1 目标

把最容易出脏状态的 3 类能力收回到显式编排语义中：

1. 恢复
2. 补偿
3. 异常回退

### 6.2 任务清单

#### M4-T1 定义恢复重算清单

恢复时必须重算：

1. 当前 state
2. 当前 chapter_id
3. contract 是否成对存在
4. chapter_plan 是否存在
5. draft 是否存在
6. gate verdict 是否存在

验收标准：

1. 恢复不是继续 loop，而是先 reconcile
2. 恢复动作可以解释

#### M4-T2 定义 recover action 结果集

恢复后只允许进入以下结果之一：

1. 回到 `contract_generation`
2. 回到 `plan_gate`
3. 继续 `writing`
4. 进入 `draft_gate`
5. 暂停等待人工

验收标准：

1. 不会因上次 state 是 `writing` 就盲目继续写

#### M4-T3 重写补偿策略

自动补偿应改为显式调度：

1. 发现缺 contract
2. 派发 Architect 的 contract generation 任务
3. 完成后重新校验
4. 不通过则停留

验收标准：

1. 补偿动作可见、可追踪、可失败
2. 补偿失败不会静默继续

#### M4-T4 定义异常回退矩阵

至少覆盖：

1. contract 生成一半失败
2. plan gate 未通过
3. draft gate 未通过
4. writer 中途中断
5. editor 评审要求 rewrite/replan

输出内容：

1. 异常类型
2. 回退状态
3. 是否需要人工确认
4. 是否允许自动重试

验收标准：

1. 每类异常都有稳定落点
2. 不会把坏状态重复送回 Writer

### 6.3 交付物

1. 恢复重算清单
2. recover action 说明
3. 补偿策略修订稿
4. 异常回退矩阵

### 6.4 风险

1. 如果恢复机制不重算，线上脏状态会继续反复污染
2. 如果补偿仍是静默后台行为，排障会继续困难

### 6.5 里程碑完成标准

满足以下条件视为 `M4` 完成：

1. 恢复后不会重复派发错误 Agent
2. 缺 contract 的章节不会被送进写作阶段
3. 异常都有明确回退状态

---

## 7. 里程碑 M5：测试补齐与灰度验收

### 7.1 目标

让测试覆盖真实运行链路，而不是只覆盖理想设计路径。

### 7.2 任务清单

#### M5-T1 构建核心集成测试矩阵

至少覆盖：

1. 当前章缺 `chapter_contract`
2. 当前章缺 `knowledge_contract`
3. 当前章只有一半 contract
4. 当前章 plan gate 未通过
5. 当前章 draft gate 未通过
6. 第 4 章缺 contract，而第 1 章有 contract

验收标准：

1. 所有这些场景都不能直接派发 `Writer`

#### M5-T2 补 Host 真实路径测试

覆盖真实入口：

1. IPC 启动
2. IPC 恢复
3. 自动推进
4. 恢复后继续推进

验收标准：

1. Host 路径与 Orchestrator 直测路径结论一致

#### M5-T3 补恢复/中断测试

至少覆盖：

1. Writer 中断
2. Contract 生成中断
3. Draft gate 前中断
4. 恢复后重新 reconcile

验收标准：

1. 恢复后状态合法
2. 恢复后不会误推进

#### M5-T4 灰度验收清单

建议做一轮端到端灰度：

1. 新建项目
2. 导入文档
3. 生成快照
4. 启动编排
5. 自动推进到首章完成
6. 自动推进到第二章开始
7. 人为制造缺 contract 场景
8. 验证系统阻塞与回退

验收标准：

1. UI 可观察到明确阻塞原因
2. Agent 不会在坏前置下继续写

### 7.3 交付物

1. 测试矩阵
2. 集成测试用例清单
3. 灰度验收 checklist
4. 上线回归清单

### 7.4 风险

1. 若只测 `Orchestrator`，仍可能漏掉 `Host` 真实行为
2. 若不做灰度验收，恢复类 bug 很容易漏过

### 7.5 里程碑完成标准

满足以下条件视为 `M5` 完成：

1. 真实路径与设计状态机行为一致
2. contract/gate 缺失不会再误派发 `Writer`
3. 恢复与异常回退可以稳定复现并通过

---

## 8. 优先级建议

### P0

必须优先推进：

1. `M1-T2` 职责边界表
2. `M2-T2` readiness 模型
3. `M2-T3` 放行/回退规则表
4. `M3-T3` 下放 Host 放行权
5. `M5-T1` 缺 contract 场景测试

### P1

紧随其后：

1. `M3-T2` 单回合协议
2. `M4-T1` 恢复重算
3. `M4-T3` 补偿策略收敛
4. `M5-T2` Host 真实路径测试

### P2

收口阶段：

1. `M4-T4` 异常回退矩阵
2. `M5-T4` 灰度验收

---

## 9. 推荐实施顺序

建议按下面顺序施工：

1. 先完成 `M1`
2. 再完成 `M2`
3. 然后先做 `M3-T1 ~ M3-T3`
4. 再做 `M4-T1 ~ M4-T3`
5. 最后补 `M5`

不要建议的顺序：

1. 先改 Host 具体逻辑，再回头定义状态模型
2. 先补测试，再决定谁拥有放行权
3. 在职责未收口前并发重构 Host 和 Orchestrator

---

## 10. 每周推进建议

如果按周推进，可以参考：

### 第 1 周

1. 完成 `M1`
2. 输出边界图、职责矩阵、调用协议

### 第 2 周

1. 完成 `M2`
2. 固化 readiness 模型与放行规则

### 第 3 周

1. 推进 `M3`
2. Host 改为按回合协议执行

### 第 4 周

1. 推进 `M4`
2. 收敛恢复、补偿、异常回退

### 第 5 周

1. 推进 `M5`
2. 集成测试、灰度验收、上线回归

---

## 11. 项目管理建议

建议把任务拆成 4 类 issue：

1. `ARCH`
   - 架构与边界类

2. `STATE`
   - 状态机/前置条件/回退规则类

3. `RUNTIME`
   - Host 执行协议、恢复、补偿类

4. `QA`
   - 集成测试、灰度、回归类

每个 issue 至少带上：

1. 所属里程碑
2. 依赖前置
3. 验收标准
4. 风险点

---

## 12. 最终验收口径

本轮优化完成的最终判定标准：

1. 系统只有一个编排决策中枢
2. `Host` 不再私自决定是否进入 `writing`
3. `Writer` 永远不会在当前章缺 contract 时被误派发
4. 恢复后系统不会因为脏状态重复犯错
5. 真实 UI 路径与状态机测试路径一致

一句话总结：

本次施工不是“修一个 contract bug”，而是把当前项目从“双编排半耦合”收敛为“单决策中枢 + 单执行壳层”的稳定结构。
