import type { ToolDefinition } from '@shared/types'
import { getDb } from '../../db'
import { uuid, now } from '../../lib/util'
import { createDraft, getLatestDraft, isCommitted } from '../draft.service'
import { getChapterContract, getKnowledgeContract } from '../contract.service'

function htmlToPlain(html: string): string {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function countWords(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const en = (text.match(/[A-Za-z0-9_]+/g) || []).length
  return cjk + en
}

function requireCommitted(projectId: string, chapterId: string): { ok: boolean; error?: string } {
  void projectId
  if (!isCommitted(chapterId)) {
    return {
      ok: false,
      error: `章节 ${chapterId} 尚未通过门禁并 commit，禁止写入长期记忆（摘要/角色状态/伏笔/世界状态）。请先通过 Draft Gate 检查并由 Orchestrator commit。`
    }
  }
  return { ok: true }
}

const create_chapter_plan: ToolDefinition = {
  name: 'create_chapter_plan',
  description: '制定章节计划（场景列表、节奏、视角）。必须在 Plan Gate 通过后调用。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '章节ID' },
      arc_id: { type: 'string', description: '所属弧ID' },
      chapter_number: { type: 'number', description: '章序号' },
      plan_content: { type: 'string', description: '计划内容' },
      scenes: { type: 'string', description: '场景列表（JSON数组）' },
      pacing: { type: 'string', description: '节奏' },
      pov: { type: 'string', description: '视角' },
      estimated_words: { type: 'number', description: '预估字数' }
    },
    required: ['chapter_id', 'chapter_number']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO chapter_plans
       (id, project_id, chapter_id, arc_id, chapter_number, plan_content,
        scenes, pacing, pov, estimated_words, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId, args.chapter_id as string,
      (args.arc_id as string) ?? null,
      args.chapter_number as number,
      (args.plan_content as string) ?? '',
      JSON.stringify((args.scenes as unknown) ?? []),
      (args.pacing as string) ?? '',
      (args.pov as string) ?? '',
      (args.estimated_words as number) ?? 0,
      ts, ts
    )
    return { success: true, data: { id } }
  }
}

const get_chapter_contract: ToolDefinition = {
  name: 'get_chapter_contract',
  description: '获取本章的章节契约（ChapterContract）。Writer 写作前必须读取，了解 required_beats / forbidden_moves / hook_goal 等约束。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '章节ID' }
    },
    required: ['chapter_id']
  },
  async handler(projectId, args) {
    const contract = getChapterContract(projectId, args.chapter_id as string)
    if (!contract) {
      return { success: false, error: '未找到章节契约，请联系 Architect 生成。' }
    }
    return { success: true, data: contract }
  }
}

const get_knowledge_contract: ToolDefinition = {
  name: 'get_knowledge_contract',
  description: '获取本章的知识契约（KnowledgeContract）。Writer 写作前必须读取，了解 POV 角色的 known/unknown_facts、forbidden_inferences 等知识边界。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '章节ID' }
    },
    required: ['chapter_id']
  },
  async handler(projectId, args) {
    const contract = getKnowledgeContract(projectId, args.chapter_id as string)
    if (!contract) {
      return { success: false, error: '未找到知识契约，请联系 Architect 生成。' }
    }
    return { success: true, data: contract }
  }
}

const write_chapter_body: ToolDefinition = {
  name: 'write_chapter_body',
  description: '写入章节正文草稿。注意：此工具写入 chapter_drafts 表（草稿），不会直接写入 chapters 表。草稿必须通过 Draft Gate 门禁后，由 Orchestrator commit 才能正式生效。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '章节ID' },
      content: { type: 'string', description: '章节正文HTML' },
      model_used: { type: 'string', description: '使用的模型名称（如 deepseek-chat / deepseek-reasoner）' }
    },
    required: ['chapter_id', 'content']
  },
  async handler(projectId, args) {
    const content = args.content as string
    const modelUsed = (args.model_used as string) ?? 'unknown'
    const draft = createDraft(projectId, args.chapter_id as string, content, modelUsed)
    return {
      success: true,
      data: {
        draft_id: draft.id,
        version: draft.version,
        word_count: draft.word_count,
        lifecycle: draft.lifecycle,
        message: '草稿已生成，等待 Draft Gate 门禁检查。通过后由 Orchestrator commit。'
      }
    }
  }
}

