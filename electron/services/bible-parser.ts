import { uuid, now } from '../lib/util'
import { chatLLM } from './ai.service'
import type {
  ParsedSegment,
  ParsedSegmentType,
  BibleSectionType,
  StoryBible
} from '@shared/types'

interface RawSegment {
  raw_text: string
  detected_type: ParsedSegmentType
  confidence: number
  target_section: BibleSectionType | ''
  target_key: string
}

type FilenameProfile = {
  type: ParsedSegmentType
  section: BibleSectionType
  defaultKey: string
  fieldRules: Array<{
    keywords: string[]
    headings?: string[]
    section: BibleSectionType
    key: string
    type?: ParsedSegmentType
  }>
}

const KEYWORD_MAP: Array<{
  keywords: string[]
  type: ParsedSegmentType
  section: BibleSectionType
  key: string
}> = [
  { keywords: ['世界', '大陆', '星球', '宇宙', '位面', '纪元'], type: 'world', section: 'world', key: 'background' },
  { keywords: ['魔法', '灵气', '功法', '能力', '超能力', '异能', '修仙', '修炼'], type: 'world', section: 'world', key: 'power_system' },
  { keywords: ['规则', '法则', '限制', '代价', '禁忌'], type: 'world', section: 'world', key: 'rules' },
  { keywords: ['势力', '组织', '宗门', '门派', '国家', '帝国', '联盟'], type: 'world', section: 'world', key: 'factions' },
  { keywords: ['地理', '地图', '城市', '地点', '山脉', '海洋'], type: 'world', section: 'world', key: 'geography' },
  { keywords: ['主角', '男主角', '女主角', 'protagonist'], type: 'character', section: 'characters', key: 'protagonist' },
  { keywords: ['配角', '反派', '敌人', 'boss', '对手'], type: 'character', section: 'characters', key: 'supporting' },
  { keywords: ['人物弧', '角色弧', '成长', '转变', '缺陷', '信念'], type: 'character', section: 'characters', key: 'character_arc' },
  { keywords: ['关系', '情感', '爱情', '友情', '仇恨'], type: 'character', section: 'characters', key: 'relationships' },
  { keywords: ['大纲', '主线', '剧情', '故事线', '情节'], type: 'outline', section: 'structure', key: 'main_plot' },
  { keywords: ['卷', '第一卷', '第二卷', '上卷', '下卷'], type: 'volume', section: 'structure', key: 'volume_skeleton' },
  { keywords: ['弧', '第一弧', '篇章', '阶段'], type: 'arc', section: 'structure', key: 'arc_skeleton' },
  { keywords: ['章节', '第一章', '第二章', '场景'], type: 'chapter_draft', section: 'structure', key: 'chapter_plan' },
  { keywords: ['伏笔', '悬念', '秘密', '谜团', '暗线'], type: 'foreshadowing', section: 'foreshadowing', key: 'foreshadowing' },
  { keywords: ['风格', '文风', '笔触', '叙事', '视角', '节奏'], type: 'style', section: 'style', key: 'writing_style' },
  { keywords: ['禁忌', '不要', '避免', '禁止'], type: 'taboo', section: 'style', key: 'taboos' },
  { keywords: ['类型', '题材', '玄幻', '都市', '科幻', '历史', '言情'], type: 'plot', section: 'positioning', key: 'genre' },
  { keywords: ['卖点', '亮点', '特色', '爽点'], type: 'plot', section: 'positioning', key: 'selling_point' },
  { keywords: ['终局', '结局', '结尾', '收尾'], type: 'plot', section: 'compass', key: 'ending_direction' },
  { keywords: ['冲突', '矛盾', '对抗', '核心冲突'], type: 'plot', section: 'compass', key: 'core_conflict' },
  { keywords: ['灵感', '想法', '创意', '点子'], type: 'inspiration', section: 'positioning', key: 'inspiration' },
  { keywords: ['参考', '类似', '借鉴', '参考作品'], type: 'reference', section: 'positioning', key: 'reference' }
]

