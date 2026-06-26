# 第三期：创作启动中心 / Story Bible 初始化中心

> 定位：编排写作流程之前的素材整理与需求收敛模块。
> 状态：✅ 全部后端服务 + StoryBiblePage UI + 24 个 IPC 通道已完成实现。
> 
> 未实现 UI 页面：ImportWizard.tsx、GuidedMode.tsx（导入解析与引导问答功能通过后端 API 可用，前端暂未实现独立页面）。
> 未实现 UI 组件：`src/components/bible/` 子目录下的 8 个组件（SectionEditor、FieldEditor、AiSidebar、ReadinessPanel、ImportDropzone、SegmentList、ConflictResolver、GuidedQuestionCard）均未创建，其功能已内联到 StoryBiblePage.tsx 或通过后端 API 提供。

---

## 一、整体架构

```
用户素材（手动输入 / Markdown 导入 / 粘贴文本）
        │
        ▼
┌─────────────────────────────────┐
│  素材解析与合并流程              │
│  ① 内容类型识别                 │
│  ② 候选信息抽取（保留来源）      │
│  ③ 重复/冲突检测                │
│  ④ 用户合并决策                 │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  Story Bible 编辑页（7 分区）    │
│  作品定位 / 故事指南针 / 世界设定 │
│  人物设定+人物弧 / 故事结构      │
│  伏笔与悬念 / 风格与约束         │
│                                  │
│  每项可：编辑 / AI 共创 / 标记   │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  启动准备度面板                  │
│  7 分区 × 4 级评估               │
│  足够 → 生成启动快照             │
│  不足 → 进入引导问答模式         │
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│  启动快照（锁定版本）            │
│  → 交给二期多 Agent 编排系统     │
└─────────────────────────────────┘
```

---

## 二、数据模型

### 2.1 新增表（5 张）

#### `story_bible_sections` — Story Bible 分区内容

```sql
CREATE TABLE IF NOT EXISTS story_bible_sections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,          -- positioning | compass | world | characters | structure | foreshadowing | style
  section_key TEXT NOT NULL,           -- 分区内字段键，如 'genre' / 'selling_point' / 'protagonist_arc'
  content TEXT DEFAULT '',             -- 正文内容
  status TEXT NOT NULL DEFAULT 'draft', -- draft | confirmed | pending | deprecated
  source_type TEXT DEFAULT 'manual',   -- manual | import | ai_suggest | guided
  source_ref TEXT DEFAULT '',          -- 来源引用，如 'import:世界设定.md#L23-45'
  ai_candidate TEXT DEFAULT '',        -- AI 共创的候选修改（用户确认前不覆盖 content）
  ai_candidate_mode TEXT DEFAULT '',   -- complete | question | variant | merge | compress | expand
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bible_section ON story_bible_sections(project_id, section_type, section_key);
```

#### `imported_documents` — 导入文档记录

```sql
CREATE TABLE IF NOT EXISTS imported_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,               -- 原始 Markdown 全文
  char_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | parsed | merged | ignored
  created_at INTEGER NOT NULL
);
```

#### `parsed_segments` — 解析后的文档片段

```sql
CREATE TABLE IF NOT EXISTS parsed_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES imported_documents(id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL,      -- 在原文中的顺序
  raw_text TEXT NOT NULL,              -- 原始文本片段
  detected_type TEXT NOT NULL,         -- world | character | plot | outline | volume | arc | chapter_draft | foreshadowing | style | taboo | inspiration | reference | unclassified
  confidence REAL DEFAULT 0,           -- AI 识别置信度 0-1
  target_section TEXT DEFAULT '',      -- 建议归入的 story_bible section_type
  target_key TEXT DEFAULT '',          -- 建议归入的 section_key
  merge_status TEXT NOT NULL DEFAULT 'pending', -- pending | merged | ignored | conflict | deprecated
  conflict_with TEXT DEFAULT '',       -- 冲突的已有 section id
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parsed_seg ON parsed_segments(project_id, document_id, merge_status);
```

#### `readiness_checks` — 准备度评估记录

```sql
CREATE TABLE IF NOT EXISTS readiness_checks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_type TEXT NOT NULL,
  level TEXT NOT NULL,                 -- sufficient | weak | insufficient | missing
  reason TEXT DEFAULT '',              -- 可解释的判断理由
  missing_items TEXT DEFAULT '[]',     -- 缺失项 JSON 数组
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readiness ON readiness_checks(project_id, created_at);
```

#### `launch_snapshots` — 启动快照

