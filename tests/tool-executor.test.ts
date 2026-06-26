import { describe, it, expect } from 'vitest'
import { registerTool, executeTool, getAllToolNames, createAgentSession, logAgentDecision } from '../electron/services/tool-executor'
import { getDb } from '../electron/db'
import { createTestProject, uuid, now } from './setup'
import type { ToolDefinition } from '@shared/types'

describe('Tool Executor', () => {
  const testTool: ToolDefinition = {
    name: 'test_echo',
    description: 'Echo tool for testing',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to echo' }
      },
      required: ['message']
    },
    async handler(_projectId, args) {
      return { success: true, data: { echoed: args.message } }
    }
  }

  it('should register a tool', () => {
    registerTool(testTool)
    const names = getAllToolNames()
    expect(names).toContain('test_echo')
  })

  it('should execute a registered tool', async () => {
    registerTool(testTool)
    const result = await executeTool('proj-1', 'test_echo', { message: 'hello' })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ echoed: 'hello' })
  })

  it('should return error for unknown tool', async () => {
    const result = await executeTool('proj-1', 'unknown_tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('should handle tool that throws', async () => {
    const badTool: ToolDefinition = {
      name: 'bad_tool',
      description: 'Always fails',
      parameters: { type: 'object', properties: {} },
      async handler() {
        throw new Error('intentional failure')
      }
    }
    registerTool(badTool)
    const result = await executeTool('proj-1', 'bad_tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('intentional failure')
  })
})

describe('Agent Sessions & Decisions', () => {
  it('should create an agent session', () => {
    const projectId = createTestProject()
    const sessionId = createAgentSession(projectId, 'architect', 'architecting', '{}')
    expect(sessionId).toBeTruthy()

    const db = getDb()
    const row = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(sessionId) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.agent_type).toBe('architect')
    expect(row.mode).toBe('architecting')
  })

  it('should log agent decisions', () => {
    const projectId = createTestProject()
    const sessionId = createAgentSession(projectId, 'writer', 'writing', '{}')

    logAgentDecision(
      projectId,
      sessionId,
      'writer',
      1,
      'write_chapter_body',
      { chapter_id: 'ch-1', content: '<p>test</p>' },
      { word_count: 1 },
      'Writing chapter 1'
    )

    const db = getDb()
    const row = db.prepare(
      'SELECT * FROM agent_decisions WHERE session_id = ?'
    ).get(sessionId) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.agent_type).toBe('writer')
    expect(row.round_number).toBe(1)
    expect(row.tool_name).toBe('write_chapter_body')
  })
})

describe('Architect Tools', () => {
  it('set_story_compass should create story compass', async () => {
    const projectId = createTestProject()
    const result = await executeTool(projectId, 'set_story_compass', {
      ending_direction: '主角最终战胜魔王',
      core_conflict: '人类与魔族的千年战争',
      theme: '勇气与牺牲',
      one_line_pitch: '一个少年从凡人到英雄的旅程',
      genre: 'fantasy',
      sub_genre: 'epic',
      selling_point: '宏大的世界观',
      target_audience: '青年读者',
      emotional_tone: '悲壮中带着希望',
      narrative_pov: 'third_person_limited'
    })
    expect(result.success).toBe(true)

    const db = getDb()
    const row = db.prepare('SELECT * FROM story_compass WHERE project_id = ?').get(projectId) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.ending_direction).toBe('主角最终战胜魔王')
    expect(row.genre).toBe('fantasy')
    expect(row.version).toBe(1)
  })

  it('create_character should create a character', async () => {
    const projectId = createTestProject()
    const result = await executeTool(projectId, 'create_character', {
      name: '主角·李凡',
      role: 'protagonist',
      appearance: '黑发黑瞳',
      personality: '善良勇敢',
      background: '出生在偏远山村',
      notes: '男主角'
    })
    expect(result.success).toBe(true)

    const db = getDb()
    const row = db.prepare('SELECT * FROM characters WHERE project_id = ?').get(projectId) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.name).toBe('主角·李凡')
    expect(row.role).toBe('protagonist')
  })

  it('create_character_arc should create a character arc', async () => {
    const projectId = createTestProject()
    const charResult = await executeTool(projectId, 'create_character', {
      name: '主角·李凡', role: 'protagonist', appearance: '', personality: '', background: ''
    })
    const charId = (charResult.data as { id: string }).id

    const result = await executeTool(projectId, 'create_character_arc', {
      character_id: charId,
      arc_type: 'positive_change',
      starting_state: '胆小怕事，缺乏自信',
      ending_state: '勇敢无畏，成为领袖',
      core_lie: '我太弱小，什么都做不了',
      core_truth: '真正的勇气来自内心',
      transformation_nodes: '["家人遇险","挺身而出","首次胜利","失去导师","独当一面"]',
      is_protagonist: 1
    })
    expect(result.success).toBe(true)

    const db = getDb()
    const row = db.prepare('SELECT * FROM character_arcs WHERE character_id = ?').get(charId) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.starting_state).toBe('胆小怕事，缺乏自信')
    expect(row.arc_type).toBe('positive_change')
  })

  it('create_world_rule should create a world rule', async () => {
    const projectId = createTestProject()
    const result = await executeTool(projectId, 'create_world_rule', {
      name: '魔法体系',
      description: '世界的魔法基于元素之力',
      category: 'magic_system',
      implications: '火水土风四元素，每人只能掌握一种'
    })
    expect(result.success).toBe(true)

    const db = getDb()
    const row = db.prepare('SELECT * FROM world_rules WHERE project_id = ?').get(projectId) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.name).toBe('魔法体系')
    expect(row.category).toBe('magic_system')
  })
})

