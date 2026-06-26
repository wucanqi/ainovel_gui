import type { RouteState, Instruction, Phase, Flow } from '@shared/types'
import { getDb } from '../db'

// ── Foundation check helpers ──

function hasStoryCompass(projectId: string): boolean {
  return !!getDb().prepare('SELECT id FROM story_compass WHERE project_id = ?').get(projectId)
}
function hasCharacters(projectId: string): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM characters WHERE project_id = ?').get(projectId) as { c: number }
  return r.c > 0
}
function hasCharacterArcs(projectId: string): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM character_arcs WHERE project_id = ?').get(projectId) as { c: number }
  return r.c > 0
}
function hasWorldRules(projectId: string): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM world_rules WHERE project_id = ?').get(projectId) as { c: number }
  return r.c > 0
}
function hasVolumeArcs(projectId: string): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM volume_arcs WHERE project_id = ?').get(projectId) as { c: number }
  return r.c > 0
}
function hasArcOutlines(projectId: string): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM arc_outlines WHERE project_id = ?').get(projectId) as { c: number }
  return r.c > 0
}
function hasArcChapterPlans(projectId: string): boolean {
  const r = getDb().prepare(
    "SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id IN (SELECT id FROM volume_arcs WHERE project_id = ?)"
  ).get(projectId) as { c: number }
  return r.c > 0
}
function hasForeshadowing(projectId: string): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM foreshadowing_ledger WHERE project_id = ?').get(projectId) as { c: number }
  return r.c > 0
}

function hasChapterContracts(projectId: string): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM chapter_contracts WHERE project_id = ?').get(projectId) as { c: number }
  return r.c > 0
}

function hasKnowledgeContracts(projectId: string): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS c FROM knowledge_contracts WHERE project_id = ?').get(projectId) as { c: number }
  return r.c > 0
}

// ── LoadState ──

