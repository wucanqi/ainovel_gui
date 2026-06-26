import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { buildCoordinatorPrompt } from './coordinator.prompt'
import { LoadState, Route, formatInstruction, detectFoundationMissing } from './flow-router'
import { generateReminder } from './reminder'
import { runAgent as runAgentEngine } from './agent-engine'
import { registerTools, createAgentSession } from './tool-executor'
import { architectTools } from './tools/architect.tools'
import { writerTools } from './tools/writer.tools'
import { editorTools } from './tools/editor.tools'
import { getActive, getProviderForTier } from './config.service'
import { resolveModel } from './model-router.service'
import { buildContext as buildRagContext } from './memory.service'
import { parseAndMergeAllDocuments } from './import.service'
import { compactMessages, compactHealth, resetCompactState } from './compaction'
import { estimateMessagesTokens } from './compaction'
import { runDraftGate, runPlanGate } from './draft-gate.service'
import type { GateVerdict } from './draft-gate.service'
import { commitDraft, rejectDraft } from './draft.service'
import { getGlobalGateRules, setGlobalGateRules } from './settings.service'
import type { LlmMessage } from './compaction'
import type {
  ToolDefinition,
  ToolResult,
  AgentResponse,
  Phase,
  Flow,
  Lifecycle,
  Instruction,
  JSONSchema,
  RouteState,
  OrchestratorState,
  HostAction
} from '@shared/types'

let toolInitDone = false

function initTools(): void {
  if (toolInitDone) return
  registerTools(architectTools)
  registerTools(writerTools)
  registerTools(editorTools)
  toolInitDone = true
}

// ── Shared state helpers ──

function db(): ReturnType<typeof getDb> { return getDb() }
function stateField(projectId: string, field: string): unknown {
  return (db().prepare(`SELECT ${field} FROM system_state WHERE project_id = ?`).get(projectId) as Record<string, unknown>)?.[field]
}
function setField(projectId: string, field: string, value: unknown): void {
  db().prepare(`UPDATE system_state SET ${field} = ?, updated_at = ? WHERE project_id = ?`).run(value, now(), projectId)
}
function ensureSystemState(projectId: string): void {
  if (db().prepare('SELECT 1 FROM system_state WHERE project_id = ?').get(projectId)) return
  db().prepare(
    `INSERT INTO system_state (project_id, orchestrator_state, phase, flow, lifecycle, is_paused, auto_mode, updated_at)
     VALUES (?, 'idle', 'init', 'writing', 'idle', 0, 0, ?)`
  ).run(projectId, now())
  if (!db().prepare('SELECT 1 FROM progress WHERE project_id = ?').get(projectId)) {
    db().prepare(`INSERT INTO progress (project_id, phase, flow, updated_at) VALUES (?, 'init', 'writing', ?)`).run(projectId, now())
  }
}