const FILENAME_PROFILES: Array<{
  aliases: string[]
  profile: FilenameProfile
}> = [
  {
    aliases: ['世界观'],
    profile: {
      type: 'world',
      section: 'world',
      defaultKey: 'background',
      fieldRules: [
        { keywords: ['背景', '设定', '时代'], headings: ['一句话核心', '时代背景', '经济层级', '教育背景', '社会圈层', '故事结构', '时间线'], section: 'world', key: 'background' },
        { keywords: ['规则', '法则', '限制', '代价'], headings: ['规则'], section: 'world', key: 'rules' },
        { keywords: ['能力', '体系', '魔法', '修炼', '力量'], section: 'world', key: 'power_system' },
        { keywords: ['势力', '组织', '国家', '联盟', '宗门'], headings: ['势力'], section: 'world', key: 'factions' },
        { keywords: ['地理', '地图', '地点', '城市', '区域'], headings: ['地理'], section: 'world', key: 'geography' }
      ]
    }
  },
  {
    aliases: ['人物'],
    profile: {
      type: 'character',
      section: 'characters',
      defaultKey: 'supporting',
      fieldRules: [
        { keywords: ['主角', '男主', '女主', '妻子', '丈夫'], headings: ['妻子', '丈夫', '苏棠', '陈屿'], section: 'characters', key: 'protagonist' },
        { keywords: ['配角', '重要角色', '主要角色'], headings: ['配角'], section: 'characters', key: 'supporting' },
        { keywords: ['反派', '敌对', '对手'], headings: ['反派'], section: 'characters', key: 'antagonist' },
        { keywords: ['人物弧', '角色弧', '成长', '转变'], headings: ['人物弧', '角色弧', '弧线'], section: 'characters', key: 'character_arc' },
        { keywords: ['关系', '感情', '互动'], headings: ['关系'], section: 'characters', key: 'relationships' }
      ]
    }
  },
  {
    aliases: ['主线粗纲', '主线粗钢'],
    profile: {
      type: 'outline',
      section: 'structure',
      defaultKey: 'volume_skeleton',
      fieldRules: [
        { keywords: ['终局', '结局', '结尾'], headings: ['终局', '结局'], section: 'compass', key: 'ending_direction', type: 'plot' },
        { keywords: ['冲突', '矛盾', '对抗'], headings: ['冲突'], section: 'compass', key: 'core_conflict', type: 'plot' },
        { keywords: ['主题'], headings: ['主题'], section: 'compass', key: 'theme', type: 'plot' },
        { keywords: ['悬念', '长线'], headings: ['悬念'], section: 'compass', key: 'long_term_suspense', type: 'foreshadowing' },
        { keywords: ['分卷', '卷', '大学篇', '婚后篇'], headings: ['卷', '大学篇', '婚后篇'], section: 'structure', key: 'volume_skeleton', type: 'volume' },
        { keywords: ['首弧', '弧', '篇章'], headings: ['弧'], section: 'structure', key: 'arc_skeleton', type: 'arc' },
        { keywords: ['主线', '剧情', '大纲'], headings: ['章节结构说明'], section: 'structure', key: 'main_plot', type: 'outline' }
      ]
    }
  },
  {
    aliases: ['重要情节'],
    profile: {
      type: 'foreshadowing',
      section: 'foreshadowing',
      defaultKey: 'foreshadowing',
      fieldRules: [
        { keywords: ['秘密', '真相'], headings: ['秘密'], section: 'foreshadowing', key: 'secrets' },
        { keywords: ['伏笔', '悬念', '回收', '暗线'], headings: ['伏笔'], section: 'foreshadowing', key: 'foreshadowing' },
        { keywords: ['情节', '事件', '转折'], headings: ['重要情节'], section: 'structure', key: 'arc_skeleton', type: 'arc' }
      ]
    }
  },
  {
    aliases: ['关键场景细纲'],
    profile: {
      type: 'chapter_draft',
      section: 'structure',
      defaultKey: 'chapter_plan',
      fieldRules: [
        { keywords: ['人物弧', '角色弧', '压抑', '试探', '失控'], headings: ['人物弧线总纲'], section: 'characters', key: 'character_arc', type: 'character' },
        { keywords: ['写作注意', '补充', '注意事项'], headings: ['写作注意事项'], section: 'style', key: 'writing_style', type: 'style' },
        { keywords: ['章节', '第1章', '第一章', '第2章', '第二章', '章81', '第106-108章'], headings: ['章'], section: 'structure', key: 'chapter_plan', type: 'chapter_draft' },
        { keywords: ['场景', '镜头', '桥段'], headings: ['关键场景细纲'], section: 'structure', key: 'chapter_plan', type: 'chapter_draft' },
        { keywords: ['首弧', '弧'], headings: ['弧'], section: 'structure', key: 'arc_skeleton', type: 'arc' }
      ]
    }
  },
  {
    aliases: ['写作要求'],
    profile: {
      type: 'style',
      section: 'style',
      defaultKey: 'writing_style',
      fieldRules: [
        { keywords: ['禁忌', '不要', '避免', '禁止'], section: 'style', key: 'taboos', type: 'taboo' },
        { keywords: ['文风', '风格', '笔调'], section: 'style', key: 'writing_style', type: 'style' },
        { keywords: ['视角', '人称'], section: 'style', key: 'pov', type: 'style' },
        { keywords: ['节奏', '推进'], section: 'style', key: 'pacing', type: 'style' }
      ]
    }
  }
]

