# Host + Orchestrator 编排优化方案

## 当前进展（截至 2026-06-26，代码核实）

本方案已有大量实现落地，当前状态建议按下列口径理解：

1. 已完成对齐
   - `Host` 已引入显式 `HostAction` 模型，按 `dispatch_agent / wait / recover / transition` 组织执行。
   - `flow-router` 已补充章节级 `chapterReadiness`，并将 `knowledge_contract` 纳入写作前置判断，缺 contract 绝不路由到 Writer。
   - `Host` 已在启动、恢复、自动推进时同步 `current_chapter_id / current_arc_id / active_agent / orchestrator_state`。
   - 已补充"当前章缺 knowledge contract 时不能直接派发 Writer"的测试覆盖。
   - `plan_gate` 4 种 verdict（pass / replan / escalate / 修订计划）与 `draft_gate` 5 种 verdict（pass / polish / rewrite / replan / escalate）均已完整实现。
   - 子任务失败显式回退已覆盖三种 Agent（Writer / Editor / Architect）。
   - foundation 层与 chapter gate 层已完成分层判断（`foundationMissing` vs `chapterReadiness.readyToWrite`）。

2. 部分完成，仍需继续收口
   - `Host` 虽然执行 action 协议，但仍保留部分决策逻辑（`decideHostAction` 内嵌路由判断），未彻底解耦为纯执行壳层。
   - 恢复链路已有 `recover` 分支，6 种恢复场景已定义。`volume_review` 回退在 Host 侧未显式覆盖。
   - `phase`、`flow`、`orchestrator_state` 的职责边界比之前清晰，但未产出正式的状态字段语义文档。

3. 尚未完成
   - `volume_review` 未在 `inferHostOrchestratorState()` 中显式映射，卷末链路依赖 Orchestrator tick() 间接处理。
   - `plan_gate` verdict 复用 `draft_gate_verdicts` 表，未建独立持久化与审计链。
   - Host 真实链路的集成测试严重不足（仅 1 个测试用例），恢复/中断/异常回退测试缺失。

### 当前缺口

1. 决策边界仍未完全收口
   - `Host` 已明显瘦身，但 `decideHostAction` / `decideWriterGateAction` 仍内嵌路由判断，不是纯执行壳层
   - `flow-router + recovery + Host gate handling` 共同承担部分决策

2. gate 状态仍未完全产品化
   - Writer 后已经真实执行 `plan_gate / draft_gate`，所有 verdict 路径完整
   - 但 `plan_gate` 没有独立持久化 verdict 表（复用 `draft_gate_verdicts`），无统一审计链
   - `volume_review` 未在 `inferHostOrchestratorState()` 中显式映射，依赖 Orchestrator tick() 间接处理
   - gate 失败原因已回灌给后续任务，但未形成独立的"反馈记忆层 / UI 可视化诊断面板"

3. Editor 链路刚进入真实执行
   - Host 已能消费评审 verdict，并驱动 `polishing / chapter_rewrite / architecting`
   - 但还没有把 `arc_review_pending -> arc_review -> volume_review / next_arc_plan / complete` 全链条在 Host 侧精确落平（部分依赖 Orchestrator）

4. 导入文档已经满足"原文不裁切"主要求
   - 原文入库不裁切
   - 原文进入 Host 上下文不裁切
   - 仍保留 memory/RAG 分块，仅作为检索层，不再作为原文进入编排的唯一入口

5. 全局审核规则已具备基础能力
   - 可通过 `steer` 写入项目级全局审核规则与全局禁用短语
   - Draft Gate / Plan Gate / Host context 已开始消费这些规则
   - 但当前实现仍偏工程型入口，后续更适合补一个显式配置界面

6. 测试与灰度仍是主要短板
   - Router 层测试已有（4 个用例）
   - Host 真实链路测试仅 1 个用例（completed 项目守卫），恢复链路、异常回退链路测试全部缺失
   - 本地测试仍受 `better-sqlite3` ABI 环境问题阻塞

## 1. 背景

当前项目在“自动规划并推进小说编写”上，实际并存两套编排逻辑：

1. `Host` 路径
   - 负责前端真实启动、恢复、自动循环推进
   - 内含路由、补偿、阶段推进、Agent 分发等逻辑
2. `Orchestrator` 路径
   - 定义更严格的状态机
   - 明确 `contract_generation -> plan_gate -> writing -> draft_gate -> review` 等门禁链路

这两套逻辑目前没有完全对齐，导致：

1. 真实运行入口走 `Host`
2. 关键门禁约束写在 `Orchestrator`
3. 前置条件判断在多个地方重复实现
4. 某些状态会被提前推进到 `writing`
5. `Writer` 被派发时，当前章节未必真的满足 contract 前置条件