const request_draft_review: ToolDefinition = {
  name: 'request_draft_review',
  description: '请求对当前章节最新草稿执行 Draft Gate 门禁检查。Writer 完成草稿后调用此工具，不能直接 report_chapter_done。门禁若未通过，后续任务会带回具体违规点，你必须逐条修复，不能盲目重复送审。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '章节ID' }
    },
    required: ['chapter_id']
  },
  async handler(projectId, args) {
    const chapterId = args.chapter_id as string
    const draft = getLatestDraft(chapterId)
    if (!draft) {
      return { success: false, error: '未找到草稿，请先调用 write_chapter_body 生成草稿。' }
    }
    return {
      success: true,
      data: {
        draft_id: draft.id,
        chapter_id: chapterId,
        version: draft.version,
        lifecycle: draft.lifecycle,
        message: '已请求门禁检查。Orchestrator 将执行 Draft Gate 并决定 commit / polish / rewrite / replan / escalate。若未通过，系统会在后续任务中返回具体违规点。'
      }
    }
  }
}

const update_character_state: ToolDefinition = {
  name: 'update_character_state',
  description: '更新角色状态快照。守卫：仅允许在章节 commit 后调用，未 commit 的草稿不得更新角色状态。',
  parameters: {
    type: 'object',
    properties: {
      character_id: { type: 'string', description: '角色ID' },
      source_type: { type: 'string', description: '来源类型：chapter / arc / volume' },
      source_id: { type: 'string', description: '来源ID' },
      state_description: { type: 'string', description: '状态描述' },
      current_location: { type: 'string', description: '当前位置' },
      current_goal: { type: 'string', description: '当前目标' },
      emotional_state: { type: 'string', description: '情绪状态' },
      inventory: { type: 'string', description: '持有物品（JSON数组）' },
      key_relationships: { type: 'string', description: '关键关系（JSON对象）' }
    },
    required: ['character_id', 'source_type', 'source_id']
  },
  async handler(projectId, args) {
    const sourceType = args.source_type as string
    const sourceId = args.source_id as string
    if (sourceType === 'chapter') {
      const guard = requireCommitted(projectId, sourceId)
      if (!guard.ok) return { success: false, error: guard.error }
    }
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO character_state_snapshots
       (id, project_id, character_id, source_type, source_id, state_description,
        current_location, current_goal, emotional_state, inventory, key_relationships, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId, args.character_id as string,
      sourceType,
      sourceId,
      (args.state_description as string) ?? '',
      (args.current_location as string) ?? '',
      (args.current_goal as string) ?? '',
      (args.emotional_state as string) ?? '',
      JSON.stringify((args.inventory as unknown) ?? []),
      JSON.stringify((args.key_relationships as unknown) ?? {}),
      ts, ts
    )
    return { success: true, data: { id } }
  }
}

