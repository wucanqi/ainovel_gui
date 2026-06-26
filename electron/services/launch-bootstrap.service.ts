import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { getStoryBible } from './story-bible.service'
import { createChapterContract, createKnowledgeContract, getChapterContract, getKnowledgeContract } from './contract.service'
import type { BibleSectionType, StoryBible } from '@shared/types'

type BibleFields = Record<string, string>

type ChapterSeed = {
  number: number
  title: string
  goal: string
}

function fieldsToObject(fields: StoryBible[BibleSectionType]): BibleFields {
  const obj: BibleFields = {}
  for (const field of fields) {
    if (field.content?.trim()) obj[field.section_key] = field.content.trim()
  }
  return obj
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? ''
}

function compact(text: string, max = 500): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function extractHeading(text: string): string {
  const match = text.match(/^#{1,6}\s+(.+)$/m)
  return match?.[1]?.replace(/[《》·]/g, '').trim() || '导入作品'
}

function extractCharacterName(text: string): string {
  const heading = text.match(/^##\s+(.+)$/m)?.[1] || text.match(/^#\s+(.+)$/m)?.[1] || ''
  const name = heading
    .replace(/[·:：].*$/, '')
    .replace(/^[^\u4e00-\u9fa5A-Za-z0-9]+/, '')
    .trim()
  return name || '主角'
}

function parseChapterSeeds(text: string): ChapterSeed[] {
  const seeds: ChapterSeed[] = []
  const seen = new Set<number>()
  const chapterLine = /^\s*[-*]?\s*(?:章|第)\s*([0-9０-９一二三四五六七八九十百]+)\s*[：:、.\s-]+(.+)$/gm
  let match: RegExpExecArray | null

  while ((match = chapterLine.exec(text)) && seeds.length < 12) {
    const number = parseChapterNumber(match[1])
    if (!number || seen.has(number)) continue
    const goal = match[2].trim()
    seeds.push({
      number,
      title: goal.replace(/[。；;].*$/, '').slice(0, 32) || `第${number}章`,
      goal
    })
    seen.add(number)
  }

  if (seeds.length > 0) return seeds

  return [
    {
      number: 1,
      title: '第一章',
      goal: compact(text, 240) || '根据导入大纲开启第一章'
    }
  ]
}

function parseChapterNumber(value: string): number {
  const normalized = value.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  )
  const numeric = Number(normalized)
  if (Number.isFinite(numeric) && numeric > 0) return numeric

  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  }
  if (normalized === '十') return 10
  const tenMatch = normalized.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (tenMatch) {
    return (tenMatch[1] ? digits[tenMatch[1]] : 1) * 10 + (tenMatch[2] ? digits[tenMatch[2]] : 0)
  }
  return digits[normalized] ?? 0
}

