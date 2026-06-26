import type {
  OrchestratorState,
  AgentType,
  ExecutionMode,
  ReviewVerdict,
  BoundaryConditions,
  SystemState,
  AgentResponse,
  ToolDefinition,
  ToolResult,
  Phase,
  Flow,
  Lifecycle
} from '@shared/types'
import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { registerTools, createAgentSession } from './tool-executor'
import { architectTools } from './tools/architect.tools'
import { writerTools } from './tools/writer.tools'
import { editorTools } from './tools/editor.tools'
import { runAgent, runAgentStreaming } from './agent-engine'
import type { AgentRunOptions, AgentStreamOptions } from './agent-engine'
import { getLatestDraft, commitDraft, rejectDraft, isCommitted } from './draft.service'
import { runDraftGate, runPlanGate } from './draft-gate.service'
import type { GateVerdict } from './draft-gate.service'
import { getChapterContract, getKnowledgeContract } from './contract.service'
import { shouldEscalate } from './model-router.service'
import { getLocksForProject } from './fact-lock.service'
import { buildContext as buildMemoryContext } from './memory.service'

let initialized = false

function autoModeIntToExecutionMode(value: number | null | undefined): ExecutionMode {
  switch (value) {
    case 1:
      return 'full_auto'
    case 2:
      return 'arc_auto'
    case 3:
      return 'node_review'
    default:
      return 'semi_auto'
  }
}

function executionModeToAutoModeInt(mode: ExecutionMode): number {
  switch (mode) {
    case 'full_auto':
      return 1
    case 'arc_auto':
      return 2
    case 'node_review':
      return 3
    default:
      return 0
  }
}

function initToolRegistry(): void {
  if (initialized) return
  registerTools(architectTools)
  registerTools(writerTools)
  registerTools(editorTools)
  initialized = true
}

export function getSystemState(projectId: string): SystemState | null {
  const db = getDb()
  const row = db.prepare(
    'SELECT * FROM system_state WHERE project_id = ?'
  ).get(projectId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    project_id: row.project_id as string,
    phase: (row.phase as Phase) ?? 'init',
    flow: (row.flow as Flow) ?? 'writing',
    lifecycle: (row.lifecycle as Lifecycle) ?? 'idle',
    current_chapter: (row.current_chapter as number) ?? 0,
    current_volume: (row.current_volume as number) ?? 0,
    current_arc: (row.current_arc as number) ?? 0,
    pending_rewrites: [],
    foundation_missing: [],
    is_paused: row.is_paused as number,
    auto_mode: row.auto_mode as number,
    // legacy
    orchestrator_state: (row.orchestrator_state as OrchestratorState) ?? 'idle',
    current_chapter_id: row.current_chapter_id as string | null,
    current_arc_id: row.current_arc_id as string | null,
    current_volume_id: row.current_volume_id as string | null,
    active_agent: row.active_agent as AgentType | null,
    paused_boundary: (row.paused_boundary as string) ?? '{}',
    updated_at: row.updated_at as number
  }
}

// Backward compat: raw row reader for legacy code
function legacyRaw(projectId: string): Record<string, unknown> | null {
  const db = getDb()
  return db.prepare('SELECT * FROM system_state WHERE project_id = ?').get(projectId) as Record<string, unknown> | null
}

function ensureSystemState(projectId: string, initialState: OrchestratorState = 'idle'): SystemState {
  const existing = getSystemState(projectId)
  if (existing) {
    cleanupAbandonedSessions(projectId)
    return existing
  }
  const db = getDb()
  const ts = now()
  db.prepare(
    `INSERT INTO system_state (project_id, orchestrator_state, phase, flow, lifecycle, is_paused, auto_mode, updated_at)
     VALUES (?, ?, 'init', 'writing', 'idle', 0, 0, ?)`
  ).run(projectId, initialState, ts)
  return getSystemState(projectId)!
}

function cleanupAbandonedSessions(projectId: string): void {
  const db = getDb()
  const ts = now()
  const running = db.prepare(
    "SELECT id FROM agent_sessions WHERE project_id = ? AND status = 'running'"
  ).all(projectId) as Array<{ id: string }>
  if (running.length === 0) return
  for (const s of running) {
    db.prepare(
      "UPDATE agent_sessions SET status = 'aborted', ended_at = ? WHERE id = ?"
    ).run(ts, s.id)
  }
  console.log('[Orchestrator] cleanupAbandonedSessions:', running.length, 'sessions marked aborted')
  const state = getSystemState(projectId)
  const currentState = state?.orchestrator_state ?? 'idle'
  logTransition(projectId, currentState, currentState, `系统恢复: ${running.length} 个未完成的 Agent 会话已标记为 aborted`, { sessionIds: running.map(s => s.id) })
}

function setSystemStateField(projectId: string, field: string, value: unknown): void {
  const db = getDb()
  const ts = now()
  db.prepare(
    `UPDATE system_state SET ${field} = ?, updated_at = ? WHERE project_id = ?`
  ).run(value, ts, projectId)
}

function setOrchestratorState(projectId: string, state: OrchestratorState): void {
  setSystemStateField(projectId, 'orchestrator_state', state)
}

function setCurrentArc(projectId: string, arcId: string | null): void {
  setSystemStateField(projectId, 'current_arc_id', arcId)
}

function setCurrentChapter(projectId: string, chapterId: string | null): void {
  setSystemStateField(projectId, 'current_chapter_id', chapterId)
}

function setActiveAgent(projectId: string, agent: AgentType | null): void {
  setSystemStateField(projectId, 'active_agent', agent)
}

function setPaused(projectId: string, paused: boolean): void {
  setSystemStateField(projectId, 'is_paused', paused ? 1 : 0)
}

function logTransition(
  projectId: string,
  from: OrchestratorState | null,
  to: OrchestratorState,
  reason: string,
  details: Record<string, unknown> = {}
): void {
  const db = getDb()
  const id = uuid()
  const ts = now()
  db.prepare(
    `INSERT INTO orchestration_log (id, project_id, event_type, from_state, to_state, reason, details, created_at)
     VALUES (?, ?, 'transition', ?, ?, ?, ?, ?)`
  ).run(id, projectId, from, to, reason, JSON.stringify(details), ts)
}

function countChaptersInArc(arcId: string): number {
  const db = getDb()
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id = ? AND status = ?'
  ).get(arcId, 'written') as { c: number }
  return row.c
}

function countPlannedChaptersInArc(arcId: string): number {
  const db = getDb()
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id = ?'
  ).get(arcId) as { c: number }
  return row.c
}

