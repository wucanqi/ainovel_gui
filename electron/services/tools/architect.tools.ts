import type { ToolDefinition } from '@shared/types'
import { getDb } from '../../db'
import { uuid, now } from '../../lib/util'
import { generateChapterContract, generateKnowledgeContract } from '../contract.service'

const set_story_compass: ToolDefinition = {
  name: 'set_story_compass',
  description: '设定或更新故事指南针。可以部分更新（只传要改的字段）。',
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

    if (existing) {
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
      if (fields.length > 0) {
        db.prepare(
          `UPDATE story_compass SET ${fields.join(', ')}, version = ?, updated_at = ? WHERE id = ?`
        ).run(...values, newVersion, ts, existing.id)
      }
      return { success: true, data: { id: existing.id, version: newVersion } }
    } else {
      const id = uuid()
      db.prepare(
        `INSERT INTO story_compass
         (id, project_id, ending_direction, core_conflict, theme, one_line_pitch,
          genre, sub_genre, selling_point, target_audience, emotional_tone,
          narrative_pov, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        id, projectId,
        (args.ending_direction as string) ?? '',
        (args.core_conflict as string) ?? '',
        (args.theme as string) ?? '',
        (args.one_line_pitch as string) ?? '',
        (args.genre as string) ?? '',
        (args.sub_genre as string) ?? '',
        (args.selling_point as string) ?? '',
        (args.target_audience as string) ?? '',
        (args.emotional_tone as string) ?? '',
        (args.narrative_pov as string) ?? '',
        ts, ts
      )
      return { success: true, data: { id, version: 1 } }
    }
  }
}

const add_title_candidate: ToolDefinition = {
  name: 'add_title_candidate',
  description: '添加一个书名候选。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '候选书名' },
      reasoning: { type: 'string', description: '推荐理由' }
    },
    required: ['title']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO title_candidates (id, project_id, title, reasoning, selected, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).run(id, projectId, args.title as string, (args.reasoning as string) ?? '', ts)
    return { success: true, data: { id } }
  }
}

const set_genre_positioning: ToolDefinition = {
  name: 'set_genre_positioning',
  description: '设定故事的类型定位。',
  parameters: {
    type: 'object',
    properties: {
      genre: { type: 'string', description: '主类型' },
      sub_genre: { type: 'string', description: '子类型' }
    },
    required: ['genre']
  },
  async handler(projectId, args) {
    const db = getDb()
    const ts = now()
    const existing = db.prepare(
      'SELECT id, version FROM story_compass WHERE project_id = ?'
    ).get(projectId) as { id: string; version: number } | undefined

    if (existing) {
      const newVersion = existing.version + 1
      db.prepare(
        'UPDATE story_compass SET genre = ?, sub_genre = ?, version = ?, updated_at = ? WHERE id = ?'
      ).run(args.genre as string, (args.sub_genre as string) ?? '', newVersion, ts, existing.id)
      return { success: true, data: { id: existing.id, version: newVersion } }
    } else {
      const id = uuid()
      db.prepare(
        `INSERT INTO story_compass
         (id, project_id, genre, sub_genre, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(id, projectId, args.genre as string, (args.sub_genre as string) ?? '', ts, ts)
      return { success: true, data: { id, version: 1 } }
    }
  }
}

const set_core_selling_point: ToolDefinition = {
  name: 'set_core_selling_point',
  description: '设定故事的核心卖点。',
  parameters: {
    type: 'object',
    properties: {
      selling_point: { type: 'string', description: '核心卖点描述' }
    },
    required: ['selling_point']
  },
  async handler(projectId, args) {
    const db = getDb()
    const ts = now()
    const existing = db.prepare(
      'SELECT id, version FROM story_compass WHERE project_id = ?'
    ).get(projectId) as { id: string; version: number } | undefined

    if (existing) {
      const newVersion = existing.version + 1
      db.prepare(
        'UPDATE story_compass SET selling_point = ?, version = ?, updated_at = ? WHERE id = ?'
      ).run(args.selling_point as string, newVersion, ts, existing.id)
      return { success: true, data: { id: existing.id, version: newVersion } }
    } else {
      const id = uuid()
      db.prepare(
        `INSERT INTO story_compass (id, project_id, selling_point, version, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`
      ).run(id, projectId, args.selling_point as string, ts, ts)
      return { success: true, data: { id, version: 1 } }
    }
  }
}

const create_character_arc: ToolDefinition = {
  name: 'create_character_arc',
  description: '创建或更新人物弧。可通过 character_id 或 character_name 指定角色。优先使用 character_id，若 character_name 匹配到唯一角色则自动使用该角色。',
  parameters: {
    type: 'object',
    properties: {
      character_id: { type: 'string', description: '人物ID（优先使用）' },
      character_name: { type: 'string', description: '人物名称（character_id 无效时按名称查找）' },
      arc_type: { type: 'string', description: '弧类型：positive_change / negative_change / flat / fall_redemption' },
      starting_state: { type: 'string', description: '起点状态' },
      ending_state: { type: 'string', description: '终点状态' },
      core_lie: { type: 'string', description: '核心谎言/信念' },
      core_truth: { type: 'string', description: '核心真相' },
      transformation_nodes: { type: 'string', description: '成长轨迹节点（JSON数组）' },
      span: { type: 'string', description: '弧跨度：project / volume / multi_volume' },
      volume_id: { type: 'string', description: '关联卷ID' },
      arc_id: { type: 'string', description: '关联弧ID' },
      is_protagonist: { type: 'number', description: '是否主角 0/1' }
    },
    required: []
  },
  async handler(projectId, args) {
    const db = getDb()
    let charId = (args.character_id as string) ?? ''
    const charName = (args.character_name as string) ?? ''

    // Resolve character by ID or name
    if (!charId && charName) {
      const match = db.prepare(
        'SELECT id FROM characters WHERE project_id = ? AND name = ?'
      ).get(projectId, charName) as { id: string } | undefined
      if (match) charId = match.id
    }
    // If character_id is provided but doesn't exist, try name lookup
    if (charId && charName) {
      const exists = db.prepare('SELECT id FROM characters WHERE id = ?').get(charId)
      if (!exists) {
        const match = db.prepare(
          'SELECT id FROM characters WHERE project_id = ? AND name = ?'
        ).get(projectId, charName) as { id: string } | undefined
        if (match) charId = match.id
      }
    }
    if (!charId) {
      return { success: false, error: '未指定 character_id 或 character_name，且无法匹配已有角色。请先使用 create_character 创建角色，或提供有效的 character_name。' }
    }

    const ts = now()
    const existing = db.prepare(
      'SELECT id, version FROM character_arcs WHERE project_id = ? AND character_id = ?'
    ).get(projectId, charId) as { id: string; version: number } | undefined

    if (existing) {
      const newVersion = existing.version + 1
      const fields: string[] = []
      const values: unknown[] = []
      const allowed = [
        'arc_type', 'starting_state', 'ending_state', 'core_lie', 'core_truth',
        'transformation_nodes', 'span', 'volume_id', 'arc_id', 'is_protagonist'
      ]
      for (const key of allowed) {
        if (key in args) {
          fields.push(`${key} = ?`)
          values.push(args[key])
        }
      }
      if (fields.length > 0) {
        db.prepare(
          `UPDATE character_arcs SET ${fields.join(', ')}, version = ?, updated_at = ? WHERE id = ?`
        ).run(...values, newVersion, ts, existing.id)
      }
      return { success: true, data: { id: existing.id, version: newVersion } }
    } else {
      const id = uuid()
      db.prepare(
        `INSERT INTO character_arcs
         (id, project_id, character_id, arc_type, starting_state, ending_state,
          core_lie, core_truth, transformation_nodes, span, volume_id, arc_id,
          is_protagonist, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        id, projectId, charId,
        (args.arc_type as string) ?? 'positive_change',
        (args.starting_state as string) ?? '',
        (args.ending_state as string) ?? '',
        (args.core_lie as string) ?? '',
        (args.core_truth as string) ?? '',
        JSON.stringify((args.transformation_nodes as unknown) ?? []),
        (args.span as string) ?? 'project',
        (args.volume_id as string) ?? null,
        (args.arc_id as string) ?? null,
        (args.is_protagonist as number) ?? 0,
        ts, ts
      )
      return { success: true, data: { id, version: 1 } }
    }
  }
}

const create_world_rule: ToolDefinition = {
  name: 'create_world_rule',
  description: '创建一条世界规则。',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: '规则分类' },
      name: { type: 'string', description: '规则名称' },
      description: { type: 'string', description: '规则描述' },
      implications: { type: 'string', description: '规则影响/推论' },
      related_character_ids: { type: 'string', description: '关联人物ID列表（JSON数组）' }
    },
    required: ['name']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO world_rules
       (id, project_id, category, name, description, implications, related_character_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId,
      (args.category as string) ?? 'general',
      args.name as string,
      (args.description as string) ?? '',
      (args.implications as string) ?? '',
      JSON.stringify((args.related_character_ids as unknown) ?? []),
      ts, ts
    )
    return { success: true, data: { id } }
  }
}

const create_volume_arc: ToolDefinition = {
  name: 'create_volume_arc',
  description: '创建卷弧骨架。',
  parameters: {
    type: 'object',
    properties: {
      volume_number: { type: 'number', description: '卷序号' },
      volume_title: { type: 'string', description: '卷标题' },
      arc_number: { type: 'number', description: '弧序号' },
      arc_title: { type: 'string', description: '弧标题' },
      arc_goal: { type: 'string', description: '弧目标' },
      arc_type: { type: 'string', description: '弧类型：setup / rising / climax / resolution / transition' },
      planned_chapters: { type: 'number', description: '计划章节数' },
      sort_order: { type: 'number', description: '排序序号' }
    },
    required: ['volume_number', 'arc_number', 'arc_title']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO volume_arcs
       (id, project_id, volume_number, volume_title, arc_number, arc_title,
        arc_goal, arc_type, planned_chapters, actual_chapters, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'planned', ?, ?, ?)`
    ).run(
      id, projectId,
      args.volume_number as number,
      (args.volume_title as string) ?? '',
      args.arc_number as number,
      args.arc_title as string,
      (args.arc_goal as string) ?? '',
      (args.arc_type as string) ?? 'rising',
      (args.planned_chapters as number) ?? 0,
      (args.sort_order as number) ?? 0,
      ts, ts
    )
    return { success: true, data: { id } }
  }
}

const create_arc_outline: ToolDefinition = {
  name: 'create_arc_outline',
  description: '创建弧大纲，包含弧的章节计划。可通过 arc_id 或 arc 标题/编号指定弧。',
  parameters: {
    type: 'object',
    properties: {
      arc_id: { type: 'string', description: '弧ID（优先使用）' },
      arc_title: { type: 'string', description: '弧标题（arc_id 无效时按标题查找）' },
      volume_number: { type: 'number', description: '卷编号（配合 arc_number 查找弧）' },
      arc_number: { type: 'number', description: '弧编号（配合 volume_number 查找弧）' },
      arc_opening: { type: 'string', description: '弧开端' },
      arc_midpoint: { type: 'string', description: '弧转折点' },
      arc_climax: { type: 'string', description: '弧高潮' },
      arc_resolution: { type: 'string', description: '弧结局' },
      planned_foreshadowings: { type: 'string', description: '伏笔清单（JSON数组）' },
      character_arc_plan: { type: 'string', description: '人物弧推进计划（JSON对象）' },
      chapter_plans: { type: 'string', description: '章节计划列表（JSON数组）' }
    },
    required: []
  },
  async handler(projectId, args) {
    const db = getDb()
    let arcId = (args.arc_id as string) ?? ''
    const arcTitle = (args.arc_title as string) ?? ''
    const volNum = args.volume_number as number | undefined
    const arcNum = args.arc_number as number | undefined

    if (!arcId && arcTitle) {
      const m = db.prepare('SELECT id FROM volume_arcs WHERE project_id = ? AND arc_title = ? LIMIT 1').get(projectId, arcTitle) as { id: string } | undefined
      if (m) arcId = m.id
    }
    if (!arcId && volNum && arcNum) {
      const m = db.prepare('SELECT id FROM volume_arcs WHERE project_id = ? AND volume_number = ? AND arc_number = ? LIMIT 1').get(projectId, volNum, arcNum) as { id: string } | undefined
      if (m) arcId = m.id
    }
    if (arcId) {
      const exists = db.prepare('SELECT id FROM volume_arcs WHERE id = ?').get(arcId)
      if (!exists && arcTitle) {
        const m = db.prepare('SELECT id FROM volume_arcs WHERE project_id = ? AND arc_title = ? LIMIT 1').get(projectId, arcTitle) as { id: string } | undefined
        if (m) arcId = m.id
      }
    }
    if (!arcId) {
      return { success: false, error: '未指定有效的 arc_id、arc_title 或 volume_number+arc_number。请先使用 create_volume_arc 创建弧，或提供已存在弧的标识信息。' }
    }

    const ts = now()
    const outlineId = uuid()
    db.prepare(
      `INSERT INTO arc_outlines
       (id, project_id, arc_id, arc_opening, arc_midpoint, arc_climax, arc_resolution,
        planned_foreshadowings, character_arc_plan, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
       outlineId, projectId, arcId,
      (args.arc_opening as string) ?? '',
      (args.arc_midpoint as string) ?? '',
      (args.arc_climax as string) ?? '',
      (args.arc_resolution as string) ?? '',
      JSON.stringify((args.planned_foreshadowings as unknown) ?? []),
      JSON.stringify((args.character_arc_plan as unknown) ?? {}),
      ts, ts
    )

    const chapterPlans = args.chapter_plans as Array<Record<string, unknown>> | undefined
    const inserted: string[] = []
    if (chapterPlans && Array.isArray(chapterPlans)) {
      for (const plan of chapterPlans) {
        const cpId = uuid()
        db.prepare(
          `INSERT INTO arc_chapter_plans
           (id, arc_id, chapter_number, chapter_title, chapter_goal, scenes,
            foreshadowing_plan, pov_character_id, estimated_words, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`
        ).run(
           cpId, arcId,
          (plan.chapter_number as number) ?? 0,
          (plan.chapter_title as string) ?? '',
          (plan.chapter_goal as string) ?? '',
          JSON.stringify((plan.scenes as unknown) ?? []),
          JSON.stringify((plan.foreshadowing_plan as unknown) ?? []),
          (plan.pov_character_id as string) ?? null,
          (plan.estimated_words as number) ?? 0,
          ts, ts
        )
        inserted.push(cpId)
      }
    }

    // Update arc status to expanded
    db.prepare(
      "UPDATE volume_arcs SET status = 'expanded', updated_at = ? WHERE id = ?"
    ).run(ts, arcId)

    return { success: true, data: { outline_id: outlineId, chapter_plan_ids: inserted } }
  }
}

const create_arc_chapter_plans: ToolDefinition = {
  name: 'create_arc_chapter_plans',
  description: '批量创建弧章节计划。可通过 arc_id 或 arc 标题/编号指定弧。',
  parameters: {
    type: 'object',
    properties: {
      arc_id: { type: 'string', description: '弧ID（优先使用）' },
      arc_title: { type: 'string', description: '弧标题（arc_id 无效时按标题查找）' },
      volume_number: { type: 'number', description: '卷编号（配合 arc_number 查找）' },
      arc_number: { type: 'number', description: '弧编号（配合 volume_number 查找）' },
      plans: { type: 'string', description: '章节计划数组（JSON），每项包含chapter_number/chapter_title/chapter_goal/scenes/foreshadowing_plan/pov_character_id/estimated_words' }
    },
    required: ['plans']
  },
  async handler(projectId, args) {
    const db = getDb()
    let arcId = (args.arc_id as string) ?? ''
    const arcTitle = (args.arc_title as string) ?? ''
    const volNum = args.volume_number as number | undefined
    const arcNum = args.arc_number as number | undefined

    if (!arcId && arcTitle) {
      const m = db.prepare('SELECT id FROM volume_arcs WHERE project_id = ? AND arc_title = ? LIMIT 1').get(projectId, arcTitle) as { id: string } | undefined
      if (m) arcId = m.id
    }
    if (!arcId && volNum && arcNum) {
      const m = db.prepare('SELECT id FROM volume_arcs WHERE project_id = ? AND volume_number = ? AND arc_number = ? LIMIT 1').get(projectId, volNum, arcNum) as { id: string } | undefined
      if (m) arcId = m.id
    }
    if (!arcId) {
      return { success: false, error: '未指定有效的 arc_id、arc_title 或 volume_number+arc_number。' }
    }
    const ts = now()
    let plans: unknown = args.plans
    // Auto-parse if LLM passed a JSON string instead of an array
    if (typeof plans === 'string') {
      try { plans = JSON.parse(plans) } catch { /* keep as string, will fail check below */ }
    }
    if (!Array.isArray(plans)) {
      return { success: false, error: 'plans must be an array' }
    }
    const inserted: string[] = []
    for (const plan of plans) {
      const cpId = uuid()
      db.prepare(
        `INSERT INTO arc_chapter_plans
         (id, arc_id, chapter_number, chapter_title, chapter_goal, scenes,
          foreshadowing_plan, pov_character_id, estimated_words, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)`
      ).run(
           cpId, arcId,
        (plan.chapter_number as number) ?? 0,
        (plan.chapter_title as string) ?? '',
        (plan.chapter_goal as string) ?? '',
        JSON.stringify((plan.scenes as unknown) ?? []),
        JSON.stringify((plan.foreshadowing_plan as unknown) ?? []),
        (plan.pov_character_id as string) ?? null,
        (plan.estimated_words as number) ?? 0,
        ts, ts
      )
      inserted.push(cpId)
    }
    // Update arc status
    if (inserted.length > 0) {
      db.prepare(
        "UPDATE volume_arcs SET status = CASE WHEN status = 'planned' THEN 'expanded' ELSE status END, updated_at = ? WHERE id = ?"
      ).run(ts, arcId)
    }
    return { success: true, data: { ids: inserted } }
  }
}

const create_foreshadowing: ToolDefinition = {
  name: 'create_foreshadowing',
  description: '注册一个伏笔。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '伏笔名称' },
      content: { type: 'string', description: '伏笔内容描述' },
      type: { type: 'string', description: '伏笔类型：mystery / character / plot / world / relationship' },
      importance: { type: 'string', description: '重要性：major / minor / easter_egg' },
      planned_plant_arc_id: { type: 'string', description: '计划埋下弧ID' },
      planned_plant_chapter: { type: 'number', description: '计划埋下章序号' },
      planned_progress_points: { type: 'string', description: '计划推进点（JSON数组）' },
      planned_payoff_arc_id: { type: 'string', description: '计划回收弧ID' },
      planned_payoff_chapter: { type: 'number', description: '计划回收章序号' },
      notes: { type: 'string', description: '备注' }
    },
    required: ['name']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO foreshadowing_ledger
       (id, project_id, name, content, type, importance,
        planned_plant_arc_id, planned_plant_chapter, planned_progress_points,
        planned_payoff_arc_id, planned_payoff_chapter, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unplanned', ?, ?, ?)`
    ).run(
      id, projectId, args.name as string,
      (args.content as string) ?? '',
      (args.type as string) ?? 'plot',
      (args.importance as string) ?? 'minor',
      (args.planned_plant_arc_id as string) ?? null,
      (args.planned_plant_chapter as number) ?? null,
      JSON.stringify((args.planned_progress_points as unknown) ?? []),
      (args.planned_payoff_arc_id as string) ?? null,
      (args.planned_payoff_chapter as number) ?? null,
      (args.notes as string) ?? '',
      ts, ts
    )
    return { success: true, data: { id } }
  }
}

const create_character: ToolDefinition = {
  name: 'create_character',
  description: '创建一个人物角色。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '人物名称' },
      aliases: { type: 'string', description: '别名列表（JSON数组）' },
      role: { type: 'string', description: '角色定位' },
      appearance: { type: 'string', description: '外貌描述' },
      personality: { type: 'string', description: '性格描述' },
      background: { type: 'string', description: '背景故事' },
      relations: { type: 'string', description: '关系列表（JSON数组）' },
      notes: { type: 'string', description: '备注' }
    },
    required: ['name']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    const ts = now()
    db.prepare(
      `INSERT INTO characters
       (id, project_id, name, aliases, role, appearance, personality, background, relations, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId, args.name as string,
      JSON.stringify((args.aliases as unknown) ?? []),
      (args.role as string) ?? '',
      (args.appearance as string) ?? '',
      (args.personality as string) ?? '',
      (args.background as string) ?? '',
      JSON.stringify((args.relations as unknown) ?? []),
      (args.notes as string) ?? '',
      ts
    )
    return { success: true, data: { id } }
  }
}

const create_worldbuilding: ToolDefinition = {
  name: 'create_worldbuilding',
  description: '创建一条世界观词条。',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: '分类' },
      key: { type: 'string', description: '词条键名' },
      value: { type: 'string', description: '词条内容' }
    },
    required: ['key', 'value']
  },
  async handler(projectId, args) {
    const db = getDb()
    const id = uuid()
    db.prepare(
      `INSERT INTO worldbuilding (id, project_id, category, key, value)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, projectId, (args.category as string) ?? '其他', args.key as string, args.value as string)
    return { success: true, data: { id } }
  }
}

const report_architecture_done: ToolDefinition = {
  name: 'report_architecture_done',
  description: '报告架构设计完成，提交给编排器处理。',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '架构设计总结' }
    }
  },
  async handler(_projectId, args) {
    return { success: true, data: { summary: args.summary as string ?? '' } }
  }
}