function ensureStoryCompass(projectId: string, bible: StoryBible): void {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM story_compass WHERE project_id = ?').get(projectId)
  if (existing) return

  const positioning = fieldsToObject(bible.positioning)
  const compass = fieldsToObject(bible.compass)
  const world = fieldsToObject(bible.world)
  const structure = fieldsToObject(bible.structure)
  const style = fieldsToObject(bible.style)
  const ts = now()

  db.prepare(
    `INSERT INTO story_compass
     (id, project_id, ending_direction, core_conflict, theme, one_line_pitch,
      genre, sub_genre, selling_point, target_audience, emotional_tone,
      narrative_pov, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    uuid(),
    projectId,
    firstNonEmpty(compass.ending_direction, structure.main_plot, world.background),
    firstNonEmpty(compass.core_conflict, structure.main_plot, structure.arc_skeleton),
    firstNonEmpty(compass.theme, positioning.selling_point, style.writing_style),
    firstNonEmpty(positioning.inspiration, world.background, structure.main_plot),
    firstNonEmpty(positioning.genre, '现代情感'),
    firstNonEmpty(positioning.selling_point, world.background, structure.main_plot),
    positioning.target_audience ?? '',
    firstNonEmpty(style.writing_style, world.background),
    firstNonEmpty(style.pov, 'third_person_limited'),
    ts,
    ts
  )
}

function ensureCharacter(projectId: string, bible: StoryBible): string {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM characters WHERE project_id = ? ORDER BY updated_at ASC LIMIT 1')
    .get(projectId) as { id: string } | undefined
  if (existing) return existing.id

  const characters = fieldsToObject(bible.characters)
  const text = firstNonEmpty(characters.protagonist, characters.supporting, characters.character_arc)
  const ts = now()
  const characterId = uuid()
  db.prepare(
    `INSERT INTO characters
     (id, project_id, name, role, appearance, personality, background, notes, updated_at)
     VALUES (?, ?, ?, 'protagonist', '', '', ?, ?, ?)`
  ).run(characterId, projectId, extractCharacterName(text), compact(text, 800), text, ts)
  return characterId
}

function ensureCharacterArc(projectId: string, characterId: string, bible: StoryBible): void {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM character_arcs WHERE project_id = ? LIMIT 1')
    .get(projectId)
  if (existing) return

  const characters = fieldsToObject(bible.characters)
  const text = firstNonEmpty(characters.character_arc, characters.protagonist, characters.supporting)
  const ts = now()
  db.prepare(
    `INSERT INTO character_arcs
     (id, project_id, character_id, arc_type, starting_state, ending_state,
      core_lie, core_truth, transformation_nodes, span, is_protagonist, version, created_at, updated_at)
     VALUES (?, ?, ?, 'positive_change', ?, ?, '', '', ?, 'project', 1, 1, ?, ?)`
  ).run(
    uuid(),
    projectId,
    characterId,
    compact(text, 240),
    compact(text, 240),
    JSON.stringify(text ? [compact(text, 400)] : []),
    ts,
    ts
  )
}

function ensureWorldRule(projectId: string, bible: StoryBible): void {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM world_rules WHERE project_id = ? LIMIT 1').get(projectId)
  if (existing) return

  const world = fieldsToObject(bible.world)
  const description = firstNonEmpty(world.rules, world.background, world.power_system)
  const ts = now()
  db.prepare(
    `INSERT INTO world_rules
     (id, project_id, category, name, description, implications, related_character_ids, created_at, updated_at)
     VALUES (?, ?, 'general', ?, ?, '', '[]', ?, ?)`
  ).run(uuid(), projectId, '导入世界规则', compact(description, 1000), ts, ts)
}

function ensureForeshadowing(projectId: string, bible: StoryBible): void {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM foreshadowing_ledger WHERE project_id = ? LIMIT 1')
    .get(projectId)
  if (existing) return

  const foreshadowing = fieldsToObject(bible.foreshadowing)
  const structure = fieldsToObject(bible.structure)
  const content = firstNonEmpty(foreshadowing.foreshadowing, foreshadowing.secrets, structure.arc_skeleton)
  const ts = now()
  db.prepare(
    `INSERT INTO foreshadowing_ledger
     (id, project_id, name, content, type, importance, status, created_at, updated_at)
     VALUES (?, ?, '导入伏笔', ?, 'plot', 'major', 'planned', ?, ?)`
  ).run(uuid(), projectId, compact(content, 1000), ts, ts)
}

function ensureArcAndChapters(projectId: string, bible: StoryBible): void {
  const db = getDb()
  const expanded = db
    .prepare("SELECT id FROM volume_arcs WHERE project_id = ? AND status = 'expanded' ORDER BY sort_order ASC LIMIT 1")
    .get(projectId) as { id: string } | undefined
  if (expanded) return

  const structure = fieldsToObject(bible.structure)
  const style = fieldsToObject(bible.style)
  const titleText = firstNonEmpty(structure.arc_skeleton, structure.volume_skeleton, structure.main_plot)
  const chapterText = firstNonEmpty(structure.chapter_plan, structure.main_plot, titleText)
  const seeds = parseChapterSeeds(chapterText)
  const ts = now()

  const volumeId = uuid()
  db.prepare('INSERT INTO volumes (id, project_id, title, sort_order) VALUES (?, ?, ?, 1)')
    .run(volumeId, projectId, extractHeading(titleText) || '第一卷')

  const arcId = uuid()
  db.prepare(
    `INSERT INTO volume_arcs
     (id, project_id, volume_number, volume_title, arc_number, arc_title, arc_goal,
      arc_type, planned_chapters, actual_chapters, status, sort_order, created_at, updated_at)
     VALUES (?, ?, 1, ?, 1, ?, ?, 'rising', ?, 0, 'expanded', 1, ?, ?)`
  ).run(
    arcId,
    projectId,
    extractHeading(titleText) || '第一卷',
    extractHeading(titleText) || '首弧',
    compact(firstNonEmpty(structure.arc_skeleton, structure.main_plot), 800),
    seeds.length,
    ts,
    ts
  )

  db.prepare(
    `INSERT INTO arc_outlines
     (id, project_id, arc_id, arc_opening, arc_midpoint, arc_climax, arc_resolution,
      planned_foreshadowings, character_arc_plan, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '{}', 1, ?, ?)`
  ).run(
    uuid(),
    projectId,
    arcId,
    compact(seeds[0]?.goal ?? titleText, 400),
    compact(seeds[Math.floor(seeds.length / 2)]?.goal ?? titleText, 400),
    compact(seeds[seeds.length - 1]?.goal ?? titleText, 400),
    compact(structure.arc_skeleton || titleText, 400),
    ts,
    ts
  )

  for (const seed of seeds) {
    const chapterId = uuid()
    db.prepare(
      `INSERT INTO chapters
       (id, project_id, volume_id, title, sort_order, content, plain_text, status, word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', '', 'draft', 0, ?, ?)`
    ).run(chapterId, projectId, volumeId, seed.title || `第${seed.number}章`, seed.number, ts, ts)

    db.prepare(
      `INSERT INTO arc_chapter_plans
       (id, arc_id, chapter_number, chapter_title, chapter_goal, scenes,
        foreshadowing_plan, estimated_words, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 3000, 'planned', ?, ?)`
    ).run(
      chapterId,
      arcId,
      seed.number,
      seed.title || `第${seed.number}章`,
      seed.goal,
      JSON.stringify([seed.goal]),
      ts,
      ts
    )

    db.prepare(
      `INSERT INTO chapter_plans
       (id, project_id, chapter_id, arc_id, chapter_number, plan_content, scenes, pacing, pov, estimated_words, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 3000, ?, ?)`
    ).run(
      uuid(),
      projectId,
      chapterId,
      arcId,
      seed.number,
      seed.goal,
      JSON.stringify([seed.goal]),
      style.pacing || 'medium',
      style.pov || '第三人称限知',
      ts,
      ts
    )

    if (!getChapterContract(projectId, chapterId)) {
      createChapterContract(projectId, chapterId, arcId, {
        required_beats: [seed.goal],
        forbidden_moves: [],
        continuity_checks: [],
        emotion_target: '',
        payoff_points: [],
        hook_goal: seed.goal,
        allowed_foreshadow_ids: [],
        hard_constraints: []
      })
    }

    if (!getKnowledgeContract(projectId, chapterId)) {
      createKnowledgeContract(projectId, chapterId, {
        pov_character_id: null,
        known_facts: [],
        unknown_facts: [],
        author_only_facts: [],
        reader_visible_facts: [],
        allowed_reveals: [],
        forbidden_inferences: [],
        allowed_foreshadow_ids: []
      })
    }
  }
}

export function ensureLaunchAssets(projectId: string): void {
  const bible = getStoryBible(projectId)
  ensureStoryCompass(projectId, bible)
  const characterId = ensureCharacter(projectId, bible)
  ensureCharacterArc(projectId, characterId, bible)
  ensureWorldRule(projectId, bible)
  ensureForeshadowing(projectId, bible)
  ensureArcAndChapters(projectId, bible)
}
