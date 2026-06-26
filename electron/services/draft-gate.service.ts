import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { chatLLM } from './ai.service'
import { getDraft, getLatestDraft } from './draft.service'
import { getChapterContract, getKnowledgeContract } from './contract.service'
import { getLocks } from './fact-lock.service'
import { getGlobalGateRules } from './settings.service'
import type {
  ChapterDraft,
  ChapterContract,
  KnowledgeContract,
  CharacterFactLock,
  GateCheckResult,
  GateViolation,
  GateVerdictType,
  DraftGateReport,
  DraftGateVerdict,
  GateCheckType,
  GateSeverity
} from '@shared/types'

export interface GateVerdict {
  verdict: GateVerdictType
  overall_passed: boolean
  fail_count: number
  critical_count: number
  summary: string
  recommended_model: string
  reports: GateCheckResult[]
}

const INFERENCE_PATTERNS: Record<string, RegExp> = {
  premonition: /预感|直觉告诉|冥冥之中|似乎.{0,10}预示/,
  dejavu: /似曾相识|熟悉感|好像.{0,10}见过|莫名的熟悉|莫名熟悉/,
  destiny: /宿命|命中注定|缘分|天意|冥冥中注定/,
  dream_foreshadow: /梦中.{0,20}出现|梦里.{0,20}预见/,
  unknown_person_familiarity: /从未见过.{0,20}却.{0,10}熟悉|陌生.{0,10}却.{0,10}亲切/
}

const INFERENCE_KEYWORD_MAP: Record<string, string[]> = {
  premonition: ['预感', '直觉', '冥冥', '预示'],
  dejavu: ['似曾相识', '熟悉感', '莫名熟悉', '见过'],
  destiny: ['宿命', '命中注定', '缘分', '天意', '冥冥中注定'],
  dream_foreshadow: ['梦中', '梦里', '预见'],
  unknown_person_familiarity: ['从未见过', '陌生', '亲切']
}

const OCCUPATION_SYNONYMS: Record<string, string[]> = {
  法医: ['医生', '记者', '警察', '学生', '职员', '护士', '侦探', '律师'],
  医生: ['法医', '护士', '记者', '警察', '学生'],
  记者: ['法医', '医生', '警察', '编辑', '学生'],
  警察: ['法医', '医生', '记者', '军人', '保安'],
  侦探: ['警察', '法医', '记者', '律师'],
  律师: ['法务', '检察官', '法官', '记者'],
  教师: ['学生', '职员', '医生'],
  学生: ['教师', '职员', '医生']
}

const ANTI_AI_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: '不是…而是…', pattern: /不是[\s\S]{0,20}而是/g },
  { label: '所谓的', pattern: /所谓的/g },
  { label: '某种程度上', pattern: /某种程度上/g },
  { label: '仿佛', pattern: /仿佛/g },
  { label: '不禁', pattern: /不禁/g }
]

function maxSeverity(violations: GateViolation[]): GateSeverity {
  if (violations.some((v) => v.severity === 'critical')) return 'critical'
  if (violations.some((v) => v.severity === 'error')) return 'error'
  if (violations.some((v) => v.severity === 'warning')) return 'warning'
  return 'info'
}

function buildResult(
  checkType: GateCheckType,
  violations: GateViolation[]
): GateCheckResult {
  const critical = violations.filter((v) => v.severity === 'critical')
  return {
    check_type: checkType,
    passed: critical.length === 0 && violations.filter((v) => v.severity === 'error').length === 0,
    violations,
    severity: maxSeverity(violations)
  }
}

