import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import type {
  BibleField,
  BibleFieldStatus,
  BibleSectionType,
  StoryBible,
  AiCoCreateMode
} from '@shared/types'

type Row = {
  id: string
  project_id: string
  section_type: string
  section_key: string
  content: string
  status: string
  source_type: string
  source_ref: string
  ai_candidate: string
  ai_candidate_mode: string
  created_at: number
  updated_at: number
}

function mapRow(r: Row): BibleField {
  return {
    id: r.id,
    project_id: r.project_id,
    section_type: r.section_type as BibleSectionType,
    section_key: r.section_key,
    content: r.content,
    status: r.status as BibleFieldStatus,
    source_type: r.source_type as BibleField['source_type'],
    source_ref: r.source_ref,
    ai_candidate: r.ai_candidate,
    ai_candidate_mode: r.ai_candidate_mode as AiCoCreateMode | '',
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

const SECTION_TYPES: BibleSectionType[] = [
  'positioning',
  'compass',
  'world',
  'characters',
  'structure',
  'foreshadowing',
  'style'
]

export function getStoryBible(projectId: string): StoryBible {
  const rows = getDb()
    .prepare(
      'SELECT * FROM story_bible_sections WHERE project_id = ? ORDER BY section_type, section_key'
    )
    .all(projectId) as Row[]

  const bible: StoryBible = {
    positioning: [],
    compass: [],
    world: [],
    characters: [],
    structure: [],
    foreshadowing: [],
    style: []
  }

  for (const r of rows) {
    const field = mapRow(r)
    if (bible[field.section_type]) {
      bible[field.section_type].push(field)
    }
  }

  return bible
}

export function getSection(projectId: string, sectionType: BibleSectionType): BibleField[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM story_bible_sections WHERE project_id = ? AND section_type = ? ORDER BY section_key'
    )
    .all(projectId, sectionType) as Row[]
  return rows.map(mapRow)
}

export function getField(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string
): BibleField | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM story_bible_sections WHERE project_id = ? AND section_type = ? AND section_key = ?'
    )
    .get(projectId, sectionType, sectionKey) as Row | undefined
  return row ? mapRow(row) : null
}

export function updateField(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string,
  content: string,
  sourceType: BibleField['source_type'] = 'manual',
  sourceRef: string = ''
): BibleField {
  const db = getDb()
  const ts = now()
  const existing = getField(projectId, sectionType, sectionKey)

  if (existing) {
    db.prepare(
      `UPDATE story_bible_sections
       SET content = ?, source_type = ?, source_ref = ?, updated_at = ?
       WHERE id = ?`
    ).run(content, sourceType, sourceRef, ts, existing.id)
    return getField(projectId, sectionType, sectionKey)!
  }

  const id = uuid()
  db.prepare(
    `INSERT INTO story_bible_sections
     (id, project_id, section_type, section_key, content, status, source_type, source_ref, ai_candidate, ai_candidate_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, '', '', ?, ?)`
  ).run(id, projectId, sectionType, sectionKey, content, sourceType, sourceRef, ts, ts)
  return getField(projectId, sectionType, sectionKey)!
}

export function appendField(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string,
  content: string,
  sourceType: BibleField['source_type'] = 'manual',
  sourceRef: string = ''
): BibleField {
  const trimmed = content.trim()
  if (!trimmed) {
    return getField(projectId, sectionType, sectionKey)
      ?? updateField(projectId, sectionType, sectionKey, '', sourceType, sourceRef)
  }

  const existing = getField(projectId, sectionType, sectionKey)
  if (!existing || !existing.content.trim()) {
    return updateField(projectId, sectionType, sectionKey, trimmed, sourceType, sourceRef)
  }

  const existingText = existing.content.trim()
  if (existingText.includes(trimmed)) {
    return existing
  }

  const merged = `${existingText}\n\n${trimmed}`
  return updateField(projectId, sectionType, sectionKey, merged, sourceType, sourceRef)
}

export function setFieldStatus(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string,
  status: BibleFieldStatus
): void {
  getDb()
    .prepare(
      `UPDATE story_bible_sections SET status = ?, updated_at = ?
       WHERE project_id = ? AND section_type = ? AND section_key = ?`
    )
    .run(status, now(), projectId, sectionType, sectionKey)
}

export function setAiCandidate(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string,
  candidate: string,
  mode: AiCoCreateMode
): void {
  const db = getDb()
  const existing = getField(projectId, sectionType, sectionKey)
  const ts = now()

  if (existing) {
    db.prepare(
      `UPDATE story_bible_sections SET ai_candidate = ?, ai_candidate_mode = ?, updated_at = ?
       WHERE id = ?`
    ).run(candidate, mode, ts, existing.id)
  } else {
    const id = uuid()
    db.prepare(
      `INSERT INTO story_bible_sections
       (id, project_id, section_type, section_key, content, status, source_type, source_ref, ai_candidate, ai_candidate_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', 'draft', 'manual', '', ?, ?, ?, ?)`
    ).run(id, projectId, sectionType, sectionKey, candidate, mode, ts, ts)
  }
}

export function acceptAiCandidate(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string
): void {
  const db = getDb()
  const existing = getField(projectId, sectionType, sectionKey)
  if (!existing || !existing.ai_candidate) return

  db.prepare(
    `UPDATE story_bible_sections
     SET content = ?, ai_candidate = '', ai_candidate_mode = '', status = 'confirmed', source_type = 'ai_suggest', updated_at = ?
     WHERE id = ?`
  ).run(existing.ai_candidate, now(), existing.id)
}

export function rejectAiCandidate(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string
): void {
  getDb()
    .prepare(
      `UPDATE story_bible_sections SET ai_candidate = '', ai_candidate_mode = '', updated_at = ?
       WHERE project_id = ? AND section_type = ? AND section_key = ?`
    )
    .run(now(), projectId, sectionType, sectionKey)
}

export function deleteField(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string
): void {
  getDb()
    .prepare(
      'DELETE FROM story_bible_sections WHERE project_id = ? AND section_type = ? AND section_key = ?'
    )
    .run(projectId, sectionType, sectionKey)
}

export function listAllSectionTypes(): BibleSectionType[] {
  return SECTION_TYPES
}
