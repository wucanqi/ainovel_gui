import { estimateTokens } from './token'

export interface Chunk {
  content: string
  chunk_index: number
  token_count: number
}

const TARGET_TOKENS = 400
const OVERLAP_TOKENS = 50
const FOUNDATION_TARGET_TOKENS = 1600
const FOUNDATION_OVERLAP_TOKENS = 200

export function splitText(text: string): Chunk[] {
  return splitTextWithOptions(text, TARGET_TOKENS, OVERLAP_TOKENS)
}

export function splitFoundationText(text: string): Chunk[] {
  return splitTextWithOptions(text, FOUNDATION_TARGET_TOKENS, FOUNDATION_OVERLAP_TOKENS)
}

function splitTextWithOptions(
  text: string,
  targetTokens: number,
  overlapTokens: number
): Chunk[] {
  if (!text || !text.trim()) return []
  // Split on all blank lines for paragraph boundaries, but also split
  // very long single-line blocks (e.g., markdown without blank lines between sections)
  const rawParagraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (rawParagraphs.length === 0) return []

  // Flatten: if a "paragraph" has internal single \n (list items, table of contents),
  // keep them as separate logical units for chunking
  const logicalUnits: string[] = []
  for (const p of rawParagraphs) {
    const lines = p.split(/\n/).filter(l => l.trim())
    if (lines.length > 1) {
      // Has internal line breaks — could be list, toc, etc. Keep as is.
      logicalUnits.push(p)
    } else {
      logicalUnits.push(p)
    }
  }

  console.log('[chunk] splitTextWithOptions', {
    charCount: text.length,
    paraCount: rawParagraphs.length,
    unitCount: logicalUnits.length,
    targetTokens,
    overlapTokens
  })

  const chunks: Chunk[] = []
  let buffer = ''
  let bufferTokens = 0
  let chunkIndex = 0

  for (const unit of logicalUnits) {
    const unitTokens = estimateTokens(unit)
    if (bufferTokens + unitTokens > targetTokens && buffer) {
      chunks.push({ content: buffer, chunk_index: chunkIndex, token_count: bufferTokens })
      chunkIndex++
      const overlap = takeTailTokens(buffer, overlapTokens)
      buffer = overlap + '\n\n' + unit
      bufferTokens = estimateTokens(buffer)
    } else {
      buffer = buffer ? `${buffer}\n\n${unit}` : unit
      bufferTokens += unitTokens
    }
  }

  if (buffer.trim()) {
    chunks.push({ content: buffer, chunk_index: chunkIndex, token_count: bufferTokens })
  }

  console.log('[chunk] splitTextWithOptions result:', { chunks: chunks.length, totalTokens: chunks.reduce((s, c) => s + c.token_count, 0) })
  return chunks
}

function takeTailTokens(text: string, maxTokens: number): string {
  const chars = Array.from(text)
  let tokens = 0
  let i = chars.length - 1
  const result: string[] = []
  while (i >= 0 && tokens < maxTokens) {
    const ch = chars[i]
    // Match estimateTokens: CJK ~1.5 tokens, ASCII ~0.25
    const isCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3400-\u4dbf\uf900-\ufaff]/.test(ch)
    tokens += isCjk ? 1.5 : 0.25
    result.unshift(ch)
    i--
  }
  return result.join('').trim()
}

export function buildCharacterText(c: {
  name: string
  aliases?: string[]
  role?: string
  appearance?: string
  personality?: string
  background?: string
  notes?: string
}): string {
  const parts: string[] = [`【人物】${c.name}`]
  if (c.aliases && c.aliases.length) parts.push(`别名：${c.aliases.join('、')}`)
  if (c.role) parts.push(`身份：${c.role}`)
  if (c.appearance) parts.push(`外貌：${c.appearance}`)
  if (c.personality) parts.push(`性格：${c.personality}`)
  if (c.background) parts.push(`背景：${c.background}`)
  if (c.notes) parts.push(`备注：${c.notes}`)
  return parts.join('\n')
}

export function buildLocationText(l: {
  name: string
  description?: string
}): string {
  const parts: string[] = [`【地点】${l.name}`]
  if (l.description) parts.push(l.description)
  return parts.join('\n')
}

export function buildLoreText(w: {
  category: string
  key: string
  value: string
}): string {
  return `【${w.category}】${w.key}：${w.value}`
}
