import { getDb } from '../db'
import { uuid } from '../lib/util'
import { encryptString, decryptString, isEncryptionAvailable } from '../lib/crypto'
import type { ApiProvider, ApiProviderInput } from '@shared/types'

type Row = {
  id: string
  provider: string
  base_url: string
  api_key_enc: Buffer | null
  llm_model: string
  embedding_model: string
  model_tier: 'flash' | 'pro' | null
  is_active: number
  is_embedding_active: number
}

function mapRow(r: Row): ApiProvider {
  return {
    id: r.id,
    provider: r.provider,
    base_url: r.base_url,
    llm_model: r.llm_model,
    embedding_model: r.embedding_model,
    model_tier: r.model_tier,
    is_active: r.is_active,
    is_embedding_active: r.is_embedding_active,
    has_key: !!r.api_key_enc
  }
}

export function list(): ApiProvider[] {
  const rows = getDb().prepare('SELECT * FROM api_configs ORDER BY is_active DESC').all() as Row[]
  return rows.map(mapRow)
}

export function getActive(): (ApiProvider & { apiKey: string }) | null {
  const r = getDb()
    .prepare('SELECT * FROM api_configs WHERE is_active = 1 LIMIT 1')
    .get() as Row | undefined
  if (!r) return null
  let apiKey = ''
  if (r.api_key_enc) {
    try {
      apiKey = decryptString(r.api_key_enc)
    } catch {
      apiKey = ''
    }
  }
  return { ...mapRow(r), apiKey }
}

export function getActiveEmbedding(): (ApiProvider & { apiKey: string }) | null {
  const r = getDb()
    .prepare('SELECT * FROM api_configs WHERE is_embedding_active = 1 LIMIT 1')
    .get() as Row | undefined
  if (!r) {
    return getActive()
  }
  let apiKey = ''
  if (r.api_key_enc) {
    try {
      apiKey = decryptString(r.api_key_enc)
    } catch {
      apiKey = ''
    }
  }
  return { ...mapRow(r), apiKey }
}

export function save(input: ApiProviderInput): ApiProvider {
  const db = getDb()
  const id = uuid()
  const keyBuf = input.api_key ? encryptString(input.api_key) : null
  db.prepare(
    `INSERT INTO api_configs (id, provider, base_url, api_key_enc, llm_model, embedding_model, model_tier, is_active, is_embedding_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.provider,
    input.base_url,
    keyBuf,
    input.llm_model,
    input.embedding_model,
    input.model_tier ?? (input.llm_model ? 'flash' : null),
    input.is_active ?? 0,
    input.is_embedding_active ?? 0
  )
  if (input.is_active) {
    db.prepare('UPDATE api_configs SET is_active = 0 WHERE id != ?').run(id)
  }
  if (input.is_embedding_active) {
    db.prepare('UPDATE api_configs SET is_embedding_active = 0 WHERE id != ?').run(id)
  }
  return mapRow(db.prepare('SELECT * FROM api_configs WHERE id = ?').get(id) as Row)
}

export function getProviderForTier(tier: 'flash' | 'pro'): (ApiProvider & { apiKey: string }) | null {
  const db = getDb()
  const row = db.prepare(
    `SELECT * FROM api_configs
     WHERE llm_model != '' AND model_tier = ?
     ORDER BY is_active DESC, rowid DESC
     LIMIT 1`
  ).get(tier) as Row | undefined
  if (!row) return getActive()
  let apiKey = ''
  if (row.api_key_enc) {
    try {
      apiKey = decryptString(row.api_key_enc)
    } catch {
      apiKey = ''
    }
  }
  return { ...mapRow(row), apiKey }
}

export function setActive(id: string): void {
  const db = getDb()
  db.prepare('UPDATE api_configs SET is_active = 0').run()
  db.prepare('UPDATE api_configs SET is_active = 1 WHERE id = ?').run(id)
}

export function setActiveEmbedding(id: string): void {
  const db = getDb()
  db.prepare('UPDATE api_configs SET is_embedding_active = 0').run()
  db.prepare('UPDATE api_configs SET is_embedding_active = 1 WHERE id = ?').run(id)
}

export function remove(id: string): void {
  getDb().prepare('DELETE FROM api_configs WHERE id = ?').run(id)
}

export function encryptionAvailable(): boolean {
  return isEncryptionAvailable()
}