function getLatestReviewForTarget(projectId: string, targetId: string, reviewType: string): { verdict: string } | null {
  const db = getDb()
  return db.prepare(
    `SELECT verdict FROM review_records
     WHERE project_id = ? AND target_id = ? AND review_type = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(projectId, targetId, reviewType) as { verdict: string } | null
}

function hasArcSummary(arcId: string): boolean {
  const db = getDb()
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM arc_summaries WHERE arc_id = ?'
  ).get(arcId) as { c: number }
  return row.c > 0
}

function hasCharacterSnapshot(arcId: string, sourceType: string = 'arc'): boolean {
  const db = getDb()
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM character_state_snapshots WHERE source_id = ? AND source_type = ?'
  ).get(arcId, sourceType) as { c: number }
  return row.c > 0
}

function hasForeshadowingCarryover(projectId: string): boolean {
  const db = getDb()
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM foreshadowing_ledger WHERE project_id = ? AND status = 'progressing'"
  ).get(projectId) as { c: number }
  return row.c > 0
}

function getCurrentArcPlannedChapters(arcId: string): number {
  const db = getDb()
  const row = db.prepare(
    'SELECT planned_chapters FROM volume_arcs WHERE id = ?'
  ).get(arcId) as { planned_chapters: number } | undefined
  return row?.planned_chapters ?? 0
}

function getArcStatus(arcId: string): string {
  const db = getDb()
  const row = db.prepare(
    'SELECT status FROM volume_arcs WHERE id = ?'
  ).get(arcId) as { status: string } | undefined
  return row?.status ?? 'planned'
}

function hasMoreArcsInVolume(projectId: string, volumeNumber: number, currentArcId: string): boolean {
  const db = getDb()
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM volume_arcs
     WHERE project_id = ? AND volume_number = ? AND id != ? AND status != 'completed'`
  ).get(projectId, volumeNumber, currentArcId) as { c: number }
  return row.c > 0
}

function getNextArcInVolume(projectId: string, volumeNumber: number, currentArcId: string): { id: string } | null {
  const db = getDb()
  return db.prepare(
    `SELECT id FROM volume_arcs
     WHERE project_id = ? AND volume_number = ? AND id != ? AND status = 'planned'
     ORDER BY sort_order ASC LIMIT 1`
  ).get(projectId, volumeNumber, currentArcId) as { id: string } | null
}

function getCurrentArcVolumeNumber(arcId: string): number {
  const db = getDb()
  const row = db.prepare(
    'SELECT volume_number FROM volume_arcs WHERE id = ?'
  ).get(arcId) as { volume_number: number } | undefined
  return row?.volume_number ?? 1
}

function hasMoreVolumes(projectId: string, currentVolume: number): boolean {
  const db = getDb()
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM volume_arcs
     WHERE project_id = ? AND volume_number > ?`
  ).get(projectId, currentVolume) as { c: number }
  return row.c > 0
}

function isArchitectureReady(projectId: string): boolean {
  const db = getDb()
  const compass = db.prepare(
    'SELECT id FROM story_compass WHERE project_id = ?'
  ).get(projectId)
  if (!compass) return false

  const firstArc = db.prepare(
    `SELECT id FROM volume_arcs WHERE project_id = ? AND status IN ('planned', 'expanded', 'in_progress')
     ORDER BY sort_order ASC LIMIT 1`
  ).get(projectId)
  if (!firstArc) return false

  const arcOutline = db.prepare(
    'SELECT id FROM arc_outlines WHERE project_id = ?'
  ).get(projectId)
  if (!arcOutline) return false

  const arcChapterPlans = db.prepare(
    `SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id IN
     (SELECT id FROM volume_arcs WHERE project_id = ? AND status = 'expanded')`
  ).get(projectId) as { c: number }
  if (arcChapterPlans.c === 0) return false

  const charArc = db.prepare(
    'SELECT id FROM character_arcs WHERE project_id = ?'
  ).get(projectId)
  if (!charArc) return false

  const foreshadowing = db.prepare(
    'SELECT id FROM foreshadowing_ledger WHERE project_id = ?'
  ).get(projectId)
  if (!foreshadowing) return false

  return true
}

function getFirstArcId(projectId: string): string | null {
  const db = getDb()
  const row = db.prepare(
    `SELECT id FROM volume_arcs WHERE project_id = ? AND status IN ('planned', 'expanded', 'in_progress')
     ORDER BY sort_order ASC LIMIT 1`
  ).get(projectId) as { id: string } | undefined
  return row?.id ?? null
}

function getNextChapterPlan(arcId: string): { id: string; chapter_number: number } | null {
  const db = getDb()
  return db.prepare(
    `SELECT id, chapter_number FROM arc_chapter_plans
     WHERE arc_id = ? AND status = 'planned'
     ORDER BY chapter_number ASC LIMIT 1`
  ).get(arcId) as { id: string; chapter_number: number } | null
}

function getLastChapterHint(arcId: string): string {
  const db = getDb()
  const row = db.prepare(
    `SELECT cs.next_chapter_hint FROM chapter_summaries cs
     JOIN chapters c ON cs.chapter_id = c.id
     WHERE c.project_id = (SELECT project_id FROM volume_arcs WHERE id = ?)
     ORDER BY c.sort_order DESC LIMIT 1`
  ).get(arcId) as { next_chapter_hint: string } | undefined
  return row?.next_chapter_hint ?? ''
}

function hasChapterContract(projectId: string, chapterId: string): boolean {
  return !!getChapterContract(projectId, chapterId)
}

function hasKnowledgeContract(projectId: string, chapterId: string): boolean {
  return !!getKnowledgeContract(projectId, chapterId)
}

function hasChapterPlan(chapterId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM chapter_plans WHERE chapter_id = ? LIMIT 1')
    .get(chapterId) as { 1: number } | undefined
  return !!row
}

function hasPendingDraft(chapterId: string): boolean {
  const draft = getLatestDraft(chapterId)
  if (!draft) return false
  return draft.lifecycle === 'draft_generated' || draft.lifecycle === 'draft_revised'
}

function buildRetrievalQuery(
  projectId: string,
  chapterId: string | null,
  arcId: string | null
): string {
  const parts: string[] = []
  const story = db()
    .prepare('SELECT title, summary FROM projects WHERE id = ?')
    .get(projectId) as { title: string; summary: string } | undefined
  if (story?.title) parts.push(story.title)
  if (story?.summary) parts.push(story.summary)

  if (chapterId) {
    const chapter = db()
      .prepare('SELECT title, plain_text FROM chapters WHERE id = ?')
      .get(chapterId) as { title: string; plain_text: string } | undefined
    if (chapter?.title) parts.push(chapter.title)

    const chapterPlan = db()
      .prepare('SELECT plan_content FROM chapter_plans WHERE chapter_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(chapterId) as { plan_content: string } | undefined
    if (chapterPlan?.plan_content) parts.push(chapterPlan.plan_content)
    if (chapter?.plain_text) parts.push(chapter.plain_text.slice(-600))
  }

  if (arcId) {
    const arc = db()
      .prepare('SELECT arc_title, arc_goal FROM volume_arcs WHERE id = ?')
      .get(arcId) as { arc_title: string; arc_goal: string } | undefined
    if (arc?.arc_title) parts.push(arc.arc_title)
    if (arc?.arc_goal) parts.push(arc.arc_goal)
  }

  return parts.filter(Boolean).join('\n')
}

function getLatestGateVerdict(draftId: string): GateVerdict | null {
  const db = getDb()
  const row = db.prepare(
    `SELECT * FROM draft_gate_verdicts WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(draftId) as
    | {
        verdict: string
        overall_passed: number
        fail_count: number
        critical_count: number
        summary: string
        recommended_model: string
      }
    | undefined
  if (!row) return null
  return {
    verdict: row.verdict as GateVerdict['verdict'],
    overall_passed: row.overall_passed === 1,
    fail_count: row.fail_count,
    critical_count: row.critical_count,
    summary: row.summary,
    recommended_model: row.recommended_model,
    reports: []
  }
}

