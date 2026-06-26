import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { getStoryBible } from './story-bible.service'
import type {
  BibleSectionType,
  ReadinessResult,
  ReadinessSectionResult,
  ReadinessLevel
} from '@shared/types'

function getFieldContent(
  bible: ReturnType<typeof getStoryBible>,
  section: BibleSectionType,
  key: string
): string {
  const field = bible[section]?.find((f) => f.section_key === key)
  return field?.content?.trim() || ''
}

function hasContent(content: string): boolean {
  return content.length >= 5
}

function evaluateSection(
  bible: ReturnType<typeof getStoryBible>,
  sectionType: BibleSectionType
): ReadinessSectionResult {
  switch (sectionType) {
    case 'positioning': {
      const genre = getFieldContent(bible, 'positioning', 'genre')
      const sellingPoint = getFieldContent(bible, 'positioning', 'selling_point')
      const missing: string[] = []
      if (!hasContent(genre)) missing.push('类型')
      if (!hasContent(sellingPoint)) missing.push('核心卖点')

      if (missing.length === 0)
        return { section_type: sectionType, level: 'sufficient', reason: '类型和卖点已明确', missing_items: [] }
      if (missing.length === 1)
        return { section_type: sectionType, level: 'weak', reason: `缺少${missing[0]}`, missing_items: missing }
      return { section_type: sectionType, level: 'insufficient', reason: '缺少类型和卖点', missing_items: missing }
    }

    case 'compass': {
      const ending = getFieldContent(bible, 'compass', 'ending_direction')
      const conflict = getFieldContent(bible, 'compass', 'core_conflict')
      const missing: string[] = []
      if (!hasContent(ending)) missing.push('终局方向')
      if (!hasContent(conflict)) missing.push('核心冲突')

      if (missing.length === 0)
        return { section_type: sectionType, level: 'sufficient', reason: '终局方向和核心冲突已明确', missing_items: [] }
      if (missing.length === 1)
        return { section_type: sectionType, level: 'weak', reason: `缺少${missing[0]}`, missing_items: missing }
      return { section_type: sectionType, level: 'insufficient', reason: '缺少终局方向和核心冲突', missing_items: missing }
    }

    case 'world': {
      const background = getFieldContent(bible, 'world', 'background')
      const rules = getFieldContent(bible, 'world', 'rules')
      if (hasContent(background) && hasContent(rules))
        return { section_type: sectionType, level: 'sufficient', reason: '世界背景和规则已建立', missing_items: [] }
      if (hasContent(background) || hasContent(rules))
        return { section_type: sectionType, level: 'weak', reason: '世界设定不完整', missing_items: ['背景或规则'] }
      return { section_type: sectionType, level: 'insufficient', reason: '世界设定缺失', missing_items: ['世界背景', '世界规则'] }
    }

    case 'characters': {
      const protagonist = getFieldContent(bible, 'characters', 'protagonist')
      const arc = getFieldContent(bible, 'characters', 'character_arc')
      if (hasContent(protagonist) && hasContent(arc))
        return { section_type: sectionType, level: 'sufficient', reason: '主角和人物弧已明确', missing_items: [] }
      if (hasContent(protagonist))
        return { section_type: sectionType, level: 'weak', reason: '缺少主角人物弧', missing_items: ['人物弧'] }
      return { section_type: sectionType, level: 'insufficient', reason: '缺少主角设定', missing_items: ['主角', '人物弧'] }
    }

    case 'structure': {
      const arcSkeleton = getFieldContent(bible, 'structure', 'arc_skeleton')
      const chapterPlan = getFieldContent(bible, 'structure', 'chapter_plan')
      if (hasContent(arcSkeleton) && hasContent(chapterPlan))
        return { section_type: sectionType, level: 'sufficient', reason: '首弧目标和章节方向已明确', missing_items: [] }
      if (hasContent(arcSkeleton))
        return { section_type: sectionType, level: 'weak', reason: '缺少前几章可写方向', missing_items: ['章节计划'] }
      return { section_type: sectionType, level: 'insufficient', reason: '缺少首弧目标', missing_items: ['首弧骨架', '章节计划'] }
    }

    case 'foreshadowing': {
      const foreshadowing = getFieldContent(bible, 'foreshadowing', 'foreshadowing')
      if (hasContent(foreshadowing))
        return { section_type: sectionType, level: 'sufficient', reason: '已有伏笔规划', missing_items: [] }
      return { section_type: sectionType, level: 'weak', reason: '暂无伏笔', missing_items: ['伏笔'] }
    }

    case 'style': {
      const style = getFieldContent(bible, 'style', 'writing_style')
      const taboos = getFieldContent(bible, 'style', 'taboos')
      if (hasContent(style))
        return { section_type: sectionType, level: 'sufficient', reason: '文风已明确', missing_items: [] }
      if (hasContent(taboos))
        return { section_type: sectionType, level: 'weak', reason: '有禁忌但缺文风', missing_items: ['文风'] }
      return { section_type: sectionType, level: 'weak', reason: '风格约束缺失', missing_items: ['文风', '禁忌'] }
    }

    default:
      return { section_type: sectionType, level: 'missing', reason: '未知分区', missing_items: [] }
  }
}

