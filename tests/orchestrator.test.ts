import { describe, it, expect } from 'vitest'
import { getDb } from '../electron/db'
import { createTestProject, uuid, now } from './setup'
import {
  getOrchestrator,
  evaluateBoundaryConditions,
  getSystemState,
  destroyOrchestrator
} from '../electron/services/orchestrator'
import { executeTool } from '../electron/services/tool-executor'

function setupArchitecture(projectId: string): void {
  const db = getDb()
  const ts = now()

  db.prepare(
    `INSERT INTO story_compass (id, project_id, ending_direction, core_conflict, theme, narrative_pov, version, created_at, updated_at)
     VALUES (?, ?, '测试结局', '测试冲突', '测试主题', 'third_person_limited', 1, ?, ?)`
  ).run(uuid(), projectId, ts, ts)

  const charId = uuid()
  db.prepare(
    `INSERT INTO characters (id, project_id, name, role, appearance, personality, background, updated_at)
     VALUES (?, ?, '主角', 'protagonist', '普通外貌', '善良', '乡村出身', ?)`
  ).run(charId, projectId, ts)

  db.prepare(
    `INSERT INTO character_arcs (id, project_id, character_id, arc_type, starting_state, ending_state, core_lie, core_truth, is_protagonist, version, created_at, updated_at)
     VALUES (?, ?, ?, 'positive_change', '胆怯', '勇敢', '我太弱', '勇气来自内心', 1, 1, ?, ?)`
  ).run(uuid(), projectId, charId, ts, ts)

  const arcId = uuid()
  db.prepare(
    `INSERT INTO volume_arcs (id, project_id, volume_number, volume_title, arc_number, arc_title, arc_goal, arc_type, planned_chapters, status, sort_order, created_at, updated_at)
     VALUES (?, ?, 1, '第一卷', 1, '首弧', '首弧目标', 'rising', 5, 'expanded', 1, ?, ?)`
  ).run(arcId, projectId, ts, ts)

  db.prepare(
    `INSERT INTO arc_outlines (id, project_id, arc_id, arc_opening, arc_midpoint, arc_climax, arc_resolution, version, created_at, updated_at)
     VALUES (?, ?, ?, '首弧开场', '首弧中点', '首弧高潮', '首弧结局', 1, ?, ?)`
  ).run(uuid(), projectId, arcId, ts, ts)

  for (let i = 1; i <= 5; i++) {
    db.prepare(
      `INSERT INTO arc_chapter_plans (id, arc_id, chapter_number, chapter_title, chapter_goal, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'planned', ?, ?)`
    ).run(uuid(), arcId, i, `第${i}章`, `第${i}章目标`, ts, ts)
  }

  db.prepare(
    `INSERT INTO foreshadowing_ledger (id, project_id, name, content, type, importance, status, created_at, updated_at)
     VALUES (?, ?, '神秘预言', '神秘老者的预言', 'mystery', 'medium', 'planned', ?, ?)`
  ).run(uuid(), projectId, ts, ts)
}