describe('Writer Tools', () => {
  it('create_chapter_plan should create a chapter plan', async () => {
    const projectId = createTestProject()
    const chapterId = uuid()
    const db = getDb()
    const ts = now()

    const volId = uuid()
    db.prepare(
      `INSERT INTO volumes (id, project_id, title, sort_order)
       VALUES (?, ?, '第一卷', 1)`
    ).run(volId, projectId)

    db.prepare(
      `INSERT INTO chapters (id, project_id, volume_id, title, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, '第一章', 1, ?, ?)`
    ).run(chapterId, projectId, volId, ts, ts)

    const arcId = uuid()
    db.prepare(
      `INSERT INTO volume_arcs (id, project_id, volume_number, volume_title, arc_number, arc_title, arc_goal, arc_type, planned_chapters, status, sort_order, created_at, updated_at)
       VALUES (?, ?, 1, '第一卷', 1, '首弧', '首弧目标', 'rising', 5, 'expanded', 1, ?, ?)`
    ).run(arcId, projectId, ts, ts)

    const result = await executeTool(projectId, 'create_chapter_plan', {
      chapter_id: chapterId,
      arc_id: arcId,
      chapter_number: 1,
      plan_content: '引入主角和世界观',
      scenes: '["开场场景","主角日常","突发事件"]',
      pacing: 'medium',
      pov: '主角',
      estimated_words: 3000
    })
    expect(result.success).toBe(true)

    const row = db.prepare(
      'SELECT * FROM chapter_plans WHERE chapter_id = ?'
    ).get(chapterId) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.chapter_number).toBe(1)
    expect(row.plan_content).toBe('引入主角和世界观')
  })

  it('write_chapter_body should write chapter content', async () => {
    const projectId = createTestProject()
    const chapterId = uuid()
    const db = getDb()
    const ts = now()
    const content = '<p>这是一段测试内容用于验证字数统计功能是否正确工作</p><p>第二段测试内容</p>'

    const volId = uuid()
    db.prepare(
      `INSERT INTO volumes (id, project_id, title, sort_order)
       VALUES (?, ?, '第一卷', 1)`
    ).run(volId, projectId)

    db.prepare(
      `INSERT INTO chapters (id, project_id, volume_id, title, sort_order, content, status, word_count, created_at, updated_at)
       VALUES (?, ?, ?, '第一章', 1, '', 'draft', 0, ?, ?)`
    ).run(chapterId, projectId, volId, ts, ts)

    const result = await executeTool(projectId, 'write_chapter_body', {
      chapter_id: chapterId,
      content
    })
    expect(result.success).toBe(true)

    const chapterRow = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as Record<string, unknown>
    expect(chapterRow.content).toBe('')
    expect(chapterRow.word_count).toBe(0)
    expect(chapterRow.status).toBe('draft')

    const draftRow = db.prepare(
      'SELECT * FROM chapter_drafts WHERE chapter_id = ? ORDER BY version DESC LIMIT 1'
    ).get(chapterId) as Record<string, unknown>
    expect(draftRow.content).toBe(content)
    expect((draftRow.word_count as number) > 0).toBe(true)
    expect(draftRow.lifecycle).toBe('draft_generated')
  })
})

