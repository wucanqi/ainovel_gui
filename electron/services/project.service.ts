import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import type { Project } from '@shared/types'

type Row = {
  id: string
  title: string
  summary: string
  cover_path: string | null
  created_at: number
  updated_at: number
}

function mapRow(r: Row): Project {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    cover_path: r.cover_path,
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

export function list(): Project[] {
  const rows = getDb().prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as Row[]
  return rows.map(mapRow)
}

export function get(id: string): Project | null {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
  return r ? mapRow(r) : null
}

export function create(input: { title: string; summary?: string }): Project {
  const ts = now()
  const id = uuid()
  getDb()
    .prepare(
      `INSERT INTO projects (id, title, summary, cover_path, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`
    )
    .run(id, input.title, input.summary ?? '', ts, ts)
  return get(id)!
}

export function update(id: string, input: { title?: string; summary?: string }): void {
  const cur = get(id)
  if (!cur) throw new Error('Project not found')
  getDb()
    .prepare(
      `UPDATE projects SET title = ?, summary = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      input.title ?? cur.title,
      input.summary ?? cur.summary,
      now(),
      id
    )
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
}