```sql
CREATE TABLE IF NOT EXISTS launch_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  snapshot_data TEXT NOT NULL,         -- 完整快照 JSON
  is_active INTEGER NOT NULL DEFAULT 1, -- 当前活跃快照
  created_at INTEGER NOT NULL
);
```

### 2.2 复用二期表

| 二期表 | 复用方式 |
|--------|----------|
| `story_compass` | Story Bible "故事指南针" 分区直接读写 |
| `title_candidates` | "作品定位" 分区的书名候选 |
| `characters` | "人物设定" 分区 |
| `character_arcs` | "人物设定" 分区的人物弧 |
| `world_rules` | "世界设定" 分区的世界规则 |
| `worldbuilding` | "世界设定" 分区的世界观词条 |
| `volume_arcs` | "故事结构" 分区的卷弧骨架 |
| `arc_outlines` | "故事结构" 分区的弧大纲 |
| `foreshadowing_ledger` | "伏笔与悬念" 分区 |

### 2.3 迁移逻辑

在 `runMigrations()` 中新增 5 张表的 `CREATE TABLE IF NOT EXISTS`（schema.ts 已用 IF NOT EXISTS，安全）。

---

## 三、服务层（6 个新服务文件）

### 3.1 `electron/services/story-bible.service.ts`

Story Bible 分区 CRUD + 统一读取/写入。

```typescript
// 读取整个 Story Bible（聚合 7 个分区）
export function getStoryBible(projectId: string): StoryBible

// 读取单个分区
export function getSection(projectId: string, sectionType: SectionType): StoryBibleSection

// 更新单个字段
export function updateField(projectId: string, sectionType: SectionType, sectionKey: string, content: string): void

// 更新字段状态
export function setFieldStatus(projectId: string, sectionType: SectionType, sectionKey: string, status: FieldStatus): void

// 设置 AI 候选修改（不覆盖原文）
export function setAiCandidate(projectId: string, sectionType: SectionType, sectionKey: string, candidate: string, mode: AiMode): void

// 接受 AI 候选（写入 content，清空 candidate）
export function acceptAiCandidate(projectId: string, sectionType: SectionType, sectionKey: string): void

// 拒绝 AI 候选
export function rejectAiCandidate(projectId: string, sectionType: SectionType, sectionKey: string): void
```

### 3.2 `electron/services/import.service.ts`

Markdown 导入 + 解析 + 合并。

```typescript
// 导入文档（存入 imported_documents）
export function importDocument(projectId: string, filename: string, content: string): ImportedDocument

// 列出已导入文档
export function listDocuments(projectId: string): ImportedDocument[]

// 解析文档：调用 LLM 识别内容类型，拆分为 parsed_segments
export async function parseDocument(projectId: string, documentId: string): Promise<ParsedSegment[]>

// 解析所有 pending 文档
export async function parseAllDocuments(projectId: string): Promise<void>

// 合并片段到 Story Bible（检测冲突）
export async function mergeSegments(projectId: string, segmentIds: string[]): Promise<MergeResult[]>

// 获取合并冲突列表
export function getConflicts(projectId: string): ConflictItem[]
```

### 3.3 `electron/services/bible-ai.service.ts`

Story Bible 专属 AI 共创（6 种模式）。

```typescript
export type AiCoCreateMode = 'complete' | 'question' | 'variant' | 'merge' | 'compress' | 'expand'

// 针对单个字段 AI 共创，输出候选修改（不覆盖原文）
export async function coCreate(
  projectId: string,
  sectionType: SectionType,
  sectionKey: string,
  mode: AiCoCreateMode,
  userMessage?: string
): Promise<string>  // 返回候选内容，存入 ai_candidate

// 引导问答模式：根据当前缺失项生成 3-5 个问题
export async function generateGuidedQuestions(projectId: string): Promise<GuidedQuestion[]>

// 处理用户引导问答，整理进 Story Bible
export async function processGuidedAnswers(
  projectId: string,
  answers: Array<{ questionId: string; answer: string }>
): Promise<void>
```

### 3.4 `electron/services/readiness.service.ts`

启动准备度评估。

```typescript
export type ReadinessLevel = 'sufficient' | 'weak' | 'insufficient' | 'missing'

export interface ReadinessResult {
  overall: 'can_launch' | 'suggest_supplement' | 'need_guidance' | 'inspiration_only'
  sections: Array<{
    section_type: SectionType
    level: ReadinessLevel
    reason: string
    missing_items: string[]
  }>
  can_force_launch: boolean  // 是否允许强行启动
}

// 评估当前准备度（基于 Story Bible 内容 + 规则 + LLM）
export async function evaluateReadiness(projectId: string): Promise<ReadinessResult>
```

