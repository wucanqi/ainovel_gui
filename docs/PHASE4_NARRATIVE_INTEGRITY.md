# 第四期：叙事一致性与知识边界系统
> Narrative Integrity Layer
> 状态：✅ P0 全部实现（7 张新表 + 6 个服务 + 20 个 IPC 通道 + 编排器状态机改造）
> 
> 未实现 UI 页面：IntegrityDashboard.tsx（完整性仪表盘，当前使用 IntegrityPanel.tsx 组件嵌入 EditorPage）。
> 
> 未实现 UI 组件：`src/components/integrity/` 子目录下的 6 个组件（ContractEditor、FactLockManager、DraftGateReport、DraftLifecycleBadge、ModelRoutingConfig、EvaluationRunner）均未创建独立文件，功能已内联到 IntegrityPanel.tsx 或通过后端 API 提供。
> P1 模型路由、Plan Gate、评估器、Pro Arbiter 均已实现。

---

## 一、目标与定位

### 1.1 核心问题

| 问题 | 根因 | 第四期对策 |
|------|------|-----------|
| 人物职业/身份漂移 | Writer 自由发挥，无硬约束 | character_fact_locks 事实锁 |
| 角色知道不该知道的事 | 无知识边界概念 | knowledge_contract 知识契约 |
| Writer 预感未来剧情 | Writer 能看到作者层信息 | author_only_facts 隔离 + forbidden_inferences |
| 未授权伏笔/暗示 | 伏笔无白名单 | allowed_foreshadow_ids 白名单 |
| 错误草稿污染记忆 | Writer 直接 commit，无门禁 | Draft Gate + 草稿隔离 |
| Flash 模型漂移多 | 无模型路由 | model_routing_rules 路由策略 |

### 1.2 设计原则

1. **能用代码保证的流程，必须用代码保证** — 不把所有规则写进 prompt
2. **Writer 不能拥有最终提交权** — Writer 只能申请完成，Orchestrator 负责 commit
3. **错误草稿不能污染长期记忆** — 未通过门禁的 draft 不进入 RAG/summary/state/foreshadow
4. **区分作者知识、读者知识、角色知识** — 三层知识隔离
5. **伏笔必须白名单化** — 不在 allowed_foreshadow 中的暗示默认视为幻觉
6. **Flash 负责产能，Pro 负责仲裁** — 不让 Pro 变成默认写手

### 1.3 与前三期的关系

```
一期（写作环境）──┐
二期（Agent 编排）──┼──→ 第四期（叙事完整性层）插入 Writer 与 commit 之间
三期（Story Bible）──┘

具体接入点：
① 三期启动快照 → 生成初始 character_fact_locks
② 二期 Architect 生成弧大纲后 → 新增 chapter_contract + knowledge_contract 生成步骤
③ 二期 Writer write_chapter_body → 改为写 draft（不直接更新 chapters 表）
④ 二期 report_chapter_done → 改为 request_draft_review（触发 Draft Gate）
⑤ 二期 notifyChapterDone → 改为 commit_chapter（门禁通过后才执行）
⑥ 二期 create_chapter_summary 等记忆写入 → 只允许在 commit 后执行
```

---

## 二、新增数据表设计（7 张）

### 2.1 `chapter_contracts` — 章节契约

```sql
CREATE TABLE IF NOT EXISTS chapter_contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  arc_id TEXT,
  required_beats TEXT NOT NULL DEFAULT '[]',      -- JSON 数组：必须完成的剧情节拍
  forbidden_moves TEXT NOT NULL DEFAULT '[]',     -- JSON 数组：禁止发生的剧情动作
  continuity_checks TEXT NOT NULL DEFAULT '[]',   -- JSON 数组：必须核对的连续性项
  emotion_target TEXT DEFAULT '',                  -- 情绪目标
  payoff_points TEXT NOT NULL DEFAULT '[]',       -- JSON 数组：需兑现的爽点/谜题/关系变化
  hook_goal TEXT DEFAULT '',                       -- 章末钩子目标
  allowed_foreshadow_ids TEXT NOT NULL DEFAULT '[]', -- JSON 数组：允许使用的伏笔白名单
  hard_constraints TEXT NOT NULL DEFAULT '[]',    -- JSON 数组：硬性限制
  status TEXT NOT NULL DEFAULT 'active',           -- active | fulfilled | violated | superseded
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contract_chapter ON chapter_contracts(chapter_id);
```

### 2.2 `knowledge_contracts` — 知识契约

```sql
CREATE TABLE IF NOT EXISTS knowledge_contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  pov_character_id TEXT,
  known_facts TEXT NOT NULL DEFAULT '[]',          -- JSON 数组：POV 角色已知事实
  unknown_facts TEXT NOT NULL DEFAULT '[]',        -- JSON 数组：POV 角色未知事实
  author_only_facts TEXT NOT NULL DEFAULT '[]',    -- JSON 数组：作者层知道但角色不能知道
  reader_visible_facts TEXT NOT NULL DEFAULT '[]', -- JSON 数组：读者当前可知道
  allowed_reveals TEXT NOT NULL DEFAULT '[]',      -- JSON 数组：本章允许揭示的信息
  forbidden_inferences TEXT NOT NULL DEFAULT '[]', -- JSON 数组：禁止的推断/预感/梦境/宿命感
  allowed_foreshadow_ids TEXT NOT NULL DEFAULT '[]', -- JSON 数组：伏笔白名单（与 chapter_contract 同步）
  priority TEXT NOT NULL DEFAULT 'absolute',       -- absolute | high | normal
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kcontract_chapter ON knowledge_contracts(chapter_id);
```

