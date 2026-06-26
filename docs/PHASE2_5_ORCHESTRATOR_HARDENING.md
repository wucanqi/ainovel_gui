# 长篇小说记忆型 AI 写作桌面系统 · 编排器加固落地方案

> 版本：v2.5（编排器加固）
> 日期：2026-06-25
> 状态：✅ 全部三个阶段已实现
> 
> 实现内容：
> - ✅ 阶段一（安全基座）：agent_sessions 生命周期管理、AbortController 暂停、崩溃恢复入口
> - ✅ 阶段二（Checkpoint 体系）：四种执行模式停点、章完成自动门禁闭环
> - ✅ 阶段三（用户干预完整性）：暂停边界快照、差异检测、用户干预日志
> 
> 注意：系统已迁移至三期 Host/Coordinator 架构，部分加固逻辑在 host.ts 中重新实现。

---

## 目录

1. [动机与目标](#1-动机与目标)
2. [现状差距分析](#2-现状差距分析)
3. [阶段一：安全基座](#3-阶段一安全基座)
4. [阶段二：Checkpoint 体系](#4-阶段二checkpoint-体系)
5. [阶段三：用户干预完整性](#5-阶段三用户干预完整性)
6. [数据模型变更](#6-数据模型变更)
7. [IPC 接口变更](#7-ipc-接口变更)
8. [UI 交互设计](#8-ui-交互设计)
9. [测试用例](#9-测试用例)
10. [风险与对策](#10-风险与对策)

---

## 1. 动机与目标

### 1.1 背景

二期编排器已实现基本状态机和三 Agent（Architect / Writer / Editor）调度。但在实际使用中暴露出以下问题：

| 问题 | 影响 |
|------|------|
| 应用崩溃后编排无法恢复，只能重置 | 长篇创作中数据丢失风险高 |
| 自动推进没有中间检查点，全量跑到底 | 用户无法审核中间产物 |
| 暂停不能中断正在执行的 Agent | 暂停形同虚设 |
| 用户手动修改后恢复，系统不感知 | 可能导致一致性漂移 |
| 缺少崩溃恢复入口和会话状态标记 | 编排中断后不知道是否安全继续 |

### 1.2 目标

| 目标 | 衡量标准 |
|------|----------|
| 崩溃/重启后编排可恢复 | 重启后界面提示「是否继续」，点击即从断点继续 |
| 暂停能真正中断 Agent | 暂停后 3 秒内 Agent 停止执行 |
| 四种执行模式有明确定义的停止点 | 每种模式在 checkpoint 处自动暂停 |
| 用户手动修改后恢复能感知变化 | resume 时重新评估边界条件并提示差异 |

### 1.3 不改动范围

- 一期项目/章节/设定库/RAG 记忆系统
- Agent 工具定义和 System Prompt
- 状态机核心转移规则（只加固，不重构）

---

## 2. 现状差距分析

### 2.1 状态机对照

| 文档（PHASE2） | 代码实际 | 差距 |
|----------------|----------|------|
| IDLE → INITIALIZING → ARCHITECTING | 一致 | 无 |
| ARCHITECTING → WRITING | ARCHITECTING → contract_generation → plan_gate → WRITING | 多了四期门禁状态 |
| WRITING → ARC_REVIEW | WRITING → draft_gate → ARC_REVIEW | 多了 draft_gate |
| ARC_REVIEW → ARC_PASSED / POLISHING / CHAPTER_REWRITE | 一致 | 无 |
| ARC_PASSED → (下一弧 或 NEXT_ARC_PLAN 或 VOLUME_REVIEW) | 一致 | 无 |
| 无 | chapter_review | 代码有但未被 tick 自动触发 |

**结论：** 核心状态机可行，门禁状态（contract_generation、plan_gate、draft_gate）是合理的增强。不修改状态定义本身，但需补全 tick 对门禁状态的自动处理。

### 2.2 执行模式差距

| 模式 | 当前行为 | 文档预期 | 需要修改 |
|------|----------|----------|----------|
| semi_auto | 每步手动推 | 每步手动推 | 否 |
| full_auto | 一直跑到 completed | 每弧完成停一次 | **是** |
| arc_auto | 弧结束停 | 每章完成停一次 | **是** |
| node_review | 每个门禁节点停 | 每个门禁节点停 | 否 |

### 2.3 关键能力缺失

| 能力 | 现状 |
|------|------|
| Agent 会话完成标记 | agent_sessions 无 status 字段 |
| 崩溃后会话清理 | 无扫描逻辑 |
| AbortController | runCurrentAgent 支持 signal 参数，但 Orchestrator 层未传入 |
| 暂停时中断 Agent | pause() 只改 is_paused 标志 |
| resume 重新评估 | resume() 只改 is_paused 标志 |

---

## 3. 阶段一：安全基座

### 3.1 Agent 会话生命周期

#### 数据模型变更

`agent_sessions` 表新增字段：

```sql
ALTER TABLE agent_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'running';
ALTER TABLE agent_sessions ADD COLUMN ended_at INTEGER;
```

状态流转：

```
                    ┌─────────┐
        ┌──────────▶│ running │──────────┐
        │           └────┬────┘          │
        │                │               │
    startAgent()    LLM正常返回     abort() / 异常
        │                │               │
        │                ▼               ▼
        │           ┌──────────┐    ┌─────────┐
        └───────────│completed │    │ aborted │
                    └──────────┘    └─────────┘
```

**cleanup 逻辑：** `initDb()` 完成后扫描所有 `status='running'` 的 agent_sessions，标记 `status='aborted'` 并记录 orchestration_log。

#### 代码改动

**agent-engine.ts:**
- `runAgent()` 开始时：更新 session status='running'
- `runAgent()` 正常结束时：更新 status='completed'，ended_at
- catch 块：更新 status='aborted'，ended_at
- `runAgentStreaming()` 同理

**orchestrator.ts:**
- 启动时 `ensureSystemState()` 新增：若 state 是 agent 执行状态 且 active_agent 非空，检查对应 session 状态判断是否需要恢复

### 3.2 崩溃恢复

#### getOrchestrator 增强

```
getOrchestrator(projectId):
  1. 已有实例 → 直接返回
  2. 无实例 → 新建 Orchestrator
  3. ensureSystemState()
  4. 扫描 running 的 agent_sessions → 标记 aborted
  5. 若 system_state.orchestrator_state 是 agent 执行状态且 active_agent 存在
     → 回退到上一稳定状态（如 writing → contract_generation，architecting → architecting 不动）
  6. 记录 orchestration_log: 'system_recovery'
```

#### 回退策略

| 当前状态 | 回退到 | 原因 |
|----------|--------|------|
| contract_generation | contract_generation | Architect 可能写到一半，需重新生成契约 |
| plan_gate | contract_generation | Writer 计划可能未完成 |
| writing | contract_generation | 草稿可能未写完，需重新生成 |
| draft_gate | writing | 门禁可能在执行中 |
| polishing | arc_review | Editor 评审需重新看 |
| chapter_rewrite | arc_review | 同上 |
| arc_review | arc_review_pending | 重新评审 |
| architecting | architecting | 保持，用户会看到架构可能不完整 |

#### UI 恢复入口

`OrchestrationPage.load()` 检测：

```
if (state.orchestrator_state !== 'idle' && state.orchestrator_state !== 'completed') {
  显示恢复横幅：
  "检测到未完成的编排。上次状态：{STATE_LABEL}，活跃 Agent：{AGENT_LABEL}"
  [继续编排] [重置编排]
}
```

**继续编排：** `tick()` 一次，从当前状态推进。
**重置编排：** 新增 `reset()` 方法：system_state 回到 idle，清理 active_agent，记录 log。

### 3.3 AbortController 暂停机制

#### Orchestrator 实例变更

```
class Orchestrator {
  private currentAbortController: AbortController | null = null

  async runCurrentAgent(...):
    this.currentAbortController = new AbortController()
    try {
      return await runAgent({ ..., signal: this.currentAbortController.signal })
    } finally {
      this.currentAbortController = null
    }
}
```

#### pause() 增强

```
async pause():
  // 1. 中断正在执行的 Agent
  if (this.currentAbortController) {
    this.currentAbortController.abort()
    // 对应的 agent_session 状态由 agent-engine 的 catch 块更新为 aborted
  }
  // 2. 持久化暂停状态
  setPaused(this.projectId, true)
  // 3. 记录暂停原因
  logTransition(..., 'pause', '用户手动暂停')
  // 4. UI 事件推送
  sendEvent('agentStateChange', { state: this.getState(), reason: 'user_paused' })
```

#### 暂停后 Agent 行为

Agent 在执行中收到 abort：
1. fetch 调用被中断，抛出 AbortError
2. agent-engine catch 块：标记 session status='aborted'，不抛异常给编排器
3. 已执行的 tool calls 保留（不回滚），记录到 agent_decisions
4. UI 显示 "Agent 已中断，已完成 N 次工具调用"

---

## 4. 阶段二：Checkpoint 体系

### 4.1 Checkpoint 模型

#### 类型定义

```typescript
type CheckpointType =
  | 'chapter_done'       // 一章通过门禁并 commit
  | 'arc_done'           // 一个弧的所有章通过
  | 'volume_done'        // 一个卷的所有弧通过
  | 'gate_failed'        // 门禁未通过
  | 'agent_error'        // Agent 执行异常
  | 'agent_aborted'      // Agent 被用户中断
  | 'user_paused'        // 用户手动暂停
  | 'boundary_changed'   // 边界条件变化（用户修改导致）
```

#### 持久化格式（orchestration_log）

```json
{
  "event_type": "checkpoint",
  "details": {
    "checkpoint_type": "chapter_done",
    "current_arc_id": "...",
    "current_chapter_id": "...",
    "completed_chapters": 3,
    "total_chapters_in_arc": 8,
    "last_review_verdict": "pass",
    "pause_reason": "弧完成，等待用户审核"
  }
}
```

### 4.2 模式行为修正

#### 新的停止规则

```typescript
function shouldStopForMode(
  mode: ExecutionMode,
  checkpoint: CheckpointType
): boolean {
  switch (mode) {
    case 'full_auto':
      // 只在弧完成、卷完成、异常时停
      return checkpoint === 'arc_done'
          || checkpoint === 'volume_done'
          || checkpoint === 'gate_failed'
          || checkpoint === 'agent_error'

    case 'arc_auto':
      // 每章完成后停一次，异常时也停
      return checkpoint === 'chapter_done'
          || checkpoint === 'arc_done'
          || checkpoint === 'gate_failed'
          || checkpoint === 'agent_error'

    case 'node_review':
      // 每个门禁节点都停（不变）
      return checkpoint !== 'user_paused'

    case 'semi_auto':
      // 每步手动，不自动推进（不变）
      return true

    default:
      return true
  }
}
```

#### 自动推进循环改造

```
step():
  1. 获取当前 state 和 conditions
  2. 判断当前状态是 agent 执行态还是 tick 态
  3. 执行 tick() 或 runAgent()
  4. 检查是否产生了 checkpoint：
     a. 章 commit 成功 → 'chapter_done'
     b. 弧所有章完成 → 'arc_done'
     c. 卷所有弧完成 → 'volume_done'
     d. 门禁失败 → 'gate_failed'
     e. Agent 异常 → 'agent_error'
     f. Agent 被中断 → 'agent_aborted'
  5. 若有 checkpoint，调用 shouldStopForMode(mode, checkpoint)
  6. 若应停止 → pause() + 推消息到 UI
  7. 若不应停止 → 继续循环
```

### 4.3 章完成自动门禁

当前 `tick()` 在 `writing` 状态只是被动等待草稿。改造为自动检测 + 自动转门禁：

```
tick() writing 状态:
  1. 获取 current_chapter_id
  2. 检测 hasPendingDraft(chapterId)
  3. 若有草稿 → transition('draft_gate') → 自动调用 runDraftGate()
  4. 若无草稿 → 保持 writing（等待 Writer Agent 执行）
```

`draft_gate` 通过后自动：
1. commit 草稿
2. 标记 arc_chapter_plans 为 written
3. 查找下一章 plan
4. 若还有下一章 → transition('contract_generation')
5. 若无下一章 → 产生 checkpoint('arc_done')

---

## 5. 阶段三：用户干预完整性

### 5.1 恢复时增量评估

#### boundary 快照机制

`system_state` 新增字段：

```sql
ALTER TABLE system_state ADD COLUMN paused_boundary TEXT DEFAULT '{}';
```

暂停时将当前 `BoundaryConditions` 序列化存入 `paused_boundary`。

#### resume() 增强

```
async resume():
  1. 重新调用 evaluateBoundaryConditions()
  2. 对比暂停前的 paused_boundary
  3. 差异检测：
     a. chapter_count 变化 → 用户增删了章节
     b. arc_id 变化 → 弧结构变了
     c. architectureReady 变化 → 用户改了架构
  4. 若有差异 → 推 UI 事件: 'boundary_changed'
     - 列出变化的字段
     - 建议：若 chapter 被删，回退到 contract_generation
  5. setPaused(false)
  6. 清除 paused_boundary
```

#### 差异处理策略

| 差异类型 | 自动处理 | UI 提示 |
|----------|----------|---------|
| 当前章被删除 | 回退到 contract_generation | "检测到当前章节已被删除，已回退到契约生成阶段" |
| 弧计划章节数变化 | 更新 arc_done 条件 | "弧计划已变更，已更新推进目标" |
| 用户新增章节 | 无影响 | 无 |
| 用户修改设定 | 无影响（下次 Agent 会读到新设定） | 无 |
| 架构变为不完整 | 回退到 architecting | "检测到架构不完整，请通过 Architect 完善" |

### 5.2 用户干预日志

`orchestration_log` 新增 event_type：`user_action`。

记录内容：

```json
{
  "event_type": "user_action",
  "details": {
    "action": "pause" | "resume" | "manual_tick" | "manual_agent" | "mode_change" | "reset",
    "from_state": "writing",
    "to_state": "writing",
    "reason": "用户检查章节内容",
    "affected_chapter_id": "..."
  }
}
```

### 5.3 重置编排

新增 `reset()` 方法：

```
async reset():
  1. 中断当前 Agent（如有）
  2. 标记所有 running agent_sessions 为 aborted
  3. system_state.orchestrator_state = 'idle'
  4. system_state.active_agent = null
  5. system_state.is_paused = 0
  6. 记录 user_action log: 'reset'
  7. 不删除任何数据产物（story_compass/character_arcs/chapter_plans 等保留）
```

---

## 6. 数据模型变更

### 6.1 schema 变更

```sql
-- agent_sessions 加状态追踪
ALTER TABLE agent_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'running';
ALTER TABLE agent_sessions ADD COLUMN ended_at INTEGER;

-- system_state 加暂停边界快照
ALTER TABLE system_state ADD COLUMN paused_boundary TEXT DEFAULT '{}';
```

### 6.2 新增索引

```sql
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(project_id, status);
```

---

## 7. IPC 接口变更

### 7.1 新增接口

```typescript
export interface OrchestratorApi {
  // 新增
  reset(projectId: string): Promise<{ state: OrchestratorState; message: string }>
  getRecoveryStatus(projectId: string): Promise<{
    needsRecovery: boolean
    lastState: OrchestratorState
    lastActiveAgent: AgentType | null
    abortedSessions: number
    message: string
  }>
}
```

### 7.2 事件变更

```typescript
// IpcEvent 新增
| 'agentAborted'       // Agent 被用户中断
| 'boundaryChanged'    // 边界条件变化
| 'checkpointReached'  // 到达检查点
```

---

## 8. UI 交互设计

### 8.1 恢复横幅

```
┌─────────────────────────────────────────────────────────┐
│ ⚠ 检测到未完成的编排                                     │
│ 上次状态：contract_generation · 活跃 Agent：Architect     │
│ 上次活动时间：14:32:15                                  │
│ [继续编排]  [重置编排]                                   │
└─────────────────────────────────────────────────────────┘
```

### 8.2 Checkpoint 面板提示

到达 checkpoint 时在 Agent 输出面板显示：

```
┌────────────────────────────────────────┐
│ [检查点] 弧完成                         │
│ 已完成: 3/8 章 · 最后评审: pass         │
│ 编排器已暂停，请审核后继续               │
└────────────────────────────────────────┘
```

### 8.3 边界条件变化提示

```
┌────────────────────────────────────────┐
│ ⚠ 检测到项目结构变化                     │
│ · 当前章节已被删除                       │
│ · 已回退到 contract_generation          │
│ [了解]                                  │
└────────────────────────────────────────┘
```

### 8.4 执行模式说明

在模式选择器旁加 tooltip 说明停点：

| 模式 | tooltip |
|------|---------|
| 自动到全文 | 每完成一个弧暂停一次 |
| 自动到当前弧 | 每完成一章暂停一次 |
| 半自动 | 每步手动推进 |
| 逐节点审核 | 每个门禁/评审节点暂停 |

---

## 9. 测试用例

### 9.1 崩溃恢复

| 用例 | 步骤 | 预期 |
|------|------|------|
| 写作中崩溃 | Writer 执行中关闭应用 → 重启 → 打开编排页 | 显示恢复横幅，状态=writing |
| 继续后正常 | 点击继续 → tick() | 从 writing 继续推进 |
| 重置后重来 | 点击重置 → tick() | 回到 architecting |
| 多 session 残留 | 崩溃 3 次 → 重启 | 所有 running session 标记 aborted |

### 9.2 暂停/恢复

| 用例 | 步骤 | 预期 |
|------|------|------|
| Agent 执行中暂停 | Architect 调用 LLM 中 → 点暂停 | 3 秒内 Agent 停止，session 标记 aborted |
| 暂停后恢复 | 暂停 → 恢复 | 重新评估边界条件，状态不变 |
| 暂停期间删章节 | 暂停 → 删除当前章 → 恢复 | 提示边界变化，回退到 contract_generation |

### 9.3 Checkpoint

| 用例 | 步骤 | 预期 |
|------|------|------|
| full_auto 弧完成停 | full_auto → 一个弧所有章写完 | 暂停，显示 checkpoint 横幅 |
| arc_auto 章完成停 | arc_auto → 一章 commit | 暂停，显示 checkpoint 横幅 |
| full_auto 异常停 | full_auto → Agent 报错 | 暂停，显示错误信息 |

---

## 10. 风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| abort 后 tool call 已写入但用户不知道 | 中 | agent_decisions 表已记录每次 tool call，UI 面板显示"已执行 N 次工具调用" |
| 门禁失败导致无限重试 | 中 | 连续 3 次 gate_failed → 自动暂停，提示用户介入 |
| paused_boundary 存 JSON 字段过大 | 低 | BoundaryConditions 对象很小（<500 字符），无风险 |
| reset 误删用户数据 | 高 | reset 只改 system_state，不动任何产物数据 |

---

## 附录 A：与四期的关系

四期表（chapter_contracts、knowledge_contracts、chapter_drafts、draft_gate_*、character_fact_locks 等）在二期编排器中已实际使用。本方案不改四期表结构，但 checkpoint 体系会感知四期的门禁状态。

## 附录 B：关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 崩溃回退策略 | 回到上一稳定状态 | 保守策略，避免执行到一半的 Agent 产物被误用 |
| full_auto 停点 | 每弧停一次 | 一个弧通常 5-10 章，自动写完后给用户审核窗口 |
| reset 保留产物 | 只清状态不动数据 | 用户可能只想重跑流程，不想重建设定 |
| abort 不回滚 | 幂等保留 | tool call 写入的数据是有效的，重复执行会幂等覆盖 |