典型现象是：

- 路由已判定 `foundationComplete`
- 当前 phase 已进入 `writing`
- `Writer` 按 prompt 先读取 `chapter_contract` / `knowledge_contract`
- 工具层报错：契约不存在

这不是单点工具错误，而是编排边界不清导致的系统性问题。

---

## 2. 优化目标

本次优化目标不是简单修一个 bug，而是统一项目的编排职责边界。

目标如下：

1. 建立唯一编排真相源
2. 让前置条件、门禁、回退逻辑只在一处定义
3. 让 `Host` 成为运行时壳层，而不是第二套隐式状态机
4. 保证所有自动推进都严格经过章节级 contract / gate 校验
5. 提升可恢复性、可测试性、可审计性

---

## 3. 设计原则

### 3.1 单一真相源

所有“是否可以进入下一阶段”的判断，只能由 `Orchestrator` 给出。

### 3.2 决策与执行分离

- `Orchestrator` 负责“决定做什么”
- `Host` 负责“把决定执行掉”

补充一条当前已经落地的收口规则：

- `contract_generation` 节点对“chapter 实体存在”负最终兜底责任
- 若已有 `arc_chapter_plan` 但 `chapters` 实体尚未创建，`generate_chapter_contract / generate_knowledge_contract` 必须先补建 chapter，再继续生成契约
- 这条规则优先于 Host 的回合后同步，因为 contract 生成可能发生在同一个 subagent 回合内部

### 3.3 章节粒度优先

小说推进的关键前置条件必须以“当前章节”为粒度，而不是项目级“存在任意一条记录即可”。

### 3.4 显式状态优先于隐式推断

任何可写、可评审、可提交的判断，都应该来自显式状态和显式校验，而不是散落的启发式 if/route。

### 3.5 恢复必须可重算

恢复时不能简单“继续 loop”，而要重新核对当前状态与数据库事实是否一致。

---

## 4. 推荐总体架构

推荐采用“双层编排”：

1. `Orchestrator`：唯一状态机与决策中枢
2. `Host`：唯一运行入口与执行壳层

### 4.1 角色定位

#### Orchestrator

负责：

1. 定义状态机
2. 校验前置条件
3. 决定状态迁移
4. 决定当前 Agent、mode、任务目标
5. 决定失败后回退到哪里
6. 决定何时暂停等待人工介入

不负责：

1. IPC 事件转发
2. UI 轮询
3. Thinking 日志流式输出
4. 直接承担自动循环

#### Host

负责：

1. 启动、暂停、恢复、取消
2. 触发循环执行
3. 调用 Agent / Tool
4. 采集日志与事件
5. 向前端广播状态变化
6. 处理超时、中断、幂等重试

不负责：

1. 自己决定 phase 是否进入 `writing`
2. 自己判断 contract/gate 是否满足
3. 自己决定从 `architect` 切到 `writer`
4. 自己补写业务状态迁移

---

## 5. 目标流程模型

建议将自动写作主链统一为以下状态流：

1. `architecting`
2. `contract_generation`
3. `plan_gate`
4. `writing`
5. `draft_gate`
6. `chapter_commit`
7. `arc_review_pending`
8. `arc_review`
9. `next_arc_plan`
10. `volume_review`
11. `complete`

### 5.1 各阶段职责

#### architecting

补齐基础创作资产：

1. 故事指南针
2. 人物
3. 人物弧
4. 世界规则
5. 卷弧骨架
6. 首弧展开
7. 伏笔规划

#### contract_generation

围绕“当前待写章节”生成：

1. `chapter_contract`
2. `knowledge_contract`

#### plan_gate

1. `Writer` 先产出 `chapter_plan`
2. 校验 `chapter_plan` 是否满足两个 contract
3. 通过后才能进入正文写作

#### writing

1. `Writer` 写章节正文草稿
2. 仅写入 draft，不直接视为正式章节

#### draft_gate

检查草稿是否满足：

1. `chapter_contract`
2. `knowledge_contract`
3. 一致性
4. 节奏
5. 视角知识边界

#### chapter_commit

通过门禁后：

1. commit 草稿
2. 写章节摘要
3. 更新角色状态
4. 更新关系、世界状态、伏笔台账
5. 写入下一章衔接提示

#### arc_review / volume_review

在弧末、卷末交给 `Editor` 做更高层评审。

---

## 6. 状态模型建议

当前项目存在 `phase`、`flow`、`orchestrator_state` 三套概念，建议明确分工。

### 6.1 phase

表示项目大阶段，仅承担粗粒度生命周期语义：

