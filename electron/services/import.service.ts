import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { parseByRules, enhanceByLLM, detectConflicts, toParsedSegments, applyFilenameConvention } from './bible-parser'
import { getStoryBible, appendField } from './story-bible.service'
import { rebuildFoundations } from './memory.service'
import type {
  ImportedDocument,
  ParsedSegment,
  MergeResult,
  ConflictItem,
  BibleSectionType
} from '@shared/types'

type DocRow = {
  id: string
  project_id: string
  filename: string
  content: string
  char_count: number
  status: string
  created_at: number
}

function mapDocRow(r: DocRow): ImportedDocument {
  return {
    id: r.id,
    project_id: r.project_id,
    filename: r.filename,
    content: r.content,
    char_count: r.char_count,
    status: r.status as ImportedDocument['status'],
    created_at: r.created_at
  }
}

type SegRow = {
  id: string
  project_id: string
  document_id: string
  segment_index: number
  raw_text: string
  detected_type: string
  confidence: number
  target_section: string
  target_key: string
  merge_status: string
  conflict_with: string
  created_at: number
}

function mapSegRow(r: SegRow): ParsedSegment {
  return {
    id: r.id,
    project_id: r.project_id,
    document_id: r.document_id,
    segment_index: r.segment_index,
    raw_text: r.raw_text,
    detected_type: r.detected_type as ParsedSegment['detected_type'],
    confidence: r.confidence,
    target_section: (r.target_section || '') as BibleSectionType | '',
    target_key: r.target_key,
    merge_status: r.merge_status as ParsedSegment['merge_status'],
    conflict_with: r.conflict_with,
    created_at: r.created_at
  }
}