describe('Orchestrator State Machine', () => {
  it('should start in idle state', () => {
    const projectId = createTestProject()
    const orchestrator = getOrchestrator(projectId)
    expect(orchestrator.getState()).toBe('idle')
    destroyOrchestrator(projectId)
  })

  it('should transition to architecting when architecture is not ready', async () => {
    const projectId = createTestProject()
    const orchestrator = getOrchestrator(projectId)

    const result = await orchestrator.start()
    expect(result.state).toBe('architecting')
    expect(result.message).toContain('故事指南针')

    const state = getSystemState(projectId)
    expect(state?.orchestrator_state).toBe('architecting')
    expect(state?.active_agent).toBe('architect')
    destroyOrchestrator(projectId)
  })

  it('should transition to contract_generation when architecture is ready', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const orchestrator = getOrchestrator(projectId)
    const result = await orchestrator.start()
    expect(result.state).toBe('contract_generation')
    expect(result.message).toContain('契约生成')

    const state = getSystemState(projectId)
    expect(state?.orchestrator_state).toBe('contract_generation')
    expect(state?.active_agent).toBe('architect')
    expect(state?.current_arc_id).toBeTruthy()
    destroyOrchestrator(projectId)
  })

  it('should pause and resume', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const orchestrator = getOrchestrator(projectId)
    await orchestrator.start()

    const ps = await orchestrator.pause()
    expect(ps.state).toBe('contract_generation')
    expect(getSystemState(projectId)?.is_paused).toBe(1)

    const rs = await orchestrator.resume()
    expect(rs.state).toBe('contract_generation')
    expect(getSystemState(projectId)?.is_paused).toBe(0)
    destroyOrchestrator(projectId)
  })

  it('should persist execution mode selection', () => {
    const projectId = createTestProject()
    const orchestrator = getOrchestrator(projectId)
    const result = orchestrator.setExecutionMode('arc_auto')
    expect(result.mode).toBe('arc_auto')
    expect(getSystemState(projectId)?.auto_mode).toBe(2)
    destroyOrchestrator(projectId)
  })

  it('tick should stay in contract_generation when contracts are not ready', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const orchestrator = getOrchestrator(projectId)
    await orchestrator.start()

    const result = await orchestrator.tick()
    expect(result.state).toBe('contract_generation')
    expect(result.action).toBe('waiting')
    destroyOrchestrator(projectId)
  })

  it('tick should transition to arc_review_pending when all chapters written', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const db = getDb()
    const arcId = db.prepare(
      `SELECT id FROM volume_arcs WHERE project_id = ? AND status = 'expanded' LIMIT 1`
    ).get(projectId) as { id: string }

    db.prepare(
      "UPDATE arc_chapter_plans SET status = 'written' WHERE arc_id = ?"
    ).run(arcId.id)

    db.prepare(
      "UPDATE volume_arcs SET actual_chapters = 5 WHERE id = ?"
    ).run(arcId.id)

    const orchestrator = getOrchestrator(projectId)
    await orchestrator.start()

    const result = await orchestrator.tick()
    expect(result.state).toBe('arc_review_pending')
    destroyOrchestrator(projectId)
  })

  it('should transition from arc_review to arc_passed when review is pass', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const db = getDb()
    const arcId = db.prepare(
      `SELECT id FROM volume_arcs WHERE project_id = ? AND status = 'expanded' LIMIT 1`
    ).get(projectId) as { id: string }

    db.prepare(
      "UPDATE arc_chapter_plans SET status = 'written' WHERE arc_id = ?"
    ).run(arcId.id)
    db.prepare(
      "UPDATE volume_arcs SET actual_chapters = 5 WHERE id = ?"
    ).run(arcId.id)

    const orchestrator = getOrchestrator(projectId)
    await orchestrator.start()

    let result = await orchestrator.tick()
    expect(result.state).toBe('arc_review_pending')

    result = await orchestrator.tick()
    expect(result.state).toBe('arc_review')

    await executeTool(projectId, 'review_pass', {
      target_id: arcId.id,
      review_type: 'arc',
      opinion: '测试评审通过',
      dimension_scores: '{"plot":80,"character":85,"pacing":82,"consistency":90,"hook":88}'
    })

    result = await orchestrator.tick()
    expect(result.state).toBe('arc_passed')
    destroyOrchestrator(projectId)
  })

  it('should transition to polishing when review is polish', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const db = getDb()
    const arcId = db.prepare(
      `SELECT id FROM volume_arcs WHERE project_id = ? AND status = 'expanded' LIMIT 1`
    ).get(projectId) as { id: string }

    db.prepare(
      "UPDATE arc_chapter_plans SET status = 'written' WHERE arc_id = ?"
    ).run(arcId.id)
    db.prepare(
      "UPDATE volume_arcs SET actual_chapters = 5 WHERE id = ?"
    ).run(arcId.id)

    const orchestrator = getOrchestrator(projectId)
    await orchestrator.start()

    let result = await orchestrator.tick()
    result = await orchestrator.tick()

    await executeTool(projectId, 'review_polish', {
      target_id: arcId.id,
      review_type: 'arc',
      opinion: '需要打磨',
      polish_points: '[{"chapter_id":"ch-3","point":"需要打磨"}]',
      dimension_scores: '{"pacing":60}'
    })

    result = await orchestrator.tick()
    expect(result.state).toBe('polishing')
    destroyOrchestrator(projectId)
  })

  it('should transition to chapter_rewrite when review is rewrite_chapter', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const db = getDb()
    const arcId = db.prepare(
      `SELECT id FROM volume_arcs WHERE project_id = ? AND status = 'expanded' LIMIT 1`
    ).get(projectId) as { id: string }

    db.prepare(
      "UPDATE arc_chapter_plans SET status = 'written' WHERE arc_id = ?"
    ).run(arcId.id)
    db.prepare(
      "UPDATE volume_arcs SET actual_chapters = 5 WHERE id = ?"
    ).run(arcId.id)

    const orchestrator = getOrchestrator(projectId)
    await orchestrator.start()

    let result = await orchestrator.tick()
    result = await orchestrator.tick()

    await executeTool(projectId, 'review_rewrite_chapter', {
      target_id: arcId.id,
      review_type: 'arc',
      opinion: '需要重写',
      rewrite_reason: '情节不合理',
      replan_suggestion: '建议重新规划第三章',
      dimension_scores: '{"plot":50}'
    })

    result = await orchestrator.tick()
    expect(result.state).toBe('chapter_rewrite')
    destroyOrchestrator(projectId)
  })

  it('should transition to completed when all volumes done', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const db = getDb()
    const arcId = db.prepare(
      `SELECT id FROM volume_arcs WHERE project_id = ? AND status = 'expanded' LIMIT 1`
    ).get(projectId) as { id: string }

    db.prepare(
      "UPDATE arc_chapter_plans SET status = 'written' WHERE arc_id = ?"
    ).run(arcId.id)
    db.prepare(
      "UPDATE volume_arcs SET actual_chapters = 5 WHERE id = ?"
    ).run(arcId.id)

    db.prepare(
      "DELETE FROM volume_arcs WHERE id != ?"
    ).run(arcId.id)

    const orchestrator = getOrchestrator(projectId)
    await orchestrator.start()

    let result = await orchestrator.tick()
    result = await orchestrator.tick()

    await executeTool(projectId, 'review_pass', {
      target_id: arcId.id,
      review_type: 'arc',
      opinion: 'pass',
      dimension_scores: '{"plot":80,"character":85,"pacing":82,"consistency":90,"hook":88}'
    })

    result = await orchestrator.tick()
    expect(result.state).toBe('arc_passed')

    await executeTool(projectId, 'generate_arc_summary', {
      arc_id: arcId.id,
      summary: '测试弧摘要',
      character_progression: '{}',
      foreshadowing_status: '[]',
      world_state_summary: '无变化'
    })

    result = await orchestrator.tick()
    expect(result.state).toBe('volume_review')

    await executeTool(projectId, 'review_pass', {
      target_id: arcId.id,
      review_type: 'volume',
      opinion: '卷评审通过',
      dimension_scores: '{"plot":90,"character":90,"pacing":90,"consistency":90,"hook":90}'
    })

    result = await orchestrator.tick()
    expect(result.state).toBe('completed')
    destroyOrchestrator(projectId)
  })
})

