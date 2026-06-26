import { getEvaluationCases } from './evaluation-cases.service'
import { getDraft, getLatestDraft } from './draft.service'
import { getDb } from '../db'
import type { EvaluationCase, EvaluationRunResult } from '@shared/types'

function getChapterContent(chapterId: string): string {
  const row = getDb()
    .prepare('SELECT plain_text, content FROM chapters WHERE id = ?')
    .get(chapterId) as { plain_text: string; content: string } | undefined
  return row?.plain_text || row?.content || ''
}

function getContent(input: {
  chapterId?: string
  draftId?: string
  content?: string
}): string {
  if (input.content?.trim()) return input.content
  if (input.draftId) {
    const draft = getDraft(input.draftId)
    if (draft) return draft.plain_text || draft.content
  }
  if (input.chapterId) {
    const latestDraft = getLatestDraft(input.chapterId)
    if (latestDraft) return latestDraft.plain_text || latestDraft.content
    return getChapterContent(input.chapterId)
  }
  return ''
}

function collectMatches(patterns: string[], text: string): string[] {
  const matches: string[] = []
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'g')
      const found = text.match(regex)
      if (found?.length) matches.push(...found.slice(0, 3))
    } catch {
      if (text.includes(pattern)) matches.push(pattern)
    }
  }
  return Array.from(new Set(matches))
}

export function runEvaluationCase(
  caseId: string,
  input: { projectId: string; chapterId?: string; draftId?: string; content?: string }
): EvaluationRunResult {
  void input.projectId
  const testCase = getEvaluationCases().find((item) => item.id === caseId)
  if (!testCase) {
    throw new Error('Evaluation case not found')
  }
  const text = getContent(input)
  const matches = collectMatches(testCase.forbidden_output_patterns, text)
  const passed = matches.length === 0
  return {
    case_id: testCase.id,
    case_name: testCase.name,
    category: testCase.category,
    passed,
    matches,
    details: passed
      ? `通过：${testCase.pass_criteria}`
      : `失败：命中 ${matches.join('、')}。${testCase.fail_criteria}`,
    recommended_gate: testCase.recommended_gate
  }
}

export function runAllEvaluationCases(input: {
  projectId: string
  chapterId?: string
  draftId?: string
  content?: string
  category?: EvaluationCase['category']
}): EvaluationRunResult[] {
  const cases = getEvaluationCases().filter((item) =>
    input.category ? item.category === input.category : true
  )
  return cases.map((item) =>
    runEvaluationCase(item.id, {
      projectId: input.projectId,
      chapterId: input.chapterId,
      draftId: input.draftId,
      content: input.content
    })
  )
}