async function autoParseImportedDocs(projectId: string): Promise<number> {
  try {
    const pending = db().prepare(
      "SELECT COUNT(*) AS c FROM imported_documents WHERE project_id = ? AND status = 'pending'"
    ).get(projectId) as { c: number }
    if (pending.c > 0) {
      console.log('[Host] autoParseImportedDocs starting', { projectId: projectId.slice(0, 8), pending: pending.c })
      await parseAndMergeAllDocuments(projectId)
      console.log('[Host] autoParseImportedDocs done')
      return pending.c
    }
    return 0
  } catch (e) {
    console.log('[Host] autoParseImportedDocs skipped:', (e as Error).message)
    return 0
  }
}
function logEvent(projectId: string, eventType: string, reason: string, details: Record<string, unknown> = {}): void {
  db().prepare(`INSERT INTO orchestration_log (id, project_id, event_type, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uuid(), projectId, eventType, reason, JSON.stringify(details), now())
}

function syncExecutionState(projectId: string, state: RouteState, inst: Instruction | null, action?: HostAction | null): void {
  const nextChapterId = state.nextChapterId ?? null
  const nextArcId = getArcIdForChapter(projectId, nextChapterId, state.nextChapter)
  const orchestratorState = action?.targetState ?? inferHostOrchestratorState(state, inst)
  const activeAgent = normalizeHostAgent(action?.agent ?? inst?.agent ?? inferActiveAgentFromState(state))

  setField(projectId, 'current_chapter_id', nextChapterId)
  setField(projectId, 'current_arc_id', nextArcId)
  setField(projectId, 'active_agent', activeAgent)
  setField(projectId, 'orchestrator_state', orchestratorState)
}

function normalizeHostAgent(agent: Instruction['agent'] | 'architect' | 'writer' | 'editor' | null): 'architect' | 'writer' | 'editor' | null {
  if (agent === 'architect_long') return 'architect'
  return agent
}

function getArcIdForChapter(projectId: string, chapterId: string | null, chapterNumber: number): string | null {
  if (chapterId) {
    const byId = db().prepare(
      'SELECT arc_id FROM arc_chapter_plans WHERE id = ? LIMIT 1'
    ).get(chapterId) as { arc_id: string } | undefined
    if (byId?.arc_id) return byId.arc_id
  }

  if (chapterNumber > 0) {
    const byNumber = db().prepare(
      `SELECT acp.arc_id FROM arc_chapter_plans acp
       JOIN volume_arcs va ON acp.arc_id = va.id
       WHERE va.project_id = ? AND acp.chapter_number = ?
       ORDER BY va.volume_number ASC LIMIT 1`
    ).get(projectId, chapterNumber) as { arc_id: string } | undefined
    return byNumber?.arc_id ?? null
  }

  return null
}

function inferHostOrchestratorState(state: RouteState, inst: Instruction | null): OrchestratorState {
  if (state.phase === 'complete') return 'completed'

  if (state.foundationMissing.length > 0) {
    if (state.foundationMissing.includes('chapter_contracts') || state.foundationMissing.includes('knowledge_contracts')) {
      return 'contract_generation'
    }
    return 'architecting'
  }

  if (state.pendingRewrites.length > 0) {
    return state.flow === 'polishing' ? 'polishing' : 'chapter_rewrite'
  }

  if (state.arcBoundary?.isArcEnd) {
    return state.hasArcReview ? 'arc_review' : 'arc_review_pending'
  }

  if (state.chapterReadiness && !state.chapterReadiness.readyToWrite) {
    return 'contract_generation'
  }

  if (inst?.agent === 'writer') return 'writing'
  if (inst?.agent === 'editor') return 'arc_review'
  if (inst?.agent === 'architect' || inst?.agent === 'architect_long') return 'architecting'

  if (state.phase === 'writing') return 'writing'
  return 'idle'
}

function inferActiveAgentFromState(state: RouteState): 'architect' | 'writer' | 'editor' | null {
  if (state.foundationMissing.length > 0) return 'architect'
  if (state.pendingRewrites.length > 0) return 'writer'
  if (state.arcBoundary?.isArcEnd) return 'editor'
  if (state.chapterReadiness && !state.chapterReadiness.readyToWrite) return 'architect'
  if (state.phase === 'writing' && state.nextChapter > 0) return 'writer'
  return null
}

function deriveProjectPhase(projectId: string, foundationMissing?: string[]): Phase {
  const missing = foundationMissing ?? detectFoundationMissing(projectId)
  if (missing.length > 0) return 'init'

  const arcs = db().prepare('SELECT status FROM volume_arcs WHERE project_id = ? ORDER BY sort_order ASC').all(projectId) as Array<{ status: string }>
  if (arcs.length > 0 && arcs.every((arc) => arc.status === 'completed')) {
    return 'complete'
  }

  return 'writing'
}

function reconcileProjectState(projectId: string, cb?: HostCallbacks): {
  phase: Phase
  foundationMissing: string[]
} {
  const foundationMissing = detectFoundationMissing(projectId)
  const nextPhase = deriveProjectPhase(projectId, foundationMissing)
  const prevPhase = (stateField(projectId, 'phase') as Phase) ?? 'init'
  const ts = now()

  setField(projectId, 'foundation_missing', JSON.stringify(foundationMissing))

  if (prevPhase !== nextPhase) {
    setField(projectId, 'phase', nextPhase)
    db().prepare('UPDATE progress SET phase = ?, updated_at = ? WHERE project_id = ?').run(nextPhase, ts, projectId)

    const reason = nextPhase === 'complete'
      ? '全书完成'
      : nextPhase === 'writing'
        ? '基础设定已满足写作条件'
        : '基础设定尚未齐备'
    cb?.onPhaseChange?.(prevPhase, nextPhase, reason)
  }

  return { phase: nextPhase, foundationMissing }
}

function decideHostAction(state: RouteState, inst: Instruction | null): HostAction {
  if (inst) {
    return {
      type: 'dispatch_agent',
      agent: inst.agent,
      task: inst.task,
      reason: inst.reason,
      targetState: inferHostOrchestratorState(state, inst),
      metadata: {
        chapter: inst.chapter ?? null,
        nextChapterId: state.nextChapterId,
        nextChapterTitle: state.nextChapterTitle
      }
    }
  }

  if (state.phase === 'complete') {
    return {
      type: 'transition',
      reason: '项目已完成，等待收尾',
      targetState: 'completed'
    }
  }

  return {
    type: 'wait',
    reason: buildWaitReason(state),
    targetState: inferHostOrchestratorState(state, null),
    metadata: {
      nextChapter: state.nextChapter,
      nextChapterId: state.nextChapterId
    }
  }
}

function buildWaitReason(state: RouteState): string {
  if (state.foundationMissing.length > 0) {
    return `等待补齐基础设定：${state.foundationMissing.join(', ')}`
  }
  if (state.pendingRewrites.length > 0) {
    return `等待处理重写队列：第${state.pendingRewrites.join(',')}章`
  }
  if (state.arcBoundary?.isArcEnd) {
    if (!state.hasArcReview) return '等待弧级评审'
    if (!state.hasArcSummary) return '等待弧摘要生成'
    if (state.arcBoundary.isVolumeEnd && !state.hasVolumeSummary) return '等待卷摘要生成'
    return '等待弧边界后续处理'
  }
  if (state.chapterReadiness && !state.chapterReadiness.readyToWrite) {
    return `等待当前章前置条件完成：${state.chapterReadiness.blockingIssues.join(', ')}`
  }
  if (state.phase === 'writing' && state.nextChapter <= 0) return '等待下一章节规划'
  return '当前无可执行动作，等待下一轮路由'
}

function listImportedDocumentsForContext(projectId: string): Array<{ filename: string; content: string }> {
  return db().prepare(
    `SELECT filename, content
     FROM imported_documents
     WHERE project_id = ?
     ORDER BY created_at ASC`
  ).all(projectId) as Array<{ filename: string; content: string }>
}

function formatGateReports(verdict: GateVerdict): string {
  const lines: string[] = []
  for (const report of verdict.reports ?? []) {
    const violations = report.violations ?? []
    if (violations.length === 0) continue
    lines.push(`- ${report.check_type}:`)
    for (const violation of violations.slice(0, 5)) {
      const evidence = violation.evidence ? `；证据：${violation.evidence}` : ''
      lines.push(`  - [${violation.severity}] ${violation.detail}${evidence}`)
    }
  }
  return lines.join('\n')
}

function parseGlobalGateSteer(text: string): { applied: boolean; message?: string } {
  const trimmed = text.trim()
  if (trimmed === '清空全局审核规则' || trimmed === '清空全局门禁规则') {
    setGlobalGateRules({ rules: [], forbidden_phrases: [] })
    return { applied: true, message: '已清空项目级全局审核规则' }
  }

  if (trimmed.startsWith('全局禁用短语:') || trimmed.startsWith('全局禁用短语：')) {
    const raw = trimmed.split(/[:：]/, 2)[1] ?? ''
    const phrases = raw.split(/[|\n,，;；]/).map((s) => s.trim()).filter(Boolean)
    const current = getGlobalGateRules()
    setGlobalGateRules({
      rules: current.rules,
      forbidden_phrases: [...new Set([...current.forbidden_phrases, ...phrases])]
    })
    return { applied: true, message: `已添加全局禁用短语 ${phrases.length} 条` }
  }

  if (trimmed.startsWith('全局审核规则:') || trimmed.startsWith('全局审核规则：')) {
    const raw = trimmed.split(/[:：]/, 2)[1] ?? ''
    const rules = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean)
    const current = getGlobalGateRules()
    setGlobalGateRules({
      rules: [...new Set([...current.rules, ...rules])],
      forbidden_phrases: current.forbidden_phrases
    })
    return { applied: true, message: `已添加全局审核规则 ${rules.length} 条` }
  }

  return { applied: false }
}

function getLatestReviewRecord(projectId: string): {
  review_type: string
  target_id: string
  verdict: string
  opinion: string
  polish_points: string
  rewrite_reason: string
  replan_suggestion: string
  created_at: number
} | null {
  const row = db().prepare(
    `SELECT review_type, target_id, verdict, opinion, polish_points, rewrite_reason, replan_suggestion, created_at
     FROM review_records
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(projectId) as {
    review_type: string
    target_id: string
    verdict: string
    opinion: string
    polish_points: string
    rewrite_reason: string
    replan_suggestion: string
    created_at: number
  } | undefined

  return row ?? null
}

function decideRecoveryAction(projectId: string, state: RouteState): HostAction | null {
  const chapterId = state.nextChapterId
  const latestSession = db().prepare(
    'SELECT agent_type, mode, status FROM agent_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(projectId) as { agent_type: string; mode: string; status: string } | undefined

  const latestDraft = chapterId ? getLatestDraftForRecovery(chapterId) : null
  if (latestDraft && (latestDraft.lifecycle === 'draft_generated' || latestDraft.lifecycle === 'draft_revised')) {
    return {
      type: 'recover',
      reason: `检测到待门禁草稿 v${latestDraft.version}，优先恢复到 Draft Gate`,
      targetState: 'draft_gate',
      agent: 'writer',
      task: `处理当前章节待门禁草稿并完成提交前检查。chapter_id=${chapterId ?? 'unknown'}，draft_id=${latestDraft.id}。优先衔接到 Draft Gate，不要重新起草。`,
      metadata: {
        chapterId,
        draftId: latestDraft.id,
        lifecycle: latestDraft.lifecycle
      }
    }
  }

  if (state.phase === 'writing' && state.nextChapter > 0 && !chapterId) {
    return {
      type: 'recover',
      reason: '写作阶段缺少当前章节实体，恢复到契约生成前置检查',
      targetState: 'contract_generation',
      agent: 'architect',
      task: `恢复当前待写章节的执行前置。目标章节序号=${state.nextChapter}。请先确保章节实体、契约与基础写作前置齐备。`,
      metadata: {
        chapterNumber: state.nextChapter
      }
    }
  }

  if (state.chapterReadiness && !state.chapterReadiness.readyToWrite) {
    return {
      type: 'recover',
      reason: `当前章节前置不完整：${state.chapterReadiness.blockingIssues.join(', ')}`,
      targetState: 'contract_generation',
      agent: 'architect',
      task: `为当前章节补齐缺失前置（契约/知识契约）。chapter_id=${chapterId ?? 'unknown'}。阻塞项：${state.chapterReadiness.blockingIssues.join('、')}。`,
      metadata: {
        chapterId,
        chapterNumber: state.chapterReadiness.chapterNumber
      }
    }
  }

  if (state.arcBoundary?.isArcEnd && !state.hasArcReview) {
    return {
      type: 'recover',
      reason: '已到弧末但弧级评审未完成，恢复到弧评审待定状态',
      targetState: 'arc_review_pending',
      agent: 'editor',
      task: `对当前弧执行弧级评审并补齐弧末收尾产物。当前位于第${state.arcBoundary.volume}卷第${state.arcBoundary.arc}弧末尾。`
    }
  }

  if (latestSession?.status === 'aborted') {
    const recoveredAgent = normalizeHostAgent((latestSession.agent_type as Instruction['agent']) ?? null) ?? undefined
    return {
      type: 'recover',
      reason: `检测到上次 ${latestSession.agent_type} 会话异常中断，先重建执行状态`,
      targetState: inferHostOrchestratorState(state, null),
      agent: recoveredAgent,
      task: latestSession.agent_type === 'writer'
        ? '恢复当前写作任务，先核对当前章节前置条件与已有草稿，再决定继续写作或进入门禁。'
        : latestSession.agent_type === 'editor'
          ? '恢复当前评审任务，先核对目标弧/卷的评审前置与已有记录。'
          : '恢复当前规划任务，先核对已有规划产物与缺失项，再决定继续补齐。'
    }
  }

  return null
}

function getLatestDraftForRecovery(chapterId: string): {
  id: string
  version: number
  lifecycle: string
} | null {
  const row = db().prepare(
    'SELECT id, version, lifecycle FROM chapter_drafts WHERE chapter_id = ? ORDER BY version DESC LIMIT 1'
  ).get(chapterId) as { id: string; version: number; lifecycle: string } | undefined
  return row ?? null
}

function hasChapterPlanForRecovery(chapterId: string): boolean {
  const row = db().prepare(
    `SELECT 1 FROM chapter_plans
     WHERE chapter_id = ?
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`
  ).get(chapterId) as { 1: number } | undefined
  return !!row
}

function countDraftFailuresForChapter(chapterId: string): number {
  const row = db().prepare(
    `SELECT COUNT(*) AS c FROM draft_gate_verdicts v
     JOIN chapter_drafts d ON v.draft_id = d.id
     WHERE d.chapter_id = ? AND v.overall_passed = 0`
  ).get(chapterId) as { c: number }
  return row.c
}

function commitChapterFromGate(projectId: string, chapterId: string, draftId: string): void {
  const result = commitDraft(draftId)
  if (!result.success) return

  const arcRow = db().prepare(
    `SELECT acp.arc_id
     FROM arc_chapter_plans acp
     JOIN volume_arcs va ON acp.arc_id = va.id
     WHERE va.project_id = ? AND acp.id = ?
     LIMIT 1`
  ).get(projectId, chapterId) as { arc_id: string } | undefined

  if (arcRow?.arc_id) {
    db().prepare(
      "UPDATE arc_chapter_plans SET status = 'written', updated_at = ? WHERE arc_id = ? AND id = ?"
    ).run(now(), arcRow.arc_id, chapterId)

    db().prepare(
      "UPDATE volume_arcs SET actual_chapters = actual_chapters + 1, status = 'in_progress', updated_at = ? WHERE id = ?"
    ).run(now(), arcRow.arc_id)
  }
}

function decidePostCommitAction(projectId: string, chapterId: string, draftId: string): HostAction {
  reconcileProjectState(projectId)
  const state = LoadState(projectId)
  const instruction = Route(state)
  const recoveryAction = decideRecoveryAction(projectId, state)
  const routedAction = recoveryAction ?? decideHostAction(state, instruction)

  return {
    ...routedAction,
    reason: `Draft Gate 通过，章节已提交：${chapterId}（draft=${draftId}）。${routedAction.reason}`,
    metadata: {
      ...(routedAction.metadata ?? {}),
      committedChapterId: chapterId,
      committedDraftId: draftId
    }
  }
}

function buildPlanGateAction(chapterId: string, verdict: GateVerdict): HostAction {
  const reportText = formatGateReports(verdict)
  if (verdict.verdict === 'pass') {
    return {
      type: 'recover',
      reason: `Plan Gate 通过：${verdict.summary}`,
      targetState: 'writing',
      agent: 'writer',
      task: `继续当前章节正文写作。chapter_id=${chapterId}。章节计划已通过门禁，直接进入正文撰写。`,
      metadata: {
        chapterId,
        verdict: verdict.verdict
      }
    }
  }

  if (verdict.verdict === 'replan') {
    return {
      type: 'recover',
        reason: `Plan Gate 判定重新规划：${verdict.summary}`,
        targetState: 'contract_generation',
        agent: 'architect',
        task: `重建当前章节的契约/规划前置。chapter_id=${chapterId}。Plan Gate 结论：${verdict.summary}。\n详细问题：\n${reportText || '无'}\n请针对这些问题重新规划。`,
      metadata: {
        chapterId,
        verdict: verdict.verdict,
        recommendedModel: verdict.recommended_model
      }
    }
  }

  if (verdict.verdict === 'escalate') {
    return {
      type: 'wait',
      reason: `Plan Gate 需要升级处理：${verdict.summary}`,
      targetState: 'plan_gate',
      metadata: {
        chapterId,
        verdict: verdict.verdict,
        recommendedModel: verdict.recommended_model,
        manualInterventionRequired: true
      }
    }
  }

  return {
    type: 'recover',
    reason: `Plan Gate 未通过，回退修订章节计划：${verdict.summary}`,
    targetState: 'plan_gate',
    agent: 'writer',
    task: `修订当前章节计划并重新提交 Plan Gate。chapter_id=${chapterId}。问题摘要：${verdict.summary}。\n详细违规点：\n${reportText || '无'}\n逐条修复后再提交。`,
    metadata: {
      chapterId,
      verdict: verdict.verdict,
      recommendedModel: verdict.recommended_model
    }
  }
}

function buildDraftGateAction(projectId: string, chapterId: string, draftId: string, verdict: GateVerdict): HostAction {
  const reportText = formatGateReports(verdict)
  switch (verdict.verdict) {
    case 'pass': {
      commitChapterFromGate(projectId, chapterId, draftId)
      const postCommitAction = decidePostCommitAction(projectId, chapterId, draftId)
      return {
        ...postCommitAction,
        reason: `Draft Gate 通过：${verdict.summary}；${postCommitAction.reason}`,
        metadata: {
          ...(postCommitAction.metadata ?? {}),
          chapterId,
          draftId,
          verdict: verdict.verdict
        }
      }
    }
    case 'polish':
      return {
        type: 'recover',
        reason: `Draft Gate 判定局部打磨：${verdict.summary}`,
        targetState: 'polishing',
        agent: 'writer',
        task: `根据 Draft Gate 结论打磨当前章节草稿。chapter_id=${chapterId}，draft_id=${draftId}。问题摘要：${verdict.summary}。\n详细违规点：\n${reportText || '无'}\n逐条修复，不要重新起草整章。`,
        metadata: {
          chapterId,
          draftId,
          verdict: verdict.verdict
        }
      }
    case 'rewrite':
      rejectDraft(draftId, verdict.summary)
      return {
        type: 'recover',
        reason: `Draft Gate 判定重写：${verdict.summary}`,
        targetState: 'chapter_rewrite',
        agent: 'writer',
        task: `重写当前章节。chapter_id=${chapterId}。上一版草稿已被门禁拒绝。问题摘要：${verdict.summary}。\n详细违规点：\n${reportText || '无'}\n重写时必须逐条规避这些问题。`,
        metadata: {
          chapterId,
          draftId,
          verdict: verdict.verdict,
          recommendedModel: verdict.recommended_model
        }
      }
    case 'replan':
      rejectDraft(draftId, verdict.summary)
      return {
        type: 'recover',
        reason: `Draft Gate 判定重新规划：${verdict.summary}`,
        targetState: 'architecting',
        agent: 'architect',
        task: `重新规划当前章节与上游约束。chapter_id=${chapterId}。问题摘要：${verdict.summary}。\n详细违规点：\n${reportText || '无'}\n先修正规划，再回到写作。`,
        metadata: {
          chapterId,
          draftId,
          verdict: verdict.verdict,
          recommendedModel: verdict.recommended_model
        }
      }
    case 'escalate': {
      const failCount = countDraftFailuresForChapter(chapterId)
      rejectDraft(draftId, verdict.summary)
      return {
        type: 'recover',
        reason: `Draft Gate 需要升级处理（连续失败 ${failCount} 次）：${verdict.summary}`,
        targetState: 'chapter_rewrite',
        agent: 'writer',
        task: `使用更高强度重写当前章节。chapter_id=${chapterId}。Gate 建议模型：${verdict.recommended_model}。问题摘要：${verdict.summary}。\n详细违规点：\n${reportText || '无'}\n不要重复触发同类问题。`,
        metadata: {
          chapterId,
          draftId,
          verdict: verdict.verdict,
          failCount,
          recommendedModel: verdict.recommended_model
        }
      }
    }
    default:
      return {
        type: 'wait',
        reason: `Draft Gate 返回未知判定，等待人工确认：${verdict.summary}`,
        targetState: 'draft_gate',
        metadata: {
          chapterId,
          draftId,
          verdict: verdict.verdict,
          manualInterventionRequired: true
        }
      }
  }
}

async function decideWriterGateAction(projectId: string): Promise<HostAction | null> {
  const state = LoadState(projectId)
  const chapterId = state.nextChapterId
  if (!chapterId) return null

  const latestDraft = getLatestDraftForRecovery(chapterId)
  if (latestDraft && (latestDraft.lifecycle === 'draft_generated' || latestDraft.lifecycle === 'draft_revised')) {
    const verdict = await runDraftGate(latestDraft.id)
    return buildDraftGateAction(projectId, chapterId, latestDraft.id, verdict)
  }

  if (hasChapterPlanForRecovery(chapterId)) {
    const verdict = await runPlanGate(projectId, chapterId)
    return buildPlanGateAction(chapterId, verdict)
  }

  return null
}

function decideEditorFollowUpAction(projectId: string): HostAction | null {
  const state = LoadState(projectId)
  const latestReview = getLatestReviewRecord(projectId)

  if (latestReview && state.arcBoundary?.isArcEnd) {
    switch (latestReview.verdict) {
      case 'polish':
        return {
          type: 'recover',
          reason: `Editor 评审要求打磨：${latestReview.opinion || latestReview.polish_points || '请根据评审意见修订'}`,
          targetState: 'polishing',
          agent: 'writer',
          task: `根据最新评审意见打磨章节。review_type=${latestReview.review_type}，target_id=${latestReview.target_id}。polish_points=${latestReview.polish_points || '[]'}。`,
          metadata: {
            reviewType: latestReview.review_type,
            targetId: latestReview.target_id,
            verdict: latestReview.verdict
          }
        }
      case 'rewrite_chapter':
        return {
          type: 'recover',
          reason: `Editor 评审要求重写：${latestReview.rewrite_reason || latestReview.opinion || '请按评审意见重写'}`,
          targetState: 'chapter_rewrite',
          agent: 'writer',
          task: `根据最新评审意见重写章节。review_type=${latestReview.review_type}，target_id=${latestReview.target_id}。rewrite_reason=${latestReview.rewrite_reason || latestReview.opinion}。`,
          metadata: {
            reviewType: latestReview.review_type,
            targetId: latestReview.target_id,
            verdict: latestReview.verdict
          }
        }
      case 'replan':
        return {
          type: 'recover',
          reason: `Editor 评审要求重新规划：${latestReview.replan_suggestion || latestReview.opinion || '请重新规划'}`,
          targetState: 'architecting',
          agent: 'architect',
          task: `根据最新评审意见重新规划。review_type=${latestReview.review_type}，target_id=${latestReview.target_id}。replan_suggestion=${latestReview.replan_suggestion || latestReview.opinion}。`,
          metadata: {
            reviewType: latestReview.review_type,
            targetId: latestReview.target_id,
            verdict: latestReview.verdict
          }
        }
      case 'pass':
      case 'note':
      default:
        break
    }
  }

  const instruction = Route(state)
  const recoveryAction = decideRecoveryAction(projectId, state)
  return recoveryAction ?? decideHostAction(state, instruction)
}

function decideSubagentFailureAction(
  projectId: string,
  agentType: string,
  task: string,
  summary: string
): HostAction {
  const state = LoadState(projectId)
  const chapterId = state.nextChapterId
  const latestDraft = chapterId ? getLatestDraftForRecovery(chapterId) : null
  const hasChapterPlan = chapterId ? hasChapterPlanForRecovery(chapterId) : false
  const failureReason = summary || `${agentType} 未完成任务`

  if (agentType === 'writer') {
    if (latestDraft && (latestDraft.lifecycle === 'draft_generated' || latestDraft.lifecycle === 'draft_revised')) {
      return {
        type: 'recover',
        reason: `Writer 未完成，但检测到待门禁草稿，回退到 Draft Gate：${failureReason}`,
        targetState: 'draft_gate',
        agent: 'writer',
        task: `处理当前章节待门禁草稿并完成提交前检查。chapter_id=${chapterId ?? 'unknown'}，draft_id=${latestDraft.id}。优先进入 Draft Gate，不要重新起草。`,
        metadata: {
          chapterId,
          draftId: latestDraft.id,
          failedTask: task
        }
      }
    }

    if (chapterId && hasChapterPlan) {
      return {
        type: 'recover',
        reason: `Writer 未完成，当前章已有计划，回退到 Plan Gate：${failureReason}`,
        targetState: 'plan_gate',
        agent: 'writer',
        task: `恢复当前章节计划校验并决定是否继续正文写作。chapter_id=${chapterId}。先核对已有 chapter_plan 与契约，再决定继续写作。`,
        metadata: {
          chapterId,
          failedTask: task
        }
      }
    }

    if (state.chapterReadiness && !state.chapterReadiness.readyToWrite) {
      return {
        type: 'recover',
        reason: `Writer 未完成且前置不满足，回退到 Contract Generation：${failureReason}`,
        targetState: 'contract_generation',
        agent: 'architect',
        task: `为当前章节补齐缺失前置（契约/知识契约）。chapter_id=${chapterId ?? 'unknown'}。阻塞项：${state.chapterReadiness.blockingIssues.join('、')}。`,
        metadata: {
          chapterId,
          failedTask: task
        }
      }
    }
  }

  if (agentType === 'editor') {
    return {
      type: 'recover',
      reason: `Editor 未完成，回退到弧级评审待定：${failureReason}`,
      targetState: 'arc_review_pending',
      agent: 'editor',
      task: '恢复当前评审任务，先核对目标弧/卷的评审前置与已有记录，再完成弧末收尾。',
      metadata: {
        failedTask: task
      }
    }
  }

  if (agentType === 'architect' || agentType === 'architect_long') {
    if (state.chapterReadiness && !state.chapterReadiness.readyToWrite) {
      return {
        type: 'recover',
        reason: `Architect 未完成，当前章仍缺前置，回退到 Contract Generation：${failureReason}`,
        targetState: 'contract_generation',
        agent: 'architect',
        task: `继续为当前章节补齐缺失前置。chapter_id=${chapterId ?? 'unknown'}。阻塞项：${state.chapterReadiness.blockingIssues.join('、')}。`,
        metadata: {
          chapterId,
          failedTask: task
        }
      }
    }

    if (state.foundationMissing.length > 0) {
      return {
        type: 'recover',
        reason: `Architect 未完成，基础设定仍未齐备，回退到 Architecting：${failureReason}`,
        targetState: 'architecting',
        agent: 'architect',
        task: `继续补齐基础设定缺项：${state.foundationMissing.join('、')}。优先完成当前缺失项，不要跨步推进。`,
        metadata: {
          failedTask: task
        }
      }
    }
  }

  return {
    type: 'wait',
    reason: `子任务失败且无法自动恢复，暂停等待人工介入：${failureReason}`,
    targetState: inferHostOrchestratorState(state, null),
    metadata: {
      failedAgent: agentType,
      failedTask: task,
      manualInterventionRequired: true
    }
  }
}

function instructionFromAction(action: HostAction): Instruction | null {
  if (!action.agent || !action.task) return null
  return {
    agent: action.agent,
    task: action.task,
    reason: action.reason,
    chapter: typeof action.metadata?.chapter === 'number'
      ? (action.metadata.chapter as number)
      : undefined
  }
}

function logHostAction(projectId: string, action: HostAction): void {
  logEvent(projectId, 'host_action', action.reason, {
    type: action.type,
    agent: action.agent ?? null,
    task: action.task ?? null,
    targetState: action.targetState ?? null,
    metadata: action.metadata ?? {}
  })
}

function reduceAfterSubAgent(projectId: string): {
  state: RouteState
  instruction: Instruction | null
  action: HostAction
  recoveryAction: HostAction | null
} {
  reconcileProjectState(projectId)
  const state = LoadState(projectId)
  const instruction = Route(state)
  const recoveryAction = decideRecoveryAction(projectId, state)
  const action = recoveryAction ?? decideHostAction(state, instruction)
  syncExecutionState(projectId, state, instruction, action)
  return { state, instruction, action, recoveryAction }
}

// ── LLM caller (direct, not through runAgentEngine) ──

interface LlmToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: JSONSchema }
}

