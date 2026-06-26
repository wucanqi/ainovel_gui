import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { estimateTokens } from '../lib/token'
import { splitFoundationText, splitText } from '../lib/chunk'
import { embed, embedBatch, vectorToBlob, blobToVector } from './embedding.service'
import * as chapterService from './chapter.service'
import * as characterService from './character.service'
import * as locationService from './location.service'
import * as worldbuildingService from './worldbuilding.service'
import {
  buildCharacterText,
  buildLocationText,
  buildLoreText
} from '../lib/chunk'
import {
  extractKeywordsByRule,
  extractTagsByLLM,
  type SemanticTags,
  keywordSearch,
  tagsToSearchText
} from '../lib/semantic'
import { getRagParams } from './settings.service'
import { chatLLM } from './ai.service'
import type {
  MemoryChunk,
  MemoryStats,
  MemorySourceType,
  RetrievedChunk,
  RagContext
} from '@shared/types'

type Row = {
  id: string
  project_id: string
  source_type: MemorySourceType
  source_id: string
  chunk_index: number
  content: string
  token_count: number
  embedding: Buffer | null
  tags: string | null
  created_at: number
  updated_at: number
}

function mapRow(r: Row): MemoryChunk & { tags: SemanticTags } {
  let tags: SemanticTags = emptyTagsObj()
  try {
    if (r.tags) tags = JSON.parse(r.tags) as SemanticTags
  } catch { /* keep default */ }
  return {
    id: r.id,
    project_id: r.project_id,
    source_type: r.source_type,
    source_id: r.source_id,
    chunk_index: r.chunk_index,
    content: r.content,
    token_count: r.token_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
    tags
  }
}

function emptyTagsObj(): SemanticTags {
  return { characters: [], locations: [], events: [], emotions: [], themes: [], keywords: [] }
}

export function listChunks(
  projectId: string,
  filter?: { source_type?: MemorySourceType }
): MemoryChunk[] {
  const db = getDb()
  if (filter?.source_type) {
    const rows = db
      .prepare(
        'SELECT id, project_id, source_type, source_id, chunk_index, content, token_count, created_at, updated_at FROM memory_chunks WHERE project_id = ? AND source_type = ? ORDER BY updated_at DESC'
      )
      .all(projectId, filter.source_type) as Row[]
    return rows.map(mapRow)
  }
  const rows = db
    .prepare(
      'SELECT id, project_id, source_type, source_id, chunk_index, content, token_count, created_at, updated_at FROM memory_chunks WHERE project_id = ? ORDER BY updated_at DESC'
    )
    .all(projectId) as Row[]
  return rows.map(mapRow)
}

export function getStats(projectId: string): MemoryStats {
  const db = getDb()
  const row = db
    .prepare(
      'SELECT count(*) AS c, COALESCE(sum(token_count),0) AS t FROM memory_chunks WHERE project_id = ?'
    )
    .get(projectId) as { c: number; t: number }
  return { totalChunks: row.c, totalTokens: row.t }
}

export function deleteBySource(
  projectId: string,
  sourceType: MemorySourceType,
  sourceId: string
): void {
  getDb()
    .prepare(
      'DELETE FROM memory_chunks WHERE project_id = ? AND source_type = ? AND source_id = ?'
    )
    .run(projectId, sourceType, sourceId)
}

export function deleteChunk(id: string): void {
  getDb().prepare('DELETE FROM memory_chunks WHERE id = ?').run(id)
}

async function extractTags(text: string): Promise<SemanticTags> {
  try {
    return await extractTagsByLLM(text, async (messages) => {
      return chatLLM(messages as Array<{ role: string; content: string }>)
    })
  } catch {
    return extractKeywordsByRule(text)
  }
}

