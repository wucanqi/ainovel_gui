import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import type { Character } from '@shared/types'

type Row = {
  id: string
  project_id: string
  name: string
  aliases: string
  role: string
  appearance: string
  personality: string
  background: string
  relations: string
  notes: string
  updated_at: number
}

function mapRow(r: Row): Character {
  return {
    id: r.id,
    project_id: r.project_id,
    name: r.name,
    aliases: safeParse(r.aliases, []),
    role: r.role,
    appearance: r.appearance,
    personality: r.personality,
    background: r.background,
    relations: safeParse(r.relations, []),
    notes: r.notes,
    updated_at: r.updated_at
  }
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function list(projectId: string): Character[] {
  const rows = getDb()
    .prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId) as Row[]
  return rows.map(mapRow)
}

export function create(input: { project_id: string; name: string }): Character {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO characters
       (id, project_id, name, aliases, role, appearance, personality, background, relations, notes, updated_at)
       VALUES (?, ?, ?, '[]', '', '', '', '', '[]', '', ?)`
    )
    .run(id, input.project_id, input.name, ts)
  return mapRow(getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row)
}

export function update(
  id: string,
  input: Partial<Omit<Character, 'id' | 'project_id' | 'updated_at'>>
): void {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row | undefined
  if (!cur) throw new Error('Character not found')
  db.prepare(
    `UPDATE characters SET
       name = ?, aliases = ?, role = ?, appearance = ?, personality = ?,
       background = ?, relations = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.name ?? cur.name,
    input.aliases !== undefined ? JSON.stringify(input.aliases) : cur.aliases,
    input.role ?? cur.role,
    input.appearance ?? cur.appearance,
    input.personality ?? cur.personality,
    input.background ?? cur.background,
    input.relations !== undefined ? JSON.stringify(input.relations) : cur.relations,
    input.notes ?? cur.notes,
    now(),
    id
  )
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM characters WHERE id = ?').run(id)
}
