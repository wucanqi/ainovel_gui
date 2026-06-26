import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { load } from 'sqlite-vec'
import { schema } from './schema'

let db: Database.Database | null = null
let vecVersion = ''
let testMode = false

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
}

export function getVecVersion(): string {
  return vecVersion
}

export function getDbPath(): string {
  if (testMode) return ':memory:'
  const dir = app.getPath('userData')
  return join(dir, 'novel_tool.db')
}

export function initDb(): void {
  const dbPath = getDbPath()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  try {
    load(db)
    const row = db.prepare('SELECT vec_version() AS v').get() as
      | { v: string }
      | undefined
    vecVersion = row?.v ?? 'unknown'
  } catch (e) {
    console.error('[db] sqlite-vec load failed:', e)
  }

  db.exec(schema)
  runMigrations()
  console.log('[db] initialized at', dbPath, 'vec:', vecVersion)
}

function runMigrations(): void {
  if (!db) return
  const cols = db.prepare("PRAGMA table_info('api_configs')").all() as Array<{ name: string }>
  const hasEmbeddingActive = cols.some((c) => c.name === 'is_embedding_active')
  if (!hasEmbeddingActive) {
    db.exec('ALTER TABLE api_configs ADD COLUMN is_embedding_active INTEGER NOT NULL DEFAULT 0')
    console.log('[db] migration: added is_embedding_active to api_configs')
  }
  const hasModelTier = cols.some((c) => c.name === 'model_tier')
  if (!hasModelTier) {
    db.exec("ALTER TABLE api_configs ADD COLUMN model_tier TEXT DEFAULT NULL")
    console.log('[db] migration: added model_tier to api_configs')
  }
  const memCols = db.prepare("PRAGMA table_info('memory_chunks')").all() as Array<{ name: string }>
  const hasTags = memCols.some((c) => c.name === 'tags')
  if (!hasTags) {
    db.exec("ALTER TABLE memory_chunks ADD COLUMN tags TEXT DEFAULT '{}'")
    console.log('[db] migration: added tags to memory_chunks')
  }
  const sessCols = db.prepare("PRAGMA table_info('agent_sessions')").all() as Array<{ name: string }>
  const hasStatus = sessCols.some((c) => c.name === 'status')
  if (!hasStatus) {
    db.exec("ALTER TABLE agent_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'running'")
    console.log('[db] migration: added status to agent_sessions')
  }
  const hasEndedAt = sessCols.some((c) => c.name === 'ended_at')
  if (!hasEndedAt) {
    db.exec('ALTER TABLE agent_sessions ADD COLUMN ended_at INTEGER')
    console.log('[db] migration: added ended_at to agent_sessions')
  }
  const stateCols = db.prepare("PRAGMA table_info('system_state')").all() as Array<{ name: string }>
  const hasPausedBoundary = stateCols.some((c) => c.name === 'paused_boundary')
  if (!hasPausedBoundary) {
    db.exec("ALTER TABLE system_state ADD COLUMN paused_boundary TEXT DEFAULT '{}'")
    console.log('[db] migration: added paused_boundary to system_state')
  }
  const hasPhase = stateCols.some((c) => c.name === 'phase')
  if (!hasPhase) {
    db.exec("ALTER TABLE system_state ADD COLUMN phase TEXT NOT NULL DEFAULT 'init'")
    console.log('[db] migration: added phase to system_state')
  }
  const hasFlow = stateCols.some((c) => c.name === 'flow')
  if (!hasFlow) {
    db.exec("ALTER TABLE system_state ADD COLUMN flow TEXT NOT NULL DEFAULT 'writing'")
    console.log('[db] migration: added flow to system_state')
  }
  const hasLifecycle = stateCols.some((c) => c.name === 'lifecycle')
  if (!hasLifecycle) {
    db.exec("ALTER TABLE system_state ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'idle'")
    console.log('[db] migration: added lifecycle to system_state')
  }
  const hasCurrentChapterNum = stateCols.some((c) => c.name === 'current_chapter')
  if (!hasCurrentChapterNum) {
    db.exec('ALTER TABLE system_state ADD COLUMN current_chapter INTEGER NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE system_state ADD COLUMN current_volume INTEGER NOT NULL DEFAULT 0')
    db.exec('ALTER TABLE system_state ADD COLUMN current_arc INTEGER NOT NULL DEFAULT 0')
    console.log('[db] migration: added current_chapter/volume/arc to system_state')
  }
  const hasPendingRewrites = stateCols.some((c) => c.name === 'pending_rewrites')
  if (!hasPendingRewrites) {
    db.exec("ALTER TABLE system_state ADD COLUMN pending_rewrites TEXT DEFAULT '[]'")
    db.exec("ALTER TABLE system_state ADD COLUMN foundation_missing TEXT DEFAULT '[]'")
    console.log('[db] migration: added pending_rewrites/foundation_missing to system_state')
  }
  const hasPendingSteer = stateCols.some((c) => c.name === 'pending_steer')
  if (!hasPendingSteer) {
    db.exec("ALTER TABLE system_state ADD COLUMN pending_steer TEXT DEFAULT ''")
    console.log('[db] migration: added pending_steer to system_state')
  }
}

export function initTestDb(): Database.Database {
  testMode = true
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')

  try {
    load(db)
  } catch {
    // sqlite-vec may not be available in test
  }

  db.exec(schema)
  runMigrations()
  return db
}

export function isTestMode(): boolean {
  return testMode
}

export function getTableCount(): number {
  if (!db) return 0
  const row = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table'")
    .get() as { c: number }
  return row.c
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
    testMode = false
  }
}