async function callLlm(
  messages: LlmMessage[],
  tools: LlmToolDef[],
  signal?: AbortSignal
): Promise<{
  finishReason: string
  content: string | null
  toolCalls: Array<{ id: string; name: string; arguments: string }>
}> {
  const provider = getActive()
  if (!provider) throw new Error('未配置 API，请先在设置中添加')
  if (!provider.apiKey) throw new Error('API Key 未设置')

  const routing = resolveModel('architect', 'coordinator', { riskLevel: 'high' })
  const routed = getProviderForTier(routing.tier) || provider
  const url = `${routed.base_url.replace(/\/$/, '')}/chat/completions`
  const model = routing.model || routed.llm_model || provider.llm_model || 'gpt-4o-mini'

  console.log('[Host] callLlm', { model, tier: routing.tier, msgCount: messages.length, toolCount: tools.length })

  const body: Record<string, unknown> = { model, messages, temperature: 0.7, max_tokens: 4096 }
  if (tools.length > 0) { body.tools = tools; body.tool_choice = 'auto' }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${routed.apiKey}` },
    body: JSON.stringify(body), signal
  })

  if (!resp.ok) {
    const detail = await resp.text()
    throw new Error(`LLM API ${resp.status}: ${detail.slice(0, 300)}`)
  }

  const json = (await resp.json()) as {
    choices: Array<{
      finish_reason: string
      message: {
        content: string | null
        tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
      }
    }>
  }
  const ch = json.choices[0]
  return {
    finishReason: ch.finish_reason,
    content: ch.message.content ?? null,
    toolCalls: (ch.message.tool_calls ?? []).map(tc => ({
      id: tc.id, name: tc.function.name, arguments: tc.function.arguments
    }))
  }
}

// ── SubAgent execution ──

async function runSubAgent(
  projectId: string, agentType: string, task: string, signal: AbortSignal,
  onThinking?: (agentType: string, text: string) => void,
  onToolCall?: (agentType: string, toolName: string, args: Record<string, unknown>) => void,
  onToolResult?: (agentType: string, toolName: string, result: ToolResult) => void
): Promise<AgentResponse> {
  const allTools = getSubAgentTools(agentType)
  const tools = filterToolsForTask(allTools, task)
  const subPrompt = getSubAgentPrompt(agentType, task)
  const state = LoadState(projectId)
  const subContext = await buildRichAgentContext(projectId, agentType, state)

  return runAgentEngine({
    projectId,
    agentType: agentType as 'architect' | 'writer' | 'editor',
    tools,
    context: subContext,
    mode: 'subagent',
    systemPrompt: subPrompt,
    userMessage: `[Host] 任务：${task}\n上述是流程层的明确指令，请立即执行，不要先输出推理。`,
    signal,
    onThinking: (text: string) => onThinking?.(agentType, text),
    onToolCall: (toolName: string, args: Record<string, unknown>) => onToolCall?.(agentType, toolName, args),
    onToolResult: (toolName: string, result: ToolResult) => onToolResult?.(agentType, toolName, result)
  })
}

async function buildRichAgentContext(projectId: string, agentType: string, state: import('@shared/types').RouteState): Promise<string> {
  const base: Record<string, unknown> = {
    phase: state.phase, flow: state.flow,
    lastCompleted: state.lastCompleted, nextChapter: state.nextChapter,
    nextChapterId: state.nextChapterId,
    nextChapterTitle: state.nextChapterTitle,
    totalPlanned: state.totalPlannedChapters, foundationMissing: state.foundationMissing
  }

  const importedDocs = listImportedDocumentsForContext(projectId)
  if (importedDocs.length > 0) {
    base.importedDocsFull = importedDocs
  }

  const globalGateRules = getGlobalGateRules()
  if (globalGateRules.rules.length > 0 || globalGateRules.forbidden_phrases.length > 0) {
    base.globalGateRules = globalGateRules
  }

  // Include RAG foundation memory for all agents
  try {
    const query = agentType === 'writer'
      ? `第${state.nextChapter}章 前文 角色状态 伏笔`
      : `项目全局设定 世界观 角色`
    const rag = await buildRagContext(projectId, query)
    if (rag && rag.chunks.length > 0) {
      const foundCount = rag.chunks.filter(c => c.source_type === 'foundation').length
      console.log('[Host] RAG context built', { agentType, totalChunks: rag.chunks.length, foundationChunks: foundCount, query: query.slice(0, 40) })
      base.ragChunkCount = rag.chunks.length
      base.ragContext = rag.chunks.slice(0, 10).map(c => ({
        source: c.source_type, content: c.source_type === 'foundation' ? c.content : c.content.slice(0, 2000), score: c.score?.toFixed(2)
      }))
    }
  } catch { /* RAG unavailable */ }

    // Include target chapter ID for Writer
  if (agentType === 'writer' && state.nextChapter > 0) {
    const db = getDb()
    let targetChapter = state.nextChapterId
      ? {
          id: state.nextChapterId,
          title: state.nextChapterTitle || `第${state.nextChapter}章`,
          sort_order: state.nextChapter
        }
      : undefined

    // Auto-create chapter from arc_chapter_plan if missing
    if (!targetChapter) {
      const plan = db.prepare(
        `SELECT acp.*, va.volume_number FROM arc_chapter_plans acp
         JOIN volume_arcs va ON acp.arc_id = va.id
         WHERE va.project_id = ? AND acp.chapter_number = ?
         LIMIT 1`
      ).get(projectId, state.nextChapter) as Record<string, unknown> | undefined
      if (plan) {
        const chId = plan.id as string
        const volNum = plan.volume_number as number
        const volTitle = `第${volNum}卷`
        let volId = (db.prepare(
          "SELECT id FROM volumes WHERE project_id = ? AND title = ?"
        ).get(projectId, volTitle) as { id: string } | undefined)?.id
        if (!volId) {
          volId = uuid()
          db.prepare('INSERT INTO volumes (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)').run(volId, projectId, volTitle, volNum)
        }
        const chTitle = (plan.chapter_title as string) || `第${state.nextChapter}章`
        db.prepare(
          `INSERT INTO chapters (id, volume_id, project_id, title, content, plain_text, sort_order, word_count, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, '', '', ?, 0, 'draft', ?, ?)`
        ).run(chId, volId, projectId, chTitle, state.nextChapter, now(), now())
        console.log('[Host] auto-created chapter', { chapterId: chId.slice(0, 8), title: chTitle, chapterNum: state.nextChapter })
        targetChapter = { id: chId, title: chTitle, sort_order: state.nextChapter }
      }
    }

    if (targetChapter) {
      base.targetChapterId = targetChapter.id
      base.targetChapterTitle = targetChapter.title
      base.targetChapterNumber = targetChapter.sort_order
    }

    // Include arc_chapter_plan as constraints
    const plans = db.prepare(
      `SELECT acp.* FROM arc_chapter_plans acp
       JOIN volume_arcs va ON acp.arc_id = va.id
       WHERE va.project_id = ? AND acp.chapter_number = ?
       LIMIT 1`
    ).all(projectId, state.nextChapter) as Array<Record<string, unknown>>
    if (plans.length > 0) {
      const p = plans[0]
      base.arcChapterPlan = {
        chapter_title: p.chapter_title, chapter_goal: p.chapter_goal,
        scenes: safeParse(p.scenes), estimated_words: p.estimated_words,
        foreshadowing_plan: safeParse(p.foreshadowing_plan)
      }
    }

    // Include contracts for Writer — inject as planning section
    try {
      const chapterId = targetChapter?.id
      if (chapterId) {
        const contract = db.prepare('SELECT * FROM chapter_contracts WHERE chapter_id = ?').get(chapterId) as Record<string, unknown> | undefined
        const knowledge = db.prepare('SELECT * FROM knowledge_contracts WHERE chapter_id = ?').get(chapterId) as Record<string, unknown> | undefined
        if (contract) {
          base.chapterContract = { required_beats: contract.required_beats, forbidden_moves: contract.forbidden_moves, hook_goal: contract.hook_goal }
          base.planningGuide = buildPlanningGuide(contract, knowledge as Record<string, unknown> | undefined)
        }
        if (knowledge) base.knowledgeContract = { known_facts: knowledge.known_facts, unknown_facts: knowledge.unknown_facts, reader_visible_facts: knowledge.reader_visible_facts, forbidden_inferences: knowledge.forbidden_inferences }
      }
    } catch { /* contracts unavailable */ }
  }

  // Build readable context: foundation docs as plain text sections, rest as JSON
  const parts: string[] = []

  // Imported docs FIRST — full original markdown, no truncation
  if (base.importedDocsFull) {
    const docs = base.importedDocsFull as Array<{ filename: string; content: string }>
    const totalChars = docs.reduce((s, d) => s + d.content.length, 0)
    console.log('[Host] context importedDocsFull:', { count: docs.length, totalChars, perDoc: docs.map(d => ({ file: d.filename, chars: d.content.length, preview: d.content.slice(0, 100) })) })
    parts.push(`=== 导入文档原文（全部原文，无裁切，共${docs.length}份，必须严格遵循）===\n`)
    docs.forEach((d, i) => {
      parts.push(`--- 文档 ${i + 1}: ${d.filename} ---\n${d.content}\n`)
    })
    parts.push('=== 导入文档结束 ===')
    delete base.importedDocsFull
  }

  if (base.planningGuide) {
    parts.push(`\n${base.planningGuide as string}`)
    delete base.planningGuide
  }

  // Rest as formatted JSON
  parts.push(`\n--- 项目状态 ---\n${JSON.stringify(base, null, 2)}`)
  return parts.join('\n')
}

function getSubAgentTools(agentType: string): ToolDefinition[] {
  switch (agentType) {
    case 'architect': case 'architect_long': return architectTools
    case 'writer': return writerTools
    case 'editor': return editorTools
    default: return []
  }
}

function getSubAgentPrompt(agentType: string, task: string): string {
  switch (agentType) {
    case 'architect': case 'architect_long':
      return `你是小说架构师。你被派发执行一个具体任务。

【当前任务】${task}

你的 context 最前面有 "=== 导入文档原文 ===" 段落，其中包含用户导入的所有设定文档。
这些文档是最高优先级的创作依据，你必须逐字使用其中的角色名、世界观、大纲结构。

【规则】
- 先读完 context 中的导入文档原文，确认其中有哪些可用信息。
- 只执行【当前任务】中要求的工作。不要做任务之外的事。
- 如果任务要求创建卷弧骨架，只创建卷弧骨架，不要同时创建角色或世界规则。
- 完成后返回结果，不要多做事。`
    case 'writer':
      return `你是小说写手。完成分配给你的章节写作任务。

你的固定写作流程（必须按顺序执行）：
1. 从 context 的 targetChapterId 获取目标章节ID，所有工具调用都必须使用这个 chapter_id。如果 context 中没有 targetChapterId，说明章节未初始化，应报错等待重试。
2. 检查 context 中的 arcChapterPlan（章节目标、场景列表、预估字数、伏笔计划），严格遵守。章节标题必须使用 plan 中的 chapter_title，不得修改。
3. 检查 context 中的 chapter_contract（必需要素 required_beats、禁止动作 forbidden_moves、钩子目标 hook_goal）和 knowledge_contract（角色已知/未知/读者可见/禁止推断）。
4. 制定章节计划（plan_chapter）时，必须将 contract 中的 required_beats 拆分为具体场景、将 forbidden_moves 标注为计划中的禁区。plan_content 字段应包含「必需要素」「禁止动作」「钩子目标」三个小节。
5. novel_context — 加载上下文（前情摘要、角色状态、伏笔、RAG 记忆、导入文档）。
6. write_chapter_body — 撰写整章正文。chapter_id 使用 context 中的 targetChapterId。正文必须覆盖所有 required_beats，避免所有 forbidden_moves。
7. consistency_check — 逐条对照 contract 和 knowledge_contract 检查一致性。
8. request_draft_review — 请求提交草稿。chapter_id 使用 targetChapterId。

每章完整执行上述流程一次。只做当前任务要求的事。完成后返回结果。`
    case 'editor':
      return `你是小说编辑。完成分配给你的评审或摘要任务。只做当前任务。`
    default: return 'You are a helpful assistant.'
  }
}

// Filter tools based on what tool names appear in the task string
const FOUNDATION_TOOL_MAP: Record<string, string[]> = {
  set_story_compass: ['set_story_compass', 'set_genre_positioning', 'set_core_selling_point', 'add_title_candidate'],
  create_character: ['create_character'],
  create_character_arc: ['create_character_arc'],
  create_world_rule: ['create_world_rule', 'create_worldbuilding'],
  create_volume_arc: ['create_volume_arc'],
  create_arc_outline: ['create_arc_outline', 'create_arc_chapter_plans'],
  generate_chapter_contract: ['generate_chapter_contract', 'generate_knowledge_contract'],
  create_foreshadowing: ['create_foreshadowing'],
}
const CORE_TOOLS = ['report_architecture_done']

function filterToolsForTask(allTools: ToolDefinition[], task: string): ToolDefinition[] {
  // Sort by key length descending: longer keys first to avoid substring false matches
  // e.g. create_character_arc must be checked before create_character
  const sortedKeys = Object.keys(FOUNDATION_TOOL_MAP).sort((a, b) => b.length - a.length)
  for (const toolName of sortedKeys) {
    if (task.includes(toolName)) {
      const toolSet = FOUNDATION_TOOL_MAP[toolName]
      const filtered = allTools.filter(t => toolSet.includes(t.name) || CORE_TOOLS.includes(t.name))
      if (filtered.length > 0) {
        console.log('[Host] filterToolsForTask:', { matchedTool: toolName, tools: filtered.map(t => t.name) })
        return filtered
      }
    }
  }
  // If no match, return all tools (writer/editor or general architect)
  return allTools
}

// ── Event callbacks ──

export interface HostCallbacks {
  onSystem?: (text: string) => void
  onCoordinatorThinking?: (text: string) => void
  onSubAgentStart?: (agentType: string, task: string) => void
  onSubAgentDone?: (agentType: string, done: boolean, summary: string) => void
  onSubAgentThinking?: (agentType: string, text: string) => void
  onSubAgentToolCall?: (agentType: string, toolName: string, args: Record<string, unknown>) => void
  onSubAgentToolResult?: (agentType: string, toolName: string, success: boolean, error?: string) => void
  onPhaseChange?: (from: string, to: string, reason: string) => void
  onFlowChange?: (from: string, to: string, reason: string) => void
  onProgress?: (chapter: number, total: number) => void
  onCheckpoint?: (message: string) => void
}

// ── StopGuard helper ──

function checkStopGuard(projectId: string): { allow: boolean; injectMessage?: string } {
  const phase = (stateField(projectId, 'phase') as string) ?? 'init'
  if (phase === 'complete') return { allow: true }
  return { allow: false, injectMessage: '禁止结束对话。Phase 尚未 Complete，请继续下一步（调 subagent 或查 novel_context）。' }
}

// ── Progress update helper ──

function updateProgress(projectId: string, agentType: string, cb?: HostCallbacks): void {
  const ts = now()

  // ── Architect: sync chapters from arc_chapter_plans ──
  if (agentType === 'architect' || agentType === 'architect_long') {
    // Keep chapter entities aligned with planning output, but do not silently补业务前置。
    syncChaptersFromPlans(projectId)
    const chCount = countChapters(projectId)
    const plCount = countPlans(projectId)
    if (chCount > 0 || plCount > 0) cb?.onProgress?.(chCount, plCount)
  }

  // ── Writer: update chapter count ──
  if (agentType === 'writer') {
    const count = countChapters(projectId)
    const total = countPlans(projectId)
    if (count > 0 || total > 0) {
      setField(projectId, 'current_chapter', count)
      db().prepare('UPDATE progress SET current_chapter = ?, updated_at = ? WHERE project_id = ?').run(count, ts, projectId)
      cb?.onProgress?.(count, total)
    }
  }
  // ── Editor: sync rewrite queue from review output ──
  if (agentType === 'editor') {
    const lastReview = db().prepare(
      "SELECT * FROM review_records WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(projectId) as Record<string, unknown> | undefined
    if (lastReview && (lastReview.verdict === 'rewrite_chapter' || lastReview.verdict === 'polish')) {
      const points = parseRewriteChapters(lastReview.polish_points as string)
      if (points.length > 0) {
        const current = parseRewriteChapters(stateField(projectId, 'pending_rewrites') as string)
        const merged = [...new Set([...current, ...points])]
        setField(projectId, 'pending_rewrites', JSON.stringify(merged))
        setField(projectId, 'flow', lastReview.verdict === 'rewrite_chapter' ? 'rewriting' : 'polishing')
        cb?.onSystem?.(`[重写] 章节 ${points.join(',')} 排入队列`)
      }
    }
  }

  // Reset steering after non-editor agents complete
  if (agentType !== 'editor') {
    const cf = stateField(projectId, 'flow') as string
    if (cf === 'steering') { setField(projectId, 'flow', 'writing'); setField(projectId, 'pending_steer', '') }
  }
}

// ── Auto-sync chapters from arc_chapter_plans ──

function syncChaptersFromPlans(projectId: string): void {
  const plans = db().prepare(
    `SELECT acp.*, va.volume_number, va.volume_title FROM arc_chapter_plans acp
     JOIN volume_arcs va ON acp.arc_id = va.id
     WHERE va.project_id = ?
     ORDER BY va.volume_number ASC, acp.chapter_number ASC`
  ).all(projectId) as Array<Record<string, unknown>>

  let created = 0
  for (const plan of plans) {
    const planId = plan.id as string
    const volNum = plan.volume_number as number
    const volTitle = (plan.volume_title as string) || `第${volNum}卷`
    const chNum = plan.chapter_number as number
    const chTitle = (plan.chapter_title as string) || `第${chNum}章`

    // Ensure volume exists
    let volId = (db().prepare(
      "SELECT id FROM volumes WHERE project_id = ? AND title = ?"
    ).get(projectId, volTitle) as { id: string } | undefined)?.id

    if (!volId) {
      volId = uuid()
      db().prepare(
        'INSERT INTO volumes (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)'
      ).run(volId, projectId, volTitle, volNum)
    }

    // Check if chapter already exists for this plan
    const existing = db().prepare(
      'SELECT id FROM chapters WHERE id = ?'
    ).get(planId) as { id: string } | undefined

    if (!existing) {
      created++
      db().prepare(
        `INSERT INTO chapters (id, volume_id, project_id, title, content, plain_text, sort_order, word_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', '', ?, 0, 'draft', ?, ?)`
      ).run(planId, volId, projectId, chTitle, chNum, ts(), ts())
    }
  }
  if (created > 0) console.log('[Host] syncChaptersFromPlans', { projectId: projectId.slice(0, 8), created, totalPlans: plans.length })
}