export function insertChunk(input: {
  project_id: string
  source_type: MemorySourceType
  source_id: string
  chunk_index: number
  content: string
}): MemoryChunk {
  const ts = now()
  const id = uuid()
  const tokenCount = estimateTokens(input.content)
  const tags = extractKeywordsByRule(input.content)
  getDb()
    .prepare(
      `INSERT INTO memory_chunks
       (id, project_id, source_type, source_id, chunk_index, content, token_count, embedding, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      id,
      input.project_id,
      input.source_type,
      input.source_id,
      input.chunk_index,
      input.content,
      tokenCount,
      JSON.stringify(tags),
      ts,
      ts
    )
  return mapRow(
    getDb().prepare('SELECT * FROM memory_chunks WHERE id = ?').get(id) as Row
  )
}

function insertChunkWithEmbedding(input: {
  project_id: string
  source_type: MemorySourceType
  source_id: string
  chunk_index: number
  content: string
  embedding: number[]
  tags: SemanticTags
}): void {
  const ts = now()
  const id = uuid()
  const tokenCount = estimateTokens(input.content)
  getDb()
    .prepare(
      `INSERT INTO memory_chunks
       (id, project_id, source_type, source_id, chunk_index, content, token_count, embedding, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.project_id,
      input.source_type,
      input.source_id,
      input.chunk_index,
      input.content,
      tokenCount,
      vectorToBlob(input.embedding),
      JSON.stringify(input.tags),
      ts,
      ts
    )
}

export async function rebuildChapter(
  projectId: string,
  chapterId: string
): Promise<number> {
  const chapter = chapterService.get(chapterId)
  deleteBySource(projectId, 'chapter', chapterId)
  if (!chapter || !chapter.plain_text.trim()) return 0

  const chunks = splitText(chapter.plain_text)
  if (chunks.length === 0) return 0

  let embeddings: Array<{ vector: number[] }> = []
  let useEmbedding = false
  try {
    embeddings = await embedBatch(chunks.map((c) => c.content))
    useEmbedding = true
  } catch (e) {
    console.warn('[memory] embedding failed, using keyword-only indexing:', (e as Error).message)
  }

  const tagsList: SemanticTags[] = []
  try {
    for (const chunk of chunks) {
      const tags = await extractTags(chunk.content)
      tagsList.push(tags)
    }
  } catch {
    for (const chunk of chunks) {
      tagsList.push(extractKeywordsByRule(chunk.content))
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    if (useEmbedding) {
      insertChunkWithEmbedding({
        project_id: projectId,
        source_type: 'chapter',
        source_id: chapterId,
        chunk_index: chunks[i].chunk_index,
        content: chunks[i].content,
        embedding: embeddings[i].vector,
        tags: tagsList[i]
      })
    } else {
      const ts = now()
      const id = uuid()
      const tokenCount = estimateTokens(chunks[i].content)
      getDb()
        .prepare(
          `INSERT INTO memory_chunks
           (id, project_id, source_type, source_id, chunk_index, content, token_count, embedding, tags, created_at, updated_at)
           VALUES (?, ?, 'chapter', ?, ?, ?, ?, NULL, ?, ?, ?)`
        )
        .run(
          id,
          projectId,
          chapterId,
          chunks[i].chunk_index,
          chunks[i].content,
          tokenCount,
          JSON.stringify(tagsList[i]),
          now(),
          now()
        )
    }
  }
  return chunks.length
}

export async function rebuildLore(
  projectId: string,
  sourceType: MemorySourceType,
  sourceId: string
): Promise<number> {
  deleteBySource(projectId, sourceType, sourceId)

  let text: string | null = null
  if (sourceType === 'character') {
    const c = characterService.list(projectId).find((x) => x.id === sourceId)
    if (c) text = buildCharacterText(c)
  } else if (sourceType === 'location') {
    const l = locationService.list(projectId).find((x) => x.id === sourceId)
    if (l) text = buildLocationText(l)
  } else if (sourceType === 'lore') {
    const w = worldbuildingService.list(projectId).find((x) => x.id === sourceId)
    if (w) text = buildLoreText(w)
  }

  if (!text) return 0

  let tags: SemanticTags
  try {
    tags = await extractTags(text)
  } catch {
    tags = extractKeywordsByRule(text)
  }

  let useEmbedding = false
  try {
    const { vector } = await embed(text)
    insertChunkWithEmbedding({
      project_id: projectId,
      source_type: sourceType,
      source_id: sourceId,
      chunk_index: 0,
      content: text,
      embedding: vector,
      tags
    })
    useEmbedding = true
  } catch (e) {
    console.warn('[memory] embedding failed for lore, using keyword-only:', (e as Error).message)
  }

  if (!useEmbedding) {
    const ts = now()
    const id = uuid()
    getDb()
      .prepare(
        `INSERT INTO memory_chunks
         (id, project_id, source_type, source_id, chunk_index, content, token_count, embedding, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        sourceType,
        sourceId,
        text,
        estimateTokens(text),
        JSON.stringify(tags),
        ts,
        ts
      )
  }

  return 1
}

export async function rebuildFoundationDocument(
  projectId: string,
  documentId: string
): Promise<number> {
  deleteBySource(projectId, 'foundation', documentId)

  const row = getDb()
    .prepare(
      'SELECT filename, content FROM imported_documents WHERE id = ? AND project_id = ?'
    )
    .get(documentId, projectId) as { filename: string; content: string } | undefined

  if (!row?.content?.trim()) return 0

  const origLen = row.content.length
  const chunks = splitFoundationText(row.content)
  if (chunks.length === 0) return 0
  console.log('[memory] rebuildFoundation:', {
    file: row.filename.slice(0, 30),
    origChars: origLen,
    chunks: chunks.length,
    chunkSizes: chunks.map(c => ({ idx: c.chunk_index, chars: c.content.length, tokens: c.token_count }))
  })

  let embeddings: Array<{ vector: number[] }> = []
  let useEmbedding = false
  try {
    embeddings = await embedBatch(chunks.map((c) => buildFoundationChunk(row.filename, c.content)))
    useEmbedding = true
  } catch (e) {
    console.warn('[memory] embedding failed for foundation, using keyword-only:', (e as Error).message)
  }

  const tagsList: SemanticTags[] = []
  for (const chunk of chunks) {
    const text = buildFoundationChunk(row.filename, chunk.content)
    try {
      tagsList.push(await extractTags(text))
    } catch {
      tagsList.push(extractKeywordsByRule(text))
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    const text = buildFoundationChunk(row.filename, chunks[i].content)
    if (useEmbedding) {
      insertChunkWithEmbedding({
        project_id: projectId,
        source_type: 'foundation',
        source_id: documentId,
        chunk_index: chunks[i].chunk_index,
        content: text,
        embedding: embeddings[i].vector,
        tags: tagsList[i]
      })
    } else {
      const ts = now()
      const id = uuid()
      getDb()
        .prepare(
          `INSERT INTO memory_chunks
           (id, project_id, source_type, source_id, chunk_index, content, token_count, embedding, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
        )
        .run(
          id,
          projectId,
          'foundation',
          documentId,
          chunks[i].chunk_index,
          text,
          estimateTokens(text),
          JSON.stringify(tagsList[i]),
          ts,
          ts
        )
    }
  }

  return chunks.length
}

export async function rebuildFoundations(projectId: string): Promise<number> {
  const docs = getDb()
    .prepare(
      "SELECT id FROM imported_documents WHERE project_id = ? AND status IN ('parsed', 'merged') ORDER BY created_at ASC"
    )
    .all(projectId) as Array<{ id: string }>

  let total = 0
  for (const doc of docs) {
    total += await rebuildFoundationDocument(projectId, doc.id)
  }
  return total
}

export async function rebuildAll(projectId: string): Promise<void> {
  const db = getDb()
  db.prepare('DELETE FROM memory_chunks WHERE project_id = ?').run(projectId)

  const chapters = chapterService.listByProject(projectId)
  const characters = characterService.list(projectId)
  const locations = locationService.list(projectId)
  const lores = worldbuildingService.list(projectId)
  const foundations = db
    .prepare(
      "SELECT id FROM imported_documents WHERE project_id = ? AND status IN ('parsed', 'merged')"
    )
    .all(projectId) as Array<{ id: string }>

  const total = chapters.length + characters.length + locations.length + lores.length + foundations.length
  let done = 0

  for (const ch of chapters) {
    await rebuildChapter(projectId, ch.id)
    done++
    emitProgress(done, total)
  }
  for (const c of characters) {
    await rebuildLore(projectId, 'character', c.id)
    done++
    emitProgress(done, total)
  }
  for (const l of locations) {
    await rebuildLore(projectId, 'location', l.id)
    done++
    emitProgress(done, total)
  }
  for (const w of lores) {
    await rebuildLore(projectId, 'lore', w.id)
    done++
    emitProgress(done, total)
  }
  for (const doc of foundations) {
    await rebuildFoundationDocument(projectId, doc.id)
    done++
    emitProgress(done, total)
  }
}

function emitProgress(done: number, total: number): void {
  const { BrowserWindow } = require('electron')
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('event:memoryProgress', { done, total })
  }
}

function hasEmbeddings(projectId: string): boolean {
  const db = getDb()
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM memory_chunks WHERE project_id = ? AND embedding IS NOT NULL'
  ).get(projectId) as { c: number }
  return row.c > 0
}

