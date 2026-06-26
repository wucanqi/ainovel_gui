import { getDb } from '../db'
import { uuid } from '../lib/util'
import type { Volume } from '@shared/types'

type Row = {
  id: string
  project_id: string
  title: string
  sort_order: number
}

function mapRow(r: Row): Volume {
  return {
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    sort_order: r.sort_order
  }
}

export function list(projectId: string): Volume[] {
  const rows = getDb()
    .prepare('SELECT * FROM volumes WHERE project_id = ? ORDER BY sort_order ASC')
    .all(projectId) as Row[]
  return rows.map(mapRow)
}

export function create(input: { project_id: string; title: string }): Volume {
  const db = getDb()
  const row = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM volumes WHERE project_id = ?')
    .get(input.project_id) as { next: number }
  const id = uuid()
  db.prepare(
    'INSERT INTO volumes (id, project_id, title, sort_order) VALUES (?, ?, ?, ?)'
  ).run(id, input.project_id, input.title, row.next)
  return mapRow(db.prepare('SELECT * FROM volumes WHERE id = ?').get(id) as Row)
}

export function update(id: string, input: { title?: string }): void {
  const cur = getDb().prepare('SELECT * FROM volumes WHERE id = ?').get(id) as Row | undefined
  if (!cur) throw new Error('Volume not found')
  getDb()
    .prepare('UPDATE volumes SET title = ? WHERE id = ?')
    .run(input.title ?? cur.title, id)
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM volumes WHERE id = ?').run(id)
}

export function reorder(orders: Array<{ id: string; sort_order: number }>): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE volumes SET sort_order = ? WHERE id = ?')
  const tx = db.transaction((items: typeof orders) => {
    for (const item of items) {
      stmt.run(item.sort_order, item.id)
    }
  })
  tx(orders)
}