1. `init`
2. `premise`
3. `outline`
4. `writing`
5. `complete`

`phase` 不是章节门禁状态，不应承担 contract / gate 的细节判断。

### 6.2 orchestrator_state

表示精确编排节点，是门禁与迁移的核心依据：

1. `idle`
2. `initializing`
3. `architecting`
4. `contract_generation`
5. `plan_gate`
6. `writing`
7. `draft_gate`
8. `arc_review_pending`
9. `arc_review`
10. `arc_passed`
11. `polishing`
12. `chapter_rewrite`
13. `next_arc_plan`
14. `volume_review`
15. `completed`

### 6.3 flow

仅作为表现层或辅助流程标签，例如：

1. `writing`
2. `reviewing`
3. `rewriting`
4. `polishing`
5. `steering`

`flow` 不应该成为核心放行条件。

---

## 7. 前置条件统一模型

建议把“当前章节可写”定义为一组显式布尔条件，由 `Orchestrator` 统一计算。

### 7.1 核心条件

项目级：

1. `architecture_ready`
2. `current_arc_selected`
3. `current_chapter_selected`

章节级：

1. `chapter_contract_ready`
2. `knowledge_contract_ready`
3. `chapter_plan_ready`
4. `plan_gate_passed`
5. `draft_present`
6. `draft_gate_passed`
7. `chapter_committed`

### 7.2 放行规则

建议固定如下：

1. `architecture_ready = false`
   - 不得进入 `contract_generation`
   - 必须停留在 `architecting`

2. `chapter_contract_ready = false` 或 `knowledge_contract_ready = false`
   - 不得进入 `plan_gate`
   - 必须回到 `contract_generation`

3. `plan_gate_passed = false`
   - 不得进入 `writing`

4. `draft_present = false`
   - 不得进入 `draft_gate`

5. `draft_gate_passed = false`
   - 不得进入 `chapter_commit`

6. `chapter_committed = true`
   - 才允许更新长期记忆与状态快照

### 7.3 重要约束

前置条件必须基于当前 `chapter_id` 判断，不能再使用：

- 项目里是否“存在任意一条 contract”
- 项目里是否“曾经通过过某种 gate”

---

## 8. Host 的目标工作模式

建议将 `Host` 约束为纯执行器，围绕“单回合推进”工作。

### 8.1 单回合执行协议

每一回合固定做 5 步：

1. 读取当前系统状态
2. 请求 `Orchestrator` 计算当前动作
3. 执行动作
4. 收集执行结果
5. 将结果回传给 `Orchestrator` 落状态

即：

`UI -> Host -> Orchestrator.decide() -> Host.execute(action) -> Orchestrator.reduce(result)`

### 8.2 Host 可执行的动作类型

建议收敛为 4 类：

1. `dispatch_agent`
   - 调用 `architect` / `writer` / `editor`

2. `transition`
   - 不调用 agent，只做纯状态推进

3. `wait`
   - 当前缺条件，不继续推进

4. `recover`
   - 中断恢复时重建局部状态

### 8.3 Host 不再承担的职责

以下职责应从 `Host` 迁出：

1. 自动把 `phase` 改成 `writing`
2. 根据“基础看起来齐了”直接派发 `writer`
3. 自己决定 contract 是否足够
4. 自己决定“这一章可以开始写”
5. 以补偿逻辑替代正式门禁

---

## 9. Orchestrator 的目标工作模式

`Orchestrator` 需要成为唯一编排真相源。

### 9.1 决策职责

每个状态下明确：

1. 当前期望的输入是什么
2. 允许的下一动作有哪些
3. 哪个条件满足后迁移
4. 哪个条件失败后回退
5. 当前活跃 Agent 应该是谁

### 9.2 推荐接口语义

不限定实现形式，但建议具备两个核心能力：

1. `decide(state, facts) -> action`
   - 根据当前状态和数据库事实给出下一步动作

2. `reduce(state, actionResult) -> nextState`
   - 根据动作执行结果推进或回退状态

这样可以把“编排判断”与“执行过程”完全隔离。

---

## 10. 自动补偿策略

自动补偿可以保留，但必须降级为受控动作，而不是隐式旁路。

### 10.1 当前问题

当前的自动补偿逻辑容易掩盖系统真实状态，例如：

1. 后台自动补 contract
2. 只补部分章节
3. 只补某一类 contract
4. 补偿失败也未阻止后续写作

### 10.2 目标策略

补偿动作应改为：

1. `Orchestrator` 发现当前章缺 contract
2. 输出 `dispatch_architect(mode=contract_generation)`
3. `Host` 执行
4. 执行完成后重新校验
5. 若仍缺失，则停留在 `contract_generation`