export async function search(
  projectId: string,
  query: string,
  topK = 15
): Promise<Array<MemoryChunk & { score: number }>> {
  if (hasEmbeddings(projectId)) {
    const vecResults = await vectorSearch(projectId, query, topK)
    // Also pull in foundation chunks without embeddings (embedding may have failed)
    const missingFoundation = getFoundationChunksWithoutEmbeddings(projectId)
    if (missingFoundation.length > 0) {
      console.log('[Memory] search: including', missingFoundation.length, 'foundation chunks without embeddings')
      // Give foundation chunks a high score so they appear near the top
      const merged = [...vecResults]
      for (const chunk of missingFoundation) {
        if (!merged.some(r => r.id === chunk.id)) {
          merged.push({ ...mapRow(chunk), score: 0.95 })
        }
      }
      merged.sort((a, b) => b.score - a.score)
      return merged.slice(0, topK * 2)
    }
    return vecResults
  }
  return keywordBasedSearch(projectId, query, topK)
}

function getFoundationChunksWithoutEmbeddings(projectId: string): Row[] {
  const db = getDb()
  return db.prepare(
    "SELECT * FROM memory_chunks WHERE project_id = ? AND source_type = 'foundation' AND embedding IS NULL"
  ).all(projectId) as Row[]
}