function countChapters(projectId: string): number {
  return (db().prepare(
    "SELECT COUNT(*) AS c FROM chapter_drafts WHERE project_id = ? AND lifecycle = 'final_committed'"
  ).get(projectId) as { c: number }).c
}

function countPlans(projectId: string): number {
  return (db().prepare(
    "SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id IN (SELECT id FROM volume_arcs WHERE project_id = ?)"
  ).get(projectId) as { c: number }).c
}

function ts(): number { return now() }

function parseRewriteChapters(raw: string): number[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr)) return arr.map(Number).filter(n => !isNaN(n))
  } catch { /* */ }
  return []
}

function safeParse(raw: unknown): unknown {
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return raw } }
  return raw
}

function parseStringArray(str: unknown): string[] {
  if (!str) return []
  try {
    const arr = typeof str === 'string' ? JSON.parse(str) : str
    return Array.isArray(arr) ? arr.map(String) : []
  } catch { return [] }
}

function buildPlanningGuide(contract: Record<string, unknown> | undefined, knowledge: Record<string, unknown> | undefined): string {
  const lines: string[] = ['【章节规划指南 — 必须融入 chapter_plan 的 plan_content】']
  const reqBeats = parseStringArray(contract?.required_beats)
  const forbidMoves = parseStringArray(contract?.forbidden_moves)
  const hookGoal = (contract?.hook_goal as string) ?? ''
  const forbidInfer = parseStringArray(knowledge?.forbidden_inferences)

  if (reqBeats.length > 0) {
    lines.push('\n✅ 必需要素（每个 beat 必须有对应场景）：')
    reqBeats.forEach((b, i) => lines.push(`  ${i + 1}. ${b}`))
  }
  if (forbidMoves.length > 0) {
    lines.push('\n❌ 禁止动作（任何场景不得包含）：')
    forbidMoves.forEach(m => lines.push(`  - ${m}`))
  }
  if (hookGoal) {
    lines.push(`\n🎯 章末钩子目标：${hookGoal}`)
  }
  if (forbidInfer.length > 0) {
    lines.push('\n🚫 禁止的角色推断/感知：')
    forbidInfer.forEach(f => lines.push(`  - ${f}`))
  }
  return lines.join('\n')
}

