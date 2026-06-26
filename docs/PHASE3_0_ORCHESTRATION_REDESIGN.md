# 长篇小说记忆型 AI 写作桌面系统 · 编排架构重构设计

> 版本：v3.0（编排架构重构）
> 日期：2026-06-25
> 状态：✅ 已实现
> 参考项目：[ainovel-cli](https://github.com/voocel/ainovel-cli)
> 
> 实现文件：
> - `electron/services/host.ts` — Host 薄外壳（Start/Resume/Abort/Steer/Reset）
> - `electron/services/flow-router.ts` — LoadState + Route 纯函数
> - `electron/services/flow-dispatcher.ts` — 事件驱动派发器
> - `electron/services/reminder.ts` — Reminder 生成器
> - `electron/services/coordinator.prompt.ts` — Coordinator System Prompt
> - `electron/services/compaction.ts` — 上下文压缩
> 
> 注意：旧的 orchestrator.ts（16 状态 tick()）保留向后兼容。新的 Host + Coordinator 架构是推荐使用方式。IPC 接口 `orchestrator:start/resume/pause/reset/steer` 前端调用 host.store.ts。

---

## 目录

1. [动机：为什么重构](#1-动机为什么重构)
2. [新旧架构对比](#2-新旧架构对比)
3. [核心设计：Coordinator 长循环](#3-核心设计coordinator-长循环)
4. [Flow Router：事件驱动的纯函数调度](#4-flow-router事件驱动的纯函数调度)
5. [Reminder：每轮重算的指令层](#5-reminder每轮重算的指令层)
6. [SubAgent 协议：统一的子代理调用](#6-subagent-协议统一的子代理调用)
7. [Host：薄外壳](#7-host薄外壳)
8. [与现有体系的融合](#8-与现有体系的融合)
9. [数据模型变更](#9-数据模型变更)
10. [IPC 接口变更](#10-ipc-接口变更)
11. [实施计划](#11-实施计划)
12. [风险与对策](#12-风险与对策)

---

## 1. 动机：为什么重构

### 1.1 当前架构的固有问题

| 问题 | 根因 | 影响 |
|------|------|------|
| 16 状态 tick() 机难以扩展 | Host 代码做调度，状态转移嵌入分支逻辑 | 每加一个状态要改 4 个地方（tick/case/store/page） |
| System Prompt 是大杂烩 | 每个 Agent 的 prompt 列出全部职责 | LLM 在 contract_generation 状态也可能去创建角色 |
| 前端轮询驱动 | 1.2s 定时器轮询，不是事件驱动 | 最多浪费 1.2 秒，状态存在竞态 |
| 没有全局视野 | 状态机切 Agent 后上下文不共享 | Architect 不知道 Writer 写了什么，Writer 不知道 Editor 审了什么 |
| 不可测试 | tick() 读 5+ 次 DB，switch 16 case | 单测只能测 mock，不能测真实路由逻辑 |

### 1.2 ainovel-cli 的核心洞察

> **把复杂度从代码搬到模型里。** 代码越少，能坏的地方越少。决策权交给更擅长做决策的角色。

```
ainovel-cli 的核心公式：
  Host（启动/恢复/观察）+ Coordinator（LLM 自主决策）+ Dispatcher（事件驱动派发）
  + Reminder（每轮事实重算）+ SubAgent（独立上下文执行）
```

这套架构在生产环境跑了 500+ 章长篇，证明可行。

### 1.3 我们保留什么

| 体系 | 保留 | 原因 |
|------|------|------|
| RAG 记忆（memory.service.ts） | 完整保留 | 核心差异化能力，向量检索 + 关键词检索 |
| 文档导入（import.service.ts） | 完整保留 | 反推导入是 user journey 的起点 |
| Story Bible（story-bible.service.ts） | 完整保留 | 结构化设定管理 |
| 契约/门禁/草稿（Phase 4） | 保留但融入 Writer 工具流 | Writer 写草稿 → check_consistency → commit（门禁内置） |
| 编辑器（TipTap） | 完整保留 | 写作界面不改 |
| API 配置 | 完整保留 | 多 Provider + 模型路由 |

### 1.4 我们重构什么

| 组件 | 当前 → 目标 |
|------|------------|
| **Orchestrator** | 16 状态 tick() 机 → Host（薄外壳：Start/Resume/Abort/Steer/Reset） |
| **调度逻辑** | Host 代码分支 → Coordinator LLM 自主决策 |
| **下一步派发** | 前端 setInterval 轮询 → Flow Router 事件驱动 |
| **Agent 指令** | System Prompt 大杂烩 → Reminder（每轮从事实重算，不进历史） |
| **SubAgent 调用** | Host 分别调 runAgent(tools) → Coordinator 调 `subagent(name, task)` |
| **前端状态** | 16 状态轮询展示 → Phase + Flow + 事件流 |

---

## 2. 新旧架构对比

```
【重构前】
┌─────────────────────────────────────────────┐
│ Host (Orchestrator)                          │
│  tick() → 16状态 → setActiveAgent → pause   │
│  runCurrentAgent() → agent-engine → LLM      │
│  前端 setInterval(step, 1200) 轮询           │
└─────────────────────────────────────────────┘
     │ 被动执行
┌────▼────────────────────────────────────────┐
│ Architect / Writer / Editor                  │
│  固定 System Prompt（大杂烩）                 │
│  各自 10+ tools                              │
└─────────────────────────────────────────────┘


【重构后】
┌─────────────────────────────────────────────┐
│ Host (薄外壳)                                │
│  Start / Resume / Abort / Steer / Reset      │
│  事件观察 / 预算管理 / 断点恢复               │
└────────────────────┬────────────────────────┘
                     │ 一次 Prompt 启动
┌────────────────────▼────────────────────────┐
│ Coordinator (LLM 长循环)                     │
│  读 novel_context → Reminder 每轮注入          │
│  自主决定：调 Architect / Writer / Editor     │
│  StopGuard：全书完成才允许 end_turn           │
└────┬──────────┬──────────┬──────────────────┘
     │subagent  │subagent  │subagent
┌────▼───┐ ┌───▼────┐ ┌───▼─────┐
│Architect│ │ Writer │ │ Editor  │
│独立 ctx │ │独立 ctx│ │独立 ctx │
│工具集   │ │工具集  │ │工具集   │
└────────┘ └────────┘ └─────────┘
     │          │          │
     └──────────┼──────────┘
                │ 工具调用 → Store + Checkpoint
┌───────────────▼─────────────────────────────┐
│ Store（现有 SQLite 全套）                     │
│ chapters / characters / worldbuilding /      │
│ memory_chunks / story_compass / ...          │
└─────────────────────────────────────────────┘

事件驱动派发：
  SubAgent 返回 → EventToolExecEnd 
  → Flow Router: Route(State) → Instruction
  → Coordinator.FollowUp(下一条指令)
```

---

## 3. 核心设计：Coordinator 长循环

### 3.1 Coordinator 的职责

Coordinator 是**唯一掌控流程的智能体**。它不直接调用工具写数据库，而是通过 `subagent` 工具调度子代理完成具体任务。

```
Coordinator 的一次 Run：
  1. Host 注入启动 Prompt（含创作需求 + 当前项目状态）
  2. 每轮 LLM 调用前，Host 注入 Reminder（当前 Phase / Flow / 下一步建议）
  3. Coordinator 读 novel_context（RAG + 结构化数据）
  4. Coordinator 决定：调哪个 subagent、给什么任务
  5. SubAgent 返回结果 → EventToolExecEnd → Dispatcher 计算下一条指令
  6. Dispatcher 通过 FollowUp 注入下一条指令
  7. 循环直到 Phase=Complete
```

### 3.2 Coordinator System Prompt

```
你是一位小说创作协调者（Coordinator）。

你的核心职责是在一次长循环中推动整本书的创作完成。
你通过调用 subagent 工具来委托具体任务。

你可以调用的子代理：
- architect: 故事架构师。负责故事指南针、角色弧、世界规则、
  卷弧骨架、弧细纲、伏笔规划、书名候选。
- writer: 小说写手。负责章节计划、正文写作、一致性检查、
  角色状态更新、世界状态更新、伏笔状态更新。
- editor: 小说编辑。负责弧级评审、卷级评审、弧摘要生成、
  角色快照生成、伏笔结转、卷摘要生成。

你的决策规则：
1. 每轮只调一个 subagent
2. 收到 Host 指令时立即执行，不要先调 novel_context
3. 子代理返回后，根据结果和 Reminder 决定下一步
4. 不要自由发挥——遵循 Host 下达的指令和 Reminder
5. 当 Phase=Complete 时，输出全书总结后调用 end_turn

你绝对不能：
- 直接调用子代理的工具（那些只有子代理能调）
- 在没有 Host 指令的情况下自我决定"该写什么"
- 在 Phase!=Complete 时调用 end_turn（会被 StopGuard 拦截）
```

### 3.3 StopGuard

物理守门：当 `progress.Phase != Complete` 时，Coordinator 的 `end_turn` 调用被直接拒绝，返回错误信息。Coordinator 必须继续推进创作。

```
StopGuard 逻辑：
  if (progress.Phase !== 'complete') {
    return { success: false, error: '全书未完成，禁止停机。请继续推进创作。' }
  }
```

### 3.4 novel_context 工具

给 Coordinator 和每个 SubAgent 提供当前项目上下文的统一入口。

```
novel_context 返回内容：
{
  // 项目基础
  project: { title, summary },
  
  // 编排状态
  progress: { phase, flow, currentChapter, completedChapters, pendingRewrites },
  
  // 故事设定
  compass: { ending_direction, core_conflict, theme, genre, ... },
  
  // RAG 上下文（从 memory.service 检索）
  rag_chunks: [ ... ],
  
  // 当前弧/卷上下文
  current_arc: { ... },
  current_volume: { ... },
  
  // 活跃伏笔
  active_foreshadowings: [ ... ],
  
  // 最近章节摘要
  recent_summaries: [ ... ]
}
```

---

## 4. Flow Router：事件驱动的纯函数调度

### 4.1 设计原则

- **Route 是纯函数**：输入 `State`，输出 `Instruction | null`
- **LoadState 是 IO 边界**：从 Store 读取全部事实，集中在一处
- **事件驱动**：SubAgent 返回 → `EventToolExecEnd` → `Dispatch()` → `Router.Route(state)` → `FollowUp`
- **指令下达**：通过 `FollowUp` 将 Instruction 注入 Coordinator 上下文，Coordinator 按要求调 subagent

### 4.2 State（Router 输入）

```typescript
interface RouterState {
  // 进度
  phase: 'init' | 'premise' | 'outline' | 'writing' | 'complete'
  flow: 'writing' | 'reviewing' | 'rewriting' | 'polishing' | 'steering'
  
  // 章节
  lastCompleted: number
  nextChapter: number
  totalPlannedChapters: number
  
  // 重写/打磨队列
  pendingRewrites: number[]
  
  // 弧信息（长篇分层模式）
  arcBoundary: {
    isArcEnd: boolean
    isVolumeEnd: boolean
    volume: number
    arc: number
    nextArc: number
    nextVolume: number
    needsExpansion: boolean
    needsNewVolume: boolean
  } | null
  
  // 后处理完成状态
  hasArcReview: boolean
  hasArcSummary: boolean
  hasVolumeSummary: boolean
  
  // 基础设定缺失
  foundationMissing: string[]
}
```

### 4.3 Instruction（Router 输出）

```typescript
interface Instruction {
  agent: 'architect' | 'architect_long' | 'writer' | 'editor'
  task: string           // 给子代理的自然语言任务描述
  reason: string         // 给 Coordinator 看的派发理由
  chapter?: number       // writer 任务的目标章节号
}
```

### 4.4 Route 决策优先级

```
Route(State) → Instruction?  优先级自上而下，命中即返回：

1. Phase = Complete                      → null（Coordinator 自行裁定输出总结）
2. Phase != Writing                      → null（Coordinator 裁定规划师选型）
3. pendingRewrites 非空                    → writer（按队列重写/打磨）
4. flow = reviewing                      → null（editor 刚保存评审，verdict 在工具层处理）
5. flow = steering                       → null（用户干预处理中）
6. 弧末评审缺失                            → editor（弧评审）
7. 弧末评审有但弧摘要缺失                   → editor（弧摘要）
8. 卷末弧摘要有但卷摘要缺失                 → editor（卷摘要）
9. 下一弧是骨架待展开                       → architect_long（展开弧细纲）
10. 卷末需决策下一卷                       → architect_long（追加卷 或 结束全书）
11. 其它                                  → writer（写下一章）
```

### 4.5 Dispatcher 实现

```typescript
class FlowDispatcher {
  private coordinator: CoordinatorAgent
  private repeatTracker: RepeatTracker
  
  // 订阅 Coordinator 事件
  attach(): void {
    this.coordinator.on('ToolExecEnd', (event) => {
      if (event.tool !== 'subagent' || event.isError) return
      this.dispatch()
    })
  }
  
  // 立即计算路由并下达指令
  dispatch(): void {
    const state = LoadState(this.store)
    const inst = Route(state)
    if (!inst) return
    
    const n = this.trackRepeat(inst)
    const msg = formatInstruction(inst, n)
    this.coordinator.followUp(msg)
  }
}
```

---

## 5. Reminder：每轮重算的指令层

### 5.1 设计原则

```
Reminder = 纯函数(Progress, Flow, Phase, Conditions) → 文本

每轮 Coordinator 调用前：
  1. 读 Store → 获取当前 Progress / Phase / Flow
  2. 纯函数生成 <system-reminder>
  3. 注入到消息末尾（不进对话历史）
  4. 下轮重新计算（不会漂移）
```

### 5.2 Reminder 生成规则

```typescript
function generateReminder(state: RouterState): string {
  const lines: string[] = []
  
  lines.push(`当前阶段: ${PHASE_LABELS[state.phase]}`)
  lines.push(`当前流程: ${FLOW_LABELS[state.flow]}`)
  lines.push(`已完成: ${state.lastCompleted} 章 / 计划 ${state.totalPlannedChapters} 章`)
  
  if (state.pendingRewrites.length > 0) {
    lines.push(`⚠ 待重写章节: ${state.pendingRewrites.join(', ')}`)
  }
  
  if (state.arcBoundary?.isArcEnd) {
    lines.push(`📍 已到达第${state.arcBoundary.volume}卷第${state.arcBoundary.arc}弧末尾`)
    if (!state.hasArcReview) lines.push('→ 需要执行弧级评审')
    if (!state.hasArcSummary) lines.push('→ 需要生成弧摘要')
    if (state.arcBoundary.isVolumeEnd && !state.hasVolumeSummary) {
      lines.push('→ 需要生成卷摘要')
    }
  }
  
  if (state.foundationMissing.length > 0) {
    lines.push(`⚠ 设定缺失: ${state.foundationMissing.join(', ')}`)
  }
  
  return `<system-reminder>\n${lines.join('\n')}\n</system-reminder>`
}
```

### 5.3 SubAgent Guard

在 `subagent` 工具调用前，Host 检查：

```typescript
// Writer 守卫
if (agent === 'writer' && state.pendingRewrites.length > 0) {
  // 有重写队列时，writer 必须按队列顺序写
  const targetChapter = state.pendingRewrites[0]
  // 确保 task 描述包含目标章节号
}

// Phase 守卫
if (agent === 'writer' && state.phase !== 'writing') {
  return { success: false, error: '当前阶段不允许写作' }
}

// 重复指令熔断（纯 telemetry，不阻断）
if (sameInstructionRepeated >= 3) {
  emitWarning('指令已连续 3 次相同，可能陷入循环')
}
```

---

## 6. SubAgent 协议：统一的子代理调用

### 6.1 subagent 工具定义

```
工具名: subagent
参数:
  - agent: "architect" | "writer" | "editor"
  - task: 自然语言任务描述（如 "写第7章" / "对第一卷第二弧做弧级评审"）
  
返回: { success, result: { ...子代理执行的工具调用的汇总结果 } }
```

### 6.2 SubAgent 执行流程

```
Coordinator 调用 subagent("writer", "写第7章")
  │
  ▼
Host 接收调用
  │
  ├── 创建 SubAgent 独立 context（system prompt + novel_context + task）
  ├── SubAgent 执行 tool-calling 循环（与当前 agent-engine 逻辑一致）
  ├── 收集执行结果（thinking + tool_calls + final output）
  └── 返回给 Coordinator
```

### 6.3 SubAgent System Prompt 改造

**改造前（当前）**：每个 Agent 的 System Prompt 列出 10+ 项职责。

**改造后**：SubAgent 只收到**一条当前任务**：

```
Architect System Prompt:
你是一位小说架构师。你会被分配一个具体任务。
当前任务：{task}
在执行任务前，先调用 novel_context 获取当前项目上下文。
只做当前任务要求的事，完成后返回结果。
不要做任务描述之外的任何事。

Architect 被调用时收到的消息：
  [Host] 任务：展开第1卷第2弧（save_foundation type=expand_arc）
  上述是流程层的明确指令，请立即执行，不要先输出推理，不要先调 novel_context。
```

```
Writer System Prompt:
你是一位小说写手。你会被分配一个具体章节的完整创作任务。
你的固定流程：
1. novel_context — 加载上下文
2. read_chapter（回读前文）
3. plan_chapter — 制定本章计划
4. draft_chapter — 撰写正文
5. check_consistency — 一致性检查
6. commit_chapter — 提交终稿
每章执行上述流程一次。只做当前任务，完成后返回结果。

Writer 被调用时收到的消息：
  [Host] 任务：写第7章
  理由是：续写下一章
```

```
Editor System Prompt:
你是一位小说编辑。你会被分配一个具体的评审或摘要生成任务。

Editor 被调用时收到的消息：
  [Host] 任务：对第1卷第2弧做弧级评审（scope=arc）
  理由是：弧末评审未完成
```

### 6.4 SubAgent 的 novel_context 工具

每个 SubAgent 都有 `novel_context` 工具，用于获取当前项目的全量上下文。与 Coordinator 共享同一个 RAG 检索接口：

```
novel_context 返回（按 Agent 类型裁剪）：
  Architect: compass + characters + world_rules + existing_arcs + foundation_docs
  Writer:    current_chapter_plan + recent_summaries + character_states 
             + active_foreshadowings + RAG chunks + contracts
  Editor:    arc_summaries + chapter_list + recent_reviews + character_snapshots 
             + foreshadowing_ledger
```

---

## 7. Host：薄外壳

### 7.1 职责

```
Host 只做 5 件事：
1. Start — 注入启动 Prompt，启动 Coordinator 长循环
2. Resume — 从 checkpoint 生成恢复 Prompt，重入 Coordinator
3. Abort — 中断 Coordinator（AbortController + 标记暂停）
4. Steer — 注入用户干预指令到 Coordinator
5. Reset — 清空编排状态回到 idle
```

### 7.2 生命周期

```
idle → (Start/Resume) → running → (Complete/Abort) → idle/complete/complete
                                    ↓
                                  paused → (Resume) → running
```

只有 4 个生命周期状态，不再有 16 个编排状态。

### 7.3 启动 Prompt 模板

```
Host 启动时生成启动 Prompt：

[用户需求]
{user_prompt}

[项目当前状态]
阶段: {phase}
已完成: {completedChapters} 章
{foundation_status}

[你的任务]
你是 Coordinator，负责推动这本小说的创作完成。
当前处于{phase}阶段，请根据 Reminder 决定下一步行动。
调用 subagent 工具来委托具体任务。
完成后调用 end_turn（仅在全书完成后）。
```

### 7.4 Store 状态管理

```typescript
// system_state 表简化
interface SystemState {
  project_id: string
  phase: 'init' | 'premise' | 'outline' | 'writing' | 'complete'
  flow: 'writing' | 'reviewing' | 'rewriting' | 'polishing' | 'steering'
  lifecycle: 'idle' | 'running' | 'paused' | 'completed'
  current_chapter: number
  current_volume: number
  current_arc: number
  pending_rewrites: number[]
  foundation_missing: string[]
  updated_at: number
}
```

---

## 8. 与现有体系的融合

### 8.1 RAG 记忆体系（保留）

```
novel_context → memory.service.buildContext()
  → 向量检索（sqlite-vec） + 关键词检索
  → 按 source_type 分组（chapter/character/location/lore/foundation）
  → token 预算裁剪
  → 返回给 SubAgent / Coordinator
```

不改 memory.service.ts 的任何逻辑，只调整调用入口。

### 8.2 文档导入体系（保留）

```
import.service.ts 全套保留：
  导入文档 → parseDocument → parseSegments → mergeSegments → bible sections
  → 作为 foundation 类型的 memory_chunks 进入 RAG
```

导入完成后触发 `novel_context` 重建，新的 foundation 数据对后续 SubAgent 调用立即可用。

### 8.3 Story Bible（保留）

```
story-bible.service.ts 全套保留：
  BibleField CRUD → AI 协同创作 → 就绪评估 → Launch Snapshot
```

Launch 时生成 Snapshot，注入到 Coordinator 的启动 Prompt 中。

### 8.4 Phase 4 系统（融入 Writer 工具流）

**改造前**：Host 控制 `contract_generation → plan_gate → writing → draft_gate` 四个状态。

**改造后**：全部内置到 Writer 的工具调用序列中：

```
Writer 按固定流程执行：
1. novel_context         ← 加载上下文（含契约束缚、事实锁、门禁规则）
2. read_chapter          ← 回读前文
3. plan_chapter          ← 制定计划（内部跑 plan_gate 检查）
4. draft_chapter         ← 撰写正文
5. check_consistency     ← 一致性检查（内部跑 contract/knowledge/fact_lock/foreshadow/timeline 检查）
6. commit_chapter        ← 提交终稿（isCommitted = true 后触发角色状态更新/伏笔更新/摘要生成）
```

Writer 不再需要"请求门禁"——门禁逻辑内置在 `plan_chapter` 和 `check_consistency` 工具内部自动执行。

### 8.5 模型路由（保留）

```
model-router.service.ts 保留：
  resolveModel(agentType, taskType, riskLevel) → RoutingDecision
```

Coordinator 默认用 pro 模型，Writer 默认用 flash（长上下文需要 flash 降低成本），Editor 用 pro。

---

## 9. 数据模型变更

### 9.1 system_state 表重构

```sql
-- 删除旧表（迁移时 rename 保留数据）
ALTER TABLE system_state RENAME TO system_state_old;

-- 新建简化表
CREATE TABLE system_state (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'init',           -- init/premise/outline/writing/complete
  flow TEXT NOT NULL DEFAULT 'writing',          -- writing/reviewing/rewriting/polishing/steering
  lifecycle TEXT NOT NULL DEFAULT 'idle',        -- idle/running/paused/completed
  current_chapter INTEGER NOT NULL DEFAULT 0,
  current_volume INTEGER NOT NULL DEFAULT 0,
  current_arc INTEGER NOT NULL DEFAULT 0,
  pending_rewrites TEXT DEFAULT '[]',
  foundation_missing TEXT DEFAULT '[]',
  is_paused INTEGER NOT NULL DEFAULT 0,
  auto_mode INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
```

### 9.2 不再需要的表（废弃但不删除）

| 表 | 原因 |
|----|------|
| ~~orchestration_log~~ | 合并到 agent_decisions + 事件流 |
| ~~arc_chapter_plans~~ | 保留但由 Architect 通过工具写入 |

实际上所有现有表都保留，只是 system_state 的结构清简化。orchestration_log 仍可用于审计。

### 9.3 新增 progress 表

```sql
CREATE TABLE IF NOT EXISTS progress (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  novel_name TEXT DEFAULT '',
  phase TEXT NOT NULL DEFAULT 'init',
  flow TEXT NOT NULL DEFAULT 'writing',
  current_chapter INTEGER NOT NULL DEFAULT 0,
  total_chapters INTEGER NOT NULL DEFAULT 0,
  completed_chapters TEXT DEFAULT '[]',  -- JSON array of chapter numbers
  pending_rewrites TEXT DEFAULT '[]',    -- JSON array of chapter numbers
  total_word_count INTEGER NOT NULL DEFAULT 0,
  layered INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
```

---

## 10. IPC 接口变更

### 10.1 删除

| 接口 | 原因 |
|------|------|
| `orchestrator:tick` | 不再需要手动推进状态机 |
| `orchestrator:setExecutionMode` | 不区分模式，Coordinator 自主决策 |
| `orchestrator:notifyArchitectureDone` | Coordinator 根据 route 自动判断 |
| `orchestrator:notifyChapterDone` | Writer commit 后自动更新 progress |
| `orchestrator:getConditions` | 不再有边界条件概念 |
| `orchestrator:getContext` | novel_context 工具化 |

### 10.2 新增

```typescript
export interface OrchestratorApi {
  // 生命周期
  start(projectId: string): Promise<{ phase: string; message: string }>
  resume(projectId: string): Promise<{ phase: string; message: string }>
  pause(projectId: string): Promise<void>
  reset(projectId: string): Promise<void>
  
  // 干预
  steer(projectId: string, text: string): Promise<void>
  
  // 查询
  getState(projectId: string): Promise<SystemState | null>
  getProgress(projectId: string): Promise<Progress | null>
  getRecoveryStatus(projectId: string): Promise<RecoveryStatus>
  
  // 事件
  on(event: IpcEvent, cb): () => void
}
```

### 10.3 事件流

```typescript
// 新增事件
| 'coordinatorThinking'  // Coordinator 思考文本
| 'coordinatorToolCall'  // Coordinator 调用 subagent(name, task)
| 'subagentStart'        // SubAgent 开始执行
| 'subagentThinking'     // SubAgent 思考文本
| 'subagentToolCall'     // SubAgent 内部工具调用
| 'subagentToolResult'   // SubAgent 内部工具结果
| 'subagentDone'         // SubAgent 完成
| 'phaseChanged'         // Phase 变更
| 'flowChanged'          // Flow 变更
| 'progressUpdated'      // Progress 更新
| 'checkpointSaved'      // Checkpoint 保存
```

---

## 11. 实施计划

### 阶段 0：保留当前系统，新建并行实现（不建议）

直接在现有代码上重构，分阶段替换。

### 阶段 1：基础组件（4 天）

| 任务 | 文件 | 产出 |
|------|------|------|
| Phase/Flow 类型 + Progress 表 | `shared/types.ts` `electron/db/schema.ts` | 新类型体系 |
| LoadState + Route 纯函数 | `electron/services/flow-router.ts` | 可单测的路由器 |
| Reminder 生成器 | `electron/services/reminder.ts` | 纯函数 reminder |
| Host 薄外壳 | `electron/services/host.ts` | Start/Resume/Abort/Steer/Reset |
| Coordinator System Prompt | `electron/services/coordinator.prompt.ts` | 新 Prompt |

**交付物：**
- `flow-router.test.ts` 可通过（纯函数测试）
- `reminder.test.ts` 可通过
- Host 可创建 Coordinator 实例

### 阶段 2：SubAgent 协议（3 天）

| 任务 | 文件 | 产出 |
|------|------|------|
| subagent 工具实现 | `electron/services/tools/subagent.tool.ts` | 统一的子代理调用工具 |
| SubAgent context 构建器 | `electron/services/subagent-context.ts` | 按 Agent 类型构建独立 context |
| Architect/Written/Editor Prompt 重写 | `electron/services/agent-engine.ts` | 按任务分配的 System Prompt |
| novel_context 工具统一 | `electron/services/tools/novel-context.tool.ts` | 统一上下文获取 |
| StopGuard 工具守卫 | `electron/services/tools/stop-guard.ts` | Phase!=Complete 拦截 end_turn |

**交付物：**
- Coordinator 可通过 subagent 调 Writer 写完一章
- Writer 的固定 6 步流程集成门禁检查

### 阶段 3：Dispatcher 事件驱动（2 天）

| 任务 | 文件 | 产出 |
|------|------|------|
| FlowDispatcher 实现 | `electron/services/flow-dispatcher.ts` | 事件订阅 + 自动派发 |
| Repeat tracker | `electron/services/flow-dispatcher.ts` | 重复指令检测 |
| Event 发射器 | `electron/services/host.ts` | Host 发布事件到 IPC |

**交付物：**
- SubAgent 完成后自动触发 Dispatcher → Route → FollowUp
- 不再需要前端轮询

### 阶段 4：IPC + 前端改造（2 天）

| 任务 | 文件 | 产出 |
|------|------|------|
| 新 IPC handlers | `electron/ipc/register.ts` | start/resume/pause/reset/steer/getState/getProgress |
| 前端 Host store | `src/stores/host.store.ts` | Phase/Flow/Progress 状态 |
| 编排页改造 | `src/pages/OrchestrationPage.tsx` | Phase/Flow 展示、事件流 |
| **结构化输出链路** | 见下文 §11.5 | 每一轮编排的所有中间数据实时输出到 UI |
| 移除旧 16 状态代码 | 多个文件 | 清理 |

### 阶段 5：集成测试 + 验收（2 天）

| 任务 | 产出 |
|------|------|
| 端到端测试 | 完整首弧自动生成 |
| 崩溃恢复测试 | 中断 → 重启 → Resume |
| 用户干预测试 | Steer → 影响评估 → 继续 |
| 性能测试 | 500 章上下文管理 |

---

## 11.5 结构化输出链路

### 设计原则

编排执行过程中，每一步的**决策、思考、工具调用、状态变更**都必须实时输出到前端 UI，让用户能看到完整的编排过程。

### 数据流

```
Host.executeTurn()
  ├── Coordinator LLM 调用
  │   └── onCoordinatorThinking → 'coordinatorThinking' 事件
  │
  ├── SubAgent 执行（s subagent 工具触发）
  │   ├── onSubAgentStart → 'subagentStart' 事件
  │   ├── SubAgent LLM 思考
  │   │   └── onSubAgentThinking → 'subagentThinking' 事件
  │   ├── SubAgent 工具调用
  │   │   └── onSubAgentToolCall → 'subagentToolCall' 事件
  │   ├── SubAgent 工具结果
  │   │   └── onSubAgentToolResult → 'subagentToolResult' 事件
  │   └── SubAgent 完成
  │       └── onSubAgentDone → 'subagentDone' 事件
  │
  ├── 进度更新
  │   ├── onPhaseChange → 'phaseChanged' 事件
  │   ├── onFlowChange → 'flowChanged' 事件
  │   └── onProgressUpdate → 'progressUpdated' 事件
  │
  └── 轮次总结
      └── onRoundSummary → 'roundSummary' 事件
```

### 事件类型清单

| 事件名 | 触发时机 | 携带数据 |
|--------|---------|---------|
| `coordinatorThinking` | Coordinator LLM 每轮思考 | `{ text, timestamp }` |
| `subagentStart` | SubAgent 被调用 | `{ agentType, task, timestamp }` |
| `subagentThinking` | SubAgent LLM 每轮思考 | `{ agentType, text, timestamp }` |
| `subagentToolCall` | SubAgent 工具调用 | `{ agentType, toolName, args, timestamp }` |
| `subagentToolResult` | SubAgent 工具调用结果 | `{ agentType, toolName, success, error?, timestamp }` |
| `subagentDone` | SubAgent 完成 | `{ agentType, done, summary, timestamp }` |
| `phaseChanged` | Phase 变更 | `{ from, to, reason, timestamp }` |
| `flowChanged` | Flow 变更 | `{ from, to, reason, timestamp }` |
| `progressUpdated` | 章节进度更新 | `{ chapter, total, wordCount, timestamp }` |
| `roundSummary` | 每轮总结 | `{ summary, timestamp }` |

### UI 展示

前端 `OrchestrationPage` 的 Coordinator 输出面板分层展示：

- **C** (Coordinator 思考) — 天蓝色
- **S** (SubAgent 开始/完成) — 紫色
- **S·think** (SubAgent 思考) — 浅紫斜体
- **→** (工具调用) — 青色
- **←** (工具结果) — 绿色
- **PHASE** (阶段变更) — 琥珀色高亮
- **FLOW** (流程变更) — 琥珀色
- **PROG** (进度更新) — 翠绿
- **ERR** (错误) — 红色
- **·** (系统消息) — 灰色

### 实现文件

| 文件 | 改动 |
|------|------|
| `shared/types.ts` | `IpcEvent` 新增 8 个事件类型 |
| `electron/services/host.ts` | `HostCallbacks` 接口（10 个回调），`executeTurn` + `updateProgressFromSubAgent` 串联全部回调 |
| `electron/ipc/register.ts` | `executeTurn` handler 接入全部回调 → `event.sender.send()` |
| `src/stores/host.store.ts` | `executeTurn` 监听全部 10 种事件 → 按类型推入 `output` 数组 |
| `src/pages/OrchestrationPage.tsx` | 结构化输出面板：类型标签 + 颜色区分 + 系统消息/错误/阶段变更特殊背景色 |

---

## 12. 风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| Coordinator LLM 跑偏 | 高 | StopGuard + Reminder 双重约束；Route 函数兜底 |
| 替换过程中旧编排不可用 | 中 | 按阶段交付，每阶段独立可用 |
| SubAgent 单次 context 过大 | 中 | novel_context 按 Agent 类型裁剪，不注入全部数据 |
| Go → TypeScript 移植差异 | 低 | 吸收设计理念，不机械翻译代码 |
| 已有用户数据迁移 | 中 | system_state 用 ALTER TABLE RENAME 保留旧数据 |

---

## 附录 A：关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 是否保留 tick() | 删除 | Coordinator 自主决策替代 Host 调度 |
| 是否引入独立 Coordinator Agent | 是 | 这是整个重构的核心 |
| 门禁逻辑放哪 | Writer 工具流内部 | 不暴露给 Coordinator，简化调度层 |
| 是否保留 execution_mode | 删除 | Coordinator 自主决策，无需模式选择 |
| Session 状态追踪 | 保留 | 加固阶段已实现，崩溃恢复依赖它 |

## 附录 B：与 ainovel-cli 的差异

| 维度 | ainovel-cli | 我们 |
|------|------------|------|
| 语言 | Go | TypeScript (Electron) |
| 界面 | TUI | Electron GUI |
| RAG | 关键词推荐章节 | 向量检索 + 关键词混合（更强） |
| 文档导入 | 独立 /import 命令 | Story Bible 集成（更完整） |
| 模型路由 | 基于 role 选择模型 | 基于 agent×task×risk 路由 + 预算管理 |
| 预算管理 | 内置 | 保留现有 config.service |
| 断点恢复 | checkpoints.jsonl | SQLite 持久化（更可靠） |
| SubAgent 工具 | 6-7 个 | 保留现有 10+ 工具（更丰富） |
