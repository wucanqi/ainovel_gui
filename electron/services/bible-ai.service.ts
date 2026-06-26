import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { chatLLM } from './ai.service'
import { getStoryBible, setAiCandidate, updateField } from './story-bible.service'
import { evaluateReadiness } from './readiness.service'
import type {
  AiCoCreateMode,
  BibleSectionType,
  GuidedQuestion
} from '@shared/types'

const SECTION_LABELS: Record<BibleSectionType, string> = {
  positioning: '作品定位',
  compass: '故事指南针',
  world: '世界设定',
  characters: '人物设定',
  structure: '故事结构',
  foreshadowing: '伏笔与悬念',
  style: '风格与约束'
}

const MODE_PROMPTS: Record<AiCoCreateMode, string> = {
  complete: '请根据已有 Story Bible 上下文，补齐该字段的缺失内容。保持风格一致，输出完整可用的内容。',
  question: '请指出当前设定中薄弱、冲突不足、动机不强的地方。以编号问题列表形式输出，每个问题具体可操作。',
  variant: '请给出 3 个不同方向的版本供用户选择。每个版本用【方案X】标注，简述差异点。',
  merge: '请把多个冲突设定融合成统一版本，保留各版优点，消除矛盾，输出融合后的完整内容。',
  compress: '请把冗长设定整理成简洁可用的 Story Bible 条目，保留关键信息，去除冗余。',
  expand: '请把一句灵感扩展成可用于编排的详细设定，补充背景、规则、限制和代价。'
}

export async function coCreate(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string,
  mode: AiCoCreateMode,
  userMessage?: string
): Promise<string> {
  const bible = getStoryBible(projectId)
  const fields = bible[sectionType] || []
  const currentField = fields.find((f) => f.section_key === sectionKey)

  const contextSummary = buildBibleContextSummary(bible)
  const currentContent = currentField?.content || '(空)'

  const systemPrompt = `你是一个长篇小说创作顾问。当前正在协助用户完善 Story Bible 的「${SECTION_LABELS[sectionType]}」分区。

任务模式：${MODE_PROMPTS[mode]}

当前 Story Bible 概览：
${contextSummary}

当前字段 [${sectionKey}] 的内容：
${currentContent}

${userMessage ? `用户补充要求：${userMessage}` : ''}

请直接输出结果内容，不要包含解释性前言。`

  const result = await chatLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `请对 [${sectionKey}] 字段执行「${mode}」操作。` }
  ])

  setAiCandidate(projectId, sectionType, sectionKey, result, mode)
  return result
}

function buildBibleContextSummary(bible: ReturnType<typeof getStoryBible>): string {
  const parts: string[] = []
  for (const sectionType of Object.keys(bible) as BibleSectionType[]) {
    const fields = bible[sectionType]
    if (fields.length === 0) continue
    const fieldSummaries = fields
      .map((f) => `  - ${f.section_key}: ${f.content.slice(0, 80) || '(空)'}`)
      .join('\n')
    parts.push(`【${SECTION_LABELS[sectionType]}】\n${fieldSummaries}`)
  }
  return parts.join('\n\n') || '(Story Bible 为空)'
}

export async function generateGuidedQuestions(projectId: string): Promise<GuidedQuestion[]> {
  const readiness = await evaluateReadiness(projectId)
  const missingSections = readiness.sections.filter(
    (s) => s.level === 'insufficient' || s.level === 'missing'
  )

  if (missingSections.length === 0) {
    return []
  }

  const questionBank: Array<{
    section: BibleSectionType
    key: string
    question: string
    options?: string[]
  }> = [
    { section: 'positioning', key: 'genre', question: '你的小说主要面向什么类型？', options: ['玄幻', '都市', '科幻', '历史', '言情', '悬疑', '其他'] },
    { section: 'positioning', key: 'selling_point', question: '这本书最核心的卖点或爽点是什么？' },
    { section: 'compass', key: 'ending_direction', question: '故事的终局大概往哪里走？主角最终会变成什么样？' },
    { section: 'compass', key: 'core_conflict', question: '主角要面对的核心冲突是什么？' },
    { section: 'characters', key: 'protagonist', question: '主角是谁？简单描述其身份、性格和处境。' },
    { section: 'characters', key: 'character_arc', question: '主角最核心的内在缺陷是什么？他/她需要学会什么？' },
    { section: 'world', key: 'background', question: '故事发生在一个什么样的世界？简述背景。' },
    { section: 'world', key: 'rules', question: '这个世界有什么特殊规则或限制？（如魔法体系、科技水平等）' },
    { section: 'structure', key: 'arc_skeleton', question: '第一弧要发生什么？主角要达成什么目标？' },
    { section: 'style', key: 'writing_style', question: '你希望什么样的文风？（如轻松幽默、沉重压抑、热血燃向等）' },
    { section: 'style', key: 'taboos', question: '有没有不想出现的内容或套路？' }
  ]

  const questions: GuidedQuestion[] = []
  for (const missing of missingSections) {
    const matches = questionBank.filter((q) => q.section === missing.section_type)
    for (const q of matches) {
      if (missing.missing_items.length === 0 || missing.missing_items.includes(q.key)) {
        questions.push({
          id: uuid(),
          question: q.question,
          target_section: q.section,
          target_key: q.key,
          options: q.options,
          allow_ai_decide: true
        })
      }
    }
  }

  return questions.slice(0, 5)
}

export async function processGuidedAnswers(
  projectId: string,
  answers: Array<{ questionId: string; answer: string; targetSection: BibleSectionType; targetKey: string }>
): Promise<void> {
  for (const ans of answers) {
    if (!ans.answer.trim()) continue

    const existing = getStoryBible(projectId)[ans.targetSection]?.find(
      (f) => f.section_key === ans.targetKey
    )

    if (existing && existing.content) {
      const merged = await mergeWithExisting(projectId, ans.targetSection, ans.targetKey, ans.answer)
      updateField(projectId, ans.targetSection, ans.targetKey, merged, 'guided')
    } else {
      updateField(projectId, ans.targetSection, ans.targetKey, ans.answer, 'guided')
    }
  }

  const ts = now()
  getDb()
    .prepare('DELETE FROM readiness_checks WHERE project_id = ?')
    .run(projectId)
  void ts
}

async function mergeWithExisting(
  projectId: string,
  sectionType: BibleSectionType,
  sectionKey: string,
  newAnswer: string
): Promise<string> {
  const bible = getStoryBible(projectId)
  const existing = bible[sectionType]?.find((f) => f.section_key === sectionKey)
  if (!existing || !existing.content) return newAnswer

  try {
    const result = await chatLLM([
      {
        role: 'system',
        content: '你是一个设定整合助手。请把已有设定和用户新回答融合成统一版本，保留两者关键信息，消除矛盾。直接输出融合后内容。'
      },
      {
        role: 'user',
        content: `已有设定：${existing.content}\n\n用户新回答：${newAnswer}\n\n请融合：`
      }
    ])
    return result
  } catch {
    return `${existing.content}\n\n[补充] ${newAnswer}`
  }
}