### 10.3 原则

补偿是显式步骤，不是静默修复。

这样才能：

1. 审计问题
2. 定位失败原因
3. 在 UI 上清楚展示当前阻塞点

---

## 11. 恢复与断点续跑方案

恢复机制建议也以 `Orchestrator` 为中心。

### 11.1 恢复时必须重算的事实

至少重算：

1. 当前 `orchestrator_state`
2. 当前 `active_agent`
3. 当前 `chapter_id`
4. 当前 `chapter_contract` 是否存在
5. 当前 `knowledge_contract` 是否存在
6. 当前 `chapter_plan` 是否存在
7. 当前最新 draft 是否存在
8. 当前最新 gate verdict 是什么

### 11.2 恢复后的可能动作

恢复后只能进入以下之一：

1. 回到 `contract_generation`
2. 回到 `plan_gate`
3. 继续 `writing`
4. 进入 `draft_gate`
5. 暂停等待人工

不得仅因“上次已经在 writing”就直接继续写。

---

## 12. 迁移路线图

建议按 4 个阶段推进，避免一次性大改。

### 阶段一：职责收口

目标：

1. 明确前端只通过 `Host` 启动与恢复
2. 明确 `Orchestrator` 是唯一状态决策源
3. 明确 `flow-router` 不再拥有放行权

交付：

1. 编排职责图
2. 入口链路梳理
3. 现有状态字段语义表

### 阶段二：统一前置条件

目标：

1. 建立单一章节级 readiness 模型
2. 清理项目级“存在任意一条记录即放行”的判断
3. 将 contract / plan / gate 前置条件收归 `Orchestrator`

交付：

1. readiness 字段定义
2. 放行规则表
3. 回退规则表

### 阶段三：统一执行协议

目标：

1. `Host` 按固定回合协议执行
2. `Orchestrator` 输出显式 action
3. 所有迁移通过 actionResult 落状态

交付：

1. 回合生命周期图
2. action 类型清单
3. recover 语义清单

### 阶段四：补测试与灰度验证

目标：

1. 用真实 UI 路径验证 `Host + Orchestrator`
2. 覆盖缺 contract、半成品恢复、后续章节缺失等问题
3. 验证状态机与运行时行为一致

交付：

1. 集成测试矩阵
2. 异常恢复测试矩阵
3. 验收 checklist

---

## 13. 测试建议

本次优化后，重点不是补更多 happy path，而是补“真实失配场景”。

### 13.1 必测场景

1. 当前章缺 `chapter_contract`
   - 不得派发 `writer`
   - 必须回到 `contract_generation`

2. 当前章缺 `knowledge_contract`
   - 不得派发 `writer`
   - 必须回到 `contract_generation`

3. 只有第一章有 contract，第四章没有
   - 推进到第四章时必须阻塞

4. `chapter_plan` 未通过 `plan_gate`
   - 不得进入 `writing`

5. 恢复时发现上次 contract 只生成一半
   - 不得继续写

6. draft 已生成但未过 gate
   - 不得 commit

7. IPC 真实启动路径
   - 结论必须与 `Orchestrator` 直接测试一致

### 13.2 验收标准

满足以下条件才算优化完成：

1. 任何自动推进都不会在缺少当前章 contract 时派发 `Writer`
2. `Host` 不再私自改写关键 phase / gate 状态
3. 恢复后不会因脏状态重复派发错误 Agent
4. 所有章节级前置条件都以当前 `chapter_id` 为粒度
5. 真实前端路径与状态机测试路径结论一致

---

## 14. 预期收益

完成本轮优化后，系统将获得以下收益：

1. 自动编排更稳定
2. 长篇小说跨章推进更可靠
3. 弧/卷级回退更可控
4. 问题更容易定位
5. 恢复机制更可信
6. 测试更接近真实运行链路

最重要的是，系统会从“两个半重叠的编排器”收敛成：

- 一个负责决策
- 一个负责执行

这对后续扩展：

1. 多卷滚动规划
2. 更严格的知识边界控制
3. 更复杂的 review / rewrite 流程
4. 更高等级的自动化写作

都会更稳。

---

## 15. 最终结论

本项目后续的推荐方向不是在 `Host` 和 `Orchestrator` 中二选一，而是：

1. 保留 `Host`
2. 强化 `Orchestrator`
3. 重新定义两者边界

建议的最终形态是：

- `Orchestrator` 作为唯一编排中枢
- `Host` 作为唯一运行时壳层

一句话总结：

`Orchestrator` 做大脑，`Host` 做身体。  
大脑决定能不能推进、推进到哪；身体负责把动作执行出来并把结果带回去。