### 2.3 `character_fact_locks` — 人物事实锁

```sql
CREATE TABLE IF NOT EXISTS character_fact_locks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,                          -- occupation | gender | organization | ability_boundary | identity | species | age_range
  fact_value TEXT NOT NULL,
  lock_level TEXT NOT NULL DEFAULT 'soft',         -- immutable | event_required | soft
  change_requires_event INTEGER NOT NULL DEFAULT 0, -- 0=否 1=是
  allowed_change_events TEXT NOT NULL DEFAULT '[]', -- JSON 数组：允许变更的事件类型
  last_verified_chapter_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_factlock_unique ON character_fact_locks(character_id, fact_key);
```

### 2.4 `chapter_drafts` — 章节草稿（隔离区）

```sql
CREATE TABLE IF NOT EXISTS chapter_drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL,                           -- HTML 正文
  plain_text TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  lifecycle TEXT NOT NULL DEFAULT 'draft_generated', -- draft_generated | plan_checked | draft_checked | draft_rejected | draft_revised | final_committed | indexed_to_memory
  model_used TEXT DEFAULT '',                       -- 使用的模型
  generated_at INTEGER NOT NULL,
  committed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_draft_chapter ON chapter_drafts(chapter_id, version);
```

### 2.5 `draft_gate_reports` — 草稿门禁报告

```sql
CREATE TABLE IF NOT EXISTS draft_gate_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES chapter_drafts(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  check_type TEXT NOT NULL,                        -- consistency | contract | knowledge | fact_lock | foreshadow | timeline | world_rule
  passed INTEGER NOT NULL DEFAULT 0,
  violations TEXT NOT NULL DEFAULT '[]',           -- JSON 数组：违规详情
  severity TEXT NOT NULL DEFAULT 'info',           -- info | warning | error | critical
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gate_draft ON draft_gate_reports(draft_id);
```

### 2.6 `draft_gate_verdicts` — 门禁最终判定

```sql
CREATE TABLE IF NOT EXISTS draft_gate_verdicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  draft_id TEXT NOT NULL REFERENCES chapter_drafts(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  verdict TEXT NOT NULL,                           -- pass | polish | rewrite | replan | escalate
  overall_passed INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT DEFAULT '',
  recommended_model TEXT DEFAULT '',                -- 升级建议
  created_at INTEGER NOT NULL
);
```

### 2.7 `model_routing_rules` — 模型路由规则

```sql
CREATE TABLE IF NOT EXISTS model_routing_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT,                                 -- NULL=全局规则
  agent_type TEXT NOT NULL,                        -- architect | writer | editor | evaluator | arbiter
  task_type TEXT NOT NULL,                         -- chapter_draft | chapter_plan | arc_outline | knowledge_contract | consistency_check | arc_review | volume_review | arbitration
  risk_level TEXT NOT NULL DEFAULT 'normal',       -- low | normal | high | critical
  preferred_tier TEXT NOT NULL DEFAULT 'flash',    -- flash | pro
  auto_escalate INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routing_lookup ON model_routing_rules(agent_type, task_type, risk_level);
```

### 2.8 `evaluation_cases` — 评估测试用例库（P1）

```sql
CREATE TABLE IF NOT EXISTS evaluation_cases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,                          -- knowledge_leak | fact_drift | foreshadow_violation | timeline | world_rule | relationship
  setup_context TEXT NOT NULL,                     -- JSON：测试上下文
  expected_behavior TEXT NOT NULL,
  forbidden_output_patterns TEXT NOT NULL DEFAULT '[]', -- JSON 数组
  pass_criteria TEXT NOT NULL,
  fail_criteria TEXT NOT NULL,
  recommended_gate TEXT NOT NULL,                  -- draft_gate | plan_gate | knowledge_check
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
```

---

## 三、新增服务层设计（6 个服务）

### 3.1 `electron/services/contract.service.ts` — 契约管理

```typescript
// 章节契约
export function createChapterContract(projectId, chapterId, arcId, input): ChapterContract
export function getChapterContract(projectId, chapterId): ChapterContract | null
export function updateChapterContract(id, patch): void
export function listContractViolations(contract, draftContent): Violation[]

// 知识契约
export function createKnowledgeContract(projectId, chapterId, input): KnowledgeContract
export function getKnowledgeContract(projectId, chapterId): KnowledgeContract | null
export function updateKnowledgeContract(id, patch): void

// AI 生成契约（调用 LLM）
export async function generateChapterContract(projectId, chapterId, arcId): Promise<ChapterContract>
export async function generateKnowledgeContract(projectId, chapterId, povCharacterId): Promise<KnowledgeContract>
```

### 3.2 `electron/services/fact-lock.service.ts` — 事实锁管理

```typescript
export function lockFact(projectId, characterId, factKey, factValue, lockLevel, allowedChangeEvents?): void
export function unlockFact(id): void
export function getLocks(characterId): CharacterFactLock[]
export function getLock(characterId, factKey): CharacterFactLock | null
export function verifyFact(characterId, factKey, claimedValue): { valid: boolean; reason: string }
export function changeFactWithEvent(characterId, factKey, newValue, eventId): void
export function batchLockFromSnapshot(projectId, snapshotId): void  // 从三期启动快照批量锁定
```

### 3.3 `electron/services/draft.service.ts` — 草稿生命周期管理