### 3.5 `electron/services/launch.service.ts`

启动快照生成与版本管理。

```typescript
// 生成启动快照（聚合 Story Bible 全部确认内容）
export async function generateSnapshot(projectId: string): Promise<LaunchSnapshot>

// 获取当前活跃快照
export function getActiveSnapshot(projectId: string): LaunchSnapshot | null

// 锁定快照（标记为已启动，交给编排系统）
export function lockSnapshot(projectId: string, snapshotId: string): void

// 历史快照列表
export function listSnapshots(projectId: string): LaunchSnapshot[]
```

### 3.6 `electron/services/bible-parser.ts`

Markdown 解析器（不依赖 LLM 的规则引擎 + LLM 增强）。

```typescript
// 规则引擎：按标题层级、关键词、结构特征初步分类
export function parseByRules(content: string): ParsedSegment[]

// LLM 增强：对规则引擎的 unclassified 片段二次识别
export async function enhanceByLLM(segments: ParsedSegment[]): Promise<ParsedSegment[]>

// 检测冲突：对比新片段与已有 Story Bible 内容
export function detectConflicts(
  segments: ParsedSegment[],
  bible: StoryBible
): Array<{ segmentId: string; conflictWith: string; reason: string }>
```

---

## 四、IPC 通道（新增 24 个）

### `bible:` 命名空间（8 个）
```
bible:get              — 读取整个 Story Bible
bible:updateField      — 更新单个字段
bible:setStatus        — 设置字段状态
bible:setCandidate     — 设置 AI 候选
bible:acceptCandidate  — 接受 AI 候选
bible:rejectCandidate  — 拒绝 AI 候选
bible:coCreate         — AI 共创（6 模式）
bible:getReadiness     — 获取准备度评估
```

### `import:` 命名空间（6 个）
```
import:document        — 导入单个文档
import:listDocuments   — 列出已导入文档
import:parseDocument   — 解析单个文档
import:parseAll        — 解析所有 pending 文档
import:mergeSegments   — 合并片段到 Story Bible
import:getConflicts    — 获取冲突列表
```

### `guided:` 命名空间（2 个）
```
guided:getQuestions    — 获取引导问题
guided:submitAnswers   — 提交引导回答
```
> 注：`guided:skipQuestion` 为设计预留，未实现。

### `launch:` 命名空间（4 个）
```
launch:evaluate        — 评估准备度
launch:generateSnapshot — 生成启动快照
launch:getActiveSnapshot — 获取活跃快照
launch:lockAndStart    — 锁定快照并启动编排
```

### `bibleSegment:` 命名空间（3 个）
```
bibleSegment:list      — 列出解析片段
bibleSegment:updateStatus — 更新片段合并状态
bibleSegment:delete    — 删除片段
```

---

## 五、UI 组件设计

### 5.1 新增页面

#### `src/pages/StoryBiblePage.tsx` — Story Bible 主编辑页

布局：左侧分区导航 + 中间内容编辑 + 右侧 AI 共创侧边栏

```
┌─────────────┬──────────────────────────┬──────────────┐
│  分区导航    │  内容编辑区               │  AI 共创栏   │
│             │                          │              │
│ 📌 作品定位  │  [当前分区字段列表]       │  [对话历史]  │
│ 🧭 故事指南针│  ┌────────────────────┐  │              │
│ 🌍 世界设定  │  │ 字段名    [状态]   │  │  [模式选择]  │
│ 👤 人物设定  │  │ ┌────────────────┐ │  │  ○ 补全      │
│ 📖 故事结构  │  │ │ 编辑器         │ │  │  ○ 质疑      │
│ 🔮 伏笔悬念  │  │ └────────────────┘ │  │  ○ 变体      │
│ 🎨 风格约束  │  │ [AI候选: 待确认]   │  │  ○ 融合      │
│             │  │ [来源: xxx.md]     │  │  ○ 压缩      │
│ ──────────  │  └────────────────────┘  │  ○ 展开      │
│ 📊 准备度    │                          │              │
│ 📥 导入管理  │  [+ 添加字段]            │  [输入框]    │
└─────────────┴──────────────────────────┴──────────────┘
```

#### `src/pages/ImportWizard.tsx` — 导入向导页