// ── Checkpoint ──

function saveCheckpoint(projectId: string, agentType: string, task: string, success: boolean): void {
  const state = LoadState(projectId)
  db().prepare(
    `INSERT INTO orchestration_log (id, project_id, event_type, from_state, to_state, reason, details, created_at)
     VALUES (?, ?, 'checkpoint', ?, ?, ?, ?, ?)`
  ).run(uuid(), projectId, state.phase, state.phase,
    `${agentType}: ${task} (${success ? 'ok' : 'fail'})`,
    JSON.stringify({ phase: state.phase, flow: state.flow, lastCompleted: state.lastCompleted, nextChapter: state.nextChapter, foundationMissing: state.foundationMissing, agentType, task, success }),
    now())
}

function getLastCheckpoint(projectId: string): Record<string, unknown> | null {
  const row = db().prepare(
    "SELECT * FROM orchestration_log WHERE project_id = ? AND event_type = 'checkpoint' ORDER BY created_at DESC LIMIT 1"
  ).get(projectId) as Record<string, unknown> | undefined
  if (!row) return null
  try {
    return { ...row, details: typeof row.details === 'string' ? JSON.parse(row.details as string) : row.details }
  } catch { return row }
}

// ── Host ──

export class Host {
  private projectId: string
  private currentAbortController: AbortController | null = null
  private callbacks: HostCallbacks | undefined = undefined
  private loopRunning = false