```typescript
export function createDraft(projectId, chapterId, content, modelUsed): ChapterDraft
export function getLatestDraft(chapterId): ChapterDraft | null
export function getDraft(id): ChapterDraft | null
export function listDrafts(chapterId): ChapterDraft[]
export function updateDraftLifecycle(id, lifecycle): void
export function commitDraft(draftId): { success: boolean; chapterId: string }  // 将 draft 写入 chapters 表
export function rejectDraft(draftId, reason): void
export function isCommitted(chapterId): boolean  // 是否有 final_committed 的 draft
```

### 3.4 `electron/services/draft-gate.service.ts` — 草稿门禁（核心）

```typescript
export interface GateCheckResult {
  check_type: 'consistency' | 'contract' | 'knowledge' | 'fact_lock' | 'foreshadow' | 'timeline' | 'world_rule'
  passed: boolean
  violations: Violation[]
  severity: 'info' | 'warning' | 'error' | 'critical'
}

export interface GateVerdict {
  verdict: 'pass' | 'polish' | 'rewrite' | 'replan' | 'escalate'
  overall_passed: boolean
  fail_count: number
  critical_count: number
  summary: string
  recommended_model?: string
}

// 执行全部门禁检查
export async function runDraftGate(draftId): Promise<GateVerdict>

// 单项检查
export async function checkConsistency(draftId): Promise<GateCheckResult>
export async function checkContract(draftId): Promise<GateCheckResult>
export async function checkKnowledgeBoundary(draftId): Promise<GateCheckResult>
export async function checkFactLocks(draftId): Promise<GateCheckResult>
export async function checkForeshadowWhitelist(draftId): Promise<GateCheckResult>
export async function checkTimeline(draftId): Promise<GateCheckResult>
export async function checkWorldRules(draftId): Promise<GateCheckResult>

// Plan Gate（章节计划门禁）
export async function runPlanGate(chapterPlanId, contractId, knowledgeContractId): Promise<GateVerdict>
```

### 3.5 `electron/services/model-router.service.ts` — 模型路由

```typescript
export interface RoutingDecision {
  tier: 'flash' | 'pro'
  model: string
  reason: string
  auto_escalate: boolean
}

export function getRoutingRule(agentType, taskType, riskLevel?): ModelRoutingRule | null
export function resolveModel(agentType, taskType, context?): RoutingDecision
export function shouldEscalate(currentTier, failCount, violationType?): boolean
export function setRoutingRule(input): void
export function listRoutingRules(projectId?): ModelRoutingRule[]
```

### 3.6 `electron/services/evaluator.service.ts` — 评估器（P1）

```typescript
export function listCases(category?: string): EvaluationCase[]
export function getCase(id): EvaluationCase | null
export function createCase(input): EvaluationCase
export async function runEvaluationCase(caseId, agentType): Promise<{ passed: boolean; details: string }>
export async function runAllCases(category?: string): Promise<Array<{ caseId: string; passed: boolean }>>
```

---

## 四、IPC / API 设计（新增 20 个通道）

### `contract:` 命名空间（5 个）
```
contract:getChapter        — 获取章节契约
contract:getKnowledge      — 获取知识契约
contract:generateChapter   — AI 生成章节契约
contract:generateKnowledge — AI 生成知识契约
contract:update            — 更新契约
```

### `factLock:` 命名空间（5 个）
```
factLock:list              — 列出角色事实锁
factLock:lock              — 锁定事实
factLock:unlock            — 解锁事实
factLock:verify            — 验证事实
factLock:batchLockFromSnapshot — 从启动快照批量锁定
```

### `draft:` 命名空间（4 个）
```
draft:getLatest            — 获取最新草稿
draft:list                 — 列出草稿历史
draft:reject               — 拒绝草稿
draft:getGateReport        — 获取门禁报告
```

### `gate:` 命名空间（3 个）
```
gate:runDraftGate          — 执行草稿门禁
gate:runPlanGate           — 执行计划门禁
gate:getVerdict            — 获取最终判定
```

### `routing:` 命名空间（3 个）
```
routing:listRules          — 列出路由规则
routing:setRule            — 设置路由规则
routing:resolve            — 解析当前任务应使用的模型
```

---

## 五、Orchestrator 状态机改造

### 5.1 新增状态（3 个）

```typescript
// 在现有 13 个状态基础上新增
| 'contract_generation'   // 契约生成（Architect 生成 chapter_contract + knowledge_contract）
| 'plan_gate'             // 计划门禁（检查 chapter_plan 是否违反契约）
| 'draft_gate'            // 草稿门禁（检查 draft 是否通过全部门禁）
```

### 5.2 改造后的状态转移

```
architecting（弧大纲完成）
    ↓
contract_generation（新增）── Architect 生成 chapter_contract + knowledge_contract
    ↓
writing ── Writer 生成 chapter_plan
    ↓
plan_gate（新增）── 检查计划是否违反契约
    ├─ 通过 → Writer 写 draft
    ├─ 失败 → 回到 writing（带反馈）
    └─ escalate → 升级 Pro 仲裁
    ↓
writing ── Writer 写 draft（写入 chapter_drafts，不写 chapters）
    ↓
draft_gate（新增）── 执行 7 项门禁检查
    ├─ pass → commit_chapter（写入 chapters，允许记忆写入）
    ├─ polish → 回到 writing（局部打磨）
    ├─ rewrite → 回到 writing（重写）
    ├─ replan → 回到 contract_generation（重新规划）
    └─ escalate → 升级 Pro Arbiter
    ↓
commit 后 → 允许 create_chapter_summary / update_character_state / update_foreshadowing / 写入 RAG
    ↓
arcHasMoreChapters? → writing（下一章）: arc_review_pending
```