const update_relationship: ToolDefinition = {
  name: 'update_relationship',
  description: '更新角色关系。守卫：当关联章节时，仅允许在章节 commit 后调用。',
  parameters: {
    type: 'object',
    properties: {
      character_a_id: { type: 'string', description: '角色A ID' },
      character_b_id: { type: 'string', description: '角色B ID' },
      relationship_type: { type: 'string', description: '关系类型' },
      description: { type: 'string', description: '关系描述' },
      intensity: { type: 'number', description: '关系强度 0-10' },
      chapter_id: { type: 'string', description: '关联章节ID（可选，用于守卫检查）' }
    },
    required: ['character_a_id', 'character_b_id']
  },
  async handler(projectId, args) {
    const chapterId = args.chapter_id as string | undefined
    if (chapterId) {
      const guard = requireCommitted(projectId, chapterId)
      if (!guard.ok) return { success: false, error: guard.error }
    }
    const db = getDb()
    const ts = now()
    const existing = db.prepare(
      `SELECT id FROM character_relationships
       WHERE project_id = ? AND character_a_id = ? AND character_b_id = ?`
    ).get(projectId, args.character_a_id as string, args.character_b_id as string) as { id: string } | undefined

    if (existing) {
      db.prepare(
        `UPDATE character_relationships
         SET relationship_type = ?, description = ?, intensity = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        (args.relationship_type as string) ?? '',
        (args.description as string) ?? '',
        (args.intensity as number) ?? 0,
        ts,
        existing.id
      )
      return { success: true, data: { id: existing.id } }
    } else {
      const id = uuid()
      db.prepare(
        `INSERT INTO character_relationships
         (id, project_id, character_a_id, character_b_id, relationship_type, description, intensity, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, projectId, args.character_a_id as string, args.character_b_id as string,
        (args.relationship_type as string) ?? '',
        (args.description as string) ?? '',
        (args.intensity as number) ?? 0,
        ts
      )
      return { success: true, data: { id } }
    }
  }
}

const update_world_state: ToolDefinition = {
  name: 'update_world_state',
  description: '更新世界状态变化。守卫：仅允许在章节 commit 后调用。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '关联章节ID' },
      category: { type: 'string', description: '变化分类' },
      description: { type: 'string', description: '变化描述' },
      before_state: { type: 'string', description: '变化前状态' },
      after_state: { type: 'string', description: '变化后状态' }
    },
    required: ['description']
  },
  async handler(projectId, args) {
    const chapterId = args.chapter_id as string | undefined
    if (chapterId) {
      const guard = requireCommitted(projectId, chapterId)
      if (!guard.ok) return { success: false, error: guard.error }
    }
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO world_state_changes
       (id, project_id, chapter_id, category, description, before_state, after_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId,
      chapterId ?? null,
      (args.category as string) ?? '',
      args.description as string,
      (args.before_state as string) ?? '',
      (args.after_state as string) ?? '',
      ts
    )
    return { success: true, data: { id } }
  }
}

const update_foreshadowing: ToolDefinition = {
  name: 'update_foreshadowing',
  description: '更新伏笔状态（埋下/推进/回收）。守卫：当关联章节时，仅允许在章节 commit 后调用。未授权伏笔不得在草稿中出现。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '伏笔ID' },
      status: { type: 'string', description: '新状态：planted / progressing / payed_off / abandoned' },
      actual_plant_chapter_id: { type: 'string', description: '实际埋下章节ID' },
      actual_payoff_chapter_id: { type: 'string', description: '实际回收章节ID' },
      notes: { type: 'string', description: '备注' }
    },
    required: ['id', 'status']
  },
  async handler(projectId, args) {
    const plantChapterId = args.actual_plant_chapter_id as string | undefined
    const payoffChapterId = args.actual_payoff_chapter_id as string | undefined
    const checkChapterId = plantChapterId ?? payoffChapterId
    if (checkChapterId) {
      const guard = requireCommitted(projectId, checkChapterId)
      if (!guard.ok) return { success: false, error: guard.error }
    }
    const db = getDb()
    const ts = now()
    const fields: string[] = ['status = ?', 'updated_at = ?']
    const values: unknown[] = [args.status as string, ts]

    if ('actual_plant_chapter_id' in args) {
      fields.push('actual_plant_chapter_id = ?')
      values.push(args.actual_plant_chapter_id as string)
    }
    if ('actual_payoff_chapter_id' in args) {
      fields.push('actual_payoff_chapter_id = ?')
      values.push(args.actual_payoff_chapter_id as string)
    }
    if ('notes' in args) {
      fields.push('notes = ?')
      values.push(args.notes as string)
    }

    db.prepare(
      `UPDATE foreshadowing_ledger SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`
    ).run(...values, args.id as string, projectId)
    return { success: true, data: { id: args.id } }
  }
}

