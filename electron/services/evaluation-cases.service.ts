import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import type { EvaluationCase } from '@shared/types'

type Row = {
  id: string
  name: string
  category: string
  setup_context: string
  expected_behavior: string
  forbidden_output_patterns: string
  pass_criteria: string
  fail_criteria: string
  recommended_gate: string
  enabled: number
  created_at: number
}

function mapRow(r: Row): EvaluationCase {
  return {
    id: r.id,
    name: r.name,
    category: r.category as EvaluationCase['category'],
    setup_context: JSON.parse(r.setup_context || '{}') as Record<string, unknown>,
    expected_behavior: r.expected_behavior,
    forbidden_output_patterns: JSON.parse(r.forbidden_output_patterns || '[]') as string[],
    pass_criteria: r.pass_criteria,
    fail_criteria: r.fail_criteria,
    recommended_gate: r.recommended_gate as EvaluationCase['recommended_gate'],
    enabled: r.enabled === 1,
    created_at: r.created_at
  }
}

const DEFAULT_CASES: Array<Omit<EvaluationCase, 'id' | 'created_at'>> = [
  {
    name: '男主未见面不得预感女主',
    category: 'knowledge_leak',
    setup_context: {
      pov_character: '男主（魂穿者）',
      known_facts: ['男主刚魂穿到原主身上', '原主和魂穿者都没见过女主'],
      unknown_facts: ['女主存在', '女主身份', '女主外貌']
    },
    expected_behavior: '男主不应出现任何关于女主的预感、直觉、宿命感、似曾相识',
    forbidden_output_patterns: ['预感.*女子', '冥冥之中', '似曾相识', '宿命', '命中注定', '莫名.*熟悉'],
    pass_criteria: '全文无任何关于未见女子的预感/宿命/熟悉感描写',
    fail_criteria: '出现预感、宿命感、似曾相识、梦中预见等越权描写',
    recommended_gate: 'draft_gate',
    enabled: true
  },
  {
    name: '原主秘密不得被魂穿者继承',
    category: 'knowledge_leak',
    setup_context: {
      pov_character: '魂穿者',
      known_facts: ['魂穿者自己的记忆'],
      unknown_facts: ['原主的秘密', '原主隐藏的身份']
    },
    expected_behavior: '魂穿者不应知道原主的秘密，除非通过剧情事件获取',
    forbidden_output_patterns: ['突然想起', '记忆中.*原主.*秘密', '本能.*知道'],
    pass_criteria: '魂穿者不表现出对原主秘密的知晓',
    fail_criteria: '魂穿者无剧情事件支撑却知道原主秘密',
    recommended_gate: 'knowledge_check',
    enabled: true
  },
  {
    name: '角色职业不可漂移',
    category: 'fact_drift',
    setup_context: {
      character: '林岚',
      fact_key: 'occupation',
      fact_value: '市局法医',
      lock_level: 'event_required'
    },
    expected_behavior: '林岚的职业始终为法医，不得写成医生/记者/警察/学生',
    forbidden_output_patterns: ['林岚.*医生', '林岚.*记者', '林岚.*警察', '林岚.*学生', '林岚.*职员'],
    pass_criteria: '全文职业描述与锁定值一致',
    fail_criteria: '出现与锁定职业不符的描述',
    recommended_gate: 'draft_gate',
    enabled: true
  },
  {
    name: '已死亡角色不得无解释登场',
    category: 'fact_drift',
    setup_context: {
      character: '已死亡角色',
      fact_key: 'alive',
      fact_value: 'false'
    },
    expected_behavior: '已死亡角色不得无复活剧情而登场',
    forbidden_output_patterns: ['已死角色.*说话', '已死角色.*出现', '已死角色.*行动'],
    pass_criteria: '已死亡角色不登场，或有明确复活剧情',
    fail_criteria: '已死亡角色无解释登场',
    recommended_gate: 'draft_gate',
    enabled: true
  },
  {
    name: '未授权道具不得凭空出现',
    category: 'world_rule',
    setup_context: {
      scene: '角色在荒野',
      inventory: ['水壶', '打火机']
    },
    expected_behavior: '角色不得使用不在持有物品列表中的道具',
    forbidden_output_patterns: ['突然.*拿出.*手机', '从口袋.*掏出.*枪'],
    pass_criteria: '使用的道具均在持有列表中或有获取剧情',
    fail_criteria: '凭空出现未持有的道具',
    recommended_gate: 'draft_gate',
    enabled: true
  },
  {
    name: '未到回收章节的伏笔不得提前解释',
    category: 'foreshadow_violation',
    setup_context: {
      foreshadow_id: 'fs_001',
      status: 'planted',
      payoff_chapter: '第50章'
    },
    expected_behavior: '伏笔在回收章节前不得被提前解释或揭示答案',
    forbidden_output_patterns: ['原来.*伏笔.*意思是', '其实.*伏笔.*就是'],
    pass_criteria: '伏笔未被提前解释',
    fail_criteria: '伏笔在回收章节前被解释',
    recommended_gate: 'draft_gate',
    enabled: true
  },
  {
    name: '世界规则限制不能被爽点打破',
    category: 'world_rule',
    setup_context: {
      rule: '修炼者不可飞行，除非达到金丹境',
      character_level: '筑基境'
    },
    expected_behavior: '筑境角色不得飞行',
    forbidden_output_patterns: ['腾空而起', '飞上天空', '凌空飞行'],
    pass_criteria: '角色行为符合世界规则限制',
    fail_criteria: '角色突破世界规则限制而无解释',
    recommended_gate: 'draft_gate',
    enabled: true
  },
  {
    name: '关系未升级前不得使用恋人式称呼',
    category: 'relationship',
    setup_context: {
      character_a: '男主',
      character_b: '女主',
      relationship_type: '陌生人',
      intensity: 1
    },
    expected_behavior: '关系为陌生人时不得使用恋人式称呼',
    forbidden_output_patterns: ['亲爱的', '宝贝', '老婆', '老公', '心肝'],
    pass_criteria: '称呼与关系等级匹配',
    fail_criteria: '关系未升级却使用恋人称呼',
    recommended_gate: 'draft_gate',
    enabled: true
  },
  {
    name: '角色地理位置不得瞬移',
    category: 'timeline',
    setup_context: {
      character: '主角',
      location_a: '京城',
      location_b: '边关',
      travel_time: '三天'
    },
    expected_behavior: '角色从京城到边关需要三天，不得瞬间到达',
    forbidden_output_patterns: ['转眼.*到了.*边关', '瞬间.*出现在.*边关'],
    pass_criteria: '地理位置变化有合理的时间/交通描述',
    fail_criteria: '角色无解释瞬移到远处',
    recommended_gate: 'draft_gate',
    enabled: true
  },
  {
    name: '角色不可知道作者层未来剧情',
    category: 'knowledge_leak',
    setup_context: {
      pov_character: '任意角色',
      author_only_facts: ['未来三章会发生地震', '最终BOSS是某配角']
    },
    expected_behavior: '角色不得表现出对作者层未来剧情的知晓',
    forbidden_output_patterns: ['总觉得.*要发生.*大事', '预感.*灾难', '直觉.*有人.*背叛'],
    pass_criteria: '角色不表现出对未来剧情的预知',
    fail_criteria: '角色无依据地预知未来剧情',
    recommended_gate: 'knowledge_check',
    enabled: true
  }
]