function countDraftFailures(chapterId: string): number {
  const db = getDb()
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM draft_gate_verdicts v
     JOIN chapter_drafts d ON v.draft_id = d.id
     WHERE d.chapter_id = ? AND v.overall_passed = 0`
  ).get(chapterId) as { c: number }
  return row.c
}

export async function evaluateBoundaryConditions(projectId: string): Promise<BoundaryConditions> {
  const db = getDb()
  const state = getSystemState(projectId)
  const defaultConditions: BoundaryConditions = {
    canWrite: false,
    arcHasMoreChapters: false,
    arcDone: false,
    volumeDone: false,
    reviewDone: false,
    reviewVerdict: null,
    arcSummarized: false,
    hasMoreArcsInVolume: false,
    nextArcPlanned: false,
    hasMoreVolumes: false,
    architectureReady: false,
    currentChapterId: state?.current_chapter_id ?? null, // compat
    currentArcId: state?.current_arc_id ?? null, // compat
    currentVolumeId: state?.current_volume_id ?? null // compat
  }

  defaultConditions.architectureReady = isArchitectureReady(projectId)

  if (!state) {
    const firstArcId = getFirstArcId(projectId)
    if (firstArcId) {
      const writtenCount = countChaptersInArc(firstArcId)
      const plannedCount = countPlannedChaptersInArc(firstArcId)
      defaultConditions.arcDone = plannedCount > 0 && writtenCount >= plannedCount
      defaultConditions.arcHasMoreChapters = writtenCount < plannedCount
      defaultConditions.currentArcId = firstArcId
    }
    return defaultConditions
  }

  const currentArcId = state.current_arc_id
  if (currentArcId) {
    const writtenCount = countChaptersInArc(currentArcId)
    const plannedCount = countPlannedChaptersInArc(currentArcId)
    defaultConditions.arcDone = plannedCount > 0 && writtenCount >= plannedCount
    defaultConditions.arcHasMoreChapters = writtenCount < plannedCount

    const volumeNumber = getCurrentArcVolumeNumber(currentArcId)
    defaultConditions.hasMoreArcsInVolume = hasMoreArcsInVolume(projectId, volumeNumber, currentArcId)
    defaultConditions.hasMoreVolumes = hasMoreVolumes(projectId, volumeNumber)

    const allArcChaptersCount = db.prepare(
      `SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id = ?`
    ).get(currentArcId) as { c: number }
    const writtenArcChapters = db.prepare(
      `SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id = ? AND status = 'written'`
    ).get(currentArcId) as { c: number }
    defaultConditions.volumeDone = allArcChaptersCount.c > 0 && writtenArcChapters.c >= allArcChaptersCount.c
      && !defaultConditions.hasMoreArcsInVolume

    defaultConditions.arcSummarized = hasArcSummary(currentArcId)
  }

  const currentState = state.orchestrator_state

  if (currentState === 'arc_review' || currentState === 'arc_review_pending') {
    const targetId = currentArcId
    if (targetId) {
      const review = getLatestReviewForTarget(projectId, targetId, 'arc')
      defaultConditions.reviewDone = !!review
      defaultConditions.reviewVerdict = review ? (review.verdict as ReviewVerdict) : null
    }
  }

  if (currentState === 'volume_review') {
    const targetId = currentArcId
    if (targetId) {
      const review = getLatestReviewForTarget(projectId, targetId, 'volume')
      defaultConditions.reviewDone = !!review
      defaultConditions.reviewVerdict = review ? (review.verdict as ReviewVerdict) : null
    }
  }

  if (currentState === 'arc_passed') {
    defaultConditions.reviewDone = true
    defaultConditions.reviewVerdict = 'pass'
  }

  if (currentState === 'next_arc_plan') {
    defaultConditions.nextArcPlanned = currentArcId ? !hasMoreArcsInVolume(
      projectId, getCurrentArcVolumeNumber(currentArcId), currentArcId
    ) : false
  }

  defaultConditions.canWrite = (currentState === 'writing' || currentState === 'contract_generation' || currentState === 'plan_gate' || currentState === 'draft_gate') && !defaultConditions.arcDone
    && defaultConditions.arcHasMoreChapters

  return defaultConditions
}

function db(): ReturnType<typeof getDb> {
  return getDb()
}

export class Orchestrator {
  private projectId: string
  private currentAbortController: AbortController | null = null

  constructor(projectId: string) {
    this.projectId = projectId
    initToolRegistry()
    ensureSystemState(projectId, 'idle')
  }

  getState(): OrchestratorState {
    const s = getSystemState(this.projectId)
    return s?.orchestrator_state ?? 'idle'
  }

  getFullState(): SystemState | null {
    return getSystemState(this.projectId)
  }

  isPaused(): boolean {
    const s = getSystemState(this.projectId)
    return s?.is_paused === 1
  }

  async start(): Promise<{ state: OrchestratorState; message: string }> {
    const state = this.getState()
    console.log('[Orchestrator] start() currentState:', state, 'projectId:', this.projectId)
    if (state !== 'idle') {
      console.log('[Orchestrator] start() already running with state:', state)
      return { state, message: `编排器已在运行中，当前状态: ${state}` }
    }

    const compass = db().prepare(
      'SELECT id FROM story_compass WHERE project_id = ?'
    ).get(this.projectId)

    console.log('[Orchestrator] start() story_compass exists:', !!compass)

    if (!compass) {
      console.log('[Orchestrator] start() no story_compass -> initializing -> architecting')
      logTransition(this.projectId, 'idle', 'initializing', '新项目启动，进入初始化')
      this.transition('initializing')
      this.transition('architecting')
      setActiveAgent(this.projectId, 'architect')
      setPaused(this.projectId, true)
      console.log('[Orchestrator] start() transitioned to architecting, paused=true')
      return {
        state: 'architecting',
        message: '项目尚未规划，已进入架构设计阶段。请通过 Architect Agent 完成故事指南针、人物弧、世界规则、卷弧骨架和首弧细纲的设定。'
      }
    }

    const archReady = isArchitectureReady(this.projectId)
    console.log('[Orchestrator] start() architectureReady:', archReady)

    if (!archReady) {
      console.log('[Orchestrator] start() architecture not ready -> architecting')
      logTransition(this.projectId, 'idle', 'architecting', '架构不完整，进入架构设计')
      this.transition('architecting')
      setActiveAgent(this.projectId, 'architect')
      setPaused(this.projectId, true)
      return {
        state: 'architecting',
        message: '架构规划不完整，请继续通过 Architect Agent 完善规划。'
      }
    }

    const firstArcId = getFirstArcId(this.projectId)
    console.log('[Orchestrator] start() firstArcId:', firstArcId)

    if (!firstArcId) {
      console.log('[Orchestrator] start() no expanded arc found -> architecting')
      logTransition(this.projectId, 'idle', 'architecting', '未找到可展开的弧')
      this.transition('architecting')
      setActiveAgent(this.projectId, 'architect')
      setPaused(this.projectId, true)
      return {
        state: 'architecting',
        message: '未找到已展开的弧，请通过 Architect Agent 展开首弧细纲。'
      }
    }

    setCurrentArc(this.projectId, firstArcId)
    logTransition(this.projectId, 'idle', 'contract_generation', '架构就绪，首弧已展开，进入契约生成阶段')
    this.transition('contract_generation')
    setActiveAgent(this.projectId, 'architect')
    setPaused(this.projectId, true)
    console.log('[Orchestrator] start() transitioned to contract_generation, firstArcId:', firstArcId)
    return {
      state: 'contract_generation',
      message: '架构就绪，已进入契约生成阶段。请通过 Architect Agent 为首章生成 chapter_contract 和 knowledge_contract。'
    }
  }

  async tick(): Promise<{ state: OrchestratorState; action: string; details: Record<string, unknown> }> {
    const currentState = this.getState()
    console.log('[Orchestrator] tick() currentState:', currentState, 'projectId:', this.projectId)
    const conditions = await evaluateBoundaryConditions(this.projectId)
    console.log('[Orchestrator] tick() conditions:', JSON.stringify({
      architectureReady: conditions.architectureReady,
      canWrite: conditions.canWrite,
      arcHasMoreChapters: conditions.arcHasMoreChapters,
      arcDone: conditions.arcDone,
      reviewDone: conditions.reviewDone,
      reviewVerdict: conditions.reviewVerdict,
      arcSummarized: conditions.arcSummarized,
      hasMoreArcsInVolume: conditions.hasMoreArcsInVolume,
      nextArcPlanned: conditions.nextArcPlanned,
      hasMoreVolumes: conditions.hasMoreVolumes,
      volumeDone: conditions.volumeDone
    }))

    switch (currentState) {
      case 'idle':
        return { state: 'idle', action: 'idle', details: { message: '编排器空闲，请调用 start() 启动' } }

      case 'initializing':
        this.transition('architecting')
        setActiveAgent(this.projectId, 'architect')
        setPaused(this.projectId, true)
        return { state: 'architecting', action: 'transition', details: { message: '进入架构设计阶段' } }

      case 'architecting': {
        if (conditions.architectureReady) {
          const firstArcId = getFirstArcId(this.projectId)
          if (firstArcId) {
            setCurrentArc(this.projectId, firstArcId)
            this.transition('contract_generation')
            setActiveAgent(this.projectId, 'architect')
            setPaused(this.projectId, true)
            return {
              state: 'contract_generation',
              action: 'transition',
              details: { message: '架构设计完成，进入契约生成阶段', currentArcId: firstArcId }
            }
          }
        }
        return { state: 'architecting', action: 'waiting', details: { message: '等待架构设计完成' } }
      }

      case 'contract_generation': {
        const state = getSystemState(this.projectId)
        const arcId = state?.current_arc_id
        if (!arcId) {
          return { state: 'contract_generation', action: 'waiting', details: { message: '等待当前弧设置' } }
        }
        const nextPlan = getNextChapterPlan(arcId)
        if (!nextPlan) {
          this.transition('arc_review_pending')
          setActiveAgent(this.projectId, 'editor')
          setPaused(this.projectId, true)
          return { state: 'arc_review_pending', action: 'transition', details: { message: '无更多章节计划，进入弧评审' } }
        }
        setCurrentChapter(this.projectId, nextPlan.id)
        const hasContract = hasChapterContract(this.projectId, nextPlan.id)
        const hasKnowledge = hasKnowledgeContract(this.projectId, nextPlan.id)
        if (hasContract && hasKnowledge) {
          this.transition('plan_gate')
          setActiveAgent(this.projectId, 'writer')
          setPaused(this.projectId, true)
          return {
            state: 'plan_gate',
            action: 'transition',
            details: { message: '契约已就绪，进入计划门禁', chapterId: nextPlan.id }
          }
        }
        return {
          state: 'contract_generation',
          action: 'waiting',
          details: {
            message: '等待 Architect 生成 chapter_contract 和 knowledge_contract',
            chapterId: nextPlan.id,
            hasContract,
            hasKnowledge
          }
        }
      }

      case 'plan_gate': {
        const state = getSystemState(this.projectId)
        const chapterId = state?.current_chapter_id
        if (!chapterId) {
          return { state: 'plan_gate', action: 'waiting', details: { message: '等待当前章节设置' } }
        }
        if (hasChapterPlan(chapterId)) {
          const verdict = await runPlanGate(this.projectId, chapterId)
          if (verdict.verdict === 'pass') {
            this.transition('writing')
            setActiveAgent(this.projectId, 'writer')
            setPaused(this.projectId, true)
            return {
              state: 'writing',
              action: 'transition',
              details: { message: '计划门禁通过，进入写作', chapterId, summary: verdict.summary }
            }
          }
          setActiveAgent(this.projectId, 'writer')
          setPaused(this.projectId, true)
          return {
            state: 'plan_gate',
            action: verdict.verdict === 'escalate' ? 'escalate' : 'revise_plan',
            details: {
              message: '计划门禁未通过，请修订章节计划',
              chapterId,
              verdict: verdict.verdict,
              summary: verdict.summary,
              recommendedModel: verdict.recommended_model,
              reports: verdict.reports
            }
          }
        }
        return {
          state: 'plan_gate',
          action: 'waiting',
          details: { message: '等待 Writer 生成 chapter_plan', chapterId }
        }
      }

      case 'writing': {
        if (!conditions.arcHasMoreChapters && conditions.arcDone) {
          this.transition('arc_review_pending')
          setActiveAgent(this.projectId, 'editor')
          setPaused(this.projectId, true)
          return {
            state: 'arc_review_pending',
            action: 'transition',
            details: { message: '当前弧所有章节已完成，进入弧评审待定' }
          }
        }
        if (conditions.arcHasMoreChapters) {
          const state = getSystemState(this.projectId)
          const chapterId = state?.current_chapter_id
          if (chapterId && hasPendingDraft(chapterId)) {
            this.transition('draft_gate')
            setPaused(this.projectId, true)
            return {
              state: 'draft_gate',
              action: 'transition',
              details: { message: '检测到草稿，进入草稿门禁检查', chapterId }
            }
          }
          setPaused(this.projectId, true)
          return {
            state: 'writing',
            action: 'dispatch_writer',
            details: { message: '等待 Writer 完成当前章节草稿' }
          }
        }
        return { state: 'writing', action: 'waiting', details: { message: '等待章节完成' } }
      }

      case 'draft_gate': {
        const state = getSystemState(this.projectId)
        const chapterId = state?.current_chapter_id
        if (!chapterId) {
          return { state: 'draft_gate', action: 'waiting', details: { message: '等待当前章节设置' } }
        }
        const draft = getLatestDraft(chapterId)
        if (!draft) {
          this.transition('writing')
          setActiveAgent(this.projectId, 'writer')
          setPaused(this.projectId, true)
          return { state: 'writing', action: 'transition', details: { message: '无草稿，返回写作' } }
        }

        const existingVerdict = getLatestGateVerdict(draft.id)
        if (!existingVerdict) {
          const verdict = await runDraftGate(draft.id)
          return this.handleDraftGateVerdict(chapterId, draft.id, verdict)
        }

        return this.handleDraftGateVerdict(chapterId, draft.id, existingVerdict)
      }

      case 'arc_review_pending': {
        this.transition('arc_review')
        setActiveAgent(this.projectId, 'editor')
        setPaused(this.projectId, true)
        return {
          state: 'arc_review',
          action: 'transition',
          details: { message: '进入弧评审阶段，请通过 Editor Agent 评审' }
        }
      }

      case 'arc_review': {
        if (!conditions.reviewDone) {
          return { state: 'arc_review', action: 'waiting', details: { message: '等待 Editor 评审完成' } }
        }

        const verdict = conditions.reviewVerdict
        switch (verdict) {
          case 'pass':
            this.transition('arc_passed')
            setActiveAgent(this.projectId, 'editor')
            return {
              state: 'arc_passed',
              action: 'transition',
              details: { message: '弧评审通过，等待 Editor 生成弧摘要/角色快照/伏笔结转' }
            }
          case 'polish':
            this.transition('polishing')
            setActiveAgent(this.projectId, 'writer')
            setPaused(this.projectId, true)
            return {
              state: 'polishing',
              action: 'transition',
              details: { message: '评审要求打磨指定章节，请通过 Writer Agent 打磨' }
            }
          case 'rewrite_chapter':
            this.transition('chapter_rewrite')
            setActiveAgent(this.projectId, 'writer')
            setPaused(this.projectId, true)
            return {
              state: 'chapter_rewrite',
              action: 'transition',
              details: { message: '评审要求重写章节，请通过 Writer Agent 重写' }
            }
          case 'replan':
            this.transition('architecting')
            setActiveAgent(this.projectId, 'architect')
            setPaused(this.projectId, true)
            return {
              state: 'architecting',
              action: 'transition',
              details: { message: '评审要求重新规划，请通过 Architect Agent 重新规划' }
            }
          default:
            return { state: 'arc_review', action: 'waiting', details: { message: '未知评审结果' } }
        }
      }

      case 'arc_passed': {
        if (conditions.arcSummarized) {
          const state = getSystemState(this.projectId)
          const currentArcId = state?.current_arc_id
          if (currentArcId && conditions.hasMoreArcsInVolume) {
            const nextArc = getNextArcInVolume(
              this.projectId,
              getCurrentArcVolumeNumber(currentArcId),
              currentArcId
            )
            if (nextArc) {
              setCurrentArc(this.projectId, nextArc.id)
              this.transition('contract_generation')
              setActiveAgent(this.projectId, 'architect')
              setPaused(this.projectId, true)
              return {
                state: 'contract_generation',
                action: 'transition',
                details: { message: '下一弧已规划，进入契约生成', nextArcId: nextArc.id }
              }
            }
          }

          if (conditions.volumeDone) {
            this.transition('volume_review')
            setActiveAgent(this.projectId, 'editor')
            setPaused(this.projectId, true)
            return {
              state: 'volume_review',
              action: 'transition',
              details: { message: '当前卷完成，进入卷评审' }
            }
          }

          if (currentArcId && !conditions.nextArcPlanned) {
            this.transition('next_arc_plan')
            setActiveAgent(this.projectId, 'architect')
            setPaused(this.projectId, true)
            return {
              state: 'next_arc_plan',
              action: 'transition',
              details: { message: '下一弧未展开，请通过 Architect Agent 展开' }
            }
          }
        }

        return {
          state: 'arc_passed',
          action: 'waiting',
          details: { message: '等待 Editor 生成弧摘要/角色快照/伏笔结转' }
        }
      }

      case 'polishing': {
        const state = getSystemState(this.projectId)
        const chapterId = state?.current_chapter_id
        if (chapterId && hasPendingDraft(chapterId)) {
          this.transition('draft_gate')
          setPaused(this.projectId, true)
          return {
            state: 'draft_gate',
            action: 'transition',
            details: { message: '打磨完成，重新进入草稿门禁检查' }
          }
        }
        return { state: 'polishing', action: 'waiting', details: { message: '等待 Writer 打磨完成' } }
      }

      case 'chapter_rewrite': {
        const state = getSystemState(this.projectId)
        const chapterId = state?.current_chapter_id
        if (chapterId && hasPendingDraft(chapterId)) {
          this.transition('draft_gate')
          setPaused(this.projectId, true)
          return {
            state: 'draft_gate',
            action: 'transition',
            details: { message: '重写完成，重新进入草稿门禁检查' }
          }
        }
        return { state: 'chapter_rewrite', action: 'waiting', details: { message: '等待 Writer 重写完成' } }
      }

      case 'chapter_review': {
        setPaused(this.projectId, true)
        return { state: 'chapter_review', action: 'waiting', details: { message: '章评审中' } }
      }

      case 'next_arc_plan': {
        this.transition('architecting')
        setActiveAgent(this.projectId, 'architect')
        setPaused(this.projectId, true)
        return {
          state: 'architecting',
          action: 'transition',
          details: { message: '进入下一弧规划，请通过 Architect Agent 展开' }
        }
      }

      case 'volume_review': {
        if (!conditions.reviewDone) {
          return { state: 'volume_review', action: 'waiting', details: { message: '等待 Editor 卷评审完成' } }
        }

        const verdict = conditions.reviewVerdict
        if (verdict === 'pass') {
          if (conditions.hasMoreVolumes) {
            this.transition('next_arc_plan')
            setActiveAgent(this.projectId, 'architect')
            setPaused(this.projectId, true)
            return {
              state: 'next_arc_plan',
              action: 'transition',
              details: { message: '卷评审通过，进入下一卷规划' }
            }
          } else {
            this.transition('completed')
            setActiveAgent(this.projectId, null)
            return {
              state: 'completed',
              action: 'completed',
              details: { message: '所有卷完成，项目结束' }
            }
          }
        }
        if (verdict === 'replan') {
          this.transition('architecting')
          setActiveAgent(this.projectId, 'architect')
          setPaused(this.projectId, true)
          return {
            state: 'architecting',
            action: 'transition',
            details: { message: '卷评审要求重新规划，请通过 Architect Agent 重新规划' }
          }
        }
        return { state: 'volume_review', action: 'waiting', details: { message: '等待卷评审结果' } }
      }

      case 'completed': {
        return { state: 'completed', action: 'completed', details: { message: '项目已完成' } }
      }

      default:
        return { state: currentState, action: 'unknown', details: { message: `未知状态: ${currentState}` } }
    }
  }

  async pause(): Promise<{ state: OrchestratorState; message: string }> {
    console.log('[Orchestrator] pause() projectId:', this.projectId)
    if (this.currentAbortController) {
      console.log('[Orchestrator] pause() aborting current agent')
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
    const conditions = await evaluateBoundaryConditions(this.projectId)
    setSystemStateField(this.projectId, 'paused_boundary', JSON.stringify(conditions))
    setPaused(this.projectId, true)
    logTransition(this.projectId, this.getState(), this.getState(), '用户手动暂停')
    return { state: this.getState(), message: '编排器已暂停' }
  }

  async resume(): Promise<{ state: OrchestratorState; message: string; boundaryChanged?: boolean; boundaryDiff?: string[] }> {
    console.log('[Orchestrator] resume() projectId:', this.projectId)
    const currentState = this.getState()
    const currentConditions = await evaluateBoundaryConditions(this.projectId)
    const state = getSystemState(this.projectId)
    const prevBoundaryStr = state?.paused_boundary ?? '{}'

    let boundaryChanged = false
    const boundaryDiff: string[] = []
    try {
      const prev = JSON.parse(prevBoundaryStr) as Record<string, unknown>
      const curr = currentConditions as unknown as Record<string, unknown>
      const keysToCheck = ['architectureReady', 'arcDone', 'volumeDone', 'arcHasMoreChapters', 'hasMoreArcsInVolume', 'hasMoreVolumes']
      for (const key of keysToCheck) {
        if (String(prev[key]) !== String(curr[key])) {
          boundaryChanged = true
          boundaryDiff.push(`${key}: ${String(prev[key])} → ${String(curr[key])}`)
        }
      }
    } catch { /* ignore parse error */ }

    if (boundaryChanged) {
      console.log('[Orchestrator] resume() boundary changed:', boundaryDiff)
      logTransition(this.projectId, currentState, currentState, '用户恢复编排，检测到边界条件变化', { diff: boundaryDiff })
    }

    setSystemStateField(this.projectId, 'paused_boundary', '{}')
    setPaused(this.projectId, false)
    return {
      state: currentState,
      message: boundaryChanged ? `恢复编排，检测到 ${boundaryDiff.length} 项边界条件变化` : '编排器已恢复',
      boundaryChanged,
      boundaryDiff
    }
  }

  async reset(): Promise<{ state: OrchestratorState; message: string }> {
    console.log('[Orchestrator] reset() projectId:', this.projectId)
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
    const state = getSystemState(this.projectId)
    const previousState = state?.orchestrator_state ?? 'idle'
    cleanupAbandonedSessions(this.projectId)
    setOrchestratorState(this.projectId, 'idle')
    setActiveAgent(this.projectId, null)
    setPaused(this.projectId, false)
    setSystemStateField(this.projectId, 'paused_boundary', '{}')
    setSystemStateField(this.projectId, 'current_chapter_id', null)
    setSystemStateField(this.projectId, 'current_arc_id', null)
    logTransition(this.projectId, previousState, 'idle', '用户重置编排')
    return { state: 'idle', message: '编排器已重置，所有产物数据保留' }
  }

  getRecoveryStatus(): {
    needsRecovery: boolean
    lastState: OrchestratorState
    lastActiveAgent: AgentType | null
    abortedSessions: number
    lastActivityAt: number | null
    message: string
  } {
    const state = getSystemState(this.projectId)
    const lastState = state?.orchestrator_state ?? 'idle'
    const lastActiveAgent = state?.active_agent ?? null
    const lastActivityAt = state?.updated_at ?? null

    const abortedSessions = (db().prepare(
      "SELECT COUNT(*) AS c FROM agent_sessions WHERE project_id = ? AND status = 'aborted'"
    ).get(this.projectId) as { c: number }).c

    const needsRecovery = lastState !== 'idle' && lastState !== 'completed'
    return {
      needsRecovery,
      lastState,
      lastActiveAgent,
      abortedSessions,
      lastActivityAt,
      message: needsRecovery
        ? `检测到未完成的编排。上次状态：${lastState}，活跃 Agent：${lastActiveAgent ?? '无'}。共 ${abortedSessions} 个异常中断的会话。`
        : '编排器处于空闲或已完成状态，无需恢复。'
    }
  }

  setExecutionMode(mode: ExecutionMode): { mode: ExecutionMode } {
    setSystemStateField(this.projectId, 'auto_mode', executionModeToAutoModeInt(mode))
    return { mode }
  }

  transition(to: OrchestratorState): void {
    const from = this.getState()
    setOrchestratorState(this.projectId, to)
    logTransition(this.projectId, from, to, `状态转移: ${from} -> ${to}`)
  }

  async getContext(agentType: AgentType): Promise<string> {
    const state = getSystemState(this.projectId)
    if (!state) return '{}'

    const currentArcId = state.current_arc_id

    const compass = db().prepare(
      'SELECT * FROM story_compass WHERE project_id = ?'
    ).get(this.projectId)

    const characters = db().prepare(
      'SELECT * FROM characters WHERE project_id = ?'
    ).all(this.projectId)

    const volumes = db().prepare(
      'SELECT * FROM volume_arcs WHERE project_id = ? ORDER BY sort_order ASC'
    ).all(this.projectId)

    const foreshadowings = db().prepare(
      "SELECT * FROM foreshadowing_ledger WHERE project_id = ? AND status != 'payed_off'"
    ).all(this.projectId)

    const context: Record<string, unknown> = {
      projectId: this.projectId,
      currentState: state.orchestrator_state,
      storyCompass: compass,
      characters,
      volumes,
      activeForeshadowings: foreshadowings
    }

    if (state.current_chapter_id) {
      context.chapterContract = getChapterContract(this.projectId, state.current_chapter_id)
      context.knowledgeContract = getKnowledgeContract(this.projectId, state.current_chapter_id)
      context.factLocks = getLocksForProject(this.projectId)
      context.latestDraft = getLatestDraft(state.current_chapter_id)
    }

    if (currentArcId) {
      const arc = db().prepare('SELECT * FROM volume_arcs WHERE id = ?').get(currentArcId)
      const outline = db().prepare('SELECT * FROM arc_outlines WHERE arc_id = ?').get(currentArcId)
      const chapterPlans = db().prepare(
        'SELECT * FROM arc_chapter_plans WHERE arc_id = ? ORDER BY chapter_number ASC'
      ).all(currentArcId)
      const chapterSummaries = db().prepare(
        `SELECT cs.* FROM chapter_summaries cs
         JOIN arc_chapter_plans acp ON cs.chapter_id = (
           SELECT c.id FROM chapters c WHERE c.id = cs.chapter_id
         )
         WHERE acp.arc_id = ?`
      ).all(currentArcId)

      context.currentArc = arc
      context.arcOutline = outline
      context.arcChapterPlans = chapterPlans
      context.arcChapterSummaries = chapterSummaries

      const charSnapshots = db().prepare(
        `SELECT * FROM character_state_snapshots
         WHERE project_id = ? AND source_id = ?
         ORDER BY created_at DESC`
      ).all(this.projectId, currentArcId)
      context.characterSnapshots = charSnapshots

      const worldChanges = db().prepare(
        `SELECT * FROM world_state_changes
         WHERE project_id = ? AND chapter_id IN (
           SELECT c.id FROM chapters c
           JOIN arc_chapter_plans acp ON acp.arc_id = ?
         )
         ORDER BY created_at DESC`
      ).all(this.projectId, currentArcId)
      context.worldStateChanges = worldChanges
    }

    const retrievalQuery = buildRetrievalQuery(
      this.projectId,
      (state.current_chapter_id ?? null) as string | null,
      currentArcId ?? null
    )
    if (retrievalQuery.trim()) {
      try {
        const ragContext = await buildMemoryContext(
          this.projectId,
          retrievalQuery,
          state.current_chapter_id ?? undefined
        )
        context.retrievedContext = ragContext
        context.foundationContext = ragContext.chunks.filter((chunk) => chunk.source_type === 'foundation')
      } catch (e) {
        context.retrievalError = (e as Error).message
      }
    }

    return JSON.stringify(context, null, 2)
  }

  async dispatchAgent(
    agentType: AgentType,
    mode: string,
    onAgentResponse?: (response: AgentResponse) => Promise<void>
  ): Promise<{ sessionId: string; context: string }> {
    setActiveAgent(this.projectId, agentType)
    const context = await this.getContext(agentType)
    const sessionId = createAgentSession(this.projectId, agentType, mode, context)

    return { sessionId, context }
  }

  async notifyArchitectureDone(): Promise<void> {
    const conditions = await evaluateBoundaryConditions(this.projectId)
    if (conditions.architectureReady) {
      const firstArcId = getFirstArcId(this.projectId)
      if (firstArcId) {
        setCurrentArc(this.projectId, firstArcId)
        this.transition('contract_generation')
        setActiveAgent(this.projectId, 'architect')
        setPaused(this.projectId, true)
      }
    }
  }

  private handleDraftGateVerdict(
    chapterId: string,
    draftId: string,
    verdict: GateVerdict
  ): { state: OrchestratorState; action: string; details: Record<string, unknown> } {
    switch (verdict.verdict) {
      case 'pass': {
        this.commitChapter(chapterId, draftId)
        const state = getSystemState(this.projectId)
        const arcId = state?.current_arc_id
        if (arcId) {
          const nextPlan = getNextChapterPlan(arcId)
          if (nextPlan) {
            setCurrentChapter(this.projectId, nextPlan.id)
            this.transition('contract_generation')
            setActiveAgent(this.projectId, 'architect')
            setPaused(this.projectId, true)
            return {
              state: 'contract_generation',
              action: 'committed',
              details: {
                message: '门禁通过，章节已 commit。进入下一章契约生成。',
                chapterId,
                draftId,
                nextChapterId: nextPlan.id
              }
            }
          }
        }
        this.transition('arc_review_pending')
        setActiveAgent(this.projectId, 'editor')
        setPaused(this.projectId, true)
        return {
          state: 'arc_review_pending',
          action: 'committed',
          details: { message: '门禁通过，章节已 commit。当前弧无更多章节，进入弧评审。', chapterId, draftId }
        }
      }
      case 'polish': {
        this.transition('polishing')
        setActiveAgent(this.projectId, 'writer')
        setPaused(this.projectId, true)
        return {
          state: 'polishing',
          action: 'polish',
          details: { message: '门禁判定：局部打磨', chapterId, draftId, summary: verdict.summary }
        }
      }
      case 'rewrite': {
        rejectDraft(draftId, verdict.summary)
        this.transition('chapter_rewrite')
        setActiveAgent(this.projectId, 'writer')
        setPaused(this.projectId, true)
        return {
          state: 'chapter_rewrite',
          action: 'rewrite',
          details: { message: '门禁判定：重写', chapterId, draftId, summary: verdict.summary }
        }
      }
      case 'replan': {
        rejectDraft(draftId, verdict.summary)
        this.transition('architecting')
        setActiveAgent(this.projectId, 'architect')
        setPaused(this.projectId, true)
        return {
          state: 'architecting',
          action: 'replan',
          details: { message: '门禁判定：重新规划', chapterId, draftId, summary: verdict.summary }
        }
      }
      case 'escalate': {
        const failCount = countDraftFailures(chapterId)
        const needEscalate = shouldEscalate({
          failCount,
          violationType: verdict.critical_count > 0 ? 'knowledge_leak' : undefined
        })
        if (needEscalate) {
          rejectDraft(draftId, verdict.summary)
          this.transition('chapter_rewrite')
          setActiveAgent(this.projectId, 'writer')
          setPaused(this.projectId, true)
          return {
            state: 'chapter_rewrite',
            action: 'escalate',
            details: {
              message: `门禁判定：升级仲裁（连续失败 ${failCount} 次），需 Pro 模型重写`,
              chapterId,
              draftId,
              summary: verdict.summary,
              recommendedModel: verdict.recommended_model
            }
          }
        }
        rejectDraft(draftId, verdict.summary)
        this.transition('chapter_rewrite')
        setActiveAgent(this.projectId, 'writer')
        setPaused(this.projectId, true)
        return {
          state: 'chapter_rewrite',
          action: 'escalate',
          details: { message: '门禁判定：升级仲裁', chapterId, draftId, summary: verdict.summary }
        }
      }
      default:
        return { state: 'draft_gate', action: 'waiting', details: { message: '未知门禁判定' } }
    }
  }

  private commitChapter(chapterId: string, draftId: string): void {
    const result = commitDraft(draftId)
    if (result.success) {
      setCurrentChapter(this.projectId, chapterId)
      const state = getSystemState(this.projectId)
      if (state?.current_arc_id) {
        const arcId = state.current_arc_id
        db().prepare(
          "UPDATE arc_chapter_plans SET status = 'written', updated_at = ? WHERE arc_id = ? AND id = ?"
        ).run(now(), arcId, chapterId)

        db().prepare(
          "UPDATE volume_arcs SET actual_chapters = actual_chapters + 1, status = 'in_progress', updated_at = ? WHERE id = ?"
        ).run(now(), arcId)
      }
      logTransition(this.projectId, 'draft_gate', 'contract_generation', `章节 ${chapterId} 门禁通过并 commit`, { chapterId, draftId })
    }
  }

  async notifyChapterDone(chapterId: string): Promise<void> {
    if (isCommitted(chapterId)) {
      setCurrentChapter(this.projectId, chapterId)
      return
    }
    console.warn(`[orchestrator] notifyChapterDone 被调用但章节 ${chapterId} 未通过门禁 commit，忽略。Writer 应使用 request_draft_review。`)
  }

  getAgentTools(agentType: AgentType): ToolDefinition[] {
    switch (agentType) {
      case 'architect': return architectTools
      case 'writer': return writerTools
      case 'editor': return editorTools
      default: return architectTools  // handle architect_long and unknown types
    }
  }

  async runCurrentAgent(
    userMessage?: string,
    onThinking?: (thinking: string) => void,
    onToolCall?: (toolName: string, args: Record<string, unknown>) => void,
    onToolResult?: (toolName: string, result: ToolResult) => void,
    onSummary?: (summary: string) => void,
    signal?: AbortSignal
  ): Promise<AgentResponse> {
    const state = getSystemState(this.projectId)
    if (!state || !state.active_agent) {
      console.error('[Orchestrator] runCurrentAgent ERROR: no active agent. state:', state)
      throw new Error('当前没有活跃的 Agent')
    }

    const agentType = state.active_agent!
    const tools = this.getAgentTools(agentType as AgentType)
    const context = await this.getContext(agentType as AgentType)
    const mode = state.orchestrator_state ?? 'idle'

    console.log('[Orchestrator] runCurrentAgent', {
      projectId: this.projectId,
      agentType,
      mode,
      toolCount: tools.length,
      toolNames: tools.map(t => t.name),
      contextLength: context.length,
      hasUserMessage: !!userMessage
    })

    this.currentAbortController = new AbortController()
    const effectiveSignal = signal ?? this.currentAbortController.signal

    try {
      return await runAgent({
        projectId: this.projectId,
        agentType,
        tools,
        context,
        mode,
        userMessage,
        signal: effectiveSignal,
        onThinking,
        onToolCall,
        onToolResult,
        onSummary
      })
    } finally {
      this.currentAbortController = null
    }
  }

  async runCurrentAgentStreaming(
    userMessage?: string,
    onToken?: (token: string) => void,
    onThinking?: (thinking: string) => void,
    onToolCall?: (toolName: string, args: Record<string, unknown>) => void,
    onToolResult?: (toolName: string, result: ToolResult) => void,
    onSummary?: (summary: string) => void,
    signal?: AbortSignal
  ): Promise<AgentResponse> {
    const state = getSystemState(this.projectId)
    if (!state || !state.active_agent) {
      throw new Error('当前没有活跃的 Agent')
    }

    const agentType = state.active_agent!
    const tools = this.getAgentTools(agentType as AgentType)
    const context = await this.getContext(agentType as AgentType)
    const mode = state.orchestrator_state ?? 'idle'

    return runAgentStreaming({
      projectId: this.projectId,
      agentType,
      tools,
      context,
      mode,
      userMessage,
      signal,
      onToken,
      onThinking,
      onToolCall,
      onToolResult,
      onSummary
    })
  }
}

const orchestratorInstances = new Map<string, Orchestrator>()

export function getOrchestrator(projectId: string): Orchestrator {
  let instance = orchestratorInstances.get(projectId)
  if (!instance) {
    instance = new Orchestrator(projectId)
    orchestratorInstances.set(projectId, instance)
  }
  return instance
}

export function destroyOrchestrator(projectId: string): void {
  orchestratorInstances.delete(projectId)
}