const create_chapter_summary: ToolDefinition = {
  name: 'create_chapter_summary',
  description: '产出章节摘要。守卫：仅允许在章节 commit 后调用。未通过门禁的草稿不得生成摘要。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '章节ID' },
      summary: { type: 'string', description: '摘要文本' },
      key_events: { type: 'string', description: '关键事件（JSON数组）' },
      word_count: { type: 'number', description: '本章字数' }
    },
    required: ['chapter_id', 'summary']
  },
  async handler(projectId, args) {
    const chapterId = args.chapter_id as string
    const guard = requireCommitted(projectId, chapterId)
    if (!guard.ok) return { success: false, error: guard.error }

    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO chapter_summaries
       (id, project_id, chapter_id, summary, key_events, next_chapter_hint, word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`
    ).run(
      id, projectId, chapterId,
      args.summary as string,
      JSON.stringify((args.key_events as unknown) ?? []),
      (args.word_count as number) ?? 0,
      ts, ts
    )
    return { success: true, data: { id } }
  }
}

const set_next_chapter_hint: ToolDefinition = {
  name: 'set_next_chapter_hint',
  description: '设定下一章衔接提示。守卫：仅允许在章节 commit 后调用。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '当前章节ID' },
      hint: { type: 'string', description: '下一章衔接提示' }
    },
    required: ['chapter_id', 'hint']
  },
  async handler(projectId, args) {
    const chapterId = args.chapter_id as string
    const guard = requireCommitted(projectId, chapterId)
    if (!guard.ok) return { success: false, error: guard.error }

    const db = getDb()
    const ts = now()
    db.prepare(
      `UPDATE chapter_summaries SET next_chapter_hint = ?, updated_at = ? WHERE chapter_id = ? AND project_id = ?`
    ).run(args.hint as string, ts, chapterId, projectId)
    return { success: true, data: { chapter_id: chapterId } }
  }
}

const consistency_check: ToolDefinition = {
  name: 'consistency_check',
  description: '执行一致性检查并报告。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '关联章节ID' },
      check_items: { type: 'string', description: '检查项（JSON数组）' },
      issues: { type: 'string', description: '发现的问题（JSON数组）' }
    },
    required: ['check_items']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO consistency_reports
       (id, project_id, chapter_id, check_items, issues, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id, projectId,
      (args.chapter_id as string) ?? null,
      JSON.stringify((args.check_items as unknown) ?? []),
      JSON.stringify((args.issues as unknown) ?? []),
      ts
    )
    return { success: true, data: { id } }
  }
}

const report_chapter_done: ToolDefinition = {
  name: 'report_chapter_done',
  description: '[已废弃] 报告章节完成。第四期起，Writer 不能直接报告章节完成，必须调用 request_draft_review 请求门禁检查，由 Orchestrator 在门禁通过后 commit。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '完成的章节ID' }
    }
  },
  async handler(_projectId, args) {
    return {
      success: false,
      error: '此工具已废弃。请调用 request_draft_review 请求门禁检查。Writer 不再拥有最终提交权，只有 Orchestrator 在 Draft Gate 通过后才能 commit。'
    }
  }
}

export const writerTools: ToolDefinition[] = [
  create_chapter_plan,
  get_chapter_contract,
  get_knowledge_contract,
  write_chapter_body,
  request_draft_review,
  update_character_state,
  update_relationship,
  update_world_state,
  update_foreshadowing,
  create_chapter_summary,
  set_next_chapter_hint,
  consistency_check,
  report_chapter_done
]