  constructor(projectId: string) {
    this.projectId = projectId
    initTools()
    ensureSystemState(projectId)
  }

  setCallbacks(cb: HostCallbacks): void { this.callbacks = cb }

  getPhase(): string { return (stateField(this.projectId, 'phase') as string) ?? 'init' }
  getFlow(): string { return (stateField(this.projectId, 'flow') as string) ?? 'writing' }
  getLifecycle(): string { return (stateField(this.projectId, 'lifecycle') as string) ?? 'idle' }
  getState(): Record<string, unknown> | null { return db().prepare('SELECT * FROM system_state WHERE project_id = ?').get(this.projectId) as Record<string, unknown> | null }
  getProgress(): Record<string, unknown> | null { return db().prepare('SELECT * FROM progress WHERE project_id = ?').get(this.projectId) as Record<string, unknown> | null }

  // ── Lifecycle ──

  async start(): Promise<{ phase: string; message: string }> {
    const lc = this.getLifecycle()
    if (lc === 'running') return { phase: this.getPhase(), message: '已在运行中' }
    if (lc === 'completed') return { phase: this.getPhase(), message: '项目已完成，如需重新推进请先重置' }

    // Auto-parse unparsed imported documents before starting
    const count = await autoParseImportedDocs(this.projectId)

    // Recovery: if already has state (not first start), resume from checkpoint
    if (lc === 'paused') {
      setField(this.projectId, 'lifecycle', 'running')
      setField(this.projectId, 'is_paused', 0)
      logEvent(this.projectId, 'resume', '从暂停恢复')

      // Check if last subagent was aborted → re-verify foundation
      const lastSession = db().prepare(
        "SELECT agent_type, mode, status FROM agent_sessions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(this.projectId) as { agent_type: string; mode: string; status: string } | undefined
      if (lastSession?.status === 'aborted') {
        console.log('[Host] recovery: last agent was aborted, re-verifying foundation')
        // Force re-evaluate foundation by checking what the aborted agent was doing
        const { foundationMissing } = reconcileProjectState(this.projectId, this.callbacks)
        setField(this.projectId, 'foundation_missing', JSON.stringify(foundationMissing))
        // Also sync chapters in case they were partially created
        syncChaptersFromPlans(this.projectId)
      }

      reconcileProjectState(this.projectId, this.callbacks)
      const recoveredState = LoadState(this.projectId)
      const recoveredInst = Route(recoveredState)
      const recoveryAction = decideRecoveryAction(this.projectId, recoveredState)
      syncExecutionState(this.projectId, recoveredState, recoveredInst, recoveryAction)
      if (recoveryAction) logHostAction(this.projectId, recoveryAction)

      const cp = getLastCheckpoint(this.projectId)
      const cpInfo = cp ? `（最近检查点: ${cp.reason}）` : ''
      const recoveryMsg = recoveryAction ? `；恢复动作：${recoveryAction.reason}` : ''
      this.callbacks?.onSystem?.(`编排器已从断点恢复${cpInfo}${recoveryMsg}`)
      return { phase: this.getPhase(), message: `已从断点恢复，继续推进${cpInfo}` }
    }

    const reconciled = reconcileProjectState(this.projectId, this.callbacks)
    const currentPhase = reconciled.phase
    setField(this.projectId, 'flow', 'writing')
    setField(this.projectId, 'lifecycle', 'running')
    setField(this.projectId, 'is_paused', 0)

    const routeState = LoadState(this.projectId)
    const routeInst = Route(routeState)
    const recoveryAction = decideRecoveryAction(this.projectId, routeState)
    syncExecutionState(this.projectId, routeState, routeInst, recoveryAction)

    const ts = now()
    db().prepare(`INSERT INTO progress (project_id, phase, flow, updated_at) VALUES (?, ?, 'writing', ?)
       ON CONFLICT(project_id) DO UPDATE SET phase = ?, flow = 'writing', updated_at = ?`)
      .run(this.projectId, currentPhase, ts, currentPhase, ts)

    logEvent(this.projectId, 'start', `编排器启动，阶段: ${currentPhase}`)
    const parsedMsg = count > 0 ? `（已自动解析 ${count} 个导入文档）` : ''
    this.callbacks?.onSystem?.(currentPhase === 'init'
      ? `项目尚未规划，进入架构设计阶段${parsedMsg}`
      : `架构就绪，开始推进创作${parsedMsg}`)
    this.callbacks?.onPhaseChange?.('idle', currentPhase, '编排器启动')

    return { phase: currentPhase, message: currentPhase === 'init' ? '进入架构设计阶段' : '开始推进创作' }
  }

  async resume(): Promise<void> {
    const lc = this.getLifecycle()
    if (lc === 'running') return
    setField(this.projectId, 'lifecycle', 'running')
    setField(this.projectId, 'is_paused', 0)
    logEvent(this.projectId, 'resume', '编排器恢复')
    const pending = (stateField(this.projectId, 'pending_steer') as string) ?? ''
    if (pending) {
      setField(this.projectId, 'flow', 'steering')
      setField(this.projectId, 'pending_steer', '')
      this.callbacks?.onSystem?.(`[用户干预] ${pending}`)
    } else {
      this.callbacks?.onSystem?.('编排器已恢复')
    }
    this.applyResumeRecovery()
  }

  async pause(): Promise<void> {
    this.abort()
    setField(this.projectId, 'lifecycle', 'paused')
    setField(this.projectId, 'is_paused', 1)
    logEvent(this.projectId, 'pause', '用户手动暂停')
    this.callbacks?.onSystem?.('编排器已暂停')
  }

  async reset(): Promise<void> {
    this.abort()
    setField(this.projectId, 'phase', 'init')
    setField(this.projectId, 'flow', 'writing')
    setField(this.projectId, 'lifecycle', 'idle')
    setField(this.projectId, 'is_paused', 0)
    setField(this.projectId, 'current_chapter', 0)
    setField(this.projectId, 'pending_rewrites', '[]')
    setField(this.projectId, 'foundation_missing', '[]')
    logEvent(this.projectId, 'reset', '用户重置编排器')
    resetCompactState(this.projectId)
    this.callbacks?.onSystem?.('编排器已重置')
  }

  async steer(text: string): Promise<void> {
    const globalRuleResult = parseGlobalGateSteer(text)
    if (globalRuleResult.applied) {
      logEvent(this.projectId, 'steer', text, { type: 'global_gate_rule' })
      this.callbacks?.onSystem?.(`[全局规则] ${globalRuleResult.message}`)
      return
    }

    logEvent(this.projectId, 'steer', text)
    if (this.getLifecycle() === 'running') {
      // Running: inject immediately as user instruction
      setField(this.projectId, 'flow', 'steering')
      this.callbacks?.onSystem?.(`[用户干预] ${text}`)
    } else {
      // Paused: store for next resume
      setField(this.projectId, 'pending_steer', text)
      this.callbacks?.onSystem?.(`[干预已保存] ${text}（恢复时生效）`)
    }
  }

  private abort(): void {
    this.loopRunning = false
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  private applyResumeRecovery(): void {
    reconcileProjectState(this.projectId, this.callbacks)
    const state = LoadState(this.projectId)
    const routeInst = Route(state)
    const recoveryAction = decideRecoveryAction(this.projectId, state)
    syncExecutionState(this.projectId, state, routeInst, recoveryAction)
    if (recoveryAction) {
      logHostAction(this.projectId, recoveryAction)
      this.callbacks?.onSystem?.(`[恢复] ${recoveryAction.reason}`)
    }
  }

  private handleHostAction(action: HostAction, messages: LlmMessage[]): { stopLoop: boolean } {
    logHostAction(this.projectId, action)

    switch (action.type) {
      case 'dispatch_agent':
      case 'recover': {
        const inst = instructionFromAction(action)
        if (!inst) {
          this.callbacks?.onSystem?.(`[等待] ${action.reason}`)
          return { stopLoop: false }
        }
        const followUp = formatInstruction(inst)
        messages.push({ role: 'user', content: followUp })
        return { stopLoop: false }
      }
      case 'wait':
        this.callbacks?.onSystem?.(`[等待] ${action.reason}`)
        return { stopLoop: false }
      case 'transition':
        setField(this.projectId, 'lifecycle', 'completed')
        setField(this.projectId, 'is_paused', 0)
        this.callbacks?.onSystem?.(`[完成] ${action.reason}`)
        return { stopLoop: true }
      default:
        this.callbacks?.onSystem?.(`[等待] ${action.reason}`)
        return { stopLoop: false }
    }
  }

  private async executeSubagentToolCall(
    toolCallId: string,
    rawArguments: string,
    messages: LlmMessage[],
    signal: AbortSignal
  ): Promise<void> {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(rawArguments)
    } catch {
      console.error('[Host] subagent arg parse failed:', rawArguments?.slice(0, 200))
    }

    const agentType = (args.agent as string) || 'architect'
    const task = (args.task as string) || ''
    if (!task) {
      this.callbacks?.onSystem?.('[subagent] 参数无效，跳过')
      messages.push({ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify({ success: false, error: '缺少 task 参数' }) })
      return
    }

    this.callbacks?.onSubAgentStart?.(agentType, task)

    const subResult = await runSubAgent(
      this.projectId, agentType, task, signal,
      (at, text) => this.callbacks?.onSubAgentThinking?.(at, text),
      (at, tn, ta) => this.callbacks?.onSubAgentToolCall?.(at, tn, ta),
      (at, tn, tr) => this.callbacks?.onSubAgentToolResult?.(at, tn, tr.success, tr.error)
    )

    this.callbacks?.onSubAgentDone?.(agentType, subResult.done, subResult.summary?.slice(0, 300) ?? '')
    updateProgress(this.projectId, agentType, this.callbacks)
    reconcileProjectState(this.projectId, this.callbacks)
    saveCheckpoint(this.projectId, agentType, task, subResult.done)

    messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({
        success: subResult.done,
        agent: agentType,
        task,
        done: subResult.done,
        summary: subResult.summary ?? '',
        error: subResult.done ? undefined : subResult.summary ?? 'subagent 未完成任务'
      })
    })

