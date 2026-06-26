import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import type { CharacterFactLock, FactLockLevel } from '@shared/types'

type Row = {
  id: string
  project_id: string
  character_id: string
  fact_key: string
  fact_value: string
  lock_level: string
  change_requires_event: number
  allowed_change_events: string
  last_verified_chapter_id: string | null
  created_at: number
  updated_at: number
}

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? (v as string[]) : []
  } catch {
    return []
  }
}

function mapRow(r: Row): CharacterFactLock {
  return {
    id: r.id,
    project_id: r.project_id,
    character_id: r.character_id,
    fact_key: r.fact_key,
    fact_value: r.fact_value,
    lock_level: r.lock_level as FactLockLevel,
    change_requires_event: r.change_requires_event === 1,
    allowed_change_events: safeParseArray(r.allowed_change_events),
    last_verified_chapter_id: r.last_verified_chapter_id,
    created_at: r.created_at,
    updated_at: r.updated_at
  }
}

export function lockFact(
  projectId: string,
  characterId: string,
  factKey: string,
  factValue: string,
  lockLevel: FactLockLevel,
  allowedChangeEvents: string[] = []
): CharacterFactLock {
  const db = getDb()
  const ts = now()
  const existing = db
    .prepare(
      'SELECT * FROM character_fact_locks WHERE character_id = ? AND fact_key = ?'
    )
    .get(characterId, factKey) as Row | undefined

  if (existing) {
    db.prepare(
      `UPDATE character_fact_locks
       SET fact_value = ?, lock_level = ?, change_requires_event = ?,
           allowed_change_events = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      factValue,
      lockLevel,
      lockLevel === 'event_required' ? 1 : 0,
      JSON.stringify(allowedChangeEvents),
      ts,
      existing.id
    )
    return mapRow(
      db
        .prepare('SELECT * FROM character_fact_locks WHERE id = ?')
        .get(existing.id) as Row
    )
  }

  const id = uuid()
  db.prepare(
    `INSERT INTO character_fact_locks
     (id, project_id, character_id, fact_key, fact_value, lock_level,
      change_requires_event, allowed_change_events, last_verified_chapter_id,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    id,
    projectId,
    characterId,
    factKey,
    factValue,
    lockLevel,
    lockLevel === 'event_required' ? 1 : 0,
    JSON.stringify(allowedChangeEvents),
    ts,
    ts
  )
  return mapRow(
    db.prepare('SELECT * FROM character_fact_locks WHERE id = ?').get(id) as Row
  )
}

export function unlockFact(id: string): void {
  getDb().prepare('DELETE FROM character_fact_locks WHERE id = ?').run(id)
}

export function getLocks(characterId: string): CharacterFactLock[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM character_fact_locks WHERE character_id = ? ORDER BY fact_key ASC'
    )
    .all(characterId) as Row[]
  return rows.map(mapRow)
}

export function getLock(
  characterId: string,
  factKey: string
): CharacterFactLock | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM character_fact_locks WHERE character_id = ? AND fact_key = ?'
    )
    .get(characterId, factKey) as Row | undefined
  return row ? mapRow(row) : null
}

export function getLocksForProject(projectId: string): CharacterFactLock[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM character_fact_locks WHERE project_id = ? ORDER BY character_id ASC, fact_key ASC'
    )
    .all(projectId) as Row[]
  return rows.map(mapRow)
}

export function verifyFact(
  characterId: string,
  factKey: string,
  claimedValue: string
): { valid: boolean; reason: string } {
  const lock = getLock(characterId, factKey)
  if (!lock) {
    return { valid: true, reason: '该事实未锁定，无需校验' }
  }
  if (lock.fact_value === claimedValue) {
    return { valid: true, reason: '与锁定事实一致' }
  }
  if (lock.lock_level === 'soft') {
    return {
      valid: true,
      reason: `软锁事实变更（原值：${lock.fact_value}，新值：${claimedValue}）`
    }
  }
  if (lock.lock_level === 'event_required') {
    return {
      valid: false,
      reason: `事实「${factKey}」为事件锁，需通过允许的事件变更。原值：${lock.fact_value}，声称值：${claimedValue}`
    }
  }
  return {
    valid: false,
    reason: `事实「${factKey}」为不可变锁，禁止变更。原值：${lock.fact_value}，声称值：${claimedValue}`
  }
}

export function changeFactWithEvent(
  characterId: string,
  factKey: string,
  newValue: string,
  eventId: string
): void {
  const db = getDb()
  const lock = getLock(characterId, factKey)
  if (!lock) throw new Error(`事实「${factKey}」未锁定，无法通过事件变更`)

  if (lock.lock_level === 'immutable') {
    throw new Error(`事实「${factKey}」为不可变锁，禁止任何变更`)
  }

  if (lock.lock_level === 'event_required') {
    const allowed =
      lock.allowed_change_events.length === 0 ||
      lock.allowed_change_events.includes(eventId)
    if (!allowed) {
      throw new Error(
        `事件「${eventId}」不在事实「${factKey}」允许的变更事件列表中`
      )
    }
  }

  db.prepare(
    `UPDATE character_fact_locks
     SET fact_value = ?, updated_at = ?
     WHERE id = ?`
  ).run(newValue, now(), lock.id)
}

export function batchLockFromSnapshot(
  projectId: string,
  snapshotData: Record<string, unknown>
): number {
  const characters = snapshotData.characters
  if (!Array.isArray(characters)) return 0

  const lockableKeys = [
    'occupation',
    'gender',
    'organization',
    'race',
    'age',
    'location'
  ]

  let count = 0
  for (const char of characters) {
    if (typeof char !== 'object' || char === null) continue
    const c = char as Record<string, unknown>
    const characterId = c.id
    if (typeof characterId !== 'string') continue

    for (const key of lockableKeys) {
      const value = c[key]
      if (typeof value !== 'string' && typeof value !== 'number') continue
      lockFact(
        projectId,
        characterId,
        key,
        String(value),
        'immutable',
        []
      )
      count++
    }
  }

  return count
}
