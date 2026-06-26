# 长篇小说记忆型 AI 写作桌面系统 · 一期 PRD 与技术设计

> 版本：v1.0（一期）
> 日期：2026-06-22
> 状态：✅ 一期~四期核心后端已实现（部分 UI 页面/组件尚未独立拆分，打包发布未完成）
> 
> 实现状态：项目已超出 PRD 范围，额外实现了 Agent 编排系统（二期）、编排器加固（2.5 期）、Coordinator 长循环架构重构（三期）、Story Bible 初始化中心（三期）、叙事完整性与知识边界系统（四期）。部分 UI 组件内联在现有页面中未独立拆分，macOS/Windows 打包未执行。

---

## 目录

1. [产品概述](#1-产品概述)
2. [一期范围与功能清单](#2-一期范围与功能清单)
3. [技术架构](#3-技术架构)
4. [数据模型设计](#4-数据模型设计)
5. [核心模块详细设计](#5-核心模块详细设计)
6. [RAG 记忆系统设计（核心）](#6-rag-记忆系统设计核心)
7. [AI 辅助写作设计](#7-ai-辅助写作设计)
8. [IPC 接口设计](#8-ipc-接口设计)
9. [安全设计](#9-安全设计)
10. [目录结构与工程规范](#10-目录结构与工程规范)
11. [里程碑与交付计划](#11-里程碑与交付计划)
12. [风险与对策](#12-风险与对策)
13. [验收标准](#13-验收标准)

---

## 1. 产品概述

### 1.1 产品定位

面向长篇小说创作者的**本地优先**桌面写作系统。核心解决长篇创作中 AI「记不住前文、人物、设定」的痛点，通过 **RAG（检索增强生成）+ 结构化设定库**，让 AI 在续写、润色时能动态注入相关上下文，保持长篇一致性。

### 1.2 目标用户

- 网络小说作者、长篇小说创作者
- 痛点：篇幅长（几十万到几百万字）、人物多、设定复杂，传统 AI 工具上下文窗口装不下，导致人物性格漂移、设定矛盾
- 需要一个能「记住」整部小说的本地写作环境

### 1.3 核心价值

| 价值点 | 说明 |
|--------|------|
| 长期记忆 | 通过向量检索让 AI 跨章节记住前文、人物、设定 |
| 一致性保障 | 结构化设定库 + 上下文注入，减少人物/设定矛盾 |
| 本地优先 | 数据存储在本地，隐私可控；离线仍可写作（AI 功能需联网） |
| 沉浸写作 | 克制 UI，专注编辑器体验 |

### 1.4 非目标（一期不做，后续版本已实现）

- ~~云端同步与多端协作~~ — 二期+已实现 Agent 编排
- ~~多人协同编辑~~ — 三期已实现 Story Bible 初始化中心
- ~~移动端~~ — 四期已实现叙事完整性层
- 插件市场
- 出版排版（仅基础导出）

---

## 2. 一期范围与功能清单

### 2.1 功能清单

| 模块 | 功能点 | 优先级 |
|------|--------|--------|
| M1 项目与章节管理 | 多项目管理、卷/章节树、TipTap 编辑器、字数统计、导入导出 | P0 |
| M2 设定库 | 人物/地点/世界观 CRUD、@引用、关系展示 | P0 |
| M3 记忆与 RAG | 自动分块向量化、检索、上下文组装、记忆库可视化 | P0 |
| M4 AI 辅助写作 | 续写、润色、改写、对话式灵感、流式输出、会话管理 | P0 |
| M5 设置与基础 | API 配置加密、模型选择、主题、备份恢复 | P0 |
| M6 打包发布 | macOS/Windows 打包、签名 | P0 |

### 2.2 用户故事（核心场景）

**US-1：续写时保持人物一致**
> 作为作者，我在第 50 章续写时，AI 能记住主角在第 3 章受过的伤、第 20 章获得的武器，不会让主角凭空使用从未出现过的能力。

**US-2：设定变更后自动生效**
> 作为作者，我修改了「反派王某某」的性格设定后，后续 AI 续写中该人物的行为符合新设定。

**US-3：对话式查设定**
> 作为作者，我在侧边栏问「张三和李四什么关系」，AI 基于设定库和前文给出准确回答。

**US-4：离线写作**
> 作为作者，断网时我仍能正常写作、管理章节，仅 AI 功能不可用。

---

## 3. 技术架构

### 3.1 技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 桌面外壳 | Electron | 30+ | 跨 macOS/Windows |
| 前端框架 | React + TypeScript | 18 / 5.x | 渲染进程 UI |
| 构建工具 | Vite + electron-vite | 最新 | HMR，构建快 |
| UI 组件 | Tailwind CSS | 最新 | 自定义组件 + 克制风格 |
| 编辑器 | TipTap | 2.x | 基于 ProseMirror，支持自定义节点 |
| 状态管理 | Zustand | 4.x | 轻量 |
| 本地数据库 | SQLite（better-sqlite3） | — | 业务数据 |
| 向量检索 | sqlite-vec | 0.1.x | SQLite 扩展，本地向量检索 |
| Embedding | 云端 API | — | text-embedding-3-small 等 |
| LLM | 云端 API | — | OpenAI / Claude / 通义 |
| IPC | Electron contextBridge | — | 主↔渲染安全通信 |

### 3.2 系统架构

```
┌─────────────────────────────────────────────────────┐
│  Renderer Process (React UI)                         │
│  ┌──────────┬──────────┬──────────┬──────────┐      │
│  │ 项目树    │ 编辑器    │ 设定库    │ AI 面板  │      │
│  │ ProjectTree│ Editor  │ LorePanel│ AIPanel │      │
│  └──────────┴──────────┴──────────┴──────────┘      │
│           Zustand stores + IPC client                │
└───────────────────┬─────────────────────────────────┘
                    │ contextBridge (typed IPC)
┌───────────────────▼─────────────────────────────────┐
│  Main Process                                        │
│  ┌────────────┬────────────┬────────────┬─────────┐ │
│  │ProjectSvc  │ LoreSvc    │ MemorySvc  │ AISvc   │ │
│  │章节/卷 CRUD│设定 CRUD   │向量化+检索 │云端调用 │ │
│  └────────────┴────────────┴────────────┴─────────┘ │
│  ┌──────────────────────────────────────────────┐   │
│  │  SQLite + sqlite-vec (单文件)                │   │
│  │  projects | chapters | characters | ...      │   │
│  │  memory_chunks (含 embedding BLOB)           │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
                    │ HTTPS
┌───────────────────▼─────────────────────────────────┐
│  Cloud APIs                                          │
│  LLM (续写/润色/对话) + Embedding (向量化)           │
└──────────────────────────────────────────────────────┘
```

### 3.3 进程职责

**主进程（Main）**：
- 数据库读写（SQLite + sqlite-vec）
- 文件系统操作（导入导出、备份）
- 云端 API 调用（LLM + Embedding），含流式转发
- API Key 加密存储（safeStorage）
- 记忆分块、向量化、检索的执行

**渲染进程（Renderer）**：
- UI 渲染与交互
- 编辑器（TipTap）
- 通过 preload 暴露的类型化 IPC 调用主进程

**Preload**：
- 通过 contextBridge 暴露白名单 API，渲染进程无 Node 访问权

---

## 4. 数据模型设计

### 4.1 ER 概览

```
projects 1───* volumes 1───* chapters
projects 1───* characters
projects 1───* locations
projects 1───* worldbuilding
projects 1───* memory_chunks  (source 关联 chapters/characters/...)
projects 1───* ai_sessions 1───* ai_messages
(global) api_configs

二期~四期新增（已实现，详情参见各阶段设计文档）：
projects 1───* story_compass / title_candidates / character_arcs / world_rules
projects 1───* volume_arcs 1───* arc_outlines / arc_chapter_plans
projects 1───* foreshadowing_ledger / chapter_plans / chapter_summaries
projects 1───* character_state_snapshots / character_relationships
projects 1───* world_state_changes / consistency_reports / review_records
projects 1───* agent_sessions / agent_decisions
(1) system_state / (1) orchestration_log / (1) progress
projects 1───* story_bible_sections / imported_documents / parsed_segments
projects 1───* launch_snapshots / readiness_checks
projects 1───* chapter_contracts / knowledge_contracts / character_fact_locks
projects 1───* chapter_drafts / draft_gate_reports / draft_gate_verdicts
projects 1───* model_routing_rules / evaluation_cases
```

### 4.2 表结构

#### projects（项目）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| title | TEXT | 项目名 |
| summary | TEXT | 简介 |
| cover_path | TEXT | 封面图本地路径（可空） |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

#### volumes（卷）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| project_id | TEXT FK | 所属项目 |
| title | TEXT | 卷名 |
| sort_order | INTEGER | 排序 |

#### chapters（章节）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| volume_id | TEXT FK | 所属卷 |
| project_id | TEXT FK | 冗余，便于查询 |
| title | TEXT | 章节标题 |
| content | TEXT | 富文本 HTML |
| plain_text | TEXT | 纯文本（用于检索/字数） |
| sort_order | INTEGER | 排序 |
| word_count | INTEGER | 字数 |
| status | TEXT | draft/revising/done |
| created_at | INTEGER | |
| updated_at | INTEGER | |

#### characters（人物）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK | |
| name | TEXT | 姓名 |
| aliases | TEXT | 别名（JSON 数组） |
| role | TEXT | 主角/配角/反派/路人 |
| appearance | TEXT | 外貌 |
| personality | TEXT | 性格 |
| background | TEXT | 背景 |
| relations | TEXT | 关系（JSON：[{target, type, desc}]） |
| notes | TEXT | 备注 |
| updated_at | INTEGER | |

#### locations（地点）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK | |
| name | TEXT | |
| description | TEXT | |
| related_characters | TEXT | 关联人物 id（JSON 数组） |

#### worldbuilding（世界观词条）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK | |
| category | TEXT | 势力/规则/物品/历史/其他 |
| key | TEXT | 词条名 |
| value | TEXT | 内容 |

#### memory_chunks（记忆分块）— 核心
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK | |
| source_type | TEXT | chapter/character/location/lore |
| source_id | TEXT FK | 源记录 id |
| chunk_index | INTEGER | 同源分块序号 |
| content | TEXT | 分块文本 |
| token_count | INTEGER | token 数 |
| embedding | BLOB | 向量（float32 数组） |
| created_at | INTEGER | |
| updated_at | INTEGER | |

> sqlite-vec 使用虚拟表 `vec_memory_chunks` 关联 embedding 字段进行检索。

#### ai_sessions（AI 会话）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| project_id | TEXT FK | |
| type | TEXT | continue/polish/rewrite/chat |
| title | TEXT | |
| created_at | INTEGER | |

#### ai_messages（消息）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| session_id | TEXT FK | |
| role | TEXT | user/assistant/system |
| content | TEXT | |
| context_refs | TEXT | 注入的 chunk id（JSON） |
| created_at | INTEGER | |

#### api_configs（API 配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | |
| provider | TEXT | openai/claude/qwen/custom |
| base_url | TEXT | |
| api_key_enc | BLOB | safeStorage 加密后的密文 |
| llm_model | TEXT | |
| embedding_model | TEXT | |
| is_active | INTEGER | 0/1 |

### 4.3 索引

- `chapters(project_id, sort_order)`
- `memory_chunks(project_id, source_type, source_id)`
- `memory_chunks(project_id)` + vec 虚拟表
- `characters(project_id, name)`
- `ai_messages(session_id, created_at)`

---

## 5. 核心模块详细设计

### 5.1 项目与章节管理（M1）

**功能**：
- 项目列表（左侧切换），每个项目独立 SQLite 数据隔离（按 project_id）
- 卷/章节树形结构，支持拖拽排序、右键菜单（新增/重命名/删除/移动）
- TipTap 编辑器：
  - 节点：标题、段落、引用块、章节分隔、设定引用（自定义 node，存 source_id）
  - 快捷键：Ctrl/Cmd+S 手动保存（默认自动保存，防抖 2s）
- 字数统计：实时统计 plain_text 字数
- 导入：.txt / .md（按分隔符拆章节）
- 导出：单章/全书 .md / .txt（.docx 二期）

**自动保存**：编辑器内容变更防抖 2s 后写库，同时更新 plain_text 与 word_count。

### 5.2 设定库（M2）

**人物档案**：
- 列表 + 详情双栏
- 字段：姓名、别名、身份、外貌、性格、背景、关系网、备注
- 关系网：可视化（一期用简单列表 + 文字描述，二期图可视化）

**地点设定**：名称、描述、关联人物

**世界观词条**：按 category 分组（势力/规则/物品/历史/其他），键值对形式

**@引用**：
- 编辑器输入 `@` 弹出设定选择器（人物/地点/世界观）
- 选中后插入自定义引用节点，存 source_type + source_id
- 引用关系可反查（哪些章节引用了某设定）

**设定变更联动**：设定保存后，触发对应 memory_chunk 重建（见 M3）。

### 5.3 记忆与 RAG（M3）— 见第 6 节详述

### 5.4 AI 辅助写作（M4）— 见第 7 节详述

### 5.5 设置与基础（M5）

- API 配置：多 provider，api_key 用 safeStorage 加密
- 模型选择：写作 LLM 模型 / Embedding 模型分别配置
- 主题：浅色/深色/护眼
- RAG 参数：top-K、上下文 token 预算、是否启用设定注入
- 备份/恢复：导出/导入整个 SQLite 文件

---

## 6. RAG 记忆系统设计（核心）

### 6.1 分块策略

| 数据源 | 分块方式 | 目标 token |
|--------|----------|------------|
| 章节正文 | 按段落 + 滑动窗口，重叠 50 token | 300-500 token/块 |
| 人物档案 | 整条记录拼成一块（姓名+别名+各字段） | — |
| 地点设定 | 整条一块 | — |
| 世界观词条 | 整条一块 | — |

**章节分块算法**：
```
1. 取 chapter.plain_text
2. 按段落（\n\n）切分
3. 累积段落直到 token_count 达到 ~400
4. 若超出，当前段作为一块；下一块从上一块末尾回退 50 token 开始（滑动重叠）
5. 记录 chunk_index
```

### 6.2 向量化时机

| 触发事件 | 动作 |
|----------|------|
| 章节保存（防抖后） | 删除该章节旧 chunks → 重新分块 → 调 embedding API → 写入 |
| 设定条目保存 | 删除该条目旧 chunk → 重新生成 → embedding → 写入 |
| 手动「重建记忆库」 | 全项目重新分块向量化（进度条提示） |

**增量更新**：只处理变更源，避免全量重建的高成本。

### 6.3 检索流程

```
输入：query_text（如光标前 1000 字）+ project_id
  │
  ▼
1. query_text → embedding API → query_vec
  │
  ▼
2. sqlite-vec 检索：
   SELECT id, source_type, source_id, content, distance
   FROM vec_memory_chunks
   WHERE project_id = ?
   ORDER BY embedding <-> query_vec
   LIMIT topK  (默认 topK=15)
  │
  ▼
3. 结果分组：
   - chapter 片段：按相似度取 top-5
   - character：top-3
   - location：top-2
   - lore：top-3
  │
  ▼
4. 附加必选项：
   - 当前章节最近 2000 字（不参与检索，直接注入）
  │
  ▼
5. Token 预算裁剪（默认 ≤ 4000 token）：
   优先级：当前章节 > 高相似度 chapter > character > lore > location
   超预算则从低优先级/低相似度裁剪
  │
  ▼
6. 输出：context_chunks[] + context_refs[]（用于 ai_messages.context_refs）
```

### 6.4 上下文组装与 Prompt 模板

**续写 Prompt 模板**：
```
[System]
你是一位专业的小说创作助手。请根据以下小说设定与前文，续写故事。
要求：
1. 严格保持人物性格、关系、设定的连贯性
2. 语言风格与前文一致
3. 不要重复前文内容
4. 续写约 500-800 字

[Context - 设定]
## 人物
{characters_content}

## 世界观
{lore_content}

## 地点
{locations_content}

[Context - 前文]
## 当前章节最近内容
{current_chapter_tail}

## 相关前文片段
{retrieved_chapter_chunks}

[User]
请续写以下内容：
{cursor_before_text}
```

**润色 Prompt 模板**：
```
[System]
你是专业文字编辑。请润色以下选中的文本，风格：{style}。
保持原意，不改变情节，仅优化表达。

[Context - 相关设定与前文]
{rag_context}

[User]
请润色：
{selected_text}
```

**对话 Prompt 模板**：
```
[System]
你是小说创作助手。基于以下小说设定与前文回答作者问题。
若信息不足，明确说明，不要编造设定。

[Context]
{rag_context}

[Conversation History]
{messages}

[User]
{user_input}
```

### 6.5 记忆库可视化

- 独立页面：列出当前项目所有 memory_chunks
- 按 source_type 筛选
- 显示：源、内容预览、token 数、更新时间
- 操作：删除单块、重建单源、全量重建（带进度）

### 6.6 RAG 参数配置

| 参数 | 默认 | 说明 |
|------|------|------|
| topK | 15 | 初检数量 |
| chapter_top | 5 | 章节片段最终数 |
| character_top | 3 | |
| location_top | 2 | |
| lore_top | 3 | |
| foundation_top | 8 | 导入文档片段（后增） |
| context_token_budget | 8000 | 上下文 token 上限（已从 4000 提升） |
| current_chapter_tail_chars | 2000 | 当前章节必选字数 |
| enable_lore_injection | true | 是否注入设定 |

---

## 7. AI 辅助写作设计

### 7.1 功能列表

| 功能 | 触发 | 输入 | 输出 |
|------|------|------|------|
| 续写 | 光标处按钮/快捷键 | 光标前文本 + RAG | 流式插入编辑器 |
| 润色 | 选中文本 → 菜单 | 选中文本 + 风格 + RAG | 替换选中文本 |
| 改写 | 选中文本 → 菜单 | 选中文本 + RAG | 替换选中文本 |
| 对话 | 侧边栏 | 用户输入 + @引用 + RAG | 流式回复 |

### 7.2 流式输出

- 主进程通过 fetch + ReadableStream 读取云端 SSE
- 通过 IPC `onAIToken` 事件推送到渲染进程
- 渲染进程实时更新编辑器/对话气泡
- 支持「停止」按钮：AbortController 中断请求

### 7.3 会话管理

- 每次续写/润色/改写记录为一条 ai_session（type 区分）
- 对话式灵感为持久会话，可继续
- 会话历史可回看，含注入的 context_refs

### 7.4 错误处理

| 场景 | 处理 |
|------|------|
| 网络错误 | 提示重试，保留用户输入 |
| API 限流 | 指数退避重试 1 次，仍失败提示 |
| Token 超限 | 自动降低 context_token_budget 重试 |
| API Key 无效 | 引导去设置页配置 |

---

## 8. IPC 接口设计

> 更新：实际 IPC 接口已大幅扩展。一期基础 15 个通道，当前共有 100+ 个通道，分属 24 个命名空间（system/project/volume/chapter/character/location/worldbuilding/memory/ai/config/settings/orchestrator/bible/import/guided/launch/bibleSegment/contract/factLock/draft/gate/routing/integrity/event）。完整定义见 `shared/ipc-api.ts`。

### 8.1 接口分组

```typescript
// 项目
project.list(): Project[]
project.create(input): Project
project.get(id): Project
project.update(id, input): void
project.delete(id): void

// 卷
volume.list(projectId): Volume[]
volume.create(input): Volume
volume.reorder(id, newOrder): void

// 章节
chapter.list(volumeId): Chapter[]
chapter.get(id): Chapter
chapter.create(input): Chapter
chapter.update(id, input): void   // 触发记忆重建
chapter.delete(id): void
chapter.reorder(id, newOrder): void
chapter.import(projectId, file): void
chapter.export(chapterIds, format): void

// 设定
character.list(projectId): Character[]
character.create/update/delete(...)
location.* / worldbuilding.*

// 记忆
memory.listChunks(projectId, filter): MemoryChunk[]
memory.rebuildSource(sourceType, sourceId): void
memory.rebuildAll(projectId, onProgress): void   // 进度通过事件
memory.deleteChunk(id): void
memory.getStats(projectId): { totalChunks, totalTokens }

// AI
ai.continue(params): void   // 流式，通过 onAIToken 事件
ai.polish(params): void
ai.rewrite(params): void
ai.chat(sessionId, message): void
ai.stop(): void
ai.listSessions(projectId): Session[]
ai.getMessages(sessionId): Message[]

// 事件
on(event: 'aiToken' | 'aiDone' | 'aiError' | 'memoryProgress', cb): () => void

// 设置
config.getApiConfigs(): ApiConfig[]   // 不含明文 key
config.saveApiConfig(input): void
config.testApiConfig(id): { ok, message }
config.getRagParams(): RagParams
config.setRagParams(params): void
config.backup(filePath): void
config.restore(filePath): void
```

### 8.2 安全约束

- 渲染进程无 Node 访问权（nodeIntegration: false, contextIsolation: true）
- 仅通过 preload 白名单 API 通信
- API Key 仅在主进程解密使用，永不返回渲染进程

---

## 9. 安全设计

| 风险 | 措施 |
|------|------|
| API Key 泄露 | Electron safeStorage（系统钥匙串）加密存储，不明文落库 |
| 渲染进程越权 | contextIsolation: true，nodeIntegration: false，preload 白名单 |
| 云端请求伪造 | 仅允许配置的 base_url，不执行远程脚本 |
| 数据丢失 | 自动备份提示 + 手动导出 SQLite |
| 第三方内容 | 一期不加载远程网页，CSP 严格限制 |

---

## 10. 目录结构与工程规范

### 10.1 目录结构

```
novel_tool/
├─ electron/                  主进程
│  ├─ main.ts                 入口
│  ├─ preload.ts              contextBridge
│  ├─ db/
│  │  ├─ index.ts             better-sqlite3 初始化（含 sqlite-vec 扩展加载）
│  │  └─ schema.ts            建表语句（含一~四期全部表，共 40+ 张）
│  ├─ services/               业务逻辑服务（35 个文件）
│  │  ├─ project.service.ts   项目 CRUD
│  │  ├─ volume.service.ts    卷 CRUD
│  │  ├─ chapter.service.ts   章节 CRUD
│  │  ├─ character.service.ts 人物 CRUD
│  │  ├─ location.service.ts  地点 CRUD
│  │  ├─ worldbuilding.service.ts  世界观 CRUD
│  │  ├─ memory.service.ts    分块/向量化/检索
│  │  ├─ ai.service.ts        云端调用/流式
│  │  ├─ embedding.service.ts embedding API
│  │  ├─ config.service.ts    API 配置
│  │  ├─ settings.service.ts  设置管理
│  │  ├─ agent-engine.ts      Agent 调用框架（Function Calling + 多轮）
│  │  ├─ orchestrator.ts      编排器状态机（16 状态，兼容旧 API）
│  │  ├─ host.ts              Coordinator 长循环 Host（薄外壳）
│  │  ├─ flow-router.ts       Flow Router 纯函数调度
│  │  ├─ flow-dispatcher.ts   事件驱动派发器
│  │  ├─ reminder.ts          每轮 Reminder 生成器
│  │  ├─ coordinator.prompt.ts Coordinator System Prompt
│  │  ├─ compaction.ts        上下文压缩
│  │  ├─ tool-executor.ts     工具执行框架
│  │  ├─ contract.service.ts 契约管理
│  │  ├─ fact-lock.service.ts 事实锁管理
│  │  ├─ draft.service.ts     草稿生命周期
│  │  ├─ draft-gate.service.ts 门禁检查（7 项）
│  │  ├─ model-router.service.ts 模型路由
│  │  ├─ evaluator.service.ts  评估器
│  │  ├─ evaluation-cases.service.ts 评估用例
│  │  ├─ story-bible.service.ts    Story Bible CRUD
│  │  ├─ bible-ai.service.ts        AI 共创（6 模式）
│  │  ├─ bible-parser.ts            Markdown 解析器
│  │  ├─ import.service.ts          文档导入/解析/合并
│  │  ├─ readiness.service.ts       准备度评估
│  │  ├─ launch.service.ts          启动快照
│  │  ├─ launch-bootstrap.service.ts Launch 引导
│  │  └─ tools/                  Agent 工具定义
│  │     ├─ architect.tools.ts
│  │     ├─ writer.tools.ts
│  │     └─ editor.tools.ts
│  ├─ ipc/
│  │  └─ register.ts          IPC handler 注册（20+ 命名空间，100+ 通道）
│  └─ lib/
│     ├─ chunk.ts             文本分块
│     ├─ crypto.ts            safeStorage 封装
│     ├─ semantic.ts          语义分析
│     ├─ token.ts             token 估算
│     └─ util.ts              通用工具
├─ src/                       渲染进程
│  ├─ main.tsx                React 入口
│  ├─ App.tsx                 路由
│  ├─ pages/
│  │  ├─ ProjectList.tsx       项目列表
│  │  ├─ EditorPage.tsx        编辑器主页（树+编辑器+AI面板+完整性面板）
│  │  ├─ StoryBiblePage.tsx    Story Bible 编辑页
│  │  ├─ OrchestrationPage.tsx 编排控制面板
│  │  ├─ MemoryPage.tsx        记忆库可视化
│  │  └─ Settings.tsx          设置页
│  ├─ components/
│  │  ├─ Editor.tsx            TipTap 编辑器
│  │  ├─ ChapterTree.tsx       卷/章节树
│  │  ├─ AIPanel.tsx           AI 侧边面板
│  │  ├─ OrchestratorPanel.tsx 编排器状态面板
│  │  └─ IntegrityPanel.tsx    叙事完整性面板
│  ├─ stores/
│  │  ├─ editor.store.ts       Zustand
│  │  ├─ host.store.ts
│  │  └─ orchestrator.store.ts
│  └─ styles/
│     └─ index.css             Tailwind + 自定义样式
├─ shared/                    主/渲染共享类型与常量
│  ├─ types.ts                 全部 TypeScript 类型（1035 行，涵盖一~四期）
│  └─ ipc-api.ts               IPC API 接口定义（24 个命名空间）
├─ docs/                       设计文档（9 个）
├─ tests/                      测试文件（11 个）
├─ scripts/
│  └─ dev.sh                   开发启动脚本
├─ example/                    示例小说素材
├─ electron.vite.config.ts
├─ package.json
├─ tsconfig.json
├─ tailwind.config.js
└─ vitest.config.ts
```

### 10.2 工程规范

- TypeScript strict 模式
- 共享类型放 `shared/`，主/渲染共用
- IPC 接口类型化：preload 暴露的 API 有完整 TS 类型
- 提交前：`npm run typecheck`

---

## 11. 里程碑与交付计划

| 里程碑 | 内容 | 交付物 | 验收 |
|--------|------|--------|------|
| **M0 脚手架** | electron-vite + React + TS + Tailwind + shadcn + SQLite + sqlite-vec 跑通；IPC 类型化；DB schema 初始化 | 可运行空壳 | ✅ 已完成 |
| **M1 项目与编辑器** | 项目/卷/章节 CRUD + 树形 UI + TipTap + 字数统计 + 导入导出 | 可独立写作 | ✅ 已完成 |
| **M2 设定库** | 人物/地点/世界观 CRUD + @引用 + 关系展示 | 设定可管理 | ✅ 已完成 |
| **M3 记忆与 RAG** | 分块 + embedding + sqlite-vec 检索 + 上下文组装 + 记忆库可视化 | 核心能力 | ✅ 已完成 |
| **M4 AI 写作** | 续写/润色/改写/对话 + 流式 + 会话管理 + API 配置加密 | 完整闭环 | ✅ 已完成 |
| **M5 打包发布** | macOS/Windows 打包、签名、备份恢复、设置 | 可分发 | 🚧 未完成（开发阶段，未做打包） |
| **M6 Agent 编排（二期）** | 三 Agent 系统 + 状态机 + 工具调用 | 自动协作写作 | ✅ 已完成 |
| **M7 编排加固（2.5 期）** | 崩溃恢复 + AbortController + Checkpoint | 稳定运行 | ✅ 已完成 |
| **M8 Story Bible（三期）** | 7 分区 + 导入解析 + AI 共创 + 准备度评估 | 写作素材中心 | ✅ 已完成 |
| **M9 叙事完整性（四期）** | 契约锁 + 事实锁 + 草稿门禁 + 知识边界 + 模型路由 | 质量保障 | ✅ 已完成 |

---

## 12. 风险与对策

| 风险 | 等级 | 对策 |
|------|------|------|
| sqlite-vec 在 Electron 中 native 编译跨平台打包失败 | 高 | 优先用 prebuilt 二进制；M0 阶段优先验证双平台打包 |
| 长篇全量向量化慢、API 成本高 | 中 | 增量更新；设定变更只更新对应 chunk；提供重建进度 |
| 上下文 token 超限 | 中 | 组装时按 token 预算裁剪；超限自动降预算重试 |
| API Key 安全 | 中 | safeStorage 加密；不明文返回渲染进程 |
| 云端 API 依赖网络 | 中 | 一期明确联网使用；离线禁用 AI 但保留写作 |
| TipTap 自定义节点（设定引用）复杂度 | 中 | 一期引用节点仅存元数据，不做复杂渲染 |
| better-sqlite3 与 Electron 版本兼容 | 中 | 锁定版本，按 Electron 版本 rebuild |

---

## 13. 验收标准

### 13.1 功能验收

- [x] 可创建/切换多个小说项目，数据相互隔离
- [x] 卷/章节树形管理，拖拽排序正常
- [x] TipTap 编辑器可写作，自动保存，字数统计正确
- [x] 人物/地点/世界观 CRUD 完整，编辑器可 @引用
- [x] 章节保存后自动分块向量化（可在记忆库页面查看）
- [x] 设定变更后对应记忆 chunk 自动更新
- [x] 续写功能能注入前文与设定，流式输出，可中断
- [x] 润色/改写能替换选中文本
- [x] 对话式灵感可 @引用设定，会话可保存回看
- [x] API Key 加密存储，不泄露
- [ ] macOS/Windows 安装包可正常运行
- [x] 备份/恢复正常

### 13.2 质量验收

- [x] TypeScript strict 无报错
- [x] TypeScript typecheck 无错误
- [ ] 主进程崩溃率 < 0.5%
- [ ] 10 万字项目下，单次续写响应（含检索）< 8s

---

## 附录 A：关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 向量库 | sqlite-vec | 与 SQLite 同库，零额外服务，本地优先 |
| 编辑器 | TipTap | ProseMirror 生态，支持自定义节点 |
| 状态管理 | Zustand | 轻量，够用 |
| AI 接入 | 仅云端 API | 一期简化，效果好 |
| 数据存储 | 单 SQLite 文件 | 备份恢复简单 |

## 附录 B：后续规划

以下功能尚未实现，属于未来规划：

- 本地模型支持（Ollama）
- 关系网图可视化
- 大纲/时间线管理
- 多端同步
- .docx 导出与排版
- 插件系统
- macOS/Windows 安装包打包发布