function extractKeywords(text: string): string[] {
  if (!text) return []
  const cleaned = text.replace(/[，。！？、；：""''《》（）\s\n\r\t,.!?;:"'()]/g, ' ')
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2)
  const cjkChunks = (text.match(/[\u4e00-\u9fff]{2,}/g) || []) as string[]
  const set = new Set<string>([...tokens, ...cjkChunks])
  return Array.from(set)
}

function valuesMatch(claimed: string, expected: string): boolean {
  if (!claimed || !expected) return true
  const a = claimed.trim()
  const b = expected.trim()
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  return false
}

export async function checkConsistency(draft: ChapterDraft): Promise<GateCheckResult> {
  const violations: GateViolation[] = []

  if (draft.word_count < 100) {
    violations.push({
      type: 'word_count_too_low',
      severity: 'warning',
      detail: `草稿字数过少（${draft.word_count} 字），可能内容不完整`
    })
  }

  const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])
  const openTags = (draft.content.match(/<(\w+)(?:\s[^>]*)?(?<!\/)>/g) || [])
    .filter((tag) => !VOID_ELEMENTS.has(tag.match(/<(\w+)/)?.[1]?.toLowerCase() ?? ''))
    .length
  const closeTags = (draft.content.match(/<\/(\w+)>/g) || []).length
  if (openTags !== closeTags) {
    violations.push({
      type: 'unclosed_html_tags',
      severity: 'warning',
      detail: `HTML 标签未闭合（开标签 ${openTags}，闭标签 ${closeTags}）`
    })
  }

  return buildResult('consistency', violations)
}

export async function checkContract(
  draft: ChapterDraft,
  contract: ChapterContract | null
): Promise<GateCheckResult> {
  if (!contract) {
    return buildResult('contract', [])
  }
  const violations: GateViolation[] = []
  const plainText = draft.plain_text
  const lowerPlain = plainText.toLowerCase()

  let missingBeats = 0
  for (const beat of contract.required_beats) {
    const keywords = extractKeywords(beat)
    const matched = keywords.some((kw) => plainText.includes(kw))
    if (!matched) {
      missingBeats++
      violations.push({
        type: 'missing_beat',
        severity: 'error',
        detail: `缺失必要剧情节拍：${beat}`
      })
    }
  }

  if (
    contract.required_beats.length > 0 &&
    missingBeats === contract.required_beats.length
  ) {
    for (const v of violations) {
      v.severity = 'critical'
    }
  }

  for (const move of contract.forbidden_moves) {
    const keywords = extractKeywords(move)
    const matched = keywords.some((kw) => plainText.includes(kw))
    if (matched) {
      violations.push({
        type: 'forbidden_move',
        severity: 'critical',
        detail: `触犯禁止剧情动作：${move}`,
        evidence: move
      })
    }
  }

  if (contract.hook_goal) {
    const tail = plainText.slice(-500)
    const hookKeywords = extractKeywords(contract.hook_goal)
    const hookMatched = hookKeywords.some((kw) => tail.includes(kw))
    if (!hookMatched) {
      violations.push({
        type: 'hook_not_realized',
        severity: 'error',
        detail: `章末钩子目标未在末尾体现：${contract.hook_goal}`
      })
    }
  }

  void lowerPlain
  return buildResult('contract', violations)
}

export async function checkKnowledgeBoundary(
  draft: ChapterDraft,
  contract: KnowledgeContract | null
): Promise<GateCheckResult> {
  if (!contract) {
    return buildResult('knowledge', [])
  }
  const violations: GateViolation[] = []
  const plainText = draft.plain_text

  for (const inference of contract.forbidden_inferences) {
    const lower = inference.toLowerCase()
    let matchedPattern: string | null = null
    for (const [key, pattern] of Object.entries(INFERENCE_PATTERNS)) {
      const keywords = INFERENCE_KEYWORD_MAP[key] || []
      const inferenceRelated =
        keywords.some((kw) => inference.includes(kw)) ||
        lower.includes(key) ||
        inference.includes(key)
      if (inferenceRelated && pattern.test(plainText)) {
        matchedPattern = key
        break
      }
    }
    if (matchedPattern) {
      const match = plainText.match(INFERENCE_PATTERNS[matchedPattern])
      violations.push({
        type: 'forbidden_inference',
        severity: 'critical',
        detail: `检测到禁止的推断模式（${inference}）`,
        evidence: match ? match[0] : undefined
      })
    }
  }

  for (const fact of contract.author_only_facts) {
    if (fact && plainText.includes(fact)) {
      violations.push({
        type: 'author_knowledge_leak',
        severity: 'critical',
        detail: `作者层信息被泄露：${fact}`,
        evidence: fact
      })
    }
  }

  return buildResult('knowledge', violations)
}