export function parseByRules(content: string): RawSegment[] {
  const segments: RawSegment[] = []
  const blocks = splitByHeadings(content)

  for (const block of blocks) {
    const text = block.trim()
    if (!text || text.length < 5) continue

    const detected = classifyByKeywords(text)
    segments.push(detected)
  }

  if (segments.length === 0 && content.trim().length > 0) {
    segments.push({
      raw_text: content.trim(),
      detected_type: 'unclassified',
      confidence: 0.1,
      target_section: '',
      target_key: ''
    })
  }

  return segments
}

function normalizeFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/^[0-9０-９]+[\-_.、\s]*/, '')
    .trim()
}

function getFilenameProfile(filename: string): FilenameProfile | null {
  const normalized = normalizeFilename(filename)
  const matched = FILENAME_PROFILES.find((item) =>
    item.aliases.some((alias) => normalized.includes(alias))
  )
  return matched?.profile ?? null
}

function classifyWithinProfile(text: string, profile: FilenameProfile): RawSegment {
  const lowerText = text.toLowerCase()
  const heading = getPrimaryHeading(text).toLowerCase()
  for (const rule of profile.fieldRules) {
    if (rule.headings && rule.headings.some((kw) => heading.includes(kw.toLowerCase()))) {
      return {
        raw_text: text,
        detected_type: rule.type ?? profile.type,
        confidence: 0.97,
        target_section: rule.section,
        target_key: rule.key
      }
    }
    if (rule.keywords.some((kw) => lowerText.includes(kw.toLowerCase()))) {
      return {
        raw_text: text,
        detected_type: rule.type ?? profile.type,
        confidence: 0.95,
        target_section: rule.section,
        target_key: rule.key
      }
    }
  }
  return {
    raw_text: text,
    detected_type: profile.type,
    confidence: 0.92,
    target_section: profile.section,
    target_key: profile.defaultKey
  }
}

function getPrimaryHeading(text: string): string {
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.startsWith('#'))
  return line ? line.replace(/^#+\s*/, '') : ''
}

export function applyFilenameConvention(
  filename: string,
  segments: RawSegment[]
): RawSegment[] {
  const profile = getFilenameProfile(filename)
  if (!profile) return segments

  return segments.map((seg) => {
    const classified = classifyWithinProfile(seg.raw_text, profile)
    if (!seg.target_section || seg.confidence < 0.85) {
      return classified
    }
    return {
      ...seg,
      confidence: Math.max(seg.confidence, 0.9)
    }
  })
}

function splitByHeadings(content: string): string[] {
  const lines = content.split('\n')
  const blocks: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (current.length > 0) {
        blocks.push(current.join('\n'))
        current = []
      }
    }
    current.push(line)
  }
  if (current.length > 0) {
    blocks.push(current.join('\n'))
  }

  if (blocks.length <= 1) {
    const paragraphs = content.split(/\n\s*\n/)
    return paragraphs.filter((p) => p.trim().length > 0)
  }

  return blocks
}

function classifyByKeywords(text: string): RawSegment {
  const lowerText = text.toLowerCase()
  let bestMatch: RawSegment = {
    raw_text: text,
    detected_type: 'unclassified',
    confidence: 0.1,
    target_section: '',
    target_key: ''
  }

  let maxScore = 0

  for (const rule of KEYWORD_MAP) {
    let score = 0
    for (const kw of rule.keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        score += kw.length >= 3 ? 2 : 1
      }
    }
    if (score > maxScore) {
      maxScore = score
      bestMatch = {
        raw_text: text,
        detected_type: rule.type,
        confidence: Math.min(0.5 + score * 0.1, 0.9),
        target_section: rule.section,
        target_key: rule.key
      }
    }
  }

  return bestMatch
}