### 5.3 关键改造点

**改造 1：`notifyChapterDone()` → `commitChapter()`**

```typescript
// 改造前（二期）：
async notifyChapterDone(chapterId) {
  // 直接更新章节状态
  setChapterStatus(chapterId, 'written')
  updateArcProgress(...)
}

// 改造后（四期）：
async commitChapter(draftId) {
  const verdict = await runDraftGate(draftId)
  if (verdict.verdict !== 'pass') {
    return { committed: false, verdict }
  }
  // 门禁通过，执行提交
  const draft = getDraft(draftId)
  commitDraft(draftId)  // 写入 chapters 表
  updateDraftLifecycle(draftId, 'final_committed')
  // 只有 commit 后才允许记忆写入
  setChapterStatus(draft.chapter_id, 'written')
  updateArcProgress(...)
  return { committed: true, verdict }
}
```

**改造 2：Writer 工具集调整**

```typescript
// 改造前：write_chapter_body 直接写 chapters 表
// 改造后：write_chapter_body 写 chapter_drafts 表
// 新增工具：request_draft_review（替代 report_chapter_done）
// 新增工具：get_chapter_contract（Writer 读取契约）
// 新增工具：get_knowledge_contract（Writer 读取知识契约）
```

**改造 3：记忆写入工具加守卫**

```typescript
// create_chapter_summary / update_character_state / update_foreshadowing 等工具
// 在 handler 开头加守卫：
const isCommitted = isChapterCommitted(chapterId)
if (!isCommitted) {
  return { success: false, error: '章节未通过门禁，不允许写入长期记忆' }
}
```

---

## 六、Writer 执行协议改造

### 6.1 Writer 写作前必须读取

```typescript
// Writer 在写每章前，上下文必须包含：
1. chapter_contract（本章契约）
2. knowledge_contract（知识契约）
3. character_fact_locks（涉及角色的事实锁）
4. allowed_foreshadow_ids（伏笔白名单）
5. 前章摘要（仅 final_committed 的）
6. 当前角色状态（仅 committed 的）
```

### 6.2 Writer 工具变更

| 工具 | 二期行为 | 四期行为 |
|------|---------|---------|
| `write_chapter_body` | 直接写 chapters 表 | 写 chapter_drafts 表，lifecycle='draft_generated' |
| `report_chapter_done` | 返回完成信号 | **删除**，替换为 `request_draft_review` |
| `create_chapter_summary` | 直接写 chapter_summaries | 加守卫：仅 committed 章节允许 |
| `update_character_state` | 直接写 | 加守卫：仅 committed 章节允许 |
| `update_foreshadowing` | 直接写 | 加守卫：仅 committed 章节允许 |
| `consistency_check` | 直接写 | 保留，但结果供 Draft Gate 使用 |
| `get_chapter_contract` | 不存在 | **新增**：Writer 读取契约 |
| `get_knowledge_contract` | 不存在 | **新增**：Writer 读取知识契约 |
| `request_draft_review` | 不存在 | **新增**：触发 Draft Gate |

### 6.3 Writer System Prompt 改造要点

```
你是 Writer。重要规则：
1. 你只能生成 draft，不能直接提交章节。
2. 写正文前必须调用 get_chapter_contract 和 get_knowledge_contract 读取契约。
3. 必须遵守 knowledge_contract 的 forbidden_inferences，不得写预感/梦境/宿命感/似曾相识。
4. 只能使用 allowed_foreshadow_ids 中的伏笔，其他一律不得暗示。
5. 不得违反 character_fact_locks 中的锁定事实。
6. 写完后调用 request_draft_review，由系统门禁决定是否提交。
7. 你没有最终提交权。
```

---

## 七、Editor / Evaluator 执行协议改造

### 7.1 Editor 评审依据增加

Editor 评审时必须参考：
- chapter_contract（逐项验收 required_beats / forbidden_moves）
- knowledge_contract（检查知识边界是否被突破）
- draft_gate_reports（门禁报告）
- character_fact_locks（事实锁是否被违反）

### 7.2 新增 Evaluator Agent（P1）

```typescript
// Evaluator 是独立于 Editor 的质量检查 Agent
// 职责：执行 evaluation_cases 压力测试
// 触发时机：
//   - 每章 commit 后自动跑相关 case
//   - 弧末批量跑全量 case
//   - 用户手动触发
```

---

## 八、Draft Gate 规则设计

### 8.1 7 项检查执行顺序

```
1. checkConsistency      — 基础一致性（二期已有，复用）
2. checkContract         — 章节契约检查
3. checkKnowledgeBoundary — 知识边界检查（核心）
4. checkFactLocks        — 事实锁检查
5. checkForeshadowWhitelist — 伏笔白名单检查
6. checkTimeline         — 时间线检查
7. checkWorldRules       — 世界规则检查
```

### 8.2 各检查规则

#### checkContract
- 遍历 `required_beats`，检查 draft 中是否包含每个节拍
- 遍历 `forbidden_moves`，检查 draft 中是否出现禁止动作
- 检查 `hook_goal` 是否在章末实现

#### checkKnowledgeBoundary（核心）
- 提取 draft 中所有角色内心独白、梦境、预感、似曾相识描写
- 对比 `forbidden_inferences`，匹配则 critical 违规
- 检查 `author_only_facts` 是否被角色提及或暗示
- 检查 `unknown_facts` 是否被角色知道
- **实现方式**：LLM 辅助提取 + 正则规则双重检查