```
┌──────────────────────────────────────────────────────┐
│  导入向导                                             │
├──────────────────────────────────────────────────────┤
│  Step 1: 选择导入方式                                 │
│  [拖拽 Markdown 文件到此处] 或 [粘贴文本]              │
├──────────────────────────────────────────────────────┤
│  Step 2: 已识别文档                                   │
│  📄 世界设定.md  (2,341 字)  [已解析] [查看]          │
│  📄 人物设定.md  (1,872 字)  [待解析] [解析]          │
├──────────────────────────────────────────────────────┤
│  Step 3: 解析结果                                     │
│  📄 世界设定.md → 12 个片段                           │
│    ✓ 世界背景 → world.background    [合并]            │
│    ✓ 权力结构 → world.power         [合并]            │
│    ⚠ 冲突: 魔法规则与已有 world.magic 冲突 [查看]     │
│    ? 未分类: "远古纪元..."           [手动归类]       │
├──────────────────────────────────────────────────────┤
│  Step 4: 合并确认                                     │
│  [全选] [合并选中] [让 AI 融合冲突项] [取消]          │
└──────────────────────────────────────────────────────┘
```

#### `src/pages/GuidedMode.tsx` — 引导问答页

```
┌──────────────────────────────────────────────────────┐
│  引导问答模式                                         │
│  当前准备度: 需要引导                                 │
├──────────────────────────────────────────────────────┤
│  Q1. 你的小说主要面向什么类型？                       │
│  ○ 玄幻  ○ 都市  ○ 科幻  ○ 历史  ○ 其他: [___]      │
│  [跳过] [交给 AI 决定]                                │
│                                                       │
│  Q2. 主角最核心的内在缺陷是什么？                     │
│  [_________________________________________]          │
│  [跳过] [交给 AI 决定]                                │
│                                                       │
│  Q3. 故事的终局大概往哪里走？                         │
│  [_________________________________________]          │
│  [跳过] [交给 AI 决定]                                │
├──────────────────────────────────────────────────────┤
│  [提交回答]  AI 将自动整理进 Story Bible              │
└──────────────────────────────────────────────────────┘
```

### 5.2 新增组件

> **注意**：以下组件为设计规划，当前均未创建独立文件，功能已内联到 `StoryBiblePage.tsx` 或通过后端 API 提供。

| 组件 | 位置 | 职责 | 状态 |
|------|------|------|------|
| `SectionEditor.tsx` | `src/components/bible/` | 单分区内容编辑器（字段列表 + 内联编辑 + 状态标记） | 未实现 |
| `FieldEditor.tsx` | `src/components/bible/` | 单字段编辑器（textarea + 状态徽章 + 来源 + AI 候选确认） | 未实现 |
| `AiSidebar.tsx` | `src/components/bible/` | AI 共创侧边栏（6 模式切换 + 对话 + 候选预览） | 未实现 |
| `ReadinessPanel.tsx` | `src/components/bible/` | 准备度面板（7 分区 × 4 级 + 总体评估 + 启动按钮） | 未实现 |
| `ImportDropzone.tsx` | `src/components/bible/` | 文件拖拽区 | 未实现 |
| `SegmentList.tsx` | `src/components/bible/` | 解析片段列表（合并状态操作） | 未实现 |
| `ConflictResolver.tsx` | `src/components/bible/` | 冲突解决器（对比 + 合并/替换/保留两版/废弃/AI 融合） | 未实现 |
| `GuidedQuestionCard.tsx` | `src/components/bible/` | 单个引导问题卡片 | 未实现 |

### 5.3 路由集成

在 `App.tsx` 的 `View` 类型新增 `'bible'`：

```typescript
type View = 'projects' | 'editor' | 'settings' | 'bible'
```

项目列表页每个项目卡片新增"创作启动中心"入口按钮，点击进入 `StoryBiblePage`。

---

## 六、AI 共创 6 模式实现

| 模式 | System Prompt 策略 | 输出 |
|------|-------------------|------|
| 补全 complete | "根据已有 Story Bible 上下文，补齐该字段的缺失内容" | 候选完整内容 |
| 质疑 question | "指出当前设定薄弱、冲突不足、动机不强的地方，以问题列表形式" | 问题列表 |
| 变体 variant | "给出 3 个不同方向的版本供选择" | 3 个候选 |
| 融合 merge | "把多个冲突设定融合成统一版本" | 融合后内容 |
| 压缩 compress | "把冗长设定整理成简洁可用的 Story Bible 条目" | 精简内容 |
| 展开 expand | "把一句灵感扩展成可用于编排的设定" | 扩展内容 |

所有 AI 输出存入 `ai_candidate` 字段，用户确认后才写入 `content`。

---

## 七、准备度评估规则

### 7.1 7 分区评估维度

| 分区 | sufficient 条件 | insufficient 触发 |
|------|----------------|-------------------|
| 作品定位 | 有类型 + 卖点 | 无类型 |
| 故事指南针 | 有终局方向 + 核心冲突 | 无终局方向 |
| 世界设定 | 有基础规则 | 完全空白 |
| 人物设定 | 有主角 + 主角弧方向 | 无主角 |
| 故事结构 | 有首弧目标 | 无首弧 |
| 伏笔悬念 | 有 ≥1 个伏笔 | 完全空白（weak） |
| 风格约束 | 有基本文风 | 完全空白（weak） |

### 7.2 总体评估

| 级别 | 条件 |
|------|------|
| `can_launch` | 所有 7 分区 ≥ weak，且前 5 分区 ≥ sufficient |
| `suggest_supplement` | 前 5 分区 ≥ weak，但有 1-2 个 insufficient |
| `need_guidance` | 前 5 分区有 ≥3 个 insufficient |
| `inspiration_only` | 大部分分区 missing/insufficient |

### 7.3 最低启动条件（允许强行启动）

- 作品定位（类型）
- 主角基础信息
- 主角人物弧方向
- 核心冲突
- 故事指南针（终局方向）
- 首弧目标

满足以上 6 项即可 `can_force_launch = true`。

---

## 八、引导问答模式

### 8.1 问题生成策略

每轮 3-5 个问题，优先补齐：

1. 作品类型和气质
2. 主角是谁
3. 主角想要什么
4. 主角缺什么（内在缺陷）
5. 核心冲突
6. 世界规则或背景
7. 故事终局方向
8. 第一弧要发生什么
9. 读者期待
10. 禁忌内容

### 8.2 流程

```
evaluateReadiness() → 识别缺失项
        ↓
generateGuidedQuestions() → 针对缺失项生成 3-5 问题
        ↓
用户回答（可跳过 / 交给 AI）
        ↓
processGuidedAnswers() → AI 整理回答写入 Story Bible
        ↓
重新 evaluateReadiness() → 达标则提示可启动
```

---

## 九、启动快照结构

```typescript
interface LaunchSnapshot {
  id: string
  project_id: string
  version: number
  created_at: number
  snapshot_data: {
    positioning: { ... }        // 作品定位
    compass: StoryCompass       // 故事指南针
    world_rules: WorldRule[]    // 世界规则
    worldbuilding: Worldbuilding[]
    characters: Character[]
    character_arcs: CharacterArc[]
    volume_arcs: VolumeArc[]    // 卷弧骨架
    arc_outlines: ArcOutline[]  // 首弧大纲
    foreshadowing: ForeShadowingEntry[]
    style_constraints: { ... }  // 风格约束
    taboos: string[]            // 禁忌
    inspirations: string[]      // 未确认灵感（可参考）
    missing_but_rolling: string[] // 允许后续滚动补全
  }
}
```

---

## 十、实施计划（10 步）

| 步骤 | 内容 | 依赖 |
|------|------|------|
| P3.1 | 数据模型：5 张新表 + 迁移 | 无 |
| P3.2 | `story-bible.service.ts`：分区 CRUD | P3.1 |
| P3.3 | `bible-parser.ts`：规则引擎 + LLM 增强 | P3.2 |
| P3.4 | `import.service.ts`：导入 + 解析 + 合并 | P3.2, P3.3 |
| P3.5 | `bible-ai.service.ts`：6 模式共创 + 引导问答 | P3.2 |
| P3.6 | `readiness.service.ts`：准备度评估 | P3.2 |
| P3.7 | `launch.service.ts`：启动快照 | P3.2, P3.6 |
| P3.8 | IPC 通道注册（24 个） | P3.2-P3.7 |
| P3.9 | UI 组件（8 个组件 + 3 个页面，仅 StoryBiblePage 完成，其余未实现） | P3.8 | 🟡 部分完成 |
| P3.10 | 集成测试 + 与二期编排衔接 | P3.9 |

---

## 十一、与二期编排系统的衔接

```
Story Bible 准备就绪
        ↓
generateSnapshot() → launch_snapshots 表
        ↓
lockAndStart() → 
  ① 锁定快照版本
  ② 将快照数据注入 system_state
  ③ 调用 orchestrator.start()
  ④ Architect 读取快照展开首弧
        ↓
二期编排系统接管
```

Architect Agent 的 `buildSystemPrompt` 将读取活跃快照作为上下文，确保编排基于锁定版本运行。