export async function enhanceByLLM(
  segments: RawSegment[]
): Promise<RawSegment[]> {
  const unclassified = segments.filter((s) => s.detected_type === 'unclassified')
  if (unclassified.length === 0) return segments

  const classifiedText = segments
    .filter((s) => s.detected_type !== 'unclassified')
    .map((s) => `[${s.detected_type}] ${s.raw_text.slice(0, 50)}`)
    .join('\n')

  const unclassifiedText = unclassified
    .map((s, i) => `片段${i}: ${s.raw_text.slice(0, 300)}`)
    .join('\n---\n')

  const systemPrompt = `你是一个小说创作素材分类器。请分析以下未分类片段，为每个片段判断最合适的类型。

可选类型：world（世界设定）、character（人物）、plot（主线/卖点/类型）、outline（大纲）、volume（分卷）、arc（分弧）、chapter_draft（章节草案）、foreshadowing（伏笔）、style（风格）、taboo（禁忌）、inspiration（灵感）、reference（参考作品）

输出 JSON 数组，每个元素：
{"index": 片段序号, "type": 类型, "confidence": 0-1, "section": "positioning|compass|world|characters|structure|foreshadowing|style", "key": "字段键"}

只返回 JSON，不要其他文字。`

  try {
    const raw = await chatLLM([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `已分类片段参考：\n${classifiedText || '无'}\n\n待分类片段：\n${unclassifiedText}`
      }
    ])

    const json = extractJsonArray(raw)
    if (!json) return segments

    const result = [...segments]
    for (const item of json) {
      const idx = item.index as number
      if (idx >= 0 && idx < unclassified.length) {
        const originalIdx = segments.indexOf(unclassified[idx])
        if (originalIdx >= 0) {
          const confidence = typeof item.confidence === 'number' ? item.confidence : 0.6
          const targetKey = typeof item.key === 'string' ? item.key : ''
          result[originalIdx] = {
            raw_text: segments[originalIdx].raw_text,
            detected_type: (item.type as ParsedSegmentType) || 'unclassified',
            confidence,
            target_section: (item.section as BibleSectionType) || '',
            target_key: targetKey
          }
        }
      }
    }
    return result
  } catch {
    return segments
  }
}

function extractJsonArray(text: string): Array<Record<string, unknown>> | null {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as Array<Record<string, unknown>>
  } catch {
    return null
  }
}

export function detectConflicts(
  segments: RawSegment[],
  bible: StoryBible
): Array<{ segmentIndex: number; conflictFieldId: string; reason: string }> {
  const conflicts: Array<{ segmentIndex: number; conflictFieldId: string; reason: string }> = []

  segments.forEach((seg, idx) => {
    if (!seg.target_section || !seg.target_key) return
    const existingFields = bible[seg.target_section] || []
    const match = existingFields.find((f) => f.section_key === seg.target_key)
    if (match && match.content && match.content.trim().length > 0) {
      const similarity = textSimilarity(seg.raw_text, match.content)
      if (similarity < 0.7 && similarity > 0.2) {
        conflicts.push({
          segmentIndex: idx,
          conflictFieldId: match.id,
          reason: `与已有内容相似度 ${Math.round(similarity * 100)}%，可能存在冲突`
        })
      }
    }
  })

  return conflicts
}

function textSimilarity(a: string, b: string): number {
  const setA = new Set(extractBigrams(a))
  const setB = new Set(extractBigrams(b))
  let intersection = 0
  for (const bg of setA) {
    if (setB.has(bg)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function extractBigrams(text: string): string[] {
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) || []
  const result: string[] = []
  for (const word of cjk) {
    for (let i = 0; i < word.length - 1; i++) {
      result.push(word.slice(i, i + 2))
    }
  }
  return result
}

export function toParsedSegments(
  projectId: string,
  documentId: string,
  rawSegments: RawSegment[]
): ParsedSegment[] {
  const ts = now()
  return rawSegments.map((seg, idx) => ({
    id: uuid(),
    project_id: projectId,
    document_id: documentId,
    segment_index: idx,
    raw_text: seg.raw_text,
    detected_type: seg.detected_type,
    confidence: seg.confidence,
    target_section: seg.target_section,
    target_key: seg.target_key,
    merge_status: 'pending',
    conflict_with: '',
    created_at: ts
  }))
}