export async function checkFactLocks(
  draft: ChapterDraft,
  projectId: string
): Promise<GateCheckResult> {
  const violations: GateViolation[] = []
  const plainText = draft.plain_text

  let locks: CharacterFactLock[] = []
  try {
    locks = getLocks(projectId)
  } catch {
    const rows = getDb()
      .prepare('SELECT * FROM character_fact_locks WHERE project_id = ?')
      .all(projectId) as Array<{
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
    }>
    locks = rows.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      character_id: r.character_id,
      fact_key: r.fact_key,
      fact_value: r.fact_value,
      lock_level: r.lock_level as CharacterFactLock['lock_level'],
      change_requires_event: !!r.change_requires_event,
      allowed_change_events: JSON.parse(r.allowed_change_events || '[]') as string[],
      last_verified_chapter_id: r.last_verified_chapter_id,
      created_at: r.created_at,
      updated_at: r.updated_at
    }))
  }

  for (const lock of locks) {
    if (lock.lock_level !== 'immutable') continue

    const expected = lock.fact_value
    if (plainText.includes(expected)) continue

    if (lock.fact_key === 'occupation' || lock.fact_key === 'identity') {
      const synonyms = OCCUPATION_SYNONYMS[expected] || []
      const drifted = synonyms.find((syn) => plainText.includes(syn))
      if (drifted) {
        violations.push({
          type: 'fact_drift',
          severity: 'critical',
          detail: `${lock.fact_key} 事实锁漂移：应为"${expected}"，但文本中出现"${drifted}"`,
          evidence: drifted
        })
      }
    } else {
      if (plainText.length > 0) {
        const keywords = extractKeywords(expected)
        const hasRelated = keywords.some((kw) => plainText.includes(kw))
        if (hasRelated && !plainText.includes(expected)) {
          violations.push({
            type: 'fact_drift',
            severity: 'critical',
            detail: `${lock.fact_key} 事实锁可能漂移：锁定值为"${expected}"，但文本中未找到精确匹配`,
            evidence: expected
          })
        }
      }
    }
  }

  return buildResult('fact_lock', violations)
}

export async function checkForeshadowWhitelist(
  draft: ChapterDraft,
  contract: ChapterContract | null
): Promise<GateCheckResult> {
  if (!contract) {
    return buildResult('foreshadow', [])
  }
  const violations: GateViolation[] = []
  const plainText = draft.plain_text
  const allowedIds = new Set(contract.allowed_foreshadow_ids)

  const rows = getDb()
    .prepare('SELECT id, name FROM foreshadowing_ledger WHERE project_id = ?')
    .all(draft.project_id) as Array<{ id: string; name: string }>

  for (const fs of rows) {
    if (plainText.includes(fs.name) && !allowedIds.has(fs.id)) {
      violations.push({
        type: 'unauthorized_foreshadow',
        severity: 'error',
        detail: `未授权伏笔/暗示出现：${fs.name}`,
        evidence: fs.name
      })
    }
  }

  return buildResult('foreshadow', violations)
}