export function LoadState(projectId: string): RouteState {
  const db = getDb()
  const raw = db.prepare(
    'SELECT phase, flow, current_chapter, pending_rewrites, foundation_missing FROM system_state WHERE project_id = ?'
  ).get(projectId) as Record<string, unknown> | undefined

  const phase = (raw?.phase as Phase) ?? 'init'
  const flow = (raw?.flow as Flow) ?? 'writing'
  const currentChapter = (raw?.current_chapter as number) ?? 0
  const pendingRewrites = parseNumberArray(raw?.pending_rewrites as string)
  const foundationMissing = detectFoundationMissing(projectId)

  const completedRows = db.prepare(
    'SELECT sort_order FROM chapters WHERE project_id = ? AND status = ? ORDER BY sort_order ASC'
  ).all(projectId, 'done') as Array<{ sort_order: number }>
  const completedChapters = completedRows.map(r => r.sort_order)
  const lastCompleted = completedChapters.length > 0 ? completedChapters[completedChapters.length - 1] : 0

  const planCount = (db.prepare(
    `SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id IN (SELECT id FROM volume_arcs WHERE project_id = ?)`
  ).get(projectId) as { c: number }).c
  const totalPlanned = planCount > 0 ? planCount : completedChapters.length

  const nextCh = findNextChapter(projectId, completedChapters)
  const nextChapterInfo = getNextChapterInfo(projectId, nextCh)
  const chapterReadiness = buildChapterReadiness(projectId, nextChapterInfo?.id ?? null, nextCh, nextChapterInfo?.title ?? null)
  const arcBoundary = lastCompleted > 0 ? detectArcBoundary(projectId) : null

  let hasArcReview = false; let hasArcSummary = false; let hasVolumeSummary = false
  if (arcBoundary?.isArcEnd) {
    hasArcReview = !!db.prepare("SELECT 1 FROM review_records WHERE project_id = ? AND review_type = 'arc' ORDER BY created_at DESC LIMIT 1").get(projectId)
    hasArcSummary = !!db.prepare('SELECT 1 FROM arc_summaries WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId)
    if (arcBoundary.isVolumeEnd) {
      hasVolumeSummary = !!db.prepare('SELECT 1 FROM volume_summaries WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId)
    }
  }

  return {
    phase,
    flow,
    lastCompleted,
    nextChapter: nextCh,
    nextChapterId: nextChapterInfo?.id ?? null,
    nextChapterTitle: nextChapterInfo?.title ?? null,
    totalPlannedChapters: totalPlanned,
    pendingRewrites,
    arcBoundary,
    hasArcReview,
    hasArcSummary,
    hasVolumeSummary,
    foundationMissing,
    chapterReadiness
  }
}

// ── Route (core decision function) ──

export function Route(state: RouteState): Instruction | null {
  // 1. Complete
  if (state.phase === 'complete') return null

  // 2. Foundation building (one piece at a time)
  if (state.foundationMissing.length > 0) {
    return routeFoundationPiece(state)
  }

  // 3. Pending rewrites
  if (state.pendingRewrites.length > 0) {
    const ch = state.pendingRewrites[0]
    return { agent: 'writer', task: `${state.flow === 'polishing' ? '打磨' : '重写'}第 ${ch} 章`, reason: `PendingRewrites 队列剩余 ${state.pendingRewrites.length} 章`, chapter: ch }
  }

  // 4. Review in progress / Steering
  if (state.flow === 'reviewing' || state.flow === 'steering') return null

  // 5. Arc/volume boundary post-processing
  if (state.arcBoundary?.isArcEnd) {
    return routeArcBoundary(state)
  }

  // 6. Current chapter readiness
  if (state.phase === 'writing' && state.nextChapter > 0 && state.chapterReadiness && !state.chapterReadiness.readyToWrite) {
    return routeCurrentChapterBlocker(state)
  }

  // 7. Normal next chapter
  if (state.phase === 'writing' && state.nextChapter > 0) {
    return { agent: 'writer', task: `写第 ${state.nextChapter} 章`, reason: '续写下一章', chapter: state.nextChapter }
  }

  return null
}

// ── Foundation routing: return ONE missing piece ──

function routeFoundationPiece(state: RouteState): Instruction {
  const m = state.foundationMissing[0]
  const prefix = '【Context 的 foundationDocs 包含导入文档原文。你必须逐字使用其中的角色名、世界观、大纲结构。禁止修改、禁止缩写、禁止替换同义词。严格按照原文创建。】\n'
  switch (m) {
    case 'story_compass':
      return { agent: 'architect', task: prefix + '基于 Context 中的已有设定创建故事指南针（set_story_compass）、类型定位（set_genre_positioning）、核心卖点（set_core_selling_point）和书名候选（add_title_candidate）。优先使用 context 中 foundationDocs 的角色和世界观设定。', reason: '缺少故事指南针' }
    case 'characters':
      return { agent: 'architect', task: prefix + '基于 Context 中的 foundationDocs 创建主要人物角色（create_character）。如果 context 中有人物的描述信息，使用那些信息。包括主角、配角、反派。', reason: '缺少人物设定' }
    case 'character_arcs':
      return { agent: 'architect', task: '为每个已创建的角色创建人物弧（create_character_arc），定义起点、终点、核心谎言和真相', reason: '缺少人物弧' }
    case 'world_rules':
      return { agent: 'architect', task: prefix + '基于 Context 中的 foundationDocs 创建世界规则（create_world_rule）和世界观词条（create_worldbuilding）。参考 context 中已有的世界观描述。', reason: '缺少世界规则' }
    case 'volume_arcs':
      return { agent: 'architect', task: prefix + '基于 Context 中的已有大纲和主线粗钢，创建卷弧骨架（create_volume_arc）。规划合理的卷和弧结构，每个弧预估章节数。优先使用 context 中的大纲结构。', reason: '缺少卷弧骨架' }
    case 'arc_outlines':
      return { agent: 'architect', task: prefix + '为首弧创建详细弧大纲（create_arc_outline），包含弧的开端、转折点、高潮、结局，以及详细的章节计划列表（chapter_plans）。参考 context 中的关键场景细纲。', reason: '缺少弧大纲' }
    case 'chapter_contracts':
    case 'knowledge_contracts':
      return { agent: 'architect', task: '为首章生成章节契约（generate_chapter_contract）和知识契约（generate_knowledge_contract），基于弧大纲中的章节计划', reason: '缺少章节契约' }
    case 'foreshadowing':
      return { agent: 'architect', task: '创建伏笔（create_foreshadowing），为关键剧情节点注册伏笔，规划埋下、推进和回收的时机', reason: '缺少伏笔规划' }
    default:
      return { agent: 'architect', task: `补齐缺失的设定项: ${m}`, reason: `缺少: ${m}` }
  }
}

// ── Arc boundary routing ──

function routeArcBoundary(state: RouteState): Instruction | null {
  const b = state.arcBoundary!
  if (!state.hasArcReview) {
    return { agent: 'editor', task: `对第 ${b.volume} 卷第 ${b.arc} 弧做弧级评审（scope=arc）`, reason: '弧末评审未完成' }
  }
  if (!state.hasArcSummary) {
    return { agent: 'editor', task: `生成第 ${b.volume} 卷第 ${b.arc} 弧摘要（save_arc_summary）`, reason: '弧摘要未完成' }
  }
  if (b.isVolumeEnd && !state.hasVolumeSummary) {
    return { agent: 'editor', task: `生成第 ${b.volume} 卷卷摘要（save_volume_summary）`, reason: '卷摘要未完成' }
  }
  if (b.needsExpansion && b.nextArc > 0) {
    return { agent: 'architect_long', task: `展开第 ${b.nextVolume} 卷第 ${b.nextArc} 弧（create_arc_outline + create_arc_chapter_plans）`, reason: '下一弧骨架待展开' }
  }
  if (b.needsNewVolume) {
    return { agent: 'architect_long', task: '评估后续方向，使用 create_volume_arc 追加新卷或报告全书完成', reason: '卷末需决定追加新卷或结束全书' }
  }
  return null
}

function routeCurrentChapterBlocker(state: RouteState): Instruction | null {
  const readiness = state.chapterReadiness
  if (!readiness) return null

  if (!readiness.chapterContractReady || !readiness.knowledgeContractReady) {
    const label = readiness.chapterNumber > 0 ? `第 ${readiness.chapterNumber} 章` : '当前章节'
    return {
      agent: 'architect',
      task: `为${label}生成缺失契约（generate_chapter_contract / generate_knowledge_contract）。chapter_id=${readiness.chapterId ?? 'unknown'}。优先补齐后再进入写作。`,
      reason: `当前章节未满足写作前置：${readiness.blockingIssues.join('、')}`
    }
  }

  return null
}

// ── Detect what foundation pieces are missing ──

export function detectFoundationMissing(projectId: string): string[] {
  const missing: string[] = []
  if (!hasStoryCompass(projectId)) missing.push('story_compass')
  if (!hasCharacters(projectId)) missing.push('characters')
  if (!hasCharacterArcs(projectId)) missing.push('character_arcs')
  if (!hasWorldRules(projectId)) missing.push('world_rules')
  if (!hasVolumeArcs(projectId)) missing.push('volume_arcs')
  if (!hasArcOutlines(projectId) && !hasArcChapterPlans(projectId)) missing.push('arc_outlines')
  if (!hasChapterContracts(projectId) && hasArcChapterPlans(projectId)) missing.push('chapter_contracts')
  if (!hasKnowledgeContracts(projectId) && hasArcChapterPlans(projectId)) missing.push('knowledge_contracts')
  if (!hasForeshadowing(projectId)) missing.push('foreshadowing')
  if (missing.length > 0) console.log('[Router] foundationMissing', { projectId: projectId.slice(0, 8), missing })
  else console.log('[Router] foundationComplete', { projectId: projectId.slice(0, 8) })
  return missing
}

// ── Helper: find next chapter to write ──

function findNextChapter(projectId: string, completed: number[]): number {
  // Try committed drafts first
  const db = getDb()
  const lastDraft = db.prepare(
    "SELECT c.sort_order FROM chapter_drafts d JOIN chapters c ON d.chapter_id = c.id WHERE d.project_id = ? AND d.lifecycle = 'final_committed' ORDER BY c.sort_order DESC LIMIT 1"
  ).get(projectId) as { sort_order: number } | undefined
  if (lastDraft) return lastDraft.sort_order + 1

  // Then try arc_chapter_plans for the first unwritten chapter
  const firstPlan = db.prepare(
    `SELECT acp.chapter_number FROM arc_chapter_plans acp
     JOIN volume_arcs va ON acp.arc_id = va.id
     WHERE va.project_id = ? AND acp.status = 'planned'
     ORDER BY va.volume_number ASC, acp.chapter_number ASC LIMIT 1`
  ).get(projectId) as { chapter_number: number } | undefined
  if (firstPlan) return firstPlan.chapter_number

  return completed.length > 0 ? Math.max(...completed) + 1 : 1
}

function getNextChapterInfo(projectId: string, nextChapter: number): { id: string; title: string } | null {
  if (nextChapter <= 0) return null
  const db = getDb()
  const chapter = db.prepare(
    'SELECT id, title FROM chapters WHERE project_id = ? AND sort_order = ? LIMIT 1'
  ).get(projectId, nextChapter) as { id: string; title: string } | undefined
  if (chapter) return chapter

  const plan = db.prepare(
    `SELECT acp.id, acp.chapter_title FROM arc_chapter_plans acp
     JOIN volume_arcs va ON acp.arc_id = va.id
     WHERE va.project_id = ? AND acp.chapter_number = ?
     ORDER BY va.volume_number ASC LIMIT 1`
  ).get(projectId, nextChapter) as { id: string; chapter_title: string } | undefined
  if (!plan) return null
  return { id: plan.id, title: plan.chapter_title || `第${nextChapter}章` }
}

function buildChapterReadiness(
  projectId: string,
  chapterId: string | null,
  chapterNumber: number,
  chapterTitle: string | null
): RouteState['chapterReadiness'] {
  if (chapterNumber <= 0) return null

  const blockingIssues: string[] = []
  let chapterContractReady = false
  let knowledgeContractReady = false

  if (!chapterId) {
    blockingIssues.push('缺少当前章节实体')
  } else {
    chapterContractReady = !!getDb().prepare(
      'SELECT 1 FROM chapter_contracts WHERE project_id = ? AND chapter_id = ? LIMIT 1'
    ).get(projectId, chapterId)
    knowledgeContractReady = !!getDb().prepare(
      'SELECT 1 FROM knowledge_contracts WHERE project_id = ? AND chapter_id = ? LIMIT 1'
    ).get(projectId, chapterId)

    if (!chapterContractReady) blockingIssues.push('缺少 chapter_contract')
    if (!knowledgeContractReady) blockingIssues.push('缺少 knowledge_contract')
  }

  return {
    chapterId,
    chapterNumber,
    chapterTitle,
    chapterContractReady,
    knowledgeContractReady,
    blockingIssues,
    readyToWrite: blockingIssues.length === 0
  }
}

// ── Arc boundary detection ──

function detectArcBoundary(projectId: string): RouteState['arcBoundary'] {
  const db = getDb()
  const arcs = db.prepare('SELECT * FROM volume_arcs WHERE project_id = ? ORDER BY sort_order ASC').all(projectId) as Array<Record<string, unknown>>
  if (arcs.length === 0) return null

  // Find the first non-completed arc
  const currentArc = arcs.find(a => (a.status as string) !== 'completed')
  if (!currentArc) {
    // All arcs completed
    const lastArc = arcs[arcs.length - 1]
    return {
      isArcEnd: true, isVolumeEnd: true,
      volume: lastArc.volume_number as number, arc: lastArc.arc_number as number,
      nextArc: 0, nextVolume: (lastArc.volume_number as number) + 1,
      needsExpansion: false, needsNewVolume: true
    }
  }

  const arcId = currentArc.id as string
  const plannedCount = currentArc.planned_chapters as number
  const writtenCount = (db.prepare(
    "SELECT COUNT(*) AS c FROM arc_chapter_plans WHERE arc_id = ? AND status = 'written'"
  ).get(arcId) as { c: number }).c

  if (writtenCount < plannedCount) return null // Arc still in progress

  const volNum = currentArc.volume_number as number
  const arcNum = currentArc.arc_number as number

  const volumeArcs = arcs.filter(a => (a.volume_number as number) === volNum)
  const allDone = volumeArcs.every(a => (a.status as string) === 'completed' || (a.id as string) === arcId)

  const nextArc = arcs.find(a =>
    (a.volume_number as number) > volNum ||
    ((a.volume_number as number) === volNum && (a.arc_number as number) > arcNum)
  )

  return {
    isArcEnd: true,
    isVolumeEnd: allDone,
    volume: volNum, arc: arcNum,
    nextArc: nextArc ? (nextArc.arc_number as number) : 0,
    nextVolume: nextArc ? (nextArc.volume_number as number) : volNum + 1,
    needsExpansion: !nextArc || (nextArc.status as string) === 'planned',
    needsNewVolume: allDone && !nextArc
  }
}

// ── Small helpers ──

function parseNumberArray(raw: string | undefined): number[] {
  if (!raw) return []
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.filter((v: unknown): v is number => typeof v === 'number') : [] } catch { return [] }
}

function parseStringArray(raw: string | undefined): string[] {
  if (!raw) return []
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.map(String) : [] } catch { return [] }
}

// ── Format instruction for FollowUp ──

export function formatInstruction(inst: Instruction, repeatN?: number): string {
  let msg = `[Host 下达指令] 建议调用 subagent("${inst.agent}", "执行：${inst.task}")\n理由：${inst.reason}\n优先执行本指令。如果你判断当前项目状态与本指令不符，请简要说明原因后调 end_turn。`
  if (repeatN && repeatN > 1) {
    msg += `\n（注意：本指令为第 ${repeatN} 次下达——上次派发后路由事实未变化。本次允许先调 novel_context 核对事实，再裁定照常执行或改派其它子代理。）`
  }
  return msg
}
