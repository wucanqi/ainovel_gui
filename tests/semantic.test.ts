import { describe, it, expect } from 'vitest'
import {
  extractKeywordsByRule,
  keywordSearch,
  type SemanticTags
} from '../electron/lib/semantic'

describe('Semantic Keyword Extraction', () => {
  it('should extract Chinese bigrams from text', () => {
    const tags = extractKeywordsByRule('张三站在山巅，望着远方的夕阳，心中充满了复仇的火焰')
    expect(tags.keywords.length).toBeGreaterThan(0)
    expect(tags.keywords).toContain('张三')
    expect(tags.keywords).toContain('复仇')
  })

  it('should return empty tags for empty text', () => {
    const tags = extractKeywordsByRule('')
    expect(tags.keywords).toEqual([])
    expect(tags.characters).toEqual([])
  })

  it('should extract keywords from mixed content', () => {
    const tags = extractKeywordsByRule('青云宗掌门林风在密室中发现了上古秘卷，上面记载着失传已久的九天剑诀')
    expect(tags.keywords.length).toBeGreaterThan(0)
    const hasKeywords = tags.keywords.some(
      (k) => k.includes('青云') || k.includes('林风') || k.includes('秘卷') || k.includes('剑诀')
    )
    expect(hasKeywords).toBe(true)
  })
})

describe('Keyword Search', () => {
  function makeChunk(id: string, content: string): { id: string; content: string; tags: SemanticTags } {
    return { id, content, tags: extractKeywordsByRule(content) }
  }

  it('should find relevant chunks by keyword matching', () => {
    const chunks = [
      makeChunk('1', '张三在青云山修炼剑法，日夜不辍'),
      makeChunk('2', '李四在繁华的京城经营一家酒楼'),
      makeChunk('3', '张三与仇敌在青云山巅决战，剑气纵横'),
    ]

    const results = keywordSearch('张三 青云山 剑法', chunks, 3)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].chunkId).toBe('1')
    expect(results[0].score).toBeGreaterThan(results[results.length - 1].score)
  })

  it('should return empty for no matches', () => {
    const chunks = [
      makeChunk('1', '今天天气很好'),
      makeChunk('2', '晚饭吃了面条'),
    ]

    const results = keywordSearch('修仙 法器 炼丹', chunks, 3)
    expect(results.length).toBe(0)
  })

  it('should handle empty query', () => {
    const chunks = [
      makeChunk('1', 'some content'),
    ]

    const results = keywordSearch('', chunks, 3)
    expect(results.length).toBeGreaterThanOrEqual(0)
  })

  it('should rank by relevance', () => {
    const chunks = [
      makeChunk('a', '无关内容毫无关联'),
      makeChunk('b', '张三修炼九阳神功，内力大增'),
      makeChunk('c', '张三在九阳洞中修炼神功，突破境界'),
    ]

    const results = keywordSearch('张三 九阳 神功 修炼', chunks, 3)
    expect(results.length).toBeGreaterThanOrEqual(2)
    const topIds = results.map((r) => r.chunkId)
    expect(topIds).toContain('b')
    expect(topIds).toContain('c')
    expect(results[0].score).toBeGreaterThan(0)
  })
})