export async function checkTimeline(draft: ChapterDraft): Promise<GateCheckResult> {
  const violations: GateViolation[] = []
  const plainText = draft.plain_text

  const timeWords = {
    past: ['昨天', '前天', '刚才', '之前', '此前', '曾经', '过去'],
    future: ['明天', '后天', '即将', '之后', '此后', '将来', '未来'],
    relative_past: ['三天前', '几天前', '上周', '上个月', '去年'],
    relative_future: ['三天后', '几天后', '下周', '下个月', '明年']
  }

  const paragraphs = plainText.split(/\n+/).filter((p) => p.trim().length > 0)
  for (let i = 0; i < paragraphs.length - 1; i++) {
    const cur = paragraphs[i]
    const next = paragraphs[i + 1]
    const curHasFuture = [...timeWords.future, ...timeWords.relative_future].some((w) =>
      cur.includes(w)
    )
    const nextHasPast = [...timeWords.past, ...timeWords.relative_past].some((w) =>
      next.includes(w)
    )
    const curHasPast = [...timeWords.past, ...timeWords.relative_past].some((w) =>
      cur.includes(w)
    )
    const nextHasFuture = [...timeWords.future, ...timeWords.relative_future].some((w) =>
      next.includes(w)
    )

    if ((curHasFuture && nextHasPast) || (curHasPast && nextHasFuture)) {
      violations.push({
        type: 'timeline_contradiction',
        severity: 'warning',
        detail: '相邻段落时间描述可能存在矛盾（过去/未来混用）',
        evidence: `${cur.slice(0, 50)}... | ${next.slice(0, 50)}...`
      })
      break
    }
  }

  return buildResult('timeline', violations)
}

export async function checkWorldRules(
  draft: ChapterDraft,
  projectId: string
): Promise<GateCheckResult> {
  const violations: GateViolation[] = []
  const plainText = draft.plain_text

  const rows = getDb()
    .prepare('SELECT name, description, implications FROM world_rules WHERE project_id = ?')
    .all(projectId) as Array<{ name: string; description: string; implications: string }>

  for (const rule of rows) {
    const keywords = extractKeywords(rule.name)
    const descKeywords = extractKeywords(rule.description)
    const allKeywords = Array.from(new Set([...keywords, ...descKeywords])).filter(
      (k) => k.length >= 2
    )

    const mentioned = allKeywords.some((kw) => plainText.includes(kw))
    if (mentioned && rule.implications) {
      const implKeywords = extractKeywords(rule.implications).filter((k) => k.length >= 2)
      const violated = implKeywords.some((kw) => {
        const negated = new RegExp(`(不|禁|不可|不能|无法|禁止).{0,10}${kw}`)
        return negated.test(plainText)
      })
      if (violated) {
        violations.push({
          type: 'world_rule_violation',
          severity: 'error',
          detail: `可能违反世界规则：${rule.name}`,
          evidence: rule.implications
        })
      }
    }
  }

  return buildResult('world_rule', violations)
}

export async function checkGlobalRules(draft: ChapterDraft): Promise<GateCheckResult> {
  const violations: GateViolation[] = []
  const plainText = draft.plain_text
  const globalRules = getGlobalGateRules()

  for (const phrase of globalRules.forbidden_phrases) {
    const normalized = phrase.trim()
    if (!normalized) continue
    if (plainText.includes(normalized)) {
      violations.push({
        type: 'global_forbidden_phrase',
        severity: 'error',
        detail: `命中全局禁用短语：${normalized}`,
        evidence: normalized
      })
    }
  }

  const needAntiAiCheck = globalRules.rules.some((rule) => /反ai|反AI|ai味|AI味/.test(rule))
  if (needAntiAiCheck) {
    for (const item of ANTI_AI_PATTERNS) {
      const matched = plainText.match(item.pattern)
      if (matched?.length) {
        violations.push({
          type: 'anti_ai_style',
          severity: 'warning',
          detail: `命中反 AI 味审查模式：${item.label}`,
          evidence: matched[0]
        })
      }
    }
  }

  for (const rule of globalRules.rules) {
    const normalized = rule.trim()
    if (!normalized) continue
    if (/禁止使用/.test(normalized)) {
      const phrase = normalized.replace(/^.*禁止使用[:：]?\s*/, '').trim()
      if (phrase && plainText.includes(phrase)) {
        violations.push({
          type: 'global_rule_violation',
          severity: 'error',
          detail: `违反全局审核规则：${normalized}`,
          evidence: phrase
        })
      }
    }
  }

  return buildResult('consistency', violations)
}