export function importDocument(
  projectId: string,
  filename: string,
  content: string
): ImportedDocument {
  const id = uuid()
  const ts = now()
  const charCount = content.length
  getDb()
    .prepare(
      `INSERT INTO imported_documents (id, project_id, filename, content, char_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(id, projectId, filename, content, charCount, ts)
  console.log('[Import] importDocument', { id: id.slice(0, 8), filename, charCount })
  return mapDocRow(
    getDb().prepare('SELECT * FROM imported_documents WHERE id = ?').get(id) as DocRow
  )
}

export function listDocuments(projectId: string): ImportedDocument[] {
  const rows = getDb()
    .prepare('SELECT * FROM imported_documents WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as DocRow[]
  return rows.map(mapDocRow)
}

export function deleteDocument(projectId: string, documentId: string): void {
  getDb().prepare('DELETE FROM imported_documents WHERE id = ? AND project_id = ?').run(
    documentId,
    projectId
  )
}

export async function parseDocument(
  projectId: string,
  documentId: string
): Promise<ParsedSegment[]> {
  const doc = getDb()
    .prepare('SELECT * FROM imported_documents WHERE id = ? AND project_id = ?')
    .get(documentId, projectId) as DocRow | undefined
  if (!doc) throw new Error('文档不存在')

  getDb()
    .prepare('DELETE FROM parsed_segments WHERE document_id = ?')
    .run(documentId)

  let rawSegments = parseByRules(doc.content)
  rawSegments = applyFilenameConvention(doc.filename, rawSegments)
  rawSegments = await enhanceByLLM(rawSegments)
  rawSegments = applyFilenameConvention(doc.filename, rawSegments)

  const bible = getStoryBible(projectId)
  const conflicts = detectConflicts(rawSegments, bible)

  const parsed = toParsedSegments(projectId, documentId, rawSegments)

  for (let i = 0; i < parsed.length; i++) {
    const conflict = conflicts.find((c) => c.segmentIndex === i)
    if (conflict) {
      parsed[i].merge_status = 'conflict'
      parsed[i].conflict_with = conflict.conflictFieldId
    }
  }

  const stmt = getDb().prepare(
    `INSERT INTO parsed_segments
     (id, project_id, document_id, segment_index, raw_text, detected_type, confidence, target_section, target_key, merge_status, conflict_with, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const seg of parsed) {
    stmt.run(
      seg.id,
      seg.project_id,
      seg.document_id,
      seg.segment_index,
      seg.raw_text,
      seg.detected_type,
      seg.confidence,
      seg.target_section,
      seg.target_key,
      seg.merge_status,
      seg.conflict_with,
      seg.created_at
    )
  }

  getDb()
    .prepare('UPDATE imported_documents SET status = ? WHERE id = ?')
    .run('parsed', documentId)

  return parsed
}

export async function parseAllDocuments(projectId: string): Promise<void> {
  const docs = listDocuments(projectId).filter((d) => d.status === 'pending')
  for (const doc of docs) {
    await parseDocument(projectId, doc.id)
  }
}

export async function parseAndMergeAllDocuments(projectId: string): Promise<MergeResult[]> {
  await parseAllDocuments(projectId)
  const mergeable = listSegments(projectId).filter(
    (seg) =>
      (seg.merge_status === 'pending' || seg.merge_status === 'conflict') &&
      Boolean(seg.target_section) &&
      Boolean(seg.target_key)
  )
  const results = await mergeSegments(projectId, mergeable.map((seg) => seg.id))

  const docs = listDocuments(projectId)
  for (const doc of docs) {
    const docSegments = listSegments(projectId, doc.id)
    if (docSegments.length > 0 && docSegments.every((seg) => seg.merge_status === 'merged')) {
      getDb().prepare('UPDATE imported_documents SET status = ? WHERE id = ?').run('merged', doc.id)
    }
  }

  await rebuildFoundations(projectId)

  return results
}

export function listSegments(projectId: string, documentId?: string): ParsedSegment[] {
  const db = getDb()
  const rows = documentId
    ? (db
        .prepare(
          'SELECT * FROM parsed_segments WHERE project_id = ? AND document_id = ? ORDER BY segment_index'
        )
        .all(projectId, documentId) as SegRow[])
    : (db
        .prepare(
          'SELECT * FROM parsed_segments WHERE project_id = ? ORDER BY document_id, segment_index'
        )
        .all(projectId) as SegRow[])
  return rows.map(mapSegRow)
}

export function updateSegmentStatus(
  segmentId: string,
  status: ParsedSegment['merge_status']
): void {
  getDb().prepare('UPDATE parsed_segments SET merge_status = ? WHERE id = ?').run(
    status,
    segmentId
  )
}

export function deleteSegment(segmentId: string): void {
  getDb().prepare('DELETE FROM parsed_segments WHERE id = ?').run(segmentId)
}

export async function mergeSegments(
  projectId: string,
  segmentIds: string[]
): Promise<MergeResult[]> {
  const results: MergeResult[] = []
  const segments = listSegments(projectId).filter((s) => segmentIds.includes(s.id))

  for (const seg of segments) {
    if (!seg.target_section || !seg.target_key) {
      results.push({
        segment_id: seg.id,
        success: false,
        error: '未指定目标分区'
      })
      continue
    }

    try {
      const field = appendField(
        projectId,
        seg.target_section as BibleSectionType,
        seg.target_key,
        seg.raw_text,
        'import',
        `import:${seg.document_id}#${seg.segment_index}`
      )
      updateSegmentStatus(seg.id, 'merged')
      results.push({
        segment_id: seg.id,
        success: true,
        target_field_id: field.id
      })
    } catch (e) {
      results.push({
        segment_id: seg.id,
        success: false,
        error: (e as Error).message
      })
    }
  }

  return results
}

export function getConflicts(projectId: string): ConflictItem[] {
  const segments = listSegments(projectId).filter((s) => s.merge_status === 'conflict')
  const conflicts: ConflictItem[] = []

  for (const seg of segments) {
    if (!seg.conflict_with) continue
    const fieldRow = getDb()
      .prepare('SELECT * FROM story_bible_sections WHERE id = ?')
      .get(seg.conflict_with) as
      | { id: string; content: string; section_type: string; section_key: string }
      | undefined
    if (fieldRow) {
      conflicts.push({
        segment_id: seg.id,
        segment_text: seg.raw_text,
        conflict_field_id: fieldRow.id,
        conflict_field_content: fieldRow.content,
        section_type: fieldRow.section_type as BibleSectionType,
        section_key: fieldRow.section_key,
        reason: '导入内容与已有设定存在差异'
      })
    }
  }

  return conflicts
}