    if (subResult.done && agentType === 'writer') {
      const gateAction = await decideWriterGateAction(this.projectId)
      if (gateAction) {
        const gateState = LoadState(this.projectId)
        syncExecutionState(this.projectId, gateState, null, gateAction)
        logHostAction(this.projectId, gateAction)

        if (gateAction.type === 'wait' && gateAction.metadata?.manualInterventionRequired) {
          setField(this.projectId, 'lifecycle', 'paused')
          setField(this.projectId, 'is_paused', 1)
          this.callbacks?.onSystem?.(`[暂停] ${gateAction.reason}`)
        } else {
          this.callbacks?.onSystem?.(`[门禁] ${gateAction.reason}`)
        }
      }
    }

    if (subResult.done && agentType === 'editor') {
      const editorAction = decideEditorFollowUpAction(this.projectId)
      if (editorAction) {
        const editorState = LoadState(this.projectId)
        syncExecutionState(this.projectId, editorState, null, editorAction)
        logHostAction(this.projectId, editorAction)

        if (editorAction.type === 'wait' && editorAction.metadata?.manualInterventionRequired) {
          setField(this.projectId, 'lifecycle', 'paused')
          setField(this.projectId, 'is_paused', 1)
          this.callbacks?.onSystem?.(`[暂停] ${editorAction.reason}`)
        } else {
          this.callbacks?.onSystem?.(`[评审后续] ${editorAction.reason}`)
        }
      }
    }