const LEVEL_ORDER: Record<ReadinessLevel, number> = {
  missing: 0,
  insufficient: 1,
  weak: 2,
  sufficient: 3
}

export async function evaluateReadiness(projectId: string): Promise<ReadinessResult> {
  const bible = getStoryBible(projectId)
  const sectionTypes: BibleSectionType[] = [
    'positioning',
    'compass',
    'world',
    'characters',
    'structure',
    'foreshadowing',
    'style'
  ]

  const sections = sectionTypes.map((st) => evaluateSection(bible, st))

  saveReadinessChecks(projectId, sections)

  const coreSections = sections.slice(0, 5)
  const auxSections = sections.slice(5)

  const coreInsufficient = coreSections.filter(
    (s) => s.level === 'insufficient' || s.level === 'missing'
  ).length
  const auxAllWeak = auxSections.every((s) => s.level === 'weak' || s.level === 'missing')

  let overall: ReadinessResult['overall']
  if (coreInsufficient === 0 && !auxAllWeak) {
    overall = 'can_launch'
  } else if (coreInsufficient <= 2) {
    overall = 'suggest_supplement'
  } else if (coreInsufficient <= 4) {
    overall = 'need_guidance'
  } else {
    overall = 'inspiration_only'
  }

  const forceLaunchFields = [
    getFieldContent(bible, 'positioning', 'genre'),
    getFieldContent(bible, 'characters', 'protagonist'),
    getFieldContent(bible, 'characters', 'character_arc'),
    getFieldContent(bible, 'compass', 'core_conflict'),
    getFieldContent(bible, 'compass', 'ending_direction'),
    getFieldContent(bible, 'structure', 'arc_skeleton')
  ]
  const canForceLaunch = forceLaunchFields.filter((f) => hasContent(f)).length >= 5

  return {
    overall,
    sections,
    can_force_launch: canForceLaunch
  }
}

function saveReadinessChecks(
  projectId: string,
  sections: ReadinessSectionResult[]
): void {
  const db = getDb()
  db.prepare('DELETE FROM readiness_checks WHERE project_id = ?').run(projectId)
  const ts = now()
  const stmt = db.prepare(
    `INSERT INTO readiness_checks (id, project_id, section_type, level, reason, missing_items, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const s of sections) {
    stmt.run(uuid(), projectId, s.section_type, s.level, s.reason, JSON.stringify(s.missing_items), ts)
  }
}

export function getLatestReadiness(projectId: string): ReadinessSectionResult[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM readiness_checks WHERE project_id = ?
       AND created_at = (SELECT MAX(created_at) FROM readiness_checks WHERE project_id = ?)
       ORDER BY section_type`
    )
    .all(projectId, projectId) as Array<{
      section_type: string
      level: string
      reason: string
      missing_items: string
    }>

  return rows.map((r) => ({
    section_type: r.section_type as BibleSectionType,
    level: r.level as ReadinessLevel,
    reason: r.reason,
    missing_items: JSON.parse(r.missing_items || '[]') as string[]
  }))
}