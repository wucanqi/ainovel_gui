import type { ToolDefinition } from '@shared/types'
import { getDb } from '../../db'
import { uuid, now } from '../../lib/util'

const review_pass: ToolDefinition = {
  name: 'review_pass',
  description: '评审通过。',
  parameters: {
    type: 'object',
    properties: {
      review_type: { type: 'string', description: '评审类型：chapter / arc / volume' },
      target_id: { type: 'string', description: '评审对象ID' },
      opinion: { type: 'string', description: '评审意见' },
      dimension_scores: { type: 'string', description: '维度得分（JSON对象）' }
    },
    required: ['review_type', 'target_id']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO review_records
       (id, project_id, review_type, target_id, verdict, opinion, polish_points, rewrite_reason, replan_suggestion, dimension_scores, created_at)
       VALUES (?, ?, ?, ?, 'pass', ?, '[]', '', '', ?, ?)`
    ).run(
      id, projectId, args.review_type as string, args.target_id as string,
      (args.opinion as string) ?? '',
      JSON.stringify((args.dimension_scores as unknown) ?? {}),
      ts
    )
    return { success: true, data: { id } }
  }
}

const review_polish: ToolDefinition = {
  name: 'review_polish',
  description: '要求局部打磨（指定章节和打磨点）。',
  parameters: {
    type: 'object',
    properties: {
      review_type: { type: 'string', description: '评审类型：chapter / arc / volume' },
      target_id: { type: 'string', description: '评审对象ID' },
      opinion: { type: 'string', description: '评审意见' },
      polish_points: { type: 'string', description: '打磨点（JSON数组，每项{chapter_id, point}）' },
      dimension_scores: { type: 'string', description: '维度得分（JSON对象）' }
    },
    required: ['review_type', 'target_id', 'polish_points']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO review_records
       (id, project_id, review_type, target_id, verdict, opinion, polish_points, rewrite_reason, replan_suggestion, dimension_scores, created_at)
       VALUES (?, ?, ?, ?, 'polish', ?, ?, '', '', ?, ?)`
    ).run(
      id, projectId, args.review_type as string, args.target_id as string,
      (args.opinion as string) ?? '',
      JSON.stringify((args.polish_points as unknown) ?? []),
      JSON.stringify((args.dimension_scores as unknown) ?? {}),
      ts
    )
    return { success: true, data: { id } }
  }
}

const review_rewrite_chapter: ToolDefinition = {
  name: 'review_rewrite_chapter',
  description: '要求重写指定章节（附原因）。',
  parameters: {
    type: 'object',
    properties: {
      review_type: { type: 'string', description: '评审类型：chapter / arc / volume' },
      target_id: { type: 'string', description: '评审对象ID' },
      opinion: { type: 'string', description: '评审意见' },
      rewrite_reason: { type: 'string', description: '重写原因' },
      dimension_scores: { type: 'string', description: '维度得分（JSON对象）' }
    },
    required: ['review_type', 'target_id', 'rewrite_reason']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO review_records
       (id, project_id, review_type, target_id, verdict, opinion, polish_points, rewrite_reason, replan_suggestion, dimension_scores, created_at)
       VALUES (?, ?, ?, ?, 'rewrite_chapter', ?, '[]', ?, '', ?, ?)`
    ).run(
      id, projectId, args.review_type as string, args.target_id as string,
      (args.opinion as string) ?? '',
      args.rewrite_reason as string,
      JSON.stringify((args.dimension_scores as unknown) ?? {}),
      ts
    )
    return { success: true, data: { id } }
  }
}

const review_replan: ToolDefinition = {
  name: 'review_replan',
  description: '要求重新规划（附原因）。',
  parameters: {
    type: 'object',
    properties: {
      review_type: { type: 'string', description: '评审类型：chapter / arc / volume' },
      target_id: { type: 'string', description: '评审对象ID' },
      opinion: { type: 'string', description: '评审意见' },
      replan_suggestion: { type: 'string', description: '重新规划建议' },
      dimension_scores: { type: 'string', description: '维度得分（JSON对象）' }
    },
    required: ['review_type', 'target_id', 'replan_suggestion']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO review_records
       (id, project_id, review_type, target_id, verdict, opinion, polish_points, rewrite_reason, replan_suggestion, dimension_scores, created_at)
       VALUES (?, ?, ?, ?, 'replan', ?, '[]', '', ?, ?, ?)`
    ).run(
      id, projectId, args.review_type as string, args.target_id as string,
      (args.opinion as string) ?? '',
      args.replan_suggestion as string,
      JSON.stringify((args.dimension_scores as unknown) ?? {}),
      ts
    )
    return { success: true, data: { id } }
  }
}

