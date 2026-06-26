import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import type { ChapterDraft, DraftLifecycle } from '@shared/types'

type Row = {
  id: string
  project_id: string
  chapter_id: string
  version: number
  content: string
  plain_text: string
  word_count: number
  lifecycle: string
  model_used: string
  generated_at: number
  committed_at: number | null
}

function mapRow(r: Row): ChapterDraft {
  return {
    id: r.id,
    project_id: r.project_id,
    chapter_id: r.chapter_id,
    version: r.version,
    content: r.content,
    plain_text: r.plain_text,
    word_count: r.word_count,
    lifecycle: r.lifecycle as DraftLifecycle,
    model_used: r.model_used,
    generated_at: r.generated_at,
    committed_at: r.committed_at
  }
}

function htmlToPlain(html: string): string {
  if (!html) return ''
  return html
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function countWords(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const en = (text.match(/[A-Za-z0-9_]+/g) || []).length
  return cjk + en
}

export function createDraft(
  projectId: string,
  chapterId: string,
  content: string,
  modelUsed: string
): ChapterDraft {
  const db = getDb()
  const ts = now()
  const id = uuid()
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM chapter_drafts WHERE chapter_id = ?')
    .get(chapterId) as { next: number }
  const version = row.next
  const plainText = htmlToPlain(content)
  const wordCount = countWords(plainText)

  db.prepare(
    `INSERT INTO chapter_drafts
     (id, project_id, chapter_id, version, content, plain_text, word_count, lifecycle, model_used, generated_at, committed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft_generated', ?, ?, NULL)`
  ).run(id, projectId, chapterId, version, content, plainText, wordCount, modelUsed, ts)

  return mapRow(db.prepare('SELECT * FROM chapter_drafts WHERE id = ?').get(id) as Row)
}

export function getLatestDraft(chapterId: string): ChapterDraft | null {
  const r = getDb()
    .prepare('SELECT * FROM chapter_drafts WHERE chapter_id = ? ORDER BY version DESC LIMIT 1')
    .get(chapterId) as Row | undefined
  return r ? mapRow(r) : null
}

export function getDraft(id: string): ChapterDraft | null {
  const r = getDb().prepare('SELECT * FROM chapter_drafts WHERE id = ?').get(id) as Row | undefined
  return r ? mapRow(r) : null
}

export function listDrafts(chapterId: string): ChapterDraft[] {
  const rows = getDb()
    .prepare('SELECT * FROM chapter_drafts WHERE chapter_id = ? ORDER BY version DESC')
    .all(chapterId) as Row[]
  return rows.map(mapRow)
}

export function updateDraftLifecycle(id: string, lifecycle: DraftLifecycle): void {
  getDb()
    .prepare('UPDATE chapter_drafts SET lifecycle = ? WHERE id = ?')
    .run(lifecycle, id)
}

export function commitDraft(draftId: string): { success: boolean; chapterId: string } {
  const db = getDb()
  const draft = getDraft(draftId)
  if (!draft) throw new Error('Draft not found')

  const ts = now()
  const existingChapter = db.prepare('SELECT id FROM chapters WHERE id = ?').get(draft.chapter_id) as { id: string } | undefined
  if (existingChapter) {
    db.prepare(
      `UPDATE chapters
       SET content = ?, plain_text = ?, word_count = ?, status = 'draft', updated_at = ?
       WHERE id = ?`
    ).run(draft.content, draft.plain_text, draft.word_count, ts, draft.chapter_id)
  } else {
    // Chapters row missing — auto-create before commit
    const plan = db.prepare(
      `SELECT acp.chapter_title, acp.chapter_number, va.volume_number
       FROM arc_chapter_plans acp
       JOIN volume_arcs va ON acp.arc_id = va.id
       WHERE acp.id = ? LIMIT 1`
    ).get(draft.chapter_id) as Record<string, unknown> | undefined
    const title = (plan?.chapter_title as string) || `第${plan?.chapter_number ?? '?'}章`
    const volNum = (plan?.volume_number as number) ?? 1
    const volTitle = `第${volNum}卷`
    let volId = (db.prepare("SELECT id FROM volumes WHERE project_id = ? AND title = ?").get(draft.project_id, volTitle) as { id: string } | undefined)?.id
    if (!volId) {
      volId = uuid()
      db.prepare('INSERT INTO volumes (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)').run(volId, draft.project_id, volTitle, volNum)
    }
    const sortOrder = (plan?.chapter_number as number) ?? 1
    db.prepare(
      `INSERT INTO chapters (id, volume_id, project_id, title, content, plain_text, sort_order, word_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(draft.chapter_id, volId, draft.project_id, title, draft.content, draft.plain_text, sortOrder, draft.word_count, ts, ts)
    console.log('[draft] commitDraft auto-created chapters row', { chapterId: draft.chapter_id.slice(0, 8) })
  }

  db.prepare(
    `UPDATE chapter_drafts SET lifecycle = 'final_committed', committed_at = ? WHERE id = ?`
  ).run(ts, draftId)

  return { success: true, chapterId: draft.chapter_id }
}

export function rejectDraft(draftId: string, reason: string): void {
  console.warn(`[draft] rejected ${draftId}: ${reason}`)
  getDb()
    .prepare(`UPDATE chapter_drafts SET lifecycle = 'draft_rejected' WHERE id = ?`)
    .run(draftId)
}

export function isCommitted(chapterId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM chapter_drafts WHERE chapter_id = ? AND lifecycle = 'final_committed' LIMIT 1`
    )
    .get(chapterId) as { 1: number } | undefined
  return !!row
}

export function getCommittedDraft(chapterId: string): ChapterDraft | null {
  const r = getDb()
    .prepare(
      `SELECT * FROM chapter_drafts WHERE chapter_id = ? AND lifecycle = 'final_committed' ORDER BY version DESC LIMIT 1`
    )
    .get(chapterId) as Row | undefined
  return r ? mapRow(r) : null
}
