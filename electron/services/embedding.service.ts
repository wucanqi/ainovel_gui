import { getActiveEmbedding, getActive } from './config.service'
import type { ApiProvider } from '@shared/types'

export interface EmbeddingResult {
  vector: number[]
  model: string
}

function isOllama(provider: ApiProvider): boolean {
  return provider.provider === 'ollama' || provider.base_url.includes('11434')
}

export function embeddingAvailable(): boolean {
  return !!(getActiveEmbedding() || getActive())
}

async function ollamaEmbed(text: string, provider: ApiProvider & { apiKey: string }): Promise<EmbeddingResult> {
  const url = `${provider.base_url.replace(/\/$/, '')}/api/embeddings`
  const model = provider.embedding_model || 'nomic-embed-text'

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text })
  })

  if (!resp.ok) {
    const detail = await resp.text()
    throw new Error(`Ollama Embedding 错误 ${resp.status}: ${detail}`)
  }

  const data = (await resp.json()) as { embedding: number[] }
  return { vector: data.embedding, model }
}

async function openaiEmbed(text: string, provider: ApiProvider & { apiKey: string }): Promise<EmbeddingResult> {
  const url = `${provider.base_url.replace(/\/$/, '')}/embeddings`
  const model = provider.embedding_model || 'text-embedding-3-small'

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({ model, input: text })
  })

  if (!resp.ok) {
    const detail = await resp.text()
    throw new Error(`Embedding API 错误 ${resp.status}: ${detail}`)
  }

  const data = (await resp.json()) as {
    data: Array<{ embedding: number[] }>
    model: string
  }
  return { vector: data.data[0].embedding, model: data.model }
}

async function openaiEmbedBatch(texts: string[], provider: ApiProvider & { apiKey: string }): Promise<EmbeddingResult[]> {
  const url = `${provider.base_url.replace(/\/$/, '')}/embeddings`
  const model = provider.embedding_model || 'text-embedding-3-small'

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({ model, input: texts })
  })

  if (!resp.ok) {
    const detail = await resp.text()
    throw new Error(`Embedding API 错误 ${resp.status}: ${detail}`)
  }

  const data = (await resp.json()) as {
    data: Array<{ embedding: number[] }>
    model: string
  }
  return data.data.map((d) => ({ vector: d.embedding, model: data.model }))
}

export async function embed(text: string): Promise<EmbeddingResult> {
  const provider = getActiveEmbedding()
  if (!provider) throw new Error('未配置 Embedding API，请先在设置中添加 API 配置')

  if (isOllama(provider)) {
    return ollamaEmbed(text, provider)
  }

  if (!provider.apiKey) throw new Error('Embedding API Key 未设置')
  return openaiEmbed(text, provider)
}

export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return []
  const provider = getActiveEmbedding()
  if (!provider) throw new Error('未配置 Embedding API')

  if (isOllama(provider)) {
    const results: EmbeddingResult[] = []
    for (const text of texts) {
      results.push(await ollamaEmbed(text, provider))
    }
    return results
  }

  if (!provider.apiKey) throw new Error('Embedding API Key 未设置')
  return openaiEmbedBatch(texts, provider)
}

export function vectorToBlob(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4)
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4)
  }
  return buf
}

export function blobToVector(buf: Buffer): number[] {
  const count = buf.length / 4
  const vec = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    vec[i] = buf.readFloatLE(i * 4)
  }
  return vec
}

export async function testEmbeddingConnection(): Promise<{ ok: boolean; message: string; model: string; dims?: number }> {
  const provider = getActiveEmbedding()
  if (!provider) return { ok: false, message: '未配置 Embedding API。请在设置中添加并设为 Embedding 活跃', model: '' }

  const model = provider.embedding_model || 'text-embedding-3-small'
  try {
    const result = await embed('测试连接')
    return { ok: true, message: `连接成功`, model: result.model, dims: result.vector.length }
  } catch (e) {
    return { ok: false, message: (e as Error).message, model }
  }
}