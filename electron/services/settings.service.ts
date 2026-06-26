import { getDb } from '../db'
import { DEFAULT_RAG_PARAMS, type RagParams } from '@shared/types'

const KEY = 'rag_params'
const GLOBAL_GATE_RULES_KEY = 'global_gate_rules'

export interface GlobalGateRules {
  rules: string[]
  forbidden_phrases: string[]
}

export function getRagParams(): RagParams {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as
    | { value: string }
    | undefined
  if (!row) return { ...DEFAULT_RAG_PARAMS }
  try {
    return { ...DEFAULT_RAG_PARAMS, ...(JSON.parse(row.value) as Partial<RagParams>) }
  } catch {
    return { ...DEFAULT_RAG_PARAMS }
  }
}

export function setRagParams(params: RagParams): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(KEY, JSON.stringify(params))
}

export function getGlobalGateRules(): GlobalGateRules {
  const db = getDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(GLOBAL_GATE_RULES_KEY) as
    | { value: string }
    | undefined
  if (!row) return { rules: [], forbidden_phrases: [] }
  try {
    const parsed = JSON.parse(row.value) as Partial<GlobalGateRules>
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules.map(String) : [],
      forbidden_phrases: Array.isArray(parsed.forbidden_phrases) ? parsed.forbidden_phrases.map(String) : []
    }
  } catch {
    return { rules: [], forbidden_phrases: [] }
  }
}

export function setGlobalGateRules(input: GlobalGateRules): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(GLOBAL_GATE_RULES_KEY, JSON.stringify({
    rules: input.rules,
    forbidden_phrases: input.forbidden_phrases
  }))
}