#### checkFactLocks
- 提取 draft 中涉及角色的职业、性别、组织、身份描述
- 对比 `character_fact_locks`，immutable 级别任何偏离 = critical
- event_required 级别：检查是否有对应事件发生

#### checkForeshadowWhitelist
- 提取 draft 中所有伏笔暗示、未来暗示、神秘描写
- 对比 `allowed_foreshadow_ids`，不在白名单的 = error

#### checkTimeline
- 提取 draft 中的时间描述（"三天后"、"翌日"等）
- 对比前章时间线，检测矛盾

#### checkWorldRules
- 提取 draft 中的能力使用、规则描述
- 对比 `world_rules` 表，检测违反

### 8.3 判定规则

| 条件 | verdict |
|------|---------|
| 全部通过 | `pass` |
| 仅有 info/warning | `pass`（记录但放行） |
| 有 error，无 critical | `polish` |
| 有 critical，≤2 个 | `rewrite` |
| 有 critical，>2 个 或 knowledge/fact_lock 违规 | `escalate` |
| contract 的 required_beats 全部缺失 | `replan` |

---

## 九、Plan Gate 规则设计

Plan Gate 在 Writer 写 draft 前检查 chapter_plan：

| 检查项 | 规则 |
|--------|------|
| 计划是否覆盖 required_beats | 每个 beat 必须有对应场景 |
| 计划是否触犯 forbidden_moves | 计划中的场景不得包含禁止动作 |
| 计划是否违反 knowledge_contract | 计划不得安排角色知道未知事实 |
| 计划是否使用未授权伏笔 | 计划中的伏笔必须在白名单 |
| 计划是否违反 fact_locks | 计划不得安排锁定事实变更（除非有事件） |

判定：通过 → 允许写 draft；失败 → 回到 Writer 修订计划

---

## 十、Knowledge Boundary Check 设计

### 10.1 三层知识模型

```
作者层（author_only_facts）
  ├── Writer 的 system prompt 可以看到（用于规避）
  ├── 角色绝对不能知道
  └── 旁白不能暗示

读者层（reader_visible_facts）
  ├── 读者当前可以知道
  └── 可以通过旁白展示

角色层（known_facts / unknown_facts）
  ├── POV 角色已知
  ├── POV 角色未知
  └── forbidden_inferences 禁止角色推断
```

### 10.2 检查实现

```typescript
async function checkKnowledgeBoundary(draftId): Promise<GateCheckResult> {
  const draft = getDraft(draftId)
  const contract = getKnowledgeContract(draft.project_id, draft.chapter_id)
  const violations: Violation[] = []

  // 1. 正则检查 forbidden_inferences 模式
  for (const pattern of contract.forbidden_inferences) {
    const regex = buildInferenceRegex(pattern)
    const matches = draft.plain_text.match(regex)
    if (matches) {
      violations.push({
        type: 'forbidden_inference',
        severity: 'critical',
        detail: `检测到禁止的推断模式：${pattern}`,
        evidence: matches[0]
      })
    }
  }

  // 2. LLM 检查角色是否知道不该知道的事
  const llmResult = await llmCheckKnowledgeLeak(draft, contract)
  violations.push(...llmResult.violations)

  // 3. 检查 author_only_facts 是否被泄露
  for (const fact of contract.author_only_facts) {
    if (draft.plain_text.includes(fact)) {
      violations.push({
        type: 'author_knowledge_leak',
        severity: 'critical',
        detail: `作者层信息被泄露：${fact}`
      })
    }
  }

  return {
    check_type: 'knowledge',
    passed: violations.filter(v => v.severity === 'critical').length === 0,
    violations,
    severity: violations.some(v => v.severity === 'critical') ? 'critical' : 'info'
  }
}
```

### 10.3 forbidden_inferences 正则模式库

```typescript
const INFERENCE_PATTERNS = {
  'premonition': /预感|直觉告诉|冥冥之中|似乎.{0,10}预示/,
  'dejavu': /似曾相识|熟悉感|好像.{0,10}见过|莫名的熟悉/,
  'destiny': /宿命|命中注定|缘分|天意|冥冥中注定/,
  'dream_foreshadow': /梦中.{0,20}出现|梦里.{0,20}预见/,
  'unknown_person_familiarity': /从未见过.{0,20}却.{0,10}熟悉|陌生.{0,10}却.{0,10}亲切/
}
```

---

## 十一、Fact Lock Check 设计

### 11.1 锁定级别

| 级别 | 规则 | 违反严重度 |
|------|------|-----------|
| `immutable` | 绝对不可变，任何偏离 = critical | critical |
| `event_required` | 必须有明确剧情事件才能变，无事件偏离 = critical | critical |
| `soft` | 允许轻微调整，但需记录原因 | warning |

### 11.2 检查实现