async function vectorSearch(
  projectId: string,
  query: string,
  topK: number
): Promise<Array<MemoryChunk & { score: number }>> {
  const { vector } = await embed(query)
  const db = getDb()

  const rows = db
    .prepare(
      `SELECT id, project_id, source_type, source_id, chunk_index, content, token_count, embedding, tags, created_at, updated_at
       FROM memory_chunks
       WHERE project_id = ? AND embedding IS NOT NULL`
    )
    .all(projectId) as Row[]

  const scored = rows.map((r) => {
    const vec = blobToVector(r.embedding!)
    const score = cosineSimilarity(vector, vec)
    return { ...mapRow(r), score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

function keywordBasedSearch(
  projectId: string,
  query: string,
  topK: number
): Array<MemoryChunk & { score: number }> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, project_id, source_type, source_id, chunk_index, content, token_count, tags, created_at, updated_at
       FROM memory_chunks
       WHERE project_id = ?`
    )
    .all(projectId) as Row[]

  const chunks = rows.map((r) => {
    const m = mapRow(r)
    return { id: m.id, content: m.content, tags: m.tags }
  })

  const matches = keywordSearch(query, chunks, topK)
  const matchMap = new Map(matches.map((m) => [m.chunkId, m.score]))

  const result = rows
    .map((r) => {
      const m = mapRow(r)
      return { ...m, score: matchMap.get(m.id) || 0 }
    })
    .filter((r) => r.score > 0)

  result.sort((a, b) => b.score - a.score)
  return result.slice(0, topK)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export async function buildContext(
  projectId: string,
  query: string,
  currentChapterId?: string
): Promise<RagContext> {
  const params = await getRagParams()
  const topK = params.topK
  const results = await search(projectId, query, topK)

  const byType: Record<MemorySourceType, Array<MemoryChunk & { score: number }>> = {
    chapter: [],
    character: [],
    location: [],
    lore: [],
    foundation: []
  }
  for (const r of results) {
    byType[r.source_type].push(r)
  }

  console.log('[Memory] buildContext', {
    query: query.slice(0, 50), totalResults: results.length,
    chapter: byType.chapter.length, character: byType.character.length,
    location: byType.location.length, lore: byType.lore.length,
    foundation: byType.foundation.length
  })

  const picked: RetrievedChunk[] = []
  const limits: Record<MemorySourceType, number> = {
    chapter: params.chapter_top,
    character: params.character_top,
    location: params.location_top,
    lore: params.enable_lore_injection ? params.lore_top : 0,
    foundation: params.foundation_top || Math.max(8, Math.floor(params.lore_top * 2))
  }

  for (const type of Object.keys(byType) as MemorySourceType[]) {
    const items = byType[type].slice(0, limits[type])
    for (const item of items) {
      picked.push({
        chunk_id: item.id,
        source_type: item.source_type,
        source_id: item.source_id,
        content: item.content,
        score: item.score,
        token_count: item.token_count
      })
    }
  }

  let currentChapterTail = ''
  if (currentChapterId) {
    const ch = chapterService.get(currentChapterId)
    if (ch && ch.plain_text) {
      const tail = ch.plain_text.slice(-params.current_chapter_tail_chars)
      currentChapterTail = tail
    }
  }

  let totalTokens = 0
  for (const c of picked) totalTokens += c.token_count
  totalTokens += estimateTokens(currentChapterTail)

  while (totalTokens > params.context_token_budget && picked.length > 0) {
    const removed = picked.pop()!
    totalTokens -= removed.token_count
  }

  return { chunks: picked, current_chapter_tail: currentChapterTail, total_tokens: totalTokens }
}

function buildFoundationChunk(filename: string, content: string): string {
  return `【导入文档】${filename}\n${content}`.trim()
}