export function determineVerdict(reports: GateCheckResult[]): GateVerdictType {
  const allPassed = reports.every((r) => r.passed)
  if (allPassed) return 'pass'

  const criticalViolations = reports.flatMap((r) =>
    r.violations.filter((v) => v.severity === 'critical')
  )
  const criticalCount = criticalViolations.length

  const contractReport = reports.find((r) => r.check_type === 'contract')
  if (contractReport) {
    const missingBeats = contractReport.violations.filter(
      (v) => v.type === 'missing_beat' && v.severity === 'critical'
    )
    const totalBeats = contractReport.violations.filter(
      (v) => v.type === 'missing_beat'
    ).length
    if (totalBeats > 0 && missingBeats.length === totalBeats) {
      return 'replan'
    }
  }

  const knowledgeReport = reports.find((r) => r.check_type === 'knowledge')
  const factLockReport = reports.find((r) => r.check_type === 'fact_lock')
  const hasKnowledgeCritical =
    !!knowledgeReport &&
    knowledgeReport.violations.some((v) => v.severity === 'critical')
  const hasFactLockCritical =
    !!factLockReport && factLockReport.violations.some((v) => v.severity === 'critical')

  if (criticalCount > 0 && (criticalCount > 2 || hasKnowledgeCritical || hasFactLockCritical)) {
    return 'escalate'
  }

  if (criticalCount > 0 && criticalCount <= 2) {
    return 'rewrite'
  }

  const hasError = reports.some((r) =>
    r.violations.some((v) => v.severity === 'error')
  )
  if (hasError) return 'polish'

  return 'pass'
}

export function saveGateReports(
  draftId: string,
  projectId: string,
  chapterId: string,
  reports: GateCheckResult[]
): void {
  const db = getDb()
  const ts = now()
  const stmt = db.prepare(
    `INSERT INTO draft_gate_reports
     (id, project_id, draft_id, chapter_id, check_type, passed, violations, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const tx = db.transaction((items: GateCheckResult[]) => {
    for (const r of items) {
      stmt.run(
        uuid(),
        projectId,
        draftId,
        chapterId,
        r.check_type,
        r.passed ? 1 : 0,
        JSON.stringify(r.violations),
        r.severity,
        ts
      )
    }
  })
  tx(reports)
}

export function saveGateVerdict(
  draftId: string,
  projectId: string,
  chapterId: string,
  verdict: GateVerdict
): void {
  getDb()
    .prepare(
      `INSERT INTO draft_gate_verdicts
       (id, project_id, draft_id, chapter_id, verdict, overall_passed, fail_count, critical_count, summary, recommended_model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      uuid(),
      projectId,
      draftId,
      chapterId,
      verdict.verdict,
      verdict.overall_passed ? 1 : 0,
      verdict.fail_count,
      verdict.critical_count,
      verdict.summary,
      verdict.recommended_model,
      now()
    )
}

export async function runDraftGate(draftId: string): Promise<GateVerdict> {
  const draft = getDraft(draftId)
  if (!draft) throw new Error('Draft not found')

  const chapterContract = getChapterContract(draft.project_id, draft.chapter_id)
  const knowledgeContract = getKnowledgeContract(draft.project_id, draft.chapter_id)

  const [
    consistencyResult,
    contractResult,
    knowledgeResult,
    factLockResult,
    foreshadowResult,
    timelineResult,
    worldRuleResult,
    globalRuleResult
  ] = await Promise.all([
    checkConsistency(draft),
    checkContract(draft, chapterContract),
    checkKnowledgeBoundary(draft, knowledgeContract),
    checkFactLocks(draft, draft.project_id),
    checkForeshadowWhitelist(draft, chapterContract),
    checkTimeline(draft),
    checkWorldRules(draft, draft.project_id),
    checkGlobalRules(draft)
  ])

  const reports: GateCheckResult[] = [
    consistencyResult,
    contractResult,
    knowledgeResult,
    factLockResult,
    foreshadowResult,
    timelineResult,
    worldRuleResult,
    globalRuleResult
  ]

  const verdictType = determineVerdict(reports)
  const criticalCount = reports.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.severity === 'critical').length,
    0
  )
  const failCount = reports.filter((r) => !r.passed).length
  const overallPassed = reports.every((r) => r.passed)

  const summaryParts: string[] = []
  for (const r of reports) {
    if (!r.passed) {
      const count = r.violations.length
      summaryParts.push(`${r.check_type}(${count}项违规)`)
    }
  }
  const summary = overallPassed
    ? '全部门禁检查通过'
    : `门禁未通过：${summaryParts.join('、')}；共 ${criticalCount} 个 critical 违规`

  const recommendedModel =
    verdictType === 'escalate' ? 'pro' : verdictType === 'rewrite' ? 'pro' : 'flash'

  const verdict: GateVerdict = {
    verdict: verdictType,
    overall_passed: overallPassed,
    fail_count: failCount,
    critical_count: criticalCount,
    summary,
    recommended_model: recommendedModel,
    reports
  }

  saveGateReports(draftId, draft.project_id, draft.chapter_id, reports)
  saveGateVerdict(draftId, draft.project_id, draft.chapter_id, verdict)

  void chatLLM
  void getLatestDraft
  return verdict
}

