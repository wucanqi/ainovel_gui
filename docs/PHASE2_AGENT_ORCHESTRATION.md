# 长篇小说记忆型 AI 写作桌面系统 · 二期 Agent 编排系统设计

> 版本：v2.0（二期设计）
> 日期：2026-06-22
> 状态：✅ 已实现（数据模型、工具执行器、Agent 引擎、编排器状态机均已实现）
> 
> 注意：二期编排器（orchestrator.ts）与三期 Coordinator/Host 架构（host.ts）共存。新的 Host-based 流程（start/resume/pause/reset/steer）是推荐的编排入口，旧的 tick() 状态机保留向后兼容。详情参见 PHASE3_0_ORCHESTRATION_REDESIGN.md。

---

## 目录

1. [设计理念](#1-设计理念)
2. [系统架构](#2-系统架构)
3. [Agent 定义](#3-agent-定义)
4. [编排器状态机](#4-编排器状态机)
5. [三级闭环设计](#5-三级闭环设计)
6. [数据模型](#6-数据模型)
7. [Agent 工具集](#7-agent-工具集)
8. [示例：首弧完整流程](#8-示例首弧完整流程)
9. [实现计划](#9-实现计划)

---

## 1. 设计理念

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **LLM 即大脑，工具即手脚** | 每个 Agent 的 LLM 负责决策和创作，通过工具调用将产物写入数据库，不通过输出文本传递结构化数据 |
| **滚动规划** | 不一次性规划全部章节。初始确定终局方向 + 前 N 弧骨架 + 第一弧细纲。后续弧在上一弧完成后再展开 |
| **编排器说了算** | 下一步做什么不由 Agent 自己声明，由编排器根据状态机、产物、评审结果和边界条件判断 |
| **三级闭环** | 章级闭环（一章写好）、弧级闭环（故事单元成立）、卷级闭环（大阶段完成 + 更新指南针） |
| **所有产物入库** | 创作指令、书名、指南针、人物弧、世界规则、章节计划、正文、摘要、伏笔台账、评审意见等全部进入结构化数据库 |

### 1.2 与一期的关系

一期实现了基础写作工具（编辑器 + 设定库 + RAG + AI 续写）。二期在此基础上构建 Agent 编排层：

```
┌──────────────────────────────────────────────┐
│ 二期：Agent 编排系统                          │
│  Orchestrator → Architect / Writer / Editor   │
│  状态机 · 工具调用 · 三级闭环 · 滚动规划      │
├──────────────────────────────────────────────┤
│ 一期：基础写作环境                             │
│  编辑器 · 设定库 · RAG记忆 · API配置          │
└──────────────────────────────────────────────┘
```

一期的 `chapter`、`character`、`worldbuilding`、`memory_chunks` 等表继续使用，二期新增编排相关的表，一期设定库作为 Architect 的世界规则基座。

---

## 2. 系统架构

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                        Orchestrator                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  状态机 (State Machine)                                  │ │
│  │  State × Event → NextState + Action                     │ │
│  │  边界条件检查 → 调度决策                                  │ │
│  └───────────────┬─────────────────────────────────────────┘ │
│                  │                                            │
│      ┌───────────┼───────────┐                               │
│      ▼           ▼           ▼                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                        │
│  │Architect│ │ Writer  │ │ Editor  │   Agent 层              │
│  │Agent    │ │Agent    │ │Agent    │                         │
│  │         │ │         │ │         │                         │
│  │工具集:  │ │工具集:  │ │工具集:  │                         │
│  │-指南针  │ │-章节计划│ │-章评审  │                         │
│  │-人物弧  │ │-写正文  │ │-弧评审  │                         │
│  │-世界规则│ │-一致性  │ │-卷评审  │                         │
│  │-卷弧骨架│ │-提交    │ │-打磨建议│                         │
│  │-弧细纲  │ │         │ │         │                         │
│  │-伏笔规划│ │         │ │         │                         │
│  └────┬────┘ └────┬────┘ └────┬────┘                        │
│       │            │            │                             │
│       └────────────┼────────────┘                             │
│                    ▼                                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  工具执行层 (Tool Executor)                               │ │
│  │  每个工具 = 数据库写入 + 记忆索引 + 状态更新              │ │
│  │  LLM 不直接操作数据库，通过工具调用来操作                  │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────┐
│  数据层 (一期 SQLite + 二期新增表)                             │
│  projects / chapters / characters / worldbuilding / ...       │
│  + story_compass / character_arcs / foreshadowing_ledger      │
│  + arc_skeletons / arc_outlines / chapter_plans               │
│  + agent_sessions / agent_decisions / review_records          │
│  + system_state / orchestration_log                          │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 进程职责扩充

| 层级 | 一期 | 二期新增 |
|------|------|----------|
| **主进程** | CRUD 服务 + RAG + AI 流式 | 编排器状态机 + Agent 调度 + 工具执行器 + 决策日志 |
| **渲染进程** | 编辑器 + 设定库 + AI 面板 | 编排面板（启动/暂停/查看状态）+ 产物浏览 + 评审面板 |
| **Preload** | 基础 IPC | 编排器 IPC（启动/暂停/单步/查询状态） |

---

## 3. Agent 定义

### 3.1 Agent 通用设计

每个 Agent 由三部分组成：

```
Agent = System Prompt + 工具集 + 上下文注入
```

- **System Prompt**：定义角色、职责、输出规范
- **工具集**：Agent 可调用的 tool 列表（执行写入操作）
- **上下文注入**：编排器在调用 Agent 前注入的当前状态（前文、角色快照、伏笔状态等）

LLM 的每次响应被解析为：**思考链 + 工具调用列表**。编排器执行工具调用后，将结果反馈给 Agent（或调度下一个 Agent）。

### 3.2 Architect Agent（架构师）

**职责**：创作指令收敛、书名候选、类型定位、核心卖点、故事指南针、主角人物弧、主要角色人物弧、世界规则、卷弧骨架、首弧细纲、伏笔规划。

**触发时机**：
- 项目初始化（用户启动新项目）
- 上一弧完成，下一弧需要展开
- 用户手动触发重新规划

**输入上下文**（编排器注入）：
```
项目当前状态：
- 故事指南针（如果有）
- 已完成卷/弧摘要
- 当前角色快照
- 未回收伏笔列表
- 世界状态变化
- 用户指令（如果有）
```

**工具集**：

| 工具名 | 功能 | 写入表 |
|--------|------|--------|
| `set_story_compass` | 设定/更新故事指南针 | story_compass |
| `add_title_candidate` | 添加书名候选 | title_candidates |
| `set_genre_positioning` | 设定类型定位 | story_compass（genre 字段） |
| `set_core_selling_point` | 设定核心卖点 | story_compass（selling_point 字段） |
| `create_character_arc` | 创建/更新人物弧 | character_arcs |
| `create_world_rule` | 创建世界规则 | world_rules |
| `create_volume_arc` | 创建卷弧骨架 | volume_arcs |
| `create_arc_outline` | 创建弧的详细章节计划 | arc_outlines + arc_chapter_plans |
| `create_foreshadowing` | 注册伏笔 | foreshadowing_ledger |
| `create_character` | 创建人物（同步设定库） | characters（一期） |
| `create_worldbuilding` | 创建世界观词条（同步设定库） | worldbuilding（一期） |
| `report_architecture_done` | 报告架构设计完成，提交给编排器 | 无（状态变更） |

### 3.3 Writer Agent（写手）

**职责**：只负责当前章节。写每章前必须拿到：当前章目标、当前弧目标、角色状态、活跃伏笔、最近前文摘要、相关历史章节、下一章方向。Writer 先做章节计划，再写正文，再做一致性检查，最后提交章节。

**触发时机**：
- 编排器判定"应继续写下一章"
- 编排器判定"需重写某章"

**输入上下文**（编排器注入）：
```
当前章信息：
- 当前章目标（来自弧大纲）
- 当前弧目标
- 上一章摘要
- 上一章的「下一章衔接提示」

角色状态：
- 所有角色当前状态快照
- 当前关系图谱

伏笔状态：
- 活跃伏笔列表（含：计划本章埋下/推进/回收的伏笔）
- 未回收伏笔数量

前文上下文：
- 最近 3 章摘要
- 弧内已完成章节列表
- RAG 检索相关历史章节片段

方向：
- 下一章方向（来自弧大纲或上一章衔接提示）
```

**工具集**：

| 工具名 | 功能 | 写入表 |
|--------|------|--------|
| `create_chapter_plan` | 制定章节计划（场景列表、节奏、视角） | chapter_plans |
| `write_chapter_body` | 写入章节正文 | chapters（一期，content 字段） |
| `update_character_state` | 更新角色状态快照 | character_state_snapshots |
| `update_relationship` | 更新角色关系 | character_relationships |
| `update_world_state` | 更新世界状态 | world_state_changes |
| `update_foreshadowing` | 更新伏笔状态（埋下/推进/回收） | foreshadowing_ledger |
| `create_chapter_summary` | 产出章节摘要 | chapter_summaries |
| `set_next_chapter_hint` | 设定下一章衔接提示 | chapter_summaries（next_hint 字段） |
| `consistency_check` | 执行一致性检查并报告 | consistency_reports |
| `report_chapter_done` | 报告章节完成，提交给编排器 | 无（状态变更） |

### 3.4 Editor Agent（编辑）

**职责**：质量门。不只是点评文字，而是驱动动作。章级评审、弧级评审、卷级评审。

**触发时机**：
- 每章完成后（轻量章级检查）
- 弧的所有章节完成后（弧级评审）
- 卷的所有弧完成后（卷级评审）

**输入上下文**（编排器注入）：
```
评审类型：章级 / 弧级 / 卷级

弧级评审输入：
- 本弧目标
- 弧内所有章节摘要
- 弧内角色状态变化轨迹
- 弧内伏笔台账（计划 vs 实际）
- 弧内世界状态变化
- 弧内章节计划 vs 实际产出

卷级评审输入：
- 卷目标
- 卷内所有弧摘要
- 故事指南针当前状态
- 全局伏笔台账
- 全局角色状态
```

**工具集**：

| 工具名 | 功能 | 写入表 |
|--------|------|--------|
| `review_pass` | 评审通过 | review_records（verdict=pass） |
| `review_polish` | 要求局部打磨（指定章节和打磨点） | review_records（verdict=polish） |
| `review_rewrite_chapter` | 要求重写指定章节（附原因） | review_records（verdict=rewrite_chapter） |
| `review_replan` | 要求重新规划（附原因） | review_records（verdict=replan） |
| `review_note` | 添加评审备注（不改变判定） | review_records（verdict=note） |
| `generate_arc_summary` | 生成弧摘要 | arc_summaries |
| `generate_character_snapshot` | 生成角色快照 | character_state_snapshots |
| `generate_foreshadowing_carryover` | 生成伏笔结转（哪些带到下一弧） | foreshadowing_ledger |
| `generate_volume_summary` | 生成卷摘要 | volume_summaries |
| `update_story_compass` | 更新故事指南针（卷级评审后） | story_compass |

---

## 4. 编排器状态机

### 4.1 状态定义

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Orchestrator State Machine                      │
│                                                                         │
│  ┌──────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │  IDLE    │────▶│ INITIALIZING │────▶│ ARCHITECTING │                │
│  │  空闲     │     │  初始化中     │     │  架构设计中   │                │
│  └──────────┘     └──────────────┘     └──────┬───────┘                │
│                                               │                         │
│                     ┌─────────────────────────┘                         │
│                     ▼                                                   │
│            ┌────────────────┐                                           │
│            │   WRITING      │◀──────────────────────┐                  │
│            │   写作中        │                        │                  │
│            └───────┬────────┘                        │                  │
│                    │                                 │                  │
│         ┌─────────┼─────────┐                        │                  │
│         ▼         ▼         ▼                        │                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐         │                  │
│  │ARC_REVIEW│ │CHAPTER   │ │ CHAPTER      │         │                  │
│  │_PENDING  │ │_REVIEW   │ │ _REWRITE     │─────────┘                  │
│  │ 弧评审待定│ │ 章评审中  │ │  章重写中     │                            │
│  └────┬─────┘ └──────────┘ └──────────────┘                            │
│       │                                                                │
│  ┌────┴──────────────────────────────────┐                             │
│  │                                        │                             │
│  ▼                                        ▼                             │
│  ┌────────────┐                  ┌──────────────┐                      │
│  │POLISHING   │                  │ ARC_PASSED   │                      │
│  │ 打磨中      │                  │ 弧评审通过    │                      │
│  └─────┬──────┘                  └──────┬───────┘                      │
│        │                               │                               │
│        └───────▶ WRITING ◀─────────────┘                               │
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐                                 │
│  │NEXT_ARC_PLAN │────▶│ ARCHITECTING │    (下一弧展开)                  │
│  │  下一弧规划   │     └──────────────┘                                 │
│  └──────────────┘                                                       │
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐                                 │
│  │VOLUME_REVIEW │────▶│  COMPLETED   │                                 │
│  │  卷评审中     │     │  项目完成     │                                 │
│  └──────────────┘     └──────────────┘                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 状态转移规则

编排器在每个状态完成后，根据以下**边界条件**判断下一状态。**不依赖 Agent 的自我声明**。

#### 状态：ARCHITECTING（架构设计中）

| 条件 | 下一状态 |
|------|----------|
| Architect 调用 `report_architecture_done` 且指南针/首弧细纲/人物弧/伏笔已就绪 | WRITING |
| 用户要求修改架构 | ARCHITECTING（重入） |

#### 状态：WRITING（写作中）

| 条件 | 下一状态 |
|------|----------|
| 当前弧内还有未写章节 | WRITING（继续下一章） |
| 当前弧内所有章节已完成 | ARC_REVIEW_PENDING |

#### 状态：ARC_REVIEW_PENDING（弧评审待定）

| 条件 | 下一状态 |
|------|----------|
| 自动触发：所有章节完成 | ARC_REVIEW |

#### 状态：ARC_REVIEW（弧评审中）

| 条件 | 下一状态 |
|------|----------|
| Editor 调用 `review_pass` | ARC_PASSED |
| Editor 调用 `review_polish` | POLISHING |
| Editor 调用 `review_rewrite_chapter` | CHAPTER_REWRITE |
| Editor 调用 `review_replan` | ARCHITECTING |

#### 状态：ARC_PASSED（弧评审通过）

| 条件 | 下一状态 |
|------|----------|
| 弧摘要/角色快照/伏笔结转已生成 且 当前卷还有下一弧已规划 | WRITING（下一弧第一章） |
| 弧摘要/角色快照/伏笔结转已生成 且 下一弧未展开 | NEXT_ARC_PLAN |
| 弧摘要/角色快照/伏笔结转已生成 且 当前卷所有弧完成 | VOLUME_REVIEW |

#### 状态：NEXT_ARC_PLAN（下一弧规划）

| 条件 | 下一状态 |
|------|----------|
| 自动触发 | ARCHITECTING（展开下一弧细纲） |

#### 状态：VOLUME_REVIEW（卷评审中）

| 条件 | 下一状态 |
|------|----------|
| Editor 调用 `review_pass` 且 还有下一卷 | NEXT_ARC_PLAN |
| Editor 调用 `review_pass` 且 无下一卷 | COMPLETED |
| Editor 调用 `review_replan` | ARCHITECTING |

### 4.3 编排器核心逻辑（伪代码）

```typescript
class Orchestrator {
  private state: OrchestratorState
  private projectId: string

  async tick(): Promise<void> {
    const conditions = await this.evaluateConditions()

    switch (this.state) {
      case 'ARCHITECTING':
        if (conditions.architectureDone.waiting) break
        if (conditions.architectureReady) {
          this.transition('WRITING')
        }
        break

      case 'WRITING':
        if (conditions.arcHasMoreChapters) {
          await this.dispatchWriter()
        } else {
          this.transition('ARC_REVIEW_PENDING')
        }
        break

      case 'ARC_REVIEW_PENDING':
        this.transition('ARC_REVIEW')
        await this.dispatchEditor({ type: 'arc' })
        break

      case 'ARC_REVIEW':
        if (conditions.reviewDone.waiting) break
        this.transition(conditions.reviewVerdict)
        // reviewVerdict = 'ARC_PASSED' | 'POLISHING' | 'CHAPTER_REWRITE' | 'ARCHITECTING'
        break

      case 'ARC_PASSED':
        if (conditions.arcSummarized && conditions.hasMoreArcsInVolume) {
          this.transition('WRITING')
        } else if (conditions.arcSummarized && !conditions.nextArcPlanned) {
          this.transition('NEXT_ARC_PLAN')
        } else if (conditions.volumeDone) {
          this.transition('VOLUME_REVIEW')
        }
        break

      case 'NEXT_ARC_PLAN':
        this.transition('ARCHITECTING')
        await this.dispatchArchitect({ mode: 'expand_next_arc' })
        break

      // ... 其他状态类似
    }
  }

  private async evaluateConditions(): Promise<BoundaryConditions> {
    // 查询数据库，获取当前项目的实际状态
    // 不依赖 Agent 的自我声明
    const chapters = await db.chapters.count({ arcId: currentArcId })
    const plannedChapters = await db.arcOutlines.getChapterCount(currentArcId)
    const hasReview = await db.reviewRecords.hasActiveReview(currentArcId)
    // ...
    return { /* 所有边界条件 */ }
  }
}
```

---

## 5. 三级闭环设计

### 5.1 章级闭环

```
┌─────────────────────────────────────────────────────────┐
│ 章级闭环 (Chapter Loop)                                  │
│                                                         │
│  编排器注入上下文                                          │
│       │                                                 │
│       ▼                                                 │
│  Writer.create_chapter_plan()  ← 章节计划               │
│       │                                                 │
│       ▼                                                 │
│  Writer.write_chapter_body()   ← 写正文                 │
│       │                                                 │
│       ▼                                                 │
│  Writer.consistency_check()    ← 一致性检查              │
│       │                                                 │
│       ▼                                                 │
│  Writer.report_chapter_done()  ← 提交                   │
│       │                                                 │
│       ▼                                                 │
│  编排器判断：弧内还有章节？                                │
│    YES → 继续下一章                                      │
│    NO  → 进入弧级闭环                                    │
└─────────────────────────────────────────────────────────┘

每章产出：
  - 章节正文 (chapters)
  - 章节摘要 (chapter_summaries)
  - 人物状态变化 (character_state_snapshots)
  - 关系变化 (character_relationships)
  - 世界状态变化 (world_state_changes)
  - 伏笔变化 (foreshadowing_ledger)
  - 下一章衔接提示 (chapter_summaries.next_hint)
  - 一致性检查报告 (consistency_reports)
```

### 5.2 弧级闭环

```
┌─────────────────────────────────────────────────────────┐
│ 弧级闭环 (Arc Loop)                                      │
│                                                         │
│  弧内所有章节完成                                         │
│       │                                                 │
│       ▼                                                 │
│  Editor 弧级评审：                                       │
│  ├─ 弧目标是否完成？                                      │
│  ├─ 人物弧是否推进？                                      │
│  ├─ 伏笔是否按计划埋下/推进/回收？                         │
│  ├─ 节奏是否成立？                                       │
│  ├─ 钩子是否自然？                                       │
│  ├─ 设定是否一致？                                       │
│  └─ 下一弧是否有足够动力？                                │
│       │                                                 │
│       ▼                                                 │
│  评审结果：                                              │
│  ├─ PASS      → 生成弧摘要/角色快照/伏笔结转              │
│  ├─ POLISH    → Writer 打磨指定章节 → 再评审              │
│  ├─ REWRITE   → Writer 重写指定章节 → 再评审              │
│  └─ REPLAN    → Architect 重新规划本弧/下一弧              │
│       │                                                 │
│       ▼ (PASS)                                          │
│  弧摘要生成                                               │
│  角色快照生成                                             │
│  伏笔结转生成                                             │
│       │                                                 │
│       ▼                                                 │
│  编排器判断：                                             │
│  ├─ 当前卷还有弧 → 继续下一弧                              │
│  ├─ 下一弧未展开 → Architect 展开                         │
│  └─ 当前卷完成   → 进入卷级闭环                            │
└─────────────────────────────────────────────────────────┘

每弧产出（PASS 后）：
  - 弧摘要 (arc_summaries)
  - 角色快照 (character_state_snapshots)
  - 伏笔结转 (foreshadowing_ledger 状态更新)
  - 评审记录 (review_records)
```

### 5.3 卷级闭环

```
┌─────────────────────────────────────────────────────────┐
│ 卷级闭环 (Volume Loop)                                   │
│                                                         │
│  卷内所有弧完成 + 评审通过                                 │
│       │                                                 │
│       ▼                                                 │
│  Editor 卷级评审：                                       │
│  ├─ 卷目标是否完成？                                      │
│  ├─ 大阶段故事是否成立？                                  │
│  ├─ 人物弧整体推进情况                                    │
│  ├─ 伏笔全局台账审查                                      │
│  ├─ 读者期待是否得到满足？                                │
│  └─ 故事指南针是否需要调整？                              │
│       │                                                 │
│       ▼                                                 │
│  评审结果：                                              │
│  ├─ PASS      → 生成卷摘要 + 更新指南针                   │
│  └─ REPLAN    → Architect 重新规划                       │
│       │                                                 │
│       ▼ (PASS)                                          │
│  卷摘要生成                                               │
│  故事指南针更新（如有偏移）                                │
│       │                                                 │
│       ▼                                                 │
│  编排器判断：                                             │
│  ├─ 还有下一卷 → Architect 展开下一卷                      │
│  └─ 无下一卷   → COMPLETED（项目完成）                    │
└─────────────────────────────────────────────────────────┘

每卷产出（PASS 后）：
  - 卷摘要 (volume_summaries)
  - 故事指南针更新 (story_compass)
  - 评审记录 (review_records)
```

---

## 6. 数据模型

### 6.1 新增表一览

二期新增以下表（一期表保持不变）：

| 表名 | 用途 | 负责 Agent |
|------|------|-----------|
| `story_compass` | 故事指南针（终局方向、核心冲突、主题、类型） | Architect |
| `title_candidates` | 书名候选列表 | Architect |
| `character_arcs` | 人物弧定义（目标、成长轨迹、关键节点） | Architect |
| `world_rules` | 世界规则（魔法/科技/社会规则等） | Architect |
| `volume_arcs` | 卷弧骨架（卷→弧的层级结构） | Architect |
| `arc_outlines` | 弧大纲（弧的目标、章节计划列表） | Architect |
| `arc_chapter_plans` | 弧内每章的简要计划（目标、场景、伏笔） | Architect |
| `foreshadowing_ledger` | 伏笔台账（全生命周期追踪） | Architect/Writer |
| `chapter_plans` | 章级详细计划（Writer 写前制定） | Writer |
| `chapter_summaries` | 章节摘要 + 下一章衔接提示 | Writer |
| `character_state_snapshots` | 角色状态快照（每章/每弧） | Writer/Editor |
| `character_relationships` | 角色关系状态（当前关系图） | Writer |
| `world_state_changes` | 世界状态变化记录 | Writer |
| `consistency_reports` | 一致性检查报告 | Writer |
| `arc_summaries` | 弧摘要 | Editor |
| `volume_summaries` | 卷摘要 | Editor |
| `review_records` | 评审记录（含判定和原因） | Editor |
| `agent_sessions` | Agent 会话记录（每次调用的上下文） | 编排器 |
| `agent_decisions` | Agent 决策日志（工具调用记录） | 编排器 |
| `orchestration_log` | 编排器运行日志（状态转移、调度决策） | 编排器 |
| `system_state` | 系统当前状态快照（当前状态、当前弧ID、当前卷ID等） | 编排器 |

### 6.2 关键表结构

#### story_compass（故事指南针）

```sql
CREATE TABLE story_compass (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  -- 终局方向
  ending_direction TEXT DEFAULT '',
  -- 核心冲突
  core_conflict TEXT DEFAULT '',
  -- 故事主题
  theme TEXT DEFAULT '',
  -- 一句话梗概
  one_line_pitch TEXT DEFAULT '',
  -- 类型定位
  genre TEXT DEFAULT '',
  sub_genre TEXT DEFAULT '',
  -- 核心卖点
  selling_point TEXT DEFAULT '',
  -- 目标读者
  target_audience TEXT DEFAULT '',
  -- 情感基调
  emotional_tone TEXT DEFAULT '',
  -- 叙事视角
  narrative_pov TEXT DEFAULT '',
  -- 版本号（每次更新递增）
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### character_arcs（人物弧）

```sql
CREATE TABLE character_arcs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  character_id TEXT NOT NULL REFERENCES characters(id),
  -- 弧类型：positive_change / negative_change / flat / fall_redemption
  arc_type TEXT NOT NULL DEFAULT 'positive_change',
  -- 起点状态
  starting_state TEXT DEFAULT '',
  -- 终点状态
  ending_state TEXT DEFAULT '',
  -- 核心谎言/信念
  core_lie TEXT DEFAULT '',
  -- 核心真相
  core_truth TEXT DEFAULT '',
  -- 成长轨迹（JSON 数组：关键节点列表）
  transformation_nodes TEXT DEFAULT '[]',
  -- 弧跨度：project / volume / multi_volume
  span TEXT NOT NULL DEFAULT 'project',
  -- 关联卷/弧 ID
  volume_id TEXT,
  arc_id TEXT,
  -- 是否主角
  is_protagonist INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### volume_arcs（卷弧骨架）

```sql
CREATE TABLE volume_arcs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  volume_number INTEGER NOT NULL,
  volume_title TEXT DEFAULT '',
  arc_number INTEGER NOT NULL,
  arc_title TEXT DEFAULT '',
  -- 弧目标
  arc_goal TEXT DEFAULT '',
  -- 弧类型：setup / rising / climax / resolution / transition
  arc_type TEXT DEFAULT 'rising',
  -- 弧内章节数（计划）
  planned_chapters INTEGER NOT NULL DEFAULT 0,
  -- 弧内章节数（实际）
  actual_chapters INTEGER NOT NULL DEFAULT 0,
  -- 状态：planned / expanded / in_progress / completed
  status TEXT NOT NULL DEFAULT 'planned',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### arc_outlines / arc_chapter_plans（弧大纲）

```sql
CREATE TABLE arc_outlines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  arc_id TEXT NOT NULL REFERENCES volume_arcs(id),
  -- 弧的开端
  arc_opening TEXT DEFAULT '',
  -- 弧的转折点
  arc_midpoint TEXT DEFAULT '',
  -- 弧的高潮
  arc_climax TEXT DEFAULT '',
  -- 弧的结局
  arc_resolution TEXT DEFAULT '',
  -- 本弧伏笔清单（JSON）
  planned_foreshadowings TEXT DEFAULT '[]',
  -- 本弧人物弧推进计划
  character_arc_plan TEXT DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE arc_chapter_plans (
  id TEXT PRIMARY KEY,
  arc_id TEXT NOT NULL REFERENCES volume_arcs(id),
  chapter_number INTEGER NOT NULL,
  chapter_title TEXT DEFAULT '',
  -- 本章目标（一句话）
  chapter_goal TEXT DEFAULT '',
  -- 本章场景列表
  scenes TEXT DEFAULT '[]',
  -- 本章伏笔计划（埋下/推进/回收）
  foreshadowing_plan TEXT DEFAULT '[]',
  -- 本章 POV 人物
  pov_character_id TEXT,
  -- 预估字数
  estimated_words INTEGER DEFAULT 0,
  -- 状态：planned / written
  status TEXT NOT NULL DEFAULT 'planned',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### foreshadowing_ledger（伏笔台账）

```sql
CREATE TABLE foreshadowing_ledger (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  -- 伏笔名称/标签
  name TEXT NOT NULL,
  -- 伏笔内容描述
  content TEXT DEFAULT '',
  -- 伏笔类型：mystery / character / plot / world / relationship
  type TEXT NOT NULL DEFAULT 'plot',
  -- 重要性：major / minor / easter_egg
  importance TEXT NOT NULL DEFAULT 'minor',
  -- 计划埋下位置（弧ID/章序号）
  planned_plant_arc_id TEXT,
  planned_plant_chapter INTEGER,
  -- 计划推进位置列表（JSON）
  planned_progress_points TEXT DEFAULT '[]',
  -- 计划回收位置
  planned_payoff_arc_id TEXT,
  planned_payoff_chapter INTEGER,
  -- 实际状态：unplanned / planted / progressing / payed_off / abandoned
  status TEXT NOT NULL DEFAULT 'unplanned',
  -- 实际埋下位置
  actual_plant_chapter_id TEXT,
  -- 实际回收位置
  actual_payoff_chapter_id TEXT,
  -- 备注
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### chapter_summaries（章节摘要）

```sql
CREATE TABLE chapter_summaries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  chapter_id TEXT NOT NULL REFERENCES chapters(id),
  -- 摘要文本
  summary TEXT DEFAULT '',
  -- 本章关键事件
  key_events TEXT DEFAULT '[]',
  -- 下一章衔接提示
  next_chapter_hint TEXT DEFAULT '',
  -- 本章字数
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### character_state_snapshots（角色快照）

```sql
CREATE TABLE character_state_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  character_id TEXT NOT NULL REFERENCES characters(id),
  -- 快照来源：chapter / arc / volume
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  -- 当前状态描述
  state_description TEXT DEFAULT '',
  -- 当前位置
  current_location TEXT DEFAULT '',
  -- 当前目标
  current_goal TEXT DEFAULT '',
  -- 情绪状态
  emotional_state TEXT DEFAULT '',
  -- 持有物品/能力
  inventory TEXT DEFAULT '[]',
  -- 关键关系状态
  key_relationships TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### review_records（评审记录）

```sql
CREATE TABLE review_records (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  -- 评审类型：chapter / arc / volume
  review_type TEXT NOT NULL,
  -- 评审对象 ID
  target_id TEXT NOT NULL,
  -- 判定：pass / polish / rewrite_chapter / replan
  verdict TEXT NOT NULL,
  -- 评审意见
  opinion TEXT DEFAULT '',
  -- 打磨点（JSON 数组，verdict=polish 时）
  polish_points TEXT DEFAULT '[]',
  -- 重写原因（verdict=rewrite_chapter 时）
  rewrite_reason TEXT DEFAULT '',
  -- 重新规划建议（verdict=replan 时）
  replan_suggestion TEXT DEFAULT '',
  -- 评审维度得分（JSON）
  dimension_scores TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL
);
```

#### system_state（编排器状态）

```sql
CREATE TABLE system_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  project_id TEXT NOT NULL REFERENCES projects(id),
  -- 编排器状态
  orchestrator_state TEXT NOT NULL DEFAULT 'idle',
  -- 当前卷 ID
  current_volume_id TEXT,
  -- 当前弧 ID
  current_arc_id TEXT,
  -- 当前章 ID
  current_chapter_id TEXT,
  -- 当前 Agent
  active_agent TEXT,
  -- 是否暂停
  is_paused INTEGER NOT NULL DEFAULT 0,
  -- 自动模式
  auto_mode INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
```

---

## 7. Agent 工具集

### 7.1 工具调用协议

每个 Agent 的 LLM 通过 **Function Calling** 调用工具。二期在主进程中实现一个通用的工具执行器：

```typescript
interface ToolCall {
  tool: string
  arguments: Record<string, unknown>
}

interface AgentResponse {
  thinking: string        // LLM 的思考过程
  tool_calls: ToolCall[]  // 要执行的工具调用列表
  done: boolean           // 是否完成本轮任务
  summary: string         // 对人类可见的总结
}

// 编排器调用 Agent
async function invokeAgent(
  agentType: 'architect' | 'writer' | 'editor',
  context: AgentContext
): Promise<AgentResponse> {
  // 1. 组装 System Prompt + 上下文 + 工具列表
  // 2. 调用 LLM (with function calling)
  // 3. 解析响应：提取 tool_calls
  // 4. 执行工具调用（写入数据库）
  // 5. 如果 done=false，将工具结果反馈给 LLM 继续
  // 6. 记录 agent_decisions 到数据库
}
```

### 7.2 工具实现规范

每个工具在主进程中实现为：

```typescript
interface ToolDefinition {
  name: string
  description: string
  parameters: JSONSchema
  handler: (projectId: string, args: Record<string, unknown>) => Promise<ToolResult>
}

interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}
```

工具按 Agent 分组注册：

```typescript
const architectTools: ToolDefinition[] = [
  setStoryCompassTool,
  addTitleCandidateTool,
  createCharacterArcTool,
  createWorldRuleTool,
  createVolumeArcTool,
  createArcOutlineTool,
  createForeshadowingTool,
  createCharacterTool,
  createWorldbuildingTool,
  reportArchitectureDoneTool
]

const writerTools: ToolDefinition[] = [
  createChapterPlanTool,
  writeChapterBodyTool,
  updateCharacterStateTool,
  updateRelationshipTool,
  updateWorldStateTool,
  updateForeshadowingTool,
  createChapterSummaryTool,
  setNextChapterHintTool,
  consistencyCheckTool,
  reportChapterDoneTool
]

const editorTools: ToolDefinition[] = [
  reviewPassTool,
  reviewPolishTool,
  reviewRewriteChapterTool,
  reviewReplanTool,
  reviewNoteTool,
  generateArcSummaryTool,
  generateCharacterSnapshotTool,
  generateForeshadowingCarryoverTool,
  generateVolumeSummaryTool,
  updateStoryCompassTool
]
```

### 7.3 工具：set_story_compass 示例

```typescript
const setStoryCompassTool: ToolDefinition = {
  name: 'set_story_compass',
  description: '设定或更新故事指南针。可以部分更新（只传要改的字段）。',
  parameters: {
    type: 'object',
    properties: {
      ending_direction: { type: 'string', description: '终局方向' },
      core_conflict: { type: 'string', description: '核心冲突' },
      theme: { type: 'string', description: '故事主题' },
      one_line_pitch: { type: 'string', description: '一句话梗概' },
      genre: { type: 'string', description: '主类型' },
      sub_genre: { type: 'string', description: '子类型' },
      selling_point: { type: 'string', description: '核心卖点' },
      target_audience: { type: 'string', description: '目标读者' },
      emotional_tone: { type: 'string', description: '情感基调' },
      narrative_pov: { type: 'string', description: '叙事视角' }
    }
  },
  async handler(projectId, args) {
    // UPSERT story_compass
    // 版本号 +1
    // 记录到 agent_decisions
    return { success: true, data: { version: newVersion } }
  }
}
```

---

## 8. 示例：首弧完整流程

以用户说「我想写一个修真+科幻融合的废柴逆袭故事」为例，走一遍完整流程：

### 阶段 1：初始化 → 架构设计

```
编排器: IDLE → INITIALIZING → ARCHITECTING

编排器注入上下文给 Architect:
{
  user_input: "我想写一个修真+科幻融合的废柴逆袭故事",
  project_state: "新项目"
}

Architect 第 1 轮:
  thinking: "用户想要修真+科幻废柴逆袭，我需要先做创意收敛..."
  tool_calls: [
    { tool: "set_genre_positioning", args: { genre: "修真科幻", sub_genre: "废柴逆袭" } },
    { tool: "set_core_selling_point", args: { selling_point: "..." } }
  ]
  done: false

编排器执行工具 → 写入 DB → 结果反馈给 Architect

Architect 第 2 轮:
  thinking: "类型定位已确定，现在设计故事指南针..."
  tool_calls: [
    { tool: "set_story_compass", args: { ending_direction: "...", core_conflict: "...", theme: "..." } }
  ]
  done: false

Architect 第 3 轮:
  thinking: "指南针就绪，设计主角人物弧..."
  tool_calls: [
    { tool: "create_character_arc", args: { character_id: "...", arc_type: "positive_change", ... } }
  ]
  done: false

Architect 第 4-N 轮: 配角弧 → 世界规则 → 卷弧骨架 → 首弧细纲 → 伏笔规划

Architect 最终轮:
  tool_calls: [
    { tool: "report_architecture_done", args: { summary: "..." } }
  ]
  done: true

编排器检查: 指南针 ✓ 主角弧 ✓ 配角弧 ✓ 世界规则 ✓ 卷弧骨架 ✓ 首弧细纲 ✓ 伏笔 ✓
→ 转移到 WRITING
```

### 阶段 2：写作循环

```
编排器: WRITING

编排器注入上下文给 Writer:
{
  chapter_goal: "首弧第一章：主角在废品回收站发现神秘芯片",
  arc_goal: "首弧：建立世界观，主角获得金手指，埋下核心冲突伏笔",
  arc_chapter_plan: { chapter_number: 1, scenes: [...], foreshadowing_plan: [...] },
  character_states: { 主角: { 状态: "落魄", 位置: "废品回收站" }, ... },
  active_foreshadowings: [ { name: "远古芯片的来历", status: "unplanned" }, ... ],
  recent_context: "（首章无前文）",
  next_chapter_hint: "（首章无衔接提示）"
}

Writer 第 1 轮:
  thinking: "先制定章节计划..."
  tool_calls: [
    { tool: "create_chapter_plan", args: { scenes: [...], pacing: "...", pov: "主角" } }
  ]
  done: false

Writer 第 2 轮:
  thinking: "计划已定，开始写正文..."
  tool_calls: [
    { tool: "write_chapter_body", args: { content: "（章节正文）" } }
  ]
  done: false

Writer 第 3 轮:
  thinking: "正文完成，执行一致性检查..."
  tool_calls: [
    { tool: "consistency_check", args: { ... } }
  ]
  // 一致性检查可能触发小修改，然后继续

Writer 第 4 轮:
  thinking: "检查通过，产出章节摘要和状态更新..."
  tool_calls: [
    { tool: "create_chapter_summary", args: { summary: "...", key_events: [...] } },
    { tool: "update_character_state", args: { character_id: "主角", state: "获得芯片，疑惑中" } },
    { tool: "update_foreshadowing", args: { id: "...", status: "planted", chapter_id: "..." } },
    { tool: "set_next_chapter_hint", args: { hint: "芯片激活，主角发现异常能量波动" } },
    { tool: "report_chapter_done", args: {} }
  ]
  done: true

编排器检查: 弧内还有章节 → 继续 WRITING（下一章）
```

### 阶段 3：弧结束 → 评审

```
编排器: 弧内所有章节完成 → ARC_REVIEW_PENDING → ARC_REVIEW

编排器注入上下文给 Editor:
{
  review_type: "arc",
  arc_goal: "首弧：建立世界观，主角获得金手指，埋下核心冲突伏笔",
  arc_outline: { ... },
  chapters: [ { 摘要1 }, { 摘要2 }, ... ],
  character_arc_plan: { 主角: { 起点: "落魄", 目标: "觉醒" }, ... },
  actual_character_progression: [ { 章1: "落魄" }, { 章2: "获得芯片" }, ... ],
  foreshadowing_ledger: [ { 计划埋下3个, 实际埋下3个 }, ... ],
  world_state_changes: [ ... ],
  consistency_reports: [ ... ]
}

Editor 评审:
  thinking: "弧目标已完成，人物弧有推进，伏笔埋下3个，节奏合理..."
  tool_calls: [
    { tool: "review_pass", args: { 
      opinion: "首弧质量良好，世界建立清晰，读者期待已建立...",
      dimension_scores: { plot: 8, character: 7, pacing: 8, foreshadowing: 9, consistency: 9 }
    } },
    { tool: "generate_arc_summary", args: { ... } },
    { tool: "generate_character_snapshot", args: { ... } },
    { tool: "generate_foreshadowing_carryover", args: { ... } }
  ]
  done: true

编排器: 弧评审通过 → 弧摘要/角色快照/伏笔结转已生成 → 下一弧未展开 → NEXT_ARC_PLAN → ARCHITECTING
```

---

## 9. 实现计划

### 9.1 实现阶段

| 阶段 | 内容 | 关键产出 |
|------|------|----------|
| **P0: 数据模型** | 新增 20 张表的 schema + 迁移脚本 | 完整数据库 |
| **P1: 工具执行器** | 通用 ToolDefinition 框架 + 全部工具实现 | 工具集可调用 |
| **P2: Agent 引擎** | Agent 调用框架（Prompt 组装 + Function Calling + 多轮交互） | 三个 Agent 可独立运行 |
| **P3: 编排器状态机** | 状态机实现 + 边界条件评估 + 自动调度 | 自动滚动写作 |
| **P4: UI 面板** | 编排面板（启动/暂停/状态查看）+ 产物浏览 + 评审面板 | 可视化操作 |
| **P5: 集成测试** | 端到端测试：完整首弧自动生成 | 验证闭环 |

### 9.2 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 状态机 | 自实现（纯 TypeScript） | 状态少（~12 个），转移规则明确，无需引入 XState |
| Function Calling | OpenAI / Claude tool_use | 利用 LLM 原生 tool calling 能力 |
| Agent 多轮交互 | 主进程循环控制 | 编排器控制 Agent 的输入→工具执行→反馈循环 |
| 工具执行 | 主进程同步/异步 | 每个工具 = 一个 TypeScript 函数，直接操作 SQLite |

### 9.3 与一期代码的关系

- 一期 `electron/services/` 下的 CRUD 服务作为工具的基础设施
- 一期 `ai.service.ts` 的流式调用逻辑复用为 Agent LLM 调用的底层传输
- 一期 `memory.service.ts` 的 RAG 能力注入给 Writer 做上下文检索
- 一期 `characters`/`worldbuilding` 表被 Architect 通过 `create_character`/`create_worldbuilding` 工具写入
- 一期 `chapters` 表被 Writer 通过 `write_chapter_body` 工具写入

---

## 附录 A：关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| LLM 职责 | 决策 + 创作，不直接操作数据 | 通过工具调用保证数据一致性和可审计 |
| 状态机实现 | 自实现 | 状态少，规则明确，避免引入重依赖 |
| Agent 多轮 | 编排器控制循环 | 保证每次交互都有审计记录 |
| 伏笔台账 | 全生命周期追踪 | 从计划→埋下→推进→回收，完整可追溯 |
| 弧/卷/章 | 数据库表而非文件 | 结构化管理，支持查询和状态追踪 |

## 附录 B：典型问题场景

**Q: 如果 Writer 写了一章但 Editor 评审不通过怎么办？**
A: 编排器根据 Editor 的 verdict 决定：polish → Writer 打磨指定章节；rewrite_chapter → Writer 重写该章；replan → Architect 重新规划。不通过不会进入下一章。

**Q: 如果用户在写作过程中修改了设定怎么办？**
A: 编排器检测到设定变更后，在下次 Writer 调用时注入「设定变更通知」，并触发相关章节的一致性检查标记。

**Q: 滚动规划如何保证故事不偏离指南针？**
A: 每卷评审时 Editor 检查是否偏离指南针，必要时更新指南针（偏移记录），并在下一卷 Architect 规划时注入偏移信息。

**Q: 用户能否手动干预 Agent 产出？**
A: 编排器支持暂停模式，用户可以在任意状态下暂停、查看产物、手动修改，然后恢复自动模式。用户修改记录在 `orchestration_log` 中。