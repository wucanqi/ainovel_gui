import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import type { Chapter } from '@shared/types'
import * as memoryService from './memory.service'

type Row = {
  id: string
  volume_id: string
  project_id: string
  title: string
  content: string
  plain_text: string
  sort_order: number
  word_count: number
  status: string
  created_at: number
  updated_at: number
}

function mapRow(r: Row): Chapter {
  return {
    id: r.id,
    volume_id: r.volume_id,
    project_id: r.project_id,
    title: r.title,
    content: r.content,
    plain_text: r.plain_text,
    sort_order: r.sort_order,
    word_count: r.word_count,
    status: r.status as Chapter['status'],
    created_at: r.created_at,
    updated_at: r.updated_at
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
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function countWords(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const en = (text.match(/[A-Za-z0-9_]+/g) || []).length
  return cjk + en
}

export function list(volumeId: string): Chapter[] {
  const rows = getDb()
    .prepare('SELECT * FROM chapters WHERE volume_id = ? ORDER BY sort_order ASC')
    .all(volumeId) as Row[]
  return rows.map(mapRow)
}

export function listByProject(projectId: string): Chapter[] {
  const rows = getDb()
    .prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as Row[]
  return rows.map(mapRow)
}

export function get(id: string): Chapter | null {
  const r = getDb().prepare('SELECT * FROM chapters WHERE id = ?').get(id) as Row | undefined
  return r ? mapRow(r) : null
}

export function create(input: {
  project_id: string
  volume_id: string
  title: string
}): Chapter {
  const db = getDb()
  const ts = now()
  const id = uuid()
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM chapters WHERE volume_id = ?'
    )
    .get(input.volume_id) as { next: number }
  db.prepare(
    `INSERT INTO chapters
     (id, volume_id, project_id, title, content, plain_text, sort_order, word_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '', ?, 0, 'draft', ?, ?)`
  ).run(id, input.volume_id, input.project_id, input.title, row.next, ts, ts)
  return get(id)!
}

export function update(
  id: string,
  input: { title?: string; content?: string; status?: string }
): void {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as Row | undefined
  if (!cur) throw new Error('Chapter not found')

  const title = input.title ?? cur.title
  const status = input.status ?? cur.status
  const content = input.content ?? cur.content
  const plainText = input.content !== undefined ? htmlToPlain(input.content) : cur.plain_text
  const wordCount = input.content !== undefined ? countWords(plainText) : cur.word_count

  db.prepare(
    `UPDATE chapters SET title = ?, content = ?, plain_text = ?, word_count = ?, status = ?, updated_at = ? WHERE id = ?`
  ).run(title, content, plainText, wordCount, status, now(), id)

  if (input.content !== undefined && plainText.trim()) {
    void memoryService.rebuildChapter(cur.project_id, id).catch((e) => {
      console.error('[chapter] memory rebuild failed:', e)
    })
  }
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM chapters WHERE id = ?').run(id)
}

export function reorder(orders: Array<{ id: string; sort_order: number }>): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE chapters SET sort_order = ? WHERE id = ?')
  const tx = db.transaction((items: typeof orders) => {
    for (const item of items) {
      stmt.run(item.sort_order, item.id)
    }
  })
  tx(orders)
}

export function move(id: string, volumeId: string): void {
  const db = getDb()
  const row = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM chapters WHERE volume_id = ?')
    .get(volumeId) as { next: number }
  db.prepare('UPDATE chapters SET volume_id = ?, sort_order = ? WHERE id = ?').run(
    volumeId,
    row.next,
    id
  )
}
