/**
 * 中文语义标签提取 + 关键词检索
 *
 * 策略：
 * ① 有 LLM 时：用 LLM 从文本中提取结构化语义标签（人物/地点/事件/情感/主题）
 * ② 无 LLM 时：用规则引擎提取关键词
 * ③ 检索时：优先向量检索，回退到关键词 BM25 评分
 */

import { estimateTokens } from './token'

export interface SemanticTags {
  characters: string[]
  locations: string[]
  events: string[]
  emotions: string[]
  themes: string[]
  keywords: string[]
}

export function emptyTags(): SemanticTags {
  return { characters: [], locations: [], events: [], emotions: [], themes: [], keywords: [] }
}

/**
 * 规则引擎提取关键词（不依赖 LLM）
 * 中文分词：提取连续中文字符作为关键词候选，按词频排序
 */
export function extractKeywordsByRule(text: string): SemanticTags {
  const tags: SemanticTags = emptyTags()

  const cjkWords = text.match(/[\u4e00-\u9fff]{2,}/g) || []
  const freq: Record<string, number> = {}
  for (const w of cjkWords) {
    const bigrams = slidingBigrams(w)
    for (const bg of bigrams) {
      freq[bg] = (freq[bg] || 0) + 1
    }
  }

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k]) => k)

  tags.keywords = sorted
  return tags
}

function slidingBigrams(text: string): string[] {
  const result: string[] = []
  for (let i = 0; i < text.length - 1; i++) {
    result.push(text.slice(i, i + 2))
  }
  return result
}

/**
 * 用 LLM 从文本中提取结构化语义标签
 */
export async function extractTagsByLLM(
  text: string,
  llmCall: (messages: Array<{ role: string; content: string }>) => Promise<string>
): Promise<SemanticTags> {
  const systemPrompt = `你是一个小说文本语义分析器。请从以下文本中提取结构化信息，返回 JSON。

输出格式（严格 JSON，不要额外文字）：
{
  "characters": ["人物名或人称"],
  "locations": ["地点"],
  "events": ["发生的事件关键词"],
  "emotions": ["情感关键词如愤怒/喜悦/悲伤/紧张"],
  "themes": ["主题关键词如复仇/成长/爱情"],
  "keywords": ["其他重要关键词"]
}

规则：
- 每个数组最多 5 项，只提取最显著的
- 如果某类没有，返回空数组
- 只返回 JSON，不要其他文字`

  const userPrompt = `分析以下文本并提取语义标签（文本长度约 ${estimateTokens(text)} tokens）：\n\n${text.slice(0, 3000)}`

  try {
    const raw = await llmCall([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ])
    const json = extractJson(raw)
    if (!json) return extractKeywordsByRule(text)

    const tags: SemanticTags = emptyTags()
    if (Array.isArray(json.characters)) tags.characters = json.characters.slice(0, 5)
    if (Array.isArray(json.locations)) tags.locations = json.locations.slice(0, 5)
    if (Array.isArray(json.events)) tags.events = json.events.slice(0, 5)
    if (Array.isArray(json.emotions)) tags.emotions = json.emotions.slice(0, 5)
    if (Array.isArray(json.themes)) tags.themes = json.themes.slice(0, 5)
    if (Array.isArray(json.keywords)) tags.keywords = json.keywords.slice(0, 5)

    if (tags.keywords.length === 0) {
      tags.keywords = [
        ...tags.characters,
        ...tags.locations,
        ...tags.events
      ].slice(0, 10)
    }

    return tags
  } catch {
    return extractKeywordsByRule(text)
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 将语义标签转为可搜索的文本
 */
export function tagsToSearchText(tags: SemanticTags): string {
  const parts: string[] = []
  if (tags.characters.length) parts.push(tags.characters.join(' '))
  if (tags.locations.length) parts.push(tags.locations.join(' '))
  if (tags.events.length) parts.push(tags.events.join(' '))
  if (tags.emotions.length) parts.push(tags.emotions.join(' '))
  if (tags.themes.length) parts.push(tags.themes.join(' '))
  if (tags.keywords.length) parts.push(tags.keywords.join(' '))
  return parts.join(' ')
}

/**
 * 关键词 BM25 评分检索（不依赖 embedding API）
 */
export interface KeywordMatch {
  chunkId: string
  score: number
}

export function keywordSearch(
  query: string,
  chunks: Array<{ id: string; content: string; tags: SemanticTags }>,
  topK: number = 10
): KeywordMatch[] {
  const queryTags = extractKeywordsByRule(query)
  const queryBigrams = new Set(queryTags.keywords)

  if (queryBigrams.size === 0) {
    return chunks.slice(0, topK).map((c) => ({ chunkId: c.id, score: 0.5 }))
  }

  const scored: KeywordMatch[] = []

  for (const chunk of chunks) {
    const chunkTags = chunk.tags
    const chunkBigrams = new Set(chunkTags.keywords)

    let intersection = 0
    for (const bg of queryBigrams) {
      if (chunkBigrams.has(bg)) intersection++
    }

    let tagMatch = 0
    const tagFields = ['characters', 'locations', 'events', 'emotions', 'themes'] as const
    for (const field of tagFields) {
      const queryField = queryTags[field]
      const chunkField = chunkTags[field]
      if (queryField.length === 0 || chunkField.length === 0) continue
      for (const q of queryField) {
        for (const c of chunkField) {
          if (q.includes(c) || c.includes(q)) {
            tagMatch++
            break
          }
        }
      }
    }

    const bigramScore = queryBigrams.size > 0 ? intersection / queryBigrams.size : 0
    const tagScore = tagMatch * 0.15
    const score = bigramScore + tagScore

    if (score > 0) {
      scored.push({ chunkId: chunk.id, score })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}