```typescript
async function checkFactLocks(draftId): Promise<GateCheckResult> {
  const draft = getDraft(draftId)
  // 提取 draft 中涉及的所有角色
  const mentionedCharacters = extractMentionedCharacters(draft.plain_text)
  const violations: Violation[] = []

  for (const charId of mentionedCharacters) {
    const locks = getLocks(charId)
    for (const lock of locks) {
      const claimedValue = extractFactFromDraft(draft.plain_text, charId, lock.fact_key)
      if (!claimedValue) continue

      if (lock.lock_level === 'immutable') {
        if (!valuesMatch(claimedValue, lock.fact_value)) {
          violations.push({ severity: 'critical', type: 'fact_drift', detail: `${lock.fact_key}: 应为"${lock.fact_value}"，实际为"${claimedValue}"` })
        }
      } else if (lock.lock_level === 'event_required') {
        if (!valuesMatch(claimedValue, lock.fact_value)) {
          const hasEvent = checkChangeEventInDraft(draft, lock.allowed_change_events)
          if (!hasEvent) {
            violations.push({ severity: 'critical', type: 'fact_drift_no_event', detail: `${lock.fact_key} 变更但无对应事件` })
          }
        }
      }
    }
  }

  return { check_type: 'fact_lock', passed: violations.length === 0, violations, severity: violations.length > 0 ? 'critical' : 'info' }
}
```

---

## 十二、Foreshadow Whitelist Check 设计

```typescript
async function checkForeshadowWhitelist(draftId): Promise<GateCheckResult> {
  const draft = getDraft(draftId)
  const contract = getChapterContract(draft.project_id, draft.chapter_id)
  const allowedIds = new Set(contract.allowed_foreshadow_ids)

  // 提取 draft 中的所有伏笔暗示
  const detectedForeshadowings = await llmExtractForeshadowings(draft.plain_text)

  const violations: Violation[] = []
  for (const fs of detectedForeshadowings) {
    if (!allowedIds.has(fs.id) && !allowedIds.has(fs.name)) {
      violations.push({
        severity: 'error',
        type: 'unauthorized_foreshadow',
        detail: `未授权伏笔/暗示：${fs.description}`
      })
    }
  }

  return { check_type: 'foreshadow', passed: violations.length === 0, violations, severity: violations.length > 0 ? 'error' : 'info' }
}
```

---

## 十三、Memory Quarantine 设计

### 13.1 草稿生命周期状态机

```
draft_generated → plan_checked → draft_checked
                                    ├─ pass → final_committed → indexed_to_memory
                                    ├─ polish → draft_revised → (重新 draft_checked)
                                    ├─ rewrite → draft_rejected → (重新 draft_generated)
                                    └─ escalate → (Pro 仲裁)
```

### 13.2 隔离规则（代码强制）

```typescript
// 记忆写入工具的统一守卫
function requireCommitted(chapterId): boolean {
  const draft = getLatestDraft(chapterId)
  return draft?.lifecycle === 'final_committed'
}

// 在以下工具 handler 开头加守卫：
// - create_chapter_summary
// - update_character_state
// - update_relationship
// - update_world_state
// - update_foreshadowing
// - set_next_chapter_hint
// - memory.rebuildChapter（RAG 写入）

// 示例：
export const createChapterSummaryTool = {
  name: 'create_chapter_summary',
  handler: (projectId, args) => {
    if (!requireCommitted(args.chapter_id)) {
      return { success: false, error: '章节未通过门禁，禁止写入摘要' }
    }
    // ... 原逻辑
  }
}
```

### 13.3 rejected draft 保留

- `draft_rejected` 状态的 draft 保留在 `chapter_drafts` 表
- 不进入 RAG，不生成摘要，不更新状态
- 用户/Arbiter 可查看失败原因
- 可作为重写参考

---

## 十四、Model Routing 设计

### 14.1 默认路由规则

| Agent | 任务类型 | 风险等级 | 默认 Tier |
|-------|---------|---------|----------|
| Coordinator | 任意 | - | Flash |
| Writer | chapter_draft（普通章） | low | Flash |
| Writer | chapter_plan | low | Flash |
| Writer | chapter_draft（卷首/卷尾/高潮/反转） | high | Flash → 可升级 |
| Architect | 全书设定 | high | Pro |
| Architect | 卷弧规划 | high | Pro |
| Architect | 人物弧规划 | high | Pro |
| Architect | chapter_contract 生成 | high | Pro |
| Architect | knowledge_contract 生成 | critical | Pro |
| Editor | consistency_check | normal | Flash |
| Editor | chapter_summary | low | Flash |
| Editor | arc_review | high | Pro |
| Editor | volume_review | high | Pro |
| Arbiter | 低分章节仲裁 | critical | Pro |
| Arbiter | 知识越权判断 | critical | Pro |
| Arbiter | 事实锁冲突 | critical | Pro |

### 14.2 升级触发条件

```typescript
function shouldEscalate(context: {
  failCount: number
  violationType: string
  chapterImportance: 'normal' | 'climax' | 'volume_start' | 'volume_end' | 'major_twist'
  userMarked: boolean
}): boolean {
  if (context.failCount >= 2) return true
  if (context.violationType === 'knowledge_leak') return true
  if (context.violationType === 'fact_lock_violation') return true
  if (context.violationType === 'identity_drift') return true
  if (context.chapterImportance !== 'normal') return true
  if (context.userMarked) return true
  return false
}
```

### 14.3 实现方式

```typescript
// 在 agent-engine.ts 的 callLlm 中注入路由
function resolveModelForTask(agentType, taskType, context): string {
  const decision = resolveModel(agentType, taskType, context)
  // decision.tier === 'pro' ? 使用 Pro 模型 : 使用 Flash 模型
  return decision.model
}
```

需要在 `api_configs` 表中支持标记模型为 `flash` 或 `pro` tier（扩展 `llm_model` 字段或新增 `model_tier` 列）。

---

## 十五、Evaluation Cases 设计

### 15.1 内置测试用例（10 个）