    if (!subResult.done) {
      const failureAction = decideSubagentFailureAction(
        this.projectId,
        agentType,
        task,
        subResult.summary ?? ''
      )
      const stateAfterFailure = LoadState(this.projectId)
      syncExecutionState(this.projectId, stateAfterFailure, null, failureAction)
      logHostAction(this.projectId, failureAction)

      if (failureAction.type === 'wait' && failureAction.metadata?.manualInterventionRequired) {
        setField(this.projectId, 'lifecycle', 'paused')
        setField(this.projectId, 'is_paused', 1)
        this.callbacks?.onSystem?.(`[暂停] ${failureAction.reason}`)
      } else {
        this.callbacks?.onSystem?.(`[回退] ${failureAction.reason}`)
      }
    }

    const reduced = reduceAfterSubAgent(this.projectId)

    console.log('[Host] subagent done -> route', {
      agent: agentType,
      missing: reduced.state.foundationMissing,
      hasRoute: !!reduced.instruction,
      action: reduced.action.type,
      recovery: reduced.recoveryAction?.reason ?? null,
      routeAgent: reduced.instruction?.agent,
      routeTask: reduced.instruction?.task?.slice(0, 60),
      nextChapter: reduced.state.nextChapter
    })
  }

  private async handleEndTurnToolCall(
    toolCallId: string,
    messages: LlmMessage[],
    consecutiveStopGuard: number
  ): Promise<{ shouldReturn: boolean; consecutiveStopGuard: number }> {
    const guard = checkStopGuard(this.projectId)
    if (guard.allow) {
      setField(this.projectId, 'lifecycle', 'completed')
      this.callbacks?.onSystem?.('创作完成！')
      messages.push({ role: 'tool', tool_call_id: toolCallId, content: '创作完成，会话结束' })
      return { shouldReturn: true, consecutiveStopGuard }
    }

    const nextCount = consecutiveStopGuard + 1
    this.callbacks?.onSystem?.(`[StopGuard] 禁止停机 (连续${nextCount}次)`)
    messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: JSON.stringify({ success: false, error: guard.injectMessage })
    })

    if (nextCount >= 5) {
      this.callbacks?.onSystem?.('[StopGuard] 连续5次拦截，强制暂停')
      await this.pause()
      return { shouldReturn: true, consecutiveStopGuard: nextCount }
    }

    return { shouldReturn: false, consecutiveStopGuard: nextCount }
  }

  // ── Continuous coordinator loop ──

  async runLoop(): Promise<void> {
    if (this.getLifecycle() !== 'running') { console.log('[Host] runLoop skip: lifecycle=', this.getLifecycle()); return }
    if (this.loopRunning) { console.log('[Host] runLoop skip: already running'); return }
    this.loopRunning = true
    console.log('[Host] runLoop start', { phase: this.getPhase() })

    // Keep chapter entities aligned with chapter plans before the loop starts.
    syncChaptersFromPlans(this.projectId)
    reconcileProjectState(this.projectId, this.callbacks)

    this.currentAbortController = new AbortController()
    const signal = this.currentAbortController.signal

    const coordinatorPrompt = buildCoordinatorPrompt()
    const messages: LlmMessage[] = [
      { role: 'system', content: coordinatorPrompt }
    ]

    // Build initial user message
    const state = LoadState(this.projectId)
    const reminder = generateReminder(state)
    const context = JSON.stringify({ projectId: this.projectId, phase: state.phase, flow: state.flow, lastCompleted: state.lastCompleted })
    messages.push({ role: 'user', content: `${reminder}\n\n当前项目上下文：\n${context}\n\n请根据 Reminder 和上下文开始推进创作。` })

    const coordinatorTools: LlmToolDef[] = [
      {
        type: 'function',
        function: {
          name: 'subagent',
          description: '调用子代理执行任务。agent: architect/writer/editor, task: 任务描述',
          parameters: {
            type: 'object',
            properties: {
              agent: { type: 'string', description: '子代理类型', enum: ['architect', 'architect_long', 'writer', 'editor'] },
              task: { type: 'string', description: '任务描述' }
            },
            required: ['agent', 'task']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'end_turn',
          description: '结束当前回合',
          parameters: { type: 'object', properties: { summary: { type: 'string' } } }
        }
      }
    ]

    let consecutiveStopGuard = 0

    while (this.getLifecycle() === 'running') {
      if (signal.aborted) break

      try {
        // ── Route first: inject Host instruction BEFORE reminder ──
        reconcileProjectState(this.projectId, this.callbacks)
        const currentState = LoadState(this.projectId)
        const currentReminder = generateReminder(currentState)
        const nextInst = Route(currentState)
        const recoveryAction = decideRecoveryAction(this.projectId, currentState)
        const nextAction = recoveryAction ?? decideHostAction(currentState, nextInst)
        syncExecutionState(this.projectId, currentState, nextInst, nextAction)

        console.log('[Host] turn', {
          phase: currentState.phase, nextCh: currentState.nextChapter,
          lastCompleted: currentState.lastCompleted, plans: currentState.totalPlannedChapters,
          missing: currentState.foundationMissing, msgs: messages.length,
          rewrites: currentState.pendingRewrites.length,
          route: nextInst ? `${nextInst.agent}:${nextInst.task.slice(0, 40)}` : 'none',
          action: nextAction.type,
          actionState: nextAction.targetState,
          recovery: recoveryAction?.reason ?? null
        })

        const hostActionResult = this.handleHostAction(nextAction, messages)
        if (hostActionResult.stopLoop) {
          this.loopRunning = false
          return
        }
        messages.push({ role: 'user', content: currentReminder })

        // ── Compaction check ──
        const compactResult = await compactMessages(this.projectId, messages, 128000, signal)
        if (compactResult.compacted) {
          const before = estimateMessagesTokens(messages)
          const after = estimateMessagesTokens(compactResult.messages)
          const savings = before > 0 ? Math.round((1 - after / before) * 100) : 0
          this.callbacks?.onSystem?.(`[压缩] ${compactResult.level} (节约 ${savings}%)`)
          // Replace messages with compacted version, preserving reminder
          messages.length = 0
          messages.push(...compactResult.messages)
          // Ensure Reminder is the last message (compaction may have dropped it)
          const last = messages[messages.length - 1]
          if (last?.content !== currentReminder) {
            messages.push({ role: 'user', content: currentReminder })
          }
        }

        const resp = await callLlm(messages, coordinatorTools, signal)

        // Emit thinking
        if (resp.content) {
          this.callbacks?.onCoordinatorThinking?.(resp.content)
        }

        // Process tool calls
        if (resp.toolCalls.length > 0) {
          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: resp.content,
            tool_calls: resp.toolCalls.map(tc => ({
              id: tc.id, type: 'function' as const,
              function: { name: tc.name, arguments: tc.arguments }
            }))
          })

          for (const tc of resp.toolCalls) {
            if (tc.name === 'subagent') {
              await this.executeSubagentToolCall(tc.id, tc.arguments, messages, signal)

            } else if (tc.name === 'end_turn') {
              const endTurn = await this.handleEndTurnToolCall(tc.id, messages, consecutiveStopGuard)
              consecutiveStopGuard = endTurn.consecutiveStopGuard
              if (endTurn.shouldReturn) {
                return
              }
            }
          }

          if (resp.finishReason === 'stop') {
            // Only reset stop guard on genuine LLM stop (not end_turn interception)
            const hasNonEndTurnToolCalls = resp.toolCalls.some(tc => tc.name !== 'end_turn')
            if (hasNonEndTurnToolCalls && consecutiveStopGuard > 0) {
              consecutiveStopGuard = 0
            }
          }
          continue
        }

        // No tool calls — next turn's route injection handles follow-up
        messages.push({ role: 'assistant', content: resp.content ?? '' })

        if (resp.finishReason !== 'stop') {
          // Coordinator neither called tools nor stopped — inject reminder to keep going
          messages.push({ role: 'user', content: `${currentReminder}\n\n请根据当前状态决定下一步` })
        }

      } catch (e) {
        if ((e as Error).name === 'AbortError' || signal.aborted) {
          this.callbacks?.onSystem?.('编排已中断')
          break
        }
        console.error('[Host] runLoop error:', e)
        this.callbacks?.onSystem?.(`[错误] ${(e as Error).message}`)
        // Pause on error
        this.pause()
        break
      }
    }

    this.loopRunning = false
    this.callbacks?.onSystem?.('编排器已停止')
  }
}

// ── Singleton ──

const hosts = new Map<string, Host>()
export function getHost(projectId: string): Host {
  let h = hosts.get(projectId)
  if (!h) { h = new Host(projectId); hosts.set(projectId, h) }
  return h
}
export function destroyHost(projectId: string): void { hosts.delete(projectId) }
