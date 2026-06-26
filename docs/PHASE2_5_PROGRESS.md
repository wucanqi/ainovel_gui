# 编排器加固 · 进度规划

> 版本：v1.0
> 日期：2026-06-25
> 状态：✅ 全部完成
> 关联文档：PHASE2_5_ORCHESTRATOR_HARDENING.md（落地方案）

---

## 总体状态

三个阶段（安全基座 / Checkpoint 体系 / 用户干预完整性）全部完成。系统已迁移至三期 Host/Coordinator 架构，加固功能在新架构中得以保留和增强。

---

## 目录

1. [总体时间线](#1-总体时间线)
2. [阶段一：安全基座](#2-阶段一安全基座)
3. [阶段二：Checkpoint 体系](#3-阶段二checkpoint-体系)
4. [阶段三：用户干预完整性](#4-阶段三用户干预完整性)
5. [里程碑与验收](#5-里程碑与验收)

---

## 1. 总体时间线

```
阶段一 ████████████████░░░░░░░░░░░░░░░░  2天
阶段二 ░░░░░░░░░░░░░░░░████████████████  2天
阶段三 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░███  1天
────────────────────────────────────────────
合计                                     5天
```

依赖关系：

```
阶段一（无依赖）
  │
  ├──▶ 阶段二（依赖：agent_sessions status 字段，AbortController）
  │       │
  │       └──▶ 阶段三（依赖：checkpoint 体系，paused_boundary）
  │
  └──▶ 日常可独立交付、独立测试
```

---

## 2. 阶段一：安全基座

> 目标：崩溃不丢数据、暂停能打断 Agent、重启后能恢复
> 工期：2 天

### Day 1

#### Task 1.1: agent_sessions 生命周期（3h）

| 文件 | 改动 |
|------|------|
| `electron/db/schema.ts` | ALTER TABLE agent_sessions ADD status / ended_at |
| `electron/services/agent-engine.ts` | runAgent / runAgentStreaming 开始/结束/异常时更新 status 和 ended_at |
| `electron/services/orchestrator.ts` | ensureSystemState 中扫描 running session 标记 aborted |
| `shared/types.ts` | AgentSession 类型加 status / ended_at |

**验证：**
- 正常执行完一轮 Agent，agent_sessions 最后一条 status='completed'
- 模拟崩溃（关闭应用），重启后所有 running → aborted
- orchestration_log 有对应 recovery 日志

#### Task 1.2: AbortController 接入（3h）

| 文件 | 改动 |
|------|------|
| `electron/services/orchestrator.ts` | Orchestrator 实例持有 AbortController，pause() 调用 abort() |
| `electron/services/agent-engine.ts` | catch AbortError 时标记 session aborted（不抛异常） |
| `electron/ipc/register.ts` | pause handler 返回「已中断」信息 |
| `src/stores/orchestrator.store.ts` | pause 后推 agentAborted 消息到 output |

**验证：**
- Architect 执行 LLM 调用期间点暂停，3s 内 Agent 停止
- agentSession status='aborted'
- UI 输出显示已中断和已执行的 tool call 数

#### Task 1.3: 崩溃恢复入口（2h）

| 文件 | 改动 |
|------|------|
| `shared/types.ts` | 新增 RecoveryStatus 类型 |
| `shared/ipc-api.ts` | OrchestratorApi 加 getRecoveryStatus / reset |
| `electron/ipc/register.ts` | 对应 handler，reset 实现 |
| `electron/preload.ts` | 暴露新 API |
| `src/pages/OrchestrationPage.tsx` | 恢复横幅 UI + 继续/重置按钮 |
| `src/stores/orchestrator.store.ts` | load 时检测 recovery 状态 |

**验证：**
- 编排中间态（如 writing）关闭/重启应用，打开编排页
- 显示恢复横幅，点击继续后 tick 一次正常推进
- 点击重置后回到 idle，所有产物保留

---

### Day 2（缓冲 + 联调）

#### Task 1.4: 联调与边界 case（4h）

| 场景 | 操作 |
|------|------|
| 连续崩溃 3 次 | 确认所有 session 正确标记 |
| 暂停后立即恢复 | 确认 agent 已 abort，不会残留 |
| 恢复后立即暂停 | 确认不会重复创建 AbortController |
| 多个项目切换 | 确认 AbortController 按 projectId 隔离 |

#### Task 1.5: 日志与事件（2h）

| 文件 | 改动 |
|------|------|
| `electron/services/orchestrator.ts` | pause/resume/reset 加详细日志 |
| `electron/ipc/register.ts` | 推 agentAborted / boundaryChanged 事件 |
| `shared/types.ts` | IpcEvent 加新事件类型 |

---

## 3. 阶段二：Checkpoint 体系

> 目标：每种执行模式有明确定义的停止点，自动推进闭环完整
> 工期：2 天

### Day 3

#### Task 2.1: Checkpoint 模型实现（3h）

| 文件 | 改动 |
|------|------|
| `shared/types.ts` | CheckpointType、Checkpoint 接口 |
| `electron/services/orchestrator.ts` | 实现 checkCheckpoint() 函数，每个 tick case 中检测并返回 checkpoint |
| `electron/ipc/register.ts` | tick handler 返回 checkpoint 信息 |
| `electron/ipc/register.ts` | 推 checkpointReached 事件到 UI |

**验证：**
- 一章 commit 后 tick，返回 checkpoint_type='chapter_done'
- 一弧所有章 commit，返回 checkpoint_type='arc_done'
- 门禁失败，返回 checkpoint_type='gate_failed'

#### Task 2.2: 执行模式行为修正（2h）

| 文件 | 改动 |
|------|------|
| `src/stores/orchestrator.store.ts` | 重写 shouldStopForMode() 匹配新规则 |
| `src/stores/orchestrator.store.ts` | 自动推进循环改用 checkpoint 判断 |
| `src/pages/OrchestrationPage.tsx` | 模式选择器 tooltip 更新 |

**验证：**
- full_auto：写完一弧自动暂停
- arc_auto：写完一章自动暂停
- node_review：每个门禁节点暂停
- 模式切换立即生效

#### Task 2.3: 章完成自动门禁闭环（3h）

| 文件 | 改动 |
|------|------|
| `electron/services/orchestrator.ts` | tick() writing 状态自动检测草稿并转 draft_gate |
| `electron/services/orchestrator.ts` | draft_gate 通过后自动 commit + 查下一章 + 转 contract_generation |
| `electron/services/orchestrator.ts` | arc_done 时自动转 arc_review |

**验证：**
- Writer 写完草稿后，tick 自动转到 draft_gate
- 门禁通过，自动 commit 并进入下一章契约
- 无需用户手动调 tick 来推进门禁

---

### Day 4

#### Task 2.4: Checkpoint UI（2h）

| 文件 | 改动 |
|------|------|
| `src/pages/OrchestrationPage.tsx` | checkpoint 横幅（arc_done / chapter_done / gate_failed） |
| `src/stores/orchestrator.store.ts` | 到达 checkpoint 时自动 pause + 推 output 消息 |

**验证：**
- checkpoint 到达时 UI 显示横幅，包含已完成的进度和最后评审结果
- agentOutput 有 checkpoint 条目

#### Task 2.5: 联调与边界 case（4h）

| 场景 | 验证点 |
|------|--------|
| 首弧 8 章全自动写完 | 每章 pass → 第 8 章完成后 checkpoint arc_done |
| 中间章门禁失败 | 自动停在 draft_gate，不退也不跳过 |
| 门禁连续失败 3 次 | 自动暂停，UI 提示 |
| 用户手动在 checkpoint 处点继续 | 继续推进到下一 checkpoint |

---

## 4. 阶段三：用户干预完整性

> 目标：用户中途暂停、修改、恢复，系统感知变化并正确处理
> 工期：1 天

### Day 5

#### Task 3.1: 暂停边界快照与差异检测（3h）

| 文件 | 改动 |
|------|------|
| `electron/db/schema.ts` | ALTER TABLE system_state ADD paused_boundary |
| `electron/services/orchestrator.ts` | pause 时存 paused_boundary；resume 时对比差异 |
| `electron/services/orchestrator.ts` | 差异处理：回退/提示/继续 |
| `electron/ipc/register.ts` | resume 返回差异信息或推 boundaryChanged 事件 |

**验证：**
- 暂停 → 删当前章 → 恢复 → 提示边界变化，回退到 contract_generation
- 暂停 → 无修改 → 恢复 → 正常继续
- 暂停 → 改设定 → 恢复 → 正常继续（无影响）

#### Task 3.2: 用户干预日志（1.5h）

| 文件 | 改动 |
|------|------|
| `electron/services/orchestrator.ts` | pause/resume/reset/手动 tick/手动 runAgent 写 user_action log |
| `shared/types.ts` | OrchestrationLogEntry 的 event_type 加 'user_action' |

**验证：**
- 暂停 → 日志有 user_action: pause
- 恢复 → 日志有 user_action: resume
- 重置 → 日志有 user_action: reset

#### Task 3.3: 联调与边界 case（3.5h）

| 场景 | 验证点 |
|------|--------|
| 全流程：启动 → 自动推进 → 弧完成停 → 审核 → 继续 → 崩溃 → 恢复 | 各环节正常 |
| 暂停 → 删章节 → 恢复 → 回退 → 重新架构 → 继续 | 差异检测正确 |
| 连续暂停恢复 5 次 | 无内存泄漏，状态正确 |

---

## 5. 里程碑与验收（全部完成）

### M1：安全基座（已完成）

- [x] Agent 会话有 status/ended_at 字段
- [x] 启动时自动清理 running → aborted
- [x] 崩溃/重启后编排页显示恢复入口
- [x] 暂停能中断正在执行的 Agent
- [x] reset 可重置编排器状态且不丢数据

### M2：Checkpoint 体系（已完成）

- [x] 四种模式均有明确定义的停止点
- [x] 章完成自动触发门禁闭环
- [x] checkpoint 到达时 UI 显示横幅和进度
- [x] 门禁连续失败自动暂停

### M3：用户干预完整性（已完成）

- [x] 恢复时检测用户修改导致的边界变化
- [x] 差异提示和处理正确
- [x] 用户操作全量记录到 orchestration_log
- [x] 全流程端到端无异常

### 最终验收标准

- [x] TypeScript strict 无报错
- [x] 崩溃恢复数据正常
- [x] 暂停/恢复无状态错误
- [x] 四种执行模式 checkpoint 行为正确
- [x] 已有功能无回归（项目/章节/设定/AI 续写正常）

---

## 附录 A：每日站会检查点

| 日 | 检查项 |
|----|--------|
| Day 1 | agent_sessions schema 变更完成？AbortController 接入测试过？ |
| Day 2 | 崩溃恢复入口 UI 可用？联调无 regressions？ |
| Day 3 | checkpoint 类型在 tick 中能正确检测？模式行为符合规则？ |
| Day 4 | 章完成自动门禁闭环走通？checkpoint UI 展示正常？ |
| Day 5 | 恢复时差异检测正确？全流程端到端通过？ |

## 附录 B：回滚方案

如果阶段二中某个 checkpoint 行为导致问题：
- 将对应模式的 `shouldStopForMode` 返回值临时改为 `false`
- 模式回退到当前 production 行为
- 不影响其他模式和核心状态机
