import { getDb } from '../db'
import { uuid } from '../lib/util'
import type { Location } from '@shared/types'

type Row = {
  id: string
  project_id: string
  name: string
  description: string
  related_characters: string
}

function mapRow(r: Row): Location {
  return {
    id: r.id,
    project_id: r.project_id,
    name: r.name,
    description: r.description,
    related_characters: safeParse(r.related_characters, [])
  }
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function list(projectId: string): Location[] {
  const rows = getDb()
    .prepare('SELECT * FROM locations WHERE project_id = ? ORDER BY name ASC')
    .all(projectId) as Row[]
  return rows.map(mapRow)
}

export function create(input: { project_id: string; name: string }): Location {
  const id = uuid()
  getDb()
    .prepare(
      'INSERT INTO locations (id, project_id, name, description, related_characters) VALUES (?, ?, ?, "", "[]")'
    )
    .run(id, input.project_id, input.name)
  return mapRow(getDb().prepare('SELECT * FROM locations WHERE id = ?').get(id) as Row)
}

export function update(
  id: string,
  input: Partial<Omit<Location, 'id' | 'project_id'>>
): void {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as Row | undefined
  if (!cur) throw new Error('Location not found')
  db.prepare('UPDATE locations SET name = ?, description = ?, related_characters = ? WHERE id = ?').run(
    input.name ?? cur.name,
    input.description ?? cur.description,
    input.related_characters !== undefined
      ? JSON.stringify(input.related_characters)
      : cur.related_characters,
    id
  )
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM locations WHERE id = ?').run(id)
}