| # | 名称 | 类别 | 测试要点 |
|---|------|------|---------|
| 1 | 未见面不得预感 | knowledge_leak | 男主和女主未见面，男主不得预感/梦见/对女主产生宿命感 |
| 2 | 原主秘密不继承 | knowledge_leak | 魂穿者不继承原主不知道的秘密 |
| 3 | 职业不可漂移 | fact_drift | 法医不得写成医生/记者 |
| 4 | 死亡角色不登场 | fact_drift | 已死亡角色无解释不得复活 |
| 5 | 未授权道具不凭空 | foreshadow_violation | 不在计划中的道具不得出现 |
| 6 | 伏笔不提前解释 | foreshadow_violation | 未到回收章节的伏笔不得提前解释 |
| 7 | 世界规则不被打破 | world_rule | 能力限制不能被爽点打破 |
| 8 | 关系未升级不恋人称呼 | relationship | 关系未到恋人阶段不得使用恋人式称呼 |
| 9 | 地理位置不瞬移 | timeline | 角色不得无过渡地瞬移 |
| 10 | 不知作者层未来 | knowledge_leak | 角色不得知道作者层未来剧情 |

### 15.2 用例结构示例

```typescript
{
  name: '未见面不得预感',
  category: 'knowledge_leak',
  setup_context: {
    pov_character_id: 'char_male_lead',
    knowledge_contract: {
      unknown_facts: ['女主存在', '女主姓名', '女主外貌'],
      forbidden_inferences: ['预感女主', '梦见女主', '对未见女子宿命感', '似曾相识']
    }
  },
  expected_behavior: '男主不得有任何关于女主的预感、梦境、宿命感、熟悉感',
  forbidden_output_patterns: [
    '预感.*女子', '梦中.*出现.*女', '似曾相识', '莫名的熟悉',
    '命中注定.*遇', '冥冥之中', '直觉告诉.*她'
  ],
  pass_criteria: 'draft 中无任何 forbidden_output_patterns 匹配',
  fail_criteria: 'draft 中出现任意 forbidden_output_patterns 匹配',
  recommended_gate: 'draft_gate'
}
```

---

## 十六、UI 页面/组件建议

### 16.1 新增页面

#### `src/pages/IntegrityDashboard.tsx` — 叙事完整性仪表盘（未实现）

> 当前使用 `IntegrityPanel.tsx` 组件嵌入 **EditorPage**，功能等效但无独立仪表盘页面。以下为设计稿参考：

```
┌──────────────────────────────────────────────────────┐
│  叙事完整性仪表盘                                     │
├──────────────────────────────────────────────────────┤
│  当前章节: 第三章 · draft v2                          │
│  门禁状态: ⚠ rewrite (2 critical violations)         │
├──────────────────────────────────────────────────────┤
│  📋 章节契约                                          │
│    required_beats: [✓] [✓] [✗缺失]                   │
│    forbidden_moves: [无触犯]                          │
│    allowed_foreshadow: [伏笔A] [伏笔B]                │
├──────────────────────────────────────────────────────┤
│  🧠 知识契约                                          │
│    POV: 林岚                                          │
│    known: [案件A, 嫌疑人B]                            │
│    unknown: [凶手身份]                                │
│    forbidden_inferences: [预感, 梦境, 宿命感]         │
├──────────────────────────────────────────────────────┤
│  🔒 事实锁                                            │
│    林岚.occupation = 法医 [immutable] ✓              │
│    林岚.organization = 市局 [event_required] ✓       │
├──────────────────────────────────────────────────────┤
│  🚪 门禁报告                                          │
│    [consistency] ✓ 通过                               │
│    [contract] ✗ 缺失 beat: "发现线索"                 │
│    [knowledge] ✗ critical: 检测到"预感"模式           │
│    [fact_lock] ✓ 通过                                 │
│    [foreshadow] ✗ 未授权伏笔: "神秘玉佩"              │
│    [timeline] ✓ 通过                                  │
│    [world_rule] ✓ 通过                                │
├──────────────────────────────────────────────────────┤
│  判定: rewrite                                        │
│  [查看 draft] [重写] [升级 Pro 仲裁] [重新规划]       │
└──────────────────────────────────────────────────────┘
```

### 16.2 新增组件

> **注意**：以下组件为设计规划，当前均未创建独立文件，功能已内联到 `IntegrityPanel.tsx` 或通过后端 API 提供。

| 组件 | 位置 | 职责 | 状态 |
|------|------|------|------|
| `ContractEditor.tsx` | `src/components/integrity/` | 章节契约/知识契约编辑器 | 未实现 |
| `FactLockManager.tsx` | `src/components/integrity/` | 事实锁管理（锁定/解锁/验证） | 未实现 |
| `DraftGateReport.tsx` | `src/components/integrity/` | 门禁报告展示（7 项检查结果） | 未实现 |
| `DraftLifecycleBadge.tsx` | `src/components/integrity/` | 草稿生命周期状态徽章 | 未实现 |
| `ModelRoutingConfig.tsx` | `src/components/integrity/` | 模型路由规则配置 | 未实现 |
| `EvaluationRunner.tsx` | `src/components/integrity/` | 评估测试用例运行器 | 未实现 |

### 16.3 集成到现有 UI

- `EditorPage` 右侧面板新增「完整性」Tab，展示当前章节的门禁状态
- `OrchestratorPanel` 新增 `contract_generation` / `plan_gate` / `draft_gate` 状态展示
- 章节树中每章显示门禁状态图标（✓已提交 / ⚠门禁失败 / ○草稿中）

---

## 十七、MVP 实现计划

### P0（必须做）

