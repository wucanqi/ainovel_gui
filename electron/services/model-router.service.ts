import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { getActive, getProviderForTier } from './config.service'
import type { ModelRoutingRule, RoutingDecision, ModelTier } from '@shared/types'

type Row = {
  id: string
  project_id: string | null
  agent_type: string
  task_type: string
  risk_level: string
  preferred_tier: string
  auto_escalate: number
  created_at: number
}

function mapRow(r: Row): ModelRoutingRule {
  return {
    id: r.id,
    project_id: r.project_id,
    agent_type: r.agent_type,
    task_type: r.task_type,
    risk_level: r.risk_level as ModelRoutingRule['risk_level'],
    preferred_tier: r.preferred_tier as ModelTier,
    auto_escalate: r.auto_escalate === 1,
    created_at: r.created_at
  }
}

const DEFAULT_RULES: Array<{
  agent_type: string
  task_type: string
  risk_level: ModelRoutingRule['risk_level']
  preferred_tier: ModelTier
  auto_escalate: boolean
}> = [
  { agent_type: 'coordinator', task_type: 'any', risk_level: 'low', preferred_tier: 'flash', auto_escalate: false },
  { agent_type: 'writer', task_type: 'chapter_draft', risk_level: 'low', preferred_tier: 'flash', auto_escalate: true },
  { agent_type: 'writer', task_type: 'chapter_plan', risk_level: 'low', preferred_tier: 'flash', auto_escalate: true },
  { agent_type: 'architect', task_type: 'arc_outline', risk_level: 'high', preferred_tier: 'pro', auto_escalate: false },
  { agent_type: 'architect', task_type: 'chapter_contract', risk_level: 'high', preferred_tier: 'pro', auto_escalate: false },
  { agent_type: 'architect', task_type: 'knowledge_contract', risk_level: 'critical', preferred_tier: 'pro', auto_escalate: false },
  { agent_type: 'editor', task_type: 'consistency_check', risk_level: 'normal', preferred_tier: 'flash', auto_escalate: true },
  { agent_type: 'editor', task_type: 'chapter_summary', risk_level: 'low', preferred_tier: 'flash', auto_escalate: false },
  { agent_type: 'editor', task_type: 'arc_review', risk_level: 'high', preferred_tier: 'pro', auto_escalate: false },
  { agent_type: 'editor', task_type: 'volume_review', risk_level: 'high', preferred_tier: 'pro', auto_escalate: false },
  { agent_type: 'arbiter', task_type: 'arbitration', risk_level: 'critical', preferred_tier: 'pro', auto_escalate: false }
]

export function ensureDefaultRules(): void {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) AS c FROM model_routing_rules').get() as { c: number }).c
  if (count > 0) return
  const ts = now()
  const stmt = db.prepare(
    `INSERT INTO model_routing_rules (id, project_id, agent_type, task_type, risk_level, preferred_tier, auto_escalate, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`
  )
  for (const rule of DEFAULT_RULES) {
    stmt.run(uuid(), rule.agent_type, rule.task_type, rule.risk_level, rule.preferred_tier, rule.auto_escalate ? 1 : 0, ts)
  }
}

export function getRoutingRule(
  agentType: string,
  taskType: string,
  riskLevel?: string
): ModelRoutingRule | null {
  ensureDefaultRules()
  const db = getDb()

  if (riskLevel) {
    const row = db
      .prepare(
        `SELECT * FROM model_routing_rules
         WHERE agent_type = ? AND task_type = ? AND risk_level = ?
         AND (project_id IS NULL)
         LIMIT 1`
      )
      .get(agentType, taskType, riskLevel) as Row | undefined
    if (row) return mapRow(row)
  }

  const row = db
    .prepare(
      `SELECT * FROM model_routing_rules
       WHERE agent_type = ? AND task_type = ?
       AND (project_id IS NULL)
       ORDER BY risk_level DESC
       LIMIT 1`
    )
    .get(agentType, taskType) as Row | undefined
  if (row) return mapRow(row)

  const fallback = db
    .prepare(
      `SELECT * FROM model_routing_rules
       WHERE agent_type = ? AND task_type = 'any'
       AND (project_id IS NULL)
       LIMIT 1`
    )
    .get(agentType) as Row | undefined
  return fallback ? mapRow(fallback) : null
}

export function resolveModel(
  agentType: string,
  taskType: string,
  context?: { riskLevel?: string; forceTier?: ModelTier }
): RoutingDecision {
  const rule = getRoutingRule(agentType, taskType, context?.riskLevel)
  const tier = context?.forceTier || rule?.preferred_tier || 'flash'

  const provider = getProviderForTier(tier) || getActive()
  const model = provider?.llm_model || 'unknown'

  return {
    tier,
    model,
    provider_id: provider?.id ?? null,
    reason: rule
      ? `规则匹配: ${rule.agent_type}/${rule.task_type} → ${tier}`
      : `默认: ${tier}`,
    auto_escalate: rule?.auto_escalate ?? true
  }
}

export function shouldEscalate(context: {
  failCount: number
  violationType?: string
  chapterImportance?: 'normal' | 'climax' | 'volume_start' | 'volume_end' | 'major_twist'
  userMarked?: boolean
}): boolean {
  if (context.failCount >= 2) return true
  if (context.violationType === 'knowledge_leak') return true
  if (context.violationType === 'fact_lock_violation') return true
  if (context.violationType === 'identity_drift') return true
  if (context.chapterImportance && context.chapterImportance !== 'normal') return true
  if (context.userMarked) return true
  return false
}

export function setRoutingRule(input: {
  project_id?: string | null
  agent_type: string
  task_type: string
  risk_level: ModelRoutingRule['risk_level']
  preferred_tier: ModelTier
  auto_escalate: boolean
}): ModelRoutingRule {
  const db = getDb()
  const id = uuid()
  const ts = now()
  db.prepare(
    `INSERT INTO model_routing_rules (id, project_id, agent_type, task_type, risk_level, preferred_tier, auto_escalate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.project_id ?? null,
    input.agent_type,
    input.task_type,
    input.risk_level,
    input.preferred_tier,
    input.auto_escalate ? 1 : 0,
    ts
  )
  return mapRow(db.prepare('SELECT * FROM model_routing_rules WHERE id = ?').get(id) as Row)
}

export function listRoutingRules(projectId?: string): ModelRoutingRule[] {
  ensureDefaultRules()
  const db = getDb()
  const rows = projectId
    ? (db
        .prepare(
          `SELECT * FROM model_routing_rules
           WHERE project_id IS NULL OR project_id = ?
           ORDER BY agent_type, task_type`
        )
        .all(projectId) as Row[])
    : (db
        .prepare(
          `SELECT * FROM model_routing_rules
           WHERE project_id IS NULL
           ORDER BY agent_type, task_type`
        )
        .all() as Row[])
  return rows.map(mapRow)
}