type ChapterPlanRow = {
  id: string
  chapter_id: string
  plan_content: string
  scenes: string
  pacing: string
  pov: string
}

function getLatestChapterPlan(chapterId: string): ChapterPlanRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM chapter_plans
       WHERE chapter_id = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT 1`
    )
    .get(chapterId) as ChapterPlanRow | undefined
  return row ?? null
}

function planTextFromRow(plan: ChapterPlanRow): string {
  const scenes = typeof plan.scenes === 'string' ? plan.scenes : ''
  return [plan.plan_content, scenes, plan.pacing, plan.pov].filter(Boolean).join('\n')
}

export async function runPlanGate(projectId: string, chapterId: string): Promise<GateVerdict> {
  const plan = getLatestChapterPlan(chapterId)
  if (!plan) {
    return {
      verdict: 'replan',
      overall_passed: false,
      fail_count: 1,
      critical_count: 1,
      summary: '未找到章节计划，无法通过 Plan Gate',
      recommended_model: 'flash',
      reports: [
        {
          check_type: 'contract',
          passed: false,
          severity: 'critical',
          violations: [{
            type: 'missing_chapter_plan',
            severity: 'critical',
            detail: '未找到章节计划，Writer 需要先生成 chapter_plan'
          }]
        }
      ]
    }
  }

  const planText = planTextFromRow(plan)
  const chapterContract = getChapterContract(projectId, chapterId)
  const knowledgeContract = getKnowledgeContract(projectId, chapterId)
  const fakeDraft: ChapterDraft = {
    id: `plan:${plan.id}`,
    project_id: projectId,
    chapter_id: chapterId,
    version: 0,
    content: planText,
    plain_text: planText,
    word_count: planText.length,
    lifecycle: 'plan_checked',
    model_used: 'plan-gate',
    generated_at: now(),
    committed_at: null
  }

  const [contractResult, knowledgeResult, factLockResult, foreshadowResult, globalRuleResult] = await Promise.all([
    checkContract(fakeDraft, chapterContract),
    checkKnowledgeBoundary(fakeDraft, knowledgeContract),
    checkFactLocks(fakeDraft, projectId),
    checkForeshadowWhitelist(fakeDraft, chapterContract),
    checkGlobalRules(fakeDraft)
  ])

  const reports = [contractResult, knowledgeResult, factLockResult, foreshadowResult, globalRuleResult]
  const verdictType = determineVerdict(reports)
  const criticalCount = reports.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.severity === 'critical').length,
    0
  )
  const failCount = reports.filter((r) => !r.passed).length
  const overallPassed = reports.every((r) => r.passed)

  return {
    verdict: verdictType,
    overall_passed: overallPassed,
    fail_count: failCount,
    critical_count: criticalCount,
    summary: overallPassed
      ? 'Plan Gate 通过，允许进入正文写作'
      : `Plan Gate 未通过：${reports.filter((r) => !r.passed).map((r) => r.check_type).join('、')}`,
    recommended_model: verdictType === 'escalate' ? 'pro' : 'flash',
    reports
  }
}
