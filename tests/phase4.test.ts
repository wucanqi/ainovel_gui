import { describe, expect, it } from 'vitest'
import { getDb } from '../electron/db'
import { createTestProject, now, uuid } from './setup'
import { createChapterContract, createKnowledgeContract } from '../electron/services/contract.service'
import { runPlanGate } from '../electron/services/draft-gate.service'
import { getOrchestrator, destroyOrchestrator } from '../electron/services/orchestrator'
import { runAllEvaluationCases } from '../electron/services/evaluator.service'

function setupArchitecture(projectId: string): { arcId: string; chapterId: string } {
  const db = getDb()
  const ts = now()

  db.prepare(
    `INSERT INTO story_compass (id, project_id, ending_direction, core_conflict, theme, narrative_pov, version, created_at, updated_at)
     VALUES (?, ?, '测试结局', '测试冲突', '测试主题', 'third_person_limited', 1, ?, ?)`
  ).run(uuid(), projectId, ts, ts)

  const charId = uuid()
  db.prepare(
    `INSERT INTO characters (id, project_id, name, role, appearance, personality, background, updated_at)
     VALUES (?, ?, '林岚', 'protagonist', '普通外貌', '冷静', '法医', ?)`
  ).run(charId, projectId, ts)

  db.prepare(
    `INSERT INTO character_arcs (id, project_id, character_id, arc_type, starting_state, ending_state, core_lie, core_truth, is_protagonist, version, created_at, updated_at)
     VALUES (?, ?, ?, 'positive_change', '谨慎', '坚定', '我无法破局', '真相总会出现', 1, 1, ?, ?)`
  ).run(uuid(), projectId, charId, ts, ts)

  const volId = uuid()
  db.prepare(
    `INSERT INTO volumes (id, project_id, title, sort_order)
     VALUES (?, ?, '第一卷', 1)`
  ).run(volId, projectId)

  const chapterId = uuid()
  db.prepare(
    `INSERT INTO chapters (id, project_id, volume_id, title, sort_order, content, plain_text, status, word_count, created_at, updated_at)
     VALUES (?, ?, ?, '第一章', 1, '', '', 'draft', 0, ?, ?)`
  ).run(chapterId, projectId, volId, ts, ts)

  const arcId = uuid()
  db.prepare(
    `INSERT INTO volume_arcs (id, project_id, volume_number, volume_title, arc_number, arc_title, arc_goal, arc_type, planned_chapters, status, sort_order, created_at, updated_at)
     VALUES (?, ?, 1, '第一卷', 1, '首弧', '首弧目标', 'rising', 1, 'expanded', 1, ?, ?)`
  ).run(arcId, projectId, ts, ts)

  db.prepare(
    `INSERT INTO arc_outlines (id, project_id, arc_id, arc_opening, arc_midpoint, arc_climax, arc_resolution, version, created_at, updated_at)
     VALUES (?, ?, ?, '开场', '中点', '高潮', '结尾', 1, ?, ?)`
  ).run(uuid(), projectId, arcId, ts, ts)

  db.prepare(
    `INSERT INTO arc_chapter_plans (id, arc_id, chapter_number, chapter_title, chapter_goal, status, created_at, updated_at)
     VALUES (?, ?, 1, '第一章', '引入主角并留下悬念', 'planned', ?, ?)`
  ).run(chapterId, arcId, ts, ts)

  db.prepare(
    `INSERT INTO foreshadowing_ledger (id, project_id, name, content, type, importance, status, created_at, updated_at)
     VALUES (?, ?, '神秘预言', '神秘老者的预言', 'mystery', 'medium', 'planned', ?, ?)`
  ).run(uuid(), projectId, ts, ts)

  return { arcId, chapterId }
}

describe('Phase 4 Plan Gate', () => {
  it('should pass when chapter plan satisfies chapter and knowledge contracts', async () => {
    const projectId = createTestProject()
    const { arcId, chapterId } = setupArchitecture(projectId)
    const db = getDb()
    const ts = now()

    createChapterContract(projectId, chapterId, arcId, {
      required_beats: ['引入主角', '发现线索'],
      hook_goal: '留下悬念',
      allowed_foreshadow_ids: []
    })
    createKnowledgeContract(projectId, chapterId, {
      forbidden_inferences: ['预感'],
      author_only_facts: []
    })

    db.prepare(
      `INSERT INTO chapter_plans
       (id, project_id, chapter_id, arc_id, chapter_number, plan_content, scenes, pacing, pov, estimated_words, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'medium', '林岚', 2500, ?, ?)`
    ).run(
      uuid(),
      projectId,
      chapterId,
      arcId,
      '本章引入主角林岚，发现线索，并在结尾留下悬念。',
      JSON.stringify([{ description: '引入主角' }, { description: '发现线索' }, { description: '留下悬念' }]),
      ts,
      ts
    )

    const verdict = await runPlanGate(projectId, chapterId)
    expect(verdict.verdict).toBe('pass')
    expect(verdict.overall_passed).toBe(true)
  })

  it('orchestrator should enter writing after plan gate passes', async () => {
    const projectId = createTestProject()
    const { arcId, chapterId } = setupArchitecture(projectId)
    const db = getDb()
    const ts = now()

    createChapterContract(projectId, chapterId, arcId, {
      required_beats: ['引入主角'],
      hook_goal: '留下悬念',
      allowed_foreshadow_ids: []
    })
    createKnowledgeContract(projectId, chapterId, {
      forbidden_inferences: [],
      author_only_facts: []
    })

    db.prepare(
      `INSERT INTO chapter_plans
       (id, project_id, chapter_id, arc_id, chapter_number, plan_content, scenes, pacing, pov, estimated_words, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'medium', '林岚', 2500, ?, ?)`
    ).run(
      uuid(),
      projectId,
      chapterId,
      arcId,
      '本章引入主角，并在结尾留下悬念。',
      JSON.stringify([{ description: '引入主角' }, { description: '留下悬念' }]),
      ts,
      ts
    )

    const orchestrator = getOrchestrator(projectId)
    await orchestrator.start()
    let result = await orchestrator.tick()
    expect(result.state).toBe('plan_gate')

    result = await orchestrator.tick()
    expect(result.state).toBe('writing')
    destroyOrchestrator(projectId)
  })
})

describe('Phase 4 Evaluator', () => {
  it('should run built-in evaluation cases and flag forbidden patterns', () => {
    const projectId = createTestProject()
    const results = runAllEvaluationCases({
      projectId,
      content: '他冥冥之中预感到，会有一个从未见过却莫名熟悉的女子出现。'
    })

    expect(results.length).toBe(10)
    expect(results.some((item) => item.passed === false)).toBe(true)
    expect(results.some((item) => item.matches.length > 0)).toBe(true)
  })
})
