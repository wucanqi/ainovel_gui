import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { chatLLM } from './ai.service'
import * as chapterService from './chapter.service'
import type { ChapterContract, KnowledgeContract } from '@shared/types'

type ChapterContractRow = {
  id: string
  project_id: string
  chapter_id: string
  arc_id: string | null
  required_beats: string
  forbidden_moves: string
  continuity_checks: string
  emotion_target: string
  payoff_points: string
  hook_goal: string
  allowed_foreshadow_ids: string
  hard_constraints: string
  status: string
  created_at: number
  updated_at: number
}

type KnowledgeContractRow = {
  id: string
  project_id: string
  chapter_id: string
  pov_character_id: string | null
  known_facts: string
  unknown_facts: string
  author_only_facts: string
  reader_visible_facts: string
  allowed_reveals: string
  forbidden_inferences: string
  allowed_foreshadow_ids: string
  priority: string
  created_at: number
  updated_at: number
}

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function mapChapterContractRow(r: ChapterContractRow): ChapterContract {
  return {
    id: r.id,
    project_id: r.project_id,
    chapter_id: r.chapter_id,
    arc_id: r.arc_id,
    required_beats: safeParseArray(r.required_beats),
    forbidden_moves: safeParseArray(r.forbidden_moves),
    continuity_checks: safeParseArray(r.continuity_checks),
    emotion_target: r.emotion_target,
    payoff_points: safeParseArray(r.payoff_points),
    hook_goal: r.hook_goal,
    allowed_foreshadow_ids: safeParseArray(r.allowed_foreshadow_ids),
    hard_constraints: safeParseArray(r.hard_constraints),
    status: r.status as ChapterContract['status'],
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

function mapKnowledgeContractRow(r: KnowledgeContractRow): KnowledgeContract {
  return {
    id: r.id,
    project_id: r.project_id,
    chapter_id: r.chapter_id,
    pov_character_id: r.pov_character_id,
    known_facts: safeParseArray(r.known_facts),
    unknown_facts: safeParseArray(r.unknown_facts),
    author_only_facts: safeParseArray(r.author_only_facts),
    reader_visible_facts: safeParseArray(r.reader_visible_facts),
    allowed_reveals: safeParseArray(r.allowed_reveals),
    forbidden_inferences: safeParseArray(r.forbidden_inferences),
    allowed_foreshadow_ids: safeParseArray(r.allowed_foreshadow_ids),
    priority: r.priority as KnowledgeContract['priority'],
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const match = trimmed.match(/\{[\s\S]*?\}(?=\s*$)/) || trimmed.match(/\{(?:[^{}]|\{[^{}]*\})*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : []
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function ensureChapterEntity(projectId: string, chapterId: string): ReturnType<typeof chapterService.get> {
  const existing = chapterService.get(chapterId)
  if (existing) return existing

  const db = getDb()
  const plan = db.prepare(
    `SELECT acp.id, acp.chapter_number, acp.chapter_title, va.id AS arc_id, va.volume_number, va.volume_title
     FROM arc_chapter_plans acp
     JOIN volume_arcs va ON acp.arc_id = va.id
     WHERE va.project_id = ? AND acp.id = ?
     LIMIT 1`
  ).get(projectId, chapterId) as {
    id: string
    chapter_number: number
    chapter_title: string
    arc_id: string
    volume_number: number
    volume_title: string
  } | undefined

  if (!plan) return null

  const ts = now()
  const volumeTitle = plan.volume_title || `第${plan.volume_number}卷`
  let volumeId = db.prepare(
    'SELECT id FROM volumes WHERE project_id = ? AND title = ? LIMIT 1'
  ).get(projectId, volumeTitle) as { id: string } | undefined

  if (!volumeId) {
    const newVolumeId = uuid()
    db.prepare(
      'INSERT INTO volumes (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)'
    ).run(newVolumeId, projectId, volumeTitle, plan.volume_number)
    volumeId = { id: newVolumeId }
  }

  db.prepare(
    `INSERT INTO chapters
     (id, volume_id, project_id, title, content, plain_text, sort_order, word_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '', ?, 0, 'draft', ?, ?)`
  ).run(
    chapterId,
    volumeId.id,
    projectId,
    plan.chapter_title || `第${plan.chapter_number}章`,
    plan.chapter_number,
    ts,
    ts
  )

  console.log('[Contract] auto-created chapter entity', {
    projectId: projectId.slice(0, 8),
    chapterId: chapterId.slice(0, 8),
    chapterNumber: plan.chapter_number,
    arcId: plan.arc_id.slice(0, 8)
  })

  return chapterService.get(chapterId)
}

async function chatLLMWithRetry(
  messages: Parameters<typeof chatLLM>[0],
  options: Parameters<typeof chatLLM>[1],
  maxRetries = 2
): Promise<string> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await chatLLM(messages, options)
      if (extractJson(raw)) return raw
      if (attempt < maxRetries) {
        messages.push({ role: 'user', content: '上一轮返回的不是有效 JSON，请只返回 JSON 对象，不要其他文字。' })
      }
      lastError = new Error('LLM 返回的 JSON 无效')
    } catch (e) {
      lastError = e as Error
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw lastError ?? new Error('contract generation failed after retries')
}

export function getChapterContract(
  projectId: string,
  chapterId: string
): ChapterContract | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM chapter_contracts WHERE project_id = ? AND chapter_id = ?'
    )
    .get(projectId, chapterId) as ChapterContractRow | undefined
  return row ? mapChapterContractRow(row) : null
}

export function createChapterContract(
  projectId: string,
  chapterId: string,
  arcId: string | null,
  input: Partial<ChapterContract>
): ChapterContract {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO chapter_contracts
       (id, project_id, chapter_id, arc_id, required_beats, forbidden_moves, continuity_checks,
        emotion_target, payoff_points, hook_goal, allowed_foreshadow_ids, hard_constraints,
        status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      projectId,
      chapterId,
      arcId,
      JSON.stringify(input.required_beats ?? []),
      JSON.stringify(input.forbidden_moves ?? []),
      JSON.stringify(input.continuity_checks ?? []),
      input.emotion_target ?? '',
      JSON.stringify(input.payoff_points ?? []),
      input.hook_goal ?? '',
      JSON.stringify(input.allowed_foreshadow_ids ?? []),
      JSON.stringify(input.hard_constraints ?? []),
      input.status ?? 'active',
      ts,
      ts
    )
  return mapChapterContractRow(
    getDb()
      .prepare('SELECT * FROM chapter_contracts WHERE id = ?')
      .get(id) as ChapterContractRow
  )
}

export function updateChapterContract(
  id: string,
  patch: Partial<ChapterContract>
): void {
  const db = getDb()
  const cur = db
    .prepare('SELECT * FROM chapter_contracts WHERE id = ?')
    .get(id) as ChapterContractRow | undefined
  if (!cur) throw new Error('ChapterContract not found')
  db.prepare(
    `UPDATE chapter_contracts
     SET arc_id = ?, required_beats = ?, forbidden_moves = ?, continuity_checks = ?,
         emotion_target = ?, payoff_points = ?, hook_goal = ?, allowed_foreshadow_ids = ?,
         hard_constraints = ?, status = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.arc_id !== undefined ? patch.arc_id : cur.arc_id,
    JSON.stringify(patch.required_beats ?? safeParseArray(cur.required_beats)),
    JSON.stringify(patch.forbidden_moves ?? safeParseArray(cur.forbidden_moves)),
    JSON.stringify(patch.continuity_checks ?? safeParseArray(cur.continuity_checks)),
    patch.emotion_target ?? cur.emotion_target,
    JSON.stringify(patch.payoff_points ?? safeParseArray(cur.payoff_points)),
    patch.hook_goal ?? cur.hook_goal,
    JSON.stringify(patch.allowed_foreshadow_ids ?? safeParseArray(cur.allowed_foreshadow_ids)),
    JSON.stringify(patch.hard_constraints ?? safeParseArray(cur.hard_constraints)),
    patch.status ?? cur.status,
    now(),
    id
  )
}

export function listContractsByArc(
  projectId: string,
  arcId: string
): ChapterContract[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM chapter_contracts WHERE project_id = ? AND arc_id = ? ORDER BY created_at ASC'
    )
    .all(projectId, arcId) as ChapterContractRow[]
  return rows.map(mapChapterContractRow)
}

export function getKnowledgeContract(
  projectId: string,
  chapterId: string
): KnowledgeContract | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM knowledge_contracts WHERE project_id = ? AND chapter_id = ?'
    )
    .get(projectId, chapterId) as KnowledgeContractRow | undefined
  return row ? mapKnowledgeContractRow(row) : null
}

export function createKnowledgeContract(
  projectId: string,
  chapterId: string,
  input: Partial<KnowledgeContract>
): KnowledgeContract {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO knowledge_contracts
       (id, project_id, chapter_id, pov_character_id, known_facts, unknown_facts,
        author_only_facts, reader_visible_facts, allowed_reveals, forbidden_inferences,
        allowed_foreshadow_ids, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      projectId,
      chapterId,
      input.pov_character_id ?? null,
      JSON.stringify(input.known_facts ?? []),
      JSON.stringify(input.unknown_facts ?? []),
      JSON.stringify(input.author_only_facts ?? []),
      JSON.stringify(input.reader_visible_facts ?? []),
      JSON.stringify(input.allowed_reveals ?? []),
      JSON.stringify(input.forbidden_inferences ?? []),
      JSON.stringify(input.allowed_foreshadow_ids ?? []),
      input.priority ?? 'absolute',
      ts,
      ts
    )
  return mapKnowledgeContractRow(
    getDb()
      .prepare('SELECT * FROM knowledge_contracts WHERE id = ?')
      .get(id) as KnowledgeContractRow
  )
}

export function updateKnowledgeContract(
  id: string,
  patch: Partial<KnowledgeContract>
): void {
  const db = getDb()
  const cur = db
    .prepare('SELECT * FROM knowledge_contracts WHERE id = ?')
    .get(id) as KnowledgeContractRow | undefined
  if (!cur) throw new Error('KnowledgeContract not found')
  db.prepare(
    `UPDATE knowledge_contracts
     SET pov_character_id = ?, known_facts = ?, unknown_facts = ?, author_only_facts = ?,
         reader_visible_facts = ?, allowed_reveals = ?, forbidden_inferences = ?,
         allowed_foreshadow_ids = ?, priority = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.pov_character_id !== undefined ? patch.pov_character_id : cur.pov_character_id,
    JSON.stringify(patch.known_facts ?? safeParseArray(cur.known_facts)),
    JSON.stringify(patch.unknown_facts ?? safeParseArray(cur.unknown_facts)),
    JSON.stringify(patch.author_only_facts ?? safeParseArray(cur.author_only_facts)),
    JSON.stringify(patch.reader_visible_facts ?? safeParseArray(cur.reader_visible_facts)),
    JSON.stringify(patch.allowed_reveals ?? safeParseArray(cur.allowed_reveals)),
    JSON.stringify(patch.forbidden_inferences ?? safeParseArray(cur.forbidden_inferences)),
    JSON.stringify(patch.allowed_foreshadow_ids ?? safeParseArray(cur.allowed_foreshadow_ids)),
    patch.priority ?? cur.priority,
    now(),
    id
  )
}

export async function generateChapterContract(
  projectId: string,
  chapterId: string,
  arcId: string | null
): Promise<ChapterContract> {
  console.log('[Contract] generateChapterContract', { projectId: projectId.slice(0, 8), chapterId: chapterId.slice(0, 8), arcId })
  const chapter = ensureChapterEntity(projectId, chapterId)
  if (!chapter) throw new Error('Chapter not found')

  let arcInfo = ''
  if (arcId) {
    const arc = getDb()
      .prepare('SELECT * FROM volume_arcs WHERE id = ?')
      .get(arcId) as
      | { arc_title: string; arc_goal: string; arc_type: string }
      | undefined
    if (arc) {
      arcInfo = `弧标题：${arc.arc_title}\n弧目标：${arc.arc_goal}\n弧类型：${arc.arc_type}`
    }
    const outline = getDb()
      .prepare('SELECT * FROM arc_outlines WHERE arc_id = ?')
      .get(arcId) as
      | {
          arc_opening: string
          arc_midpoint: string
          arc_climax: string
          arc_resolution: string
        }
      | undefined
    if (outline) {
      arcInfo += `\n弧大纲：\n开场：${outline.arc_opening}\n中点：${outline.arc_midpoint}\n高潮：${outline.arc_climax}\n结局：${outline.arc_resolution}`
    }
  }

  const plan = getDb()
    .prepare('SELECT * FROM chapter_plans WHERE chapter_id = ?')
    .get(chapterId) as
    | { plan_content: string; scenes: string; pacing: string; pov: string }
    | undefined

  const systemPrompt = `你是一位专业的小说叙事结构顾问。请根据弧大纲与章节计划，为该章节生成一份章节契约（ChapterContract），用于约束本章写作必须达成的叙事目标与禁止的写法。

请严格返回 JSON，字段如下：
- required_beats: string[]，本章必须完成的叙事节拍
- forbidden_moves: string[]，本章禁止出现的写法/情节走向
- continuity_checks: string[]，需要与前文保持一致性的检查点
- emotion_target: string，本章目标情绪
- payoff_points: string[]，本章需要兑现的回报点
- hook_goal: string，本章结尾的钩子目标
- allowed_foreshadow_ids: string[]，本章允许埋设/推进的伏笔 ID
- hard_constraints: string[]，硬性约束

只返回 JSON，不要其他文字。`

  const userPrompt = `项目 ID：${projectId}
章节 ID：${chapterId}
章节标题：${chapter.title}
${arcInfo ? `\n${arcInfo}\n` : ''}
${plan ? `章节计划：\n${plan.plan_content}\n场景：${plan.scenes}\n节奏：${plan.pacing}\n视角：${plan.pov}` : '（无章节计划）'}

请生成该章节的契约。`

  const raw = await chatLLMWithRetry([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], {
    agentType: 'architect',
    taskType: 'chapter_contract',
    riskLevel: 'high'
  })
  const json = extractJson(raw)
  if (!json) throw new Error('生成章节契约失败：无法解析 LLM 返回的 JSON')

  return createChapterContract(projectId, chapterId, arcId, {
    required_beats: asStringArray(json.required_beats),
    forbidden_moves: asStringArray(json.forbidden_moves),
    continuity_checks: asStringArray(json.continuity_checks),
    emotion_target: asString(json.emotion_target),
    payoff_points: asStringArray(json.payoff_points),
    hook_goal: asString(json.hook_goal),
    allowed_foreshadow_ids: asStringArray(json.allowed_foreshadow_ids),
    hard_constraints: asStringArray(json.hard_constraints)
  })
}

export async function generateKnowledgeContract(
  projectId: string,
  chapterId: string,
  povCharacterId: string | null
): Promise<KnowledgeContract> {
  console.log('[Contract] generateKnowledgeContract', { projectId: projectId.slice(0, 8), chapterId: chapterId.slice(0, 8), povCharacterId })
  const chapter = ensureChapterEntity(projectId, chapterId)
  if (!chapter) throw new Error('Chapter not found')

  let povInfo = ''
  if (povCharacterId) {
    const character = getDb()
      .prepare('SELECT * FROM characters WHERE id = ?')
      .get(povCharacterId) as
      | {
          name: string
          role: string
          background: string
          personality: string
        }
      | undefined
    if (character) {
      povInfo = `视角角色：${character.name}\n角色定位：${character.role}\n背景：${character.background}\n性格：${character.personality}`
    }
  }

  const prevSummary = getDb()
    .prepare('SELECT * FROM chapter_summaries WHERE chapter_id = ?')
    .get(chapterId) as
    | { summary: string; key_events: string }
    | undefined

  const systemPrompt = `你是一位专业的小说叙事知识边界顾问。请根据视角角色已知/未知的信息，为该章节生成一份知识契约（KnowledgeContract），用于约束本章的信息披露边界，防止角色全知或读者信息泄露。

请严格返回 JSON，字段如下：
- known_facts: string[]，视角角色已知的事实
- unknown_facts: string[]，视角角色未知的事实
- author_only_facts: string[]，仅作者知晓的事实
- reader_visible_facts: string[]，读者可见的事实
- allowed_reveals: string[]，本章允许揭示的信息
- forbidden_inferences: string[]，禁止读者/角色推断出的信息
- allowed_foreshadow_ids: string[]，本章允许使用的伏笔 ID

只返回 JSON，不要其他文字。`

  const userPrompt = `项目 ID：${projectId}
章节 ID：${chapterId}
章节标题：${chapter.title}
${povInfo ? `\n${povInfo}\n` : ''}
${prevSummary ? `前文摘要：\n${prevSummary.summary}\n关键事件：${prevSummary.key_events}` : '（无前文摘要）'}

请生成该章节的知识契约。`

  const raw = await chatLLMWithRetry([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ], {
    agentType: 'architect',
    taskType: 'knowledge_contract',
    riskLevel: 'critical'
  })
  const json = extractJson(raw)
  if (!json) throw new Error('生成知识契约失败：无法解析 LLM 返回的 JSON')

  return createKnowledgeContract(projectId, chapterId, {
    pov_character_id: povCharacterId,
    known_facts: asStringArray(json.known_facts),
    unknown_facts: asStringArray(json.unknown_facts),
    author_only_facts: asStringArray(json.author_only_facts),
    reader_visible_facts: asStringArray(json.reader_visible_facts),
    allowed_reveals: asStringArray(json.allowed_reveals),
    forbidden_inferences: asStringArray(json.forbidden_inferences),
    allowed_foreshadow_ids: asStringArray(json.allowed_foreshadow_ids)
  })
}