| # | 任务 | 依赖 |
|---|------|------|
| 1 | 数据模型：7 张新表 + 迁移 | 无 |
| 2 | `contract.service.ts`：契约 CRUD + AI 生成 | 1 |
| 3 | `fact-lock.service.ts`：事实锁 CRUD + 验证 | 1 |
| 4 | `draft.service.ts`：草稿生命周期管理 | 1 |
| 5 | `draft-gate.service.ts`：7 项门禁检查 | 2, 3, 4 |
| 6 | Writer 工具改造：write_chapter_body → 写 draft | 4 |
| 7 | 记忆写入工具加守卫：requireCommitted | 4 |
| 8 | Orchestrator 状态机改造：新增 3 状态 | 5, 6 |
| 9 | `commitChapter()` 替代 `notifyChapterDone()` | 5, 8 |
| 10 | IPC 通道注册（20 个） | 2-5 |
| 11 | UI: 门禁报告（IntegrityPanel.tsx 组件，无独立 IntegrityDashboard 页面） | 10 |

### P1（应该做）

| # | 任务 |
|---|------|
| 12 | `model-router.service.ts`：模型路由 |
| 13 | Plan Gate 实现 |
| 14 | `evaluator.service.ts`：评估测试用例 |
| 15 | Pro Arbiter 升级策略 |
| 16 | UI: 模型路由配置 + 评估运行器 |

### P2（可后续做）

| # | 任务 |
|---|------|
| 17 | 自动修复建议 |
| 18 | 局部段落级重写 |
| 19 | 复杂时间线图谱 |
| 20 | 关系图谱冲突检测 |
| 21 | 多模型 A/B 评测 |
| 22 | 自动生成测试用例 |

---

## 十八、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 门禁检查太严，Writer 频繁失败 | 产能下降 | 分级判定（polish/rewrite/escalate），非 critical 放行 |
| LLM 检查有误判 | 误报导致重写 | 正则规则优先，LLM 辅助；用户可手动覆盖 |
| 模型路由配置复杂 | 用户困惑 | 提供默认规则，UI 简化为"严格/标准/宽松"三档 |
| 草稿隔离导致上下文断裂 | Writer 不知道前文 | committed 章节的摘要/状态正常供 Writer 读取 |
| 事实锁太多限制创作 | 灵活性下降 | soft 级别宽松，immutable 谨慎使用 |
| 性能：7 项检查耗时 | 章节提交慢 | 并行执行独立检查，缓存中间结果 |

---

## 十九、验收标准

### P0 验收（全部完成）

1. [x] Writer 调用 `write_chapter_body` 写入 `chapter_drafts` 表，不直接写 `chapters` 表
2. [x] Writer 调用 `request_draft_review` 触发 Draft Gate
3. [x] Draft Gate 执行 7 项检查，生成 `draft_gate_reports` + `draft_gate_verdicts`
4. [x] 只有 verdict=pass 时，Orchestrator 才执行 `commitChapter()`
5. [x] `commitChapter()` 将 draft 写入 `chapters` 表，draft lifecycle 更新为 `final_committed`
6. [x] 未 committed 的章节，`create_chapter_summary` 等记忆工具返回错误
7. [x] `checkKnowledgeBoundary` 能检测出"预感未见之人"模式
8. [x] `checkFactLocks` 能检测出"职业漂移"
9. [x] `checkForeshadowWhitelist` 能检测出未授权伏笔
10. [x] UI 展示门禁报告（IntegrityPanel.tsx），包含 7 项检查结果和违规详情

### P1 验收（已完成）

11. [x] Plan Gate 在 Writer 写 draft 前检查 chapter_plan
12. [x] 模型路由能根据任务类型自动选择 Flash/Pro
13. [x] 连续 2 次门禁失败自动升级 Pro
14. [x] 10 个评估测试用例可运行并输出 pass/fail

---

## 二十、与前三期的完整集成图

```
三期 Story Bible
  └─ launch_snapshot
       └─ batchLockFromSnapshot() → character_fact_locks（四期）

二期 Orchestrator
  ├─ architecting
  │    └─ Architect 生成弧大纲
  │         └─ contract_generation（四期新增）
  │              ├─ generateChapterContract()
  │              └─ generateKnowledgeContract()
  │
  ├─ writing
  │    ├─ Writer 读取 contract + knowledge_contract + fact_locks
  │    ├─ Writer 生成 chapter_plan
  │    ├─ plan_gate（四期新增）
  │    ├─ Writer 写 draft → chapter_drafts（四期改造）
  │    └─ request_draft_review（四期新增）
  │
  ├─ draft_gate（四期新增）
  │    ├─ checkConsistency
  │    ├─ checkContract
  │    ├─ checkKnowledgeBoundary ← knowledge_contract
  │    ├─ checkFactLocks ← character_fact_locks
  │    ├─ checkForeshadowWhitelist ← chapter_contract.allowed_foreshadow_ids
  │    ├─ checkTimeline
  │    └─ checkWorldRules ← world_rules
  │
  ├─ verdict=pass → commitChapter()
  │    ├─ 写入 chapters 表
  │    ├─ draft lifecycle = final_committed
  │    └─ 解锁记忆写入（summary/state/foreshadow/RAG）
  │
  ├─ verdict=polish/rewrite → 回到 writing
  ├─ verdict=replan → 回到 contract_generation
  └─ verdict=escalate → Pro Arbiter（四期新增）
       └─ 仲裁后决定 pass/rewrite/replan

一期 RAG 记忆
  └─ rebuildChapter() 加守卫：仅 committed 章节允许
```