const generate_chapter_contract: ToolDefinition = {
  name: 'generate_chapter_contract',
  description: '为指定章节生成章节契约。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '章节ID' },
      arc_id: { type: 'string', description: '所属弧ID' }
    },
    required: ['chapter_id']
  },
  async handler(projectId, args) {
    const contract = await generateChapterContract(
      projectId,
      args.chapter_id as string,
      (args.arc_id as string) ?? null
    )
    return { success: true, data: contract }
  }
}

const generate_knowledge_contract: ToolDefinition = {
  name: 'generate_knowledge_contract',
  description: '为指定章节生成知识契约。',
  parameters: {
    type: 'object',
    properties: {
      chapter_id: { type: 'string', description: '章节ID' },
      pov_character_id: { type: 'string', description: '视角人物ID' }
    },
    required: ['chapter_id']
  },
  async handler(projectId, args) {
    const contract = await generateKnowledgeContract(
      projectId,
      args.chapter_id as string,
      (args.pov_character_id as string) ?? null
    )
    return { success: true, data: contract }
  }
}

export const architectTools: ToolDefinition[] = [
  set_story_compass,
  add_title_candidate,
  set_genre_positioning,
  set_core_selling_point,
  create_character_arc,
  create_world_rule,
  create_volume_arc,
  create_arc_outline,
  create_arc_chapter_plans,
  create_foreshadowing,
  create_character,
  create_worldbuilding,
  generate_chapter_contract,
  generate_knowledge_contract,
  report_architecture_done
]
