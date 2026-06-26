import { getDb } from '../db'
import { uuid } from '../lib/util'
import type { Worldbuilding } from '@shared/types'

type Row = {
  id: string
  project_id: string
  category: string
  key: string
  value: string
}

function mapRow(r: Row): Worldbuilding {
  return {
    id: r.id,
    project_id: r.project_id,
    category: r.category,
    key: r.key,
    value: r.value
  }
}

export function list(projectId: string): Worldbuilding[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM worldbuilding WHERE project_id = ? ORDER BY category ASC, key ASC'
    )
    .all(projectId) as Row[]
  return rows.map(mapRow)
}

export function create(input: {
  project_id: string
  category: string
  key: string
  value: string
}): Worldbuilding {
  const id = uuid()
  getDb()
    .prepare(
      'INSERT INTO worldbuilding (id, project_id, category, key, value) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, input.project_id, input.category, input.key, input.value)
  return mapRow(getDb().prepare('SELECT * FROM worldbuilding WHERE id = ?').get(id) as Row)
}

export function update(
  id: string,
  input: Partial<Omit<Worldbuilding, 'id' | 'project_id'>>
): void {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM worldbuilding WHERE id = ?').get(id) as Row | undefined
  if (!cur) throw new Error('Worldbuilding not found')
  db.prepare('UPDATE worldbuilding SET category = ?, key = ?, value = ? WHERE id = ?').run(
    input.category ?? cur.category,
    input.key ?? cur.key,
    input.value ?? cur.value,
    id
  )
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM worldbuilding WHERE id = ?').run(id)
}