export function ensureDefaultCases(): void {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) AS c FROM evaluation_cases').get() as { c: number }).c
  if (count > 0) return
  const ts = now()
  const stmt = db.prepare(
    `INSERT INTO evaluation_cases
     (id, name, category, setup_context, expected_behavior, forbidden_output_patterns,
      pass_criteria, fail_criteria, recommended_gate, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const c of DEFAULT_CASES) {
    stmt.run(
      uuid(),
      c.name,
      c.category,
      JSON.stringify(c.setup_context),
      c.expected_behavior,
      JSON.stringify(c.forbidden_output_patterns),
      c.pass_criteria,
      c.fail_criteria,
      c.recommended_gate,
      c.enabled ? 1 : 0,
      ts
    )
  }
}

export function getEvaluationCases(): EvaluationCase[] {
  ensureDefaultCases()
  const rows = getDb()
    .prepare('SELECT * FROM evaluation_cases ORDER BY category, name')
    .all() as Row[]
  return rows.map(mapRow)
}

export function createEvaluationCase(input: Omit<EvaluationCase, 'id' | 'created_at'>): EvaluationCase {
  const db = getDb()
  const id = uuid()
  const ts = now()
  db.prepare(
    `INSERT INTO evaluation_cases
     (id, name, category, setup_context, expected_behavior, forbidden_output_patterns,
      pass_criteria, fail_criteria, recommended_gate, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.category,
    JSON.stringify(input.setup_context),
    input.expected_behavior,
    JSON.stringify(input.forbidden_output_patterns),
    input.pass_criteria,
    input.fail_criteria,
    input.recommended_gate,
    input.enabled ? 1 : 0,
    ts
  )
  return mapRow(db.prepare('SELECT * FROM evaluation_cases WHERE id = ?').get(id) as Row)
}

export function updateEvaluationCase(id: string, patch: Partial<EvaluationCase>): void {
  const db = getDb()
  const cur = db.prepare('SELECT * FROM evaluation_cases WHERE id = ?').get(id) as Row | undefined
  if (!cur) throw new Error('EvaluationCase not found')
  db.prepare(
    `UPDATE evaluation_cases
     SET name = ?, category = ?, setup_context = ?, expected_behavior = ?,
         forbidden_output_patterns = ?, pass_criteria = ?, fail_criteria = ?,
         recommended_gate = ?, enabled = ?
     WHERE id = ?`
  ).run(
    patch.name ?? cur.name,
    patch.category ?? cur.category,
    JSON.stringify(patch.setup_context ?? JSON.parse(cur.setup_context || '{}')),
    patch.expected_behavior ?? cur.expected_behavior,
    JSON.stringify(patch.forbidden_output_patterns ?? JSON.parse(cur.forbidden_output_patterns || '[]')),
    patch.pass_criteria ?? cur.pass_criteria,
    patch.fail_criteria ?? cur.fail_criteria,
    patch.recommended_gate ?? cur.recommended_gate,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : cur.enabled,
    id
  )
}

export function deleteEvaluationCase(id: string): void {
  getDb().prepare('DELETE FROM evaluation_cases WHERE id = ?').run(id)
}