describe('Editor Tools', () => {
  it('review_pass should create a review record with pass verdict', async () => {
    const projectId = createTestProject()
    const arcId = uuid()
    const db = getDb()
    const ts = now()
    db.prepare(
      `INSERT INTO volume_arcs (id, project_id, volume_number, volume_title, arc_number, arc_title, arc_goal, arc_type, planned_chapters, status, sort_order, created_at, updated_at)
       VALUES (?, ?, 1, '第一卷', 1, '首弧', '首弧目标', 'rising', 5, 'in_progress', 1, ?, ?)`
    ).run(arcId, projectId, ts, ts)

    const result = await executeTool(projectId, 'review_pass', {
      target_id: arcId,
      review_type: 'arc',
      opinion: '首弧整体质量良好',
      dimension_scores: '{"plot":80,"character":85,"pacing":82,"consistency":90,"hook":88}'
    })
    expect(result.success).toBe(true)

    const row = db.prepare(
      'SELECT * FROM review_records WHERE target_id = ? AND review_type = ?'
    ).get(arcId, 'arc') as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.verdict).toBe('pass')
    expect(row.opinion).toBe('首弧整体质量良好')
  })

  it('review_polish should create review with polish verdict and notes', async () => {
    const projectId = createTestProject()
    const arcId = uuid()
    const db = getDb()
    const ts = now()
    db.prepare(
      `INSERT INTO volume_arcs (id, project_id, volume_number, volume_title, arc_number, arc_title, arc_goal, arc_type, planned_chapters, status, sort_order, created_at, updated_at)
       VALUES (?, ?, 1, '第一卷', 1, '首弧', '首弧目标', 'rising', 5, 'in_progress', 1, ?, ?)`
    ).run(arcId, projectId, ts, ts)

    const result = await executeTool(projectId, 'review_polish', {
      target_id: arcId,
      review_type: 'chapter',
      opinion: '需要打磨节奏',
      polish_points: '[{"chapter_id":"ch-3","point":"第三章节奏偏慢，需要压缩过渡场景"}]',
      dimension_scores: '{"pacing":60}'
    })
    expect(result.success).toBe(true)

    const row = db.prepare(
      'SELECT * FROM review_records WHERE target_id = ?'
    ).get(arcId) as Record<string, unknown>
    expect(row.verdict).toBe('polish')
    expect(row.opinion).toBe('需要打磨节奏')
  })

  it('generate_arc_summary should create arc summary', async () => {
    const projectId = createTestProject()
    const arcId = uuid()
    const db = getDb()
    const ts = now()
    db.prepare(
      `INSERT INTO volume_arcs (id, project_id, volume_number, volume_title, arc_number, arc_title, arc_goal, arc_type, planned_chapters, status, sort_order, created_at, updated_at)
       VALUES (?, ?, 1, '第一卷', 1, '首弧', '首弧目标', 'rising', 5, 'in_progress', 1, ?, ?)`
    ).run(arcId, projectId, ts, ts)

    const result = await executeTool(projectId, 'generate_arc_summary', {
      arc_id: arcId,
      summary: '首弧讲述了主角觉醒踏上旅程的故事',
      character_progression: '主角从胆怯到自信',
      foreshadowing_status: '[]',
      world_state_summary: '世界格局未变'
    })
    expect(result.success).toBe(true)

    const row = db.prepare('SELECT * FROM arc_summaries WHERE arc_id = ?').get(arcId) as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.summary).toBe('首弧讲述了主角觉醒踏上旅程的故事')
    expect(row.world_state_summary).toBe('世界格局未变')
  })
})