describe('Boundary Conditions', () => {
  it('should return default conditions for new project', async () => {
    const projectId = createTestProject()
    const conditions = await evaluateBoundaryConditions(projectId)
    expect(conditions.canWrite).toBe(false)
    expect(conditions.architectureReady).toBe(false)
    expect(conditions.arcDone).toBe(false)
    expect(conditions.volumeDone).toBe(false)
  })

  it('should detect architecture ready', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const conditions = await evaluateBoundaryConditions(projectId)
    expect(conditions.architectureReady).toBe(true)
  })

  it('should detect arc not done when chapters remain', async () => {
    const projectId = createTestProject()
    setupArchitecture(projectId)

    const conditions = await evaluateBoundaryConditions(projectId)
    expect(conditions.arcDone).toBe(false)
    expect(conditions.arcHasMoreChapters).toBe(true)
  })
})

describe('Orchestration Logging', () => {
  it('should log transitions', async () => {
    const projectId = createTestProject()
    const orchestrator = getOrchestrator(projectId)

    orchestrator.transition('architecting')
    orchestrator.transition('writing')
    orchestrator.transition('arc_review_pending')

    const db = getDb()
    const rows = db.prepare(
      `SELECT * FROM orchestration_log WHERE project_id = ? ORDER BY created_at ASC`
    ).all(projectId) as Array<Record<string, unknown>>

    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows[0].to_state).toBe('architecting')
    expect(rows[1].to_state).toBe('writing')
    expect(rows[2].to_state).toBe('arc_review_pending')
    destroyOrchestrator(projectId)
  })
})