const review_note: ToolDefinition = {
  name: 'review_note',
  description: '添加评审备注（不改变判定）。',
  parameters: {
    type: 'object',
    properties: {
      review_type: { type: 'string', description: '评审类型：chapter / arc / volume' },
      target_id: { type: 'string', description: '评审对象ID' },
      opinion: { type: 'string', description: '评审备注内容' },
      dimension_scores: { type: 'string', description: '维度得分（JSON对象）' }
    },
    required: ['review_type', 'target_id', 'opinion']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO review_records
       (id, project_id, review_type, target_id, verdict, opinion, polish_points, rewrite_reason, replan_suggestion, dimension_scores, created_at)
       VALUES (?, ?, ?, ?, 'note', ?, '[]', '', '', ?, ?)`
    ).run(
      id, projectId, args.review_type as string, args.target_id as string,
      args.opinion as string,
      JSON.stringify((args.dimension_scores as unknown) ?? {}),
      ts
    )
    return { success: true, data: { id } }
  }
}

const generate_arc_summary: ToolDefinition = {
  name: 'generate_arc_summary',
  description: '生成弧摘要。',
  parameters: {
    type: 'object',
    properties: {
      arc_id: { type: 'string', description: '弧ID' },
      summary: { type: 'string', description: '弧摘要文本' },
      character_progression: { type: 'string', description: '角色进展（JSON对象）' },
      foreshadowing_status: { type: 'string', description: '伏笔状态（JSON数组）' },
      world_state_summary: { type: 'string', description: '世界状态摘要' }
    },
    required: ['arc_id', 'summary']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO arc_summaries
       (id, project_id, arc_id, summary, character_progression, foreshadowing_status, world_state_summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId, args.arc_id as string,
      args.summary as string,
      JSON.stringify((args.character_progression as unknown) ?? {}),
      JSON.stringify((args.foreshadowing_status as unknown) ?? []),
      (args.world_state_summary as string) ?? '',
      ts, ts
    )
    return { success: true, data: { id } }
  }
}

const generate_character_snapshot: ToolDefinition = {
  name: 'generate_character_snapshot',
  description: '生成角色快照。',
  parameters: {
    type: 'object',
    properties: {
      character_id: { type: 'string', description: '角色ID' },
      source_type: { type: 'string', description: '来源类型：arc / volume' },
      source_id: { type: 'string', description: '来源ID（弧ID或卷序号）' },
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
      args.source_type as string,
      args.source_id as string,
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

const generate_foreshadowing_carryover: ToolDefinition = {
  name: 'generate_foreshadowing_carryover',
  description: '生成伏笔结转（哪些带到下一弧）。',
  parameters: {
    type: 'object',
    properties: {
      ids: { type: 'string', description: '结转伏笔ID列表（JSON数组）' },
      new_status: { type: 'string', description: '新状态' },
      notes: { type: 'string', description: '结转备注' }
    },
    required: ['ids']
  },
  async handler(projectId, args) {
    const db = getDb()
    const ts = now()
    const ids = args.ids as string[]
    const status = (args.new_status as string) ?? 'progressing'
    const notes = (args.notes as string) ?? ''
    for (const fid of ids) {
      db.prepare(
        `UPDATE foreshadowing_ledger SET status = ?, notes = ?, updated_at = ? WHERE id = ? AND project_id = ?`
      ).run(status, notes, ts, fid, projectId)
    }
    return { success: true, data: { updated: ids.length } }
  }
}

const generate_volume_summary: ToolDefinition = {
  name: 'generate_volume_summary',
  description: '生成卷摘要。',
  parameters: {
    type: 'object',
    properties: {
      volume_number: { type: 'number', description: '卷序号' },
      summary: { type: 'string', description: '卷摘要' },
      compass_deviation: { type: 'string', description: '指南针偏移记录' },
      quality_assessment: { type: 'string', description: '质量评估' }
    },
    required: ['volume_number', 'summary']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO volume_summaries
       (id, project_id, volume_number, summary, compass_deviation, quality_assessment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId, args.volume_number as number,
      args.summary as string,
      (args.compass_deviation as string) ?? '',
      (args.quality_assessment as string) ?? '',
      ts, ts
    )
    return { success: true, data: { id } }
  }
}

const update_story_compass: ToolDefinition = {
  name: 'update_story_compass',
  description: '更新故事指南针（卷级评审后，版本号+1）。',
  parameters: {
    type: 'object',
    properties: {
      ending_direction: { type: 'string', description: '终局方向' },
      core_conflict: { type: 'string', description: '核心冲突' },
      theme: { type: 'string', description: '故事主题' },
      one_line_pitch: { type: 'string', description: '一句话梗概' },
      genre: { type: 'string', description: '主类型' },
      sub_genre: { type: 'string', description: '子类型' },
      selling_point: { type: 'string', description: '核心卖点' },
      target_audience: { type: 'string', description: '目标读者' },
      emotional_tone: { type: 'string', description: '情感基调' },
      narrative_pov: { type: 'string', description: '叙事视角' }
    }
  },
  async handler(projectId, args) {
    const db = getDb()
    const ts = now()
    const existing = db.prepare(
      'SELECT id, version FROM story_compass WHERE project_id = ?'
    ).get(projectId) as { id: string; version: number } | undefined

    if (!existing) {
      return { success: false, error: 'Story compass not found. Run set_story_compass first.' }
    }

    const newVersion = existing.version + 1
    const fields: string[] = []
    const values: unknown[] = []
    const allowed = [
      'ending_direction', 'core_conflict', 'theme', 'one_line_pitch',
      'genre', 'sub_genre', 'selling_point', 'target_audience',
      'emotional_tone', 'narrative_pov'
    ]
    for (const key of allowed) {
      if (key in args) {
        fields.push(`${key} = ?`)
        values.push(args[key])
      }
    }

    if (fields.length === 0) {
      return { success: false, error: 'No fields to update' }
    }

    db.prepare(
      `UPDATE story_compass SET ${fields.join(', ')}, version = ?, updated_at = ? WHERE id = ?`
    ).run(...values, newVersion, ts, existing.id)

    return { success: true, data: { id: existing.id, version: newVersion } }
  }
}

export const editorTools: ToolDefinition[] = [
  review_pass,
  review_polish,
  review_rewrite_chapter,
  review_replan,
  review_note,
  generate_arc_summary,
  generate_character_snapshot,
  generate_foreshadowing_carryover,
  generate_volume_summary,
  update_story_compass
]