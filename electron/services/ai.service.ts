import { BrowserWindow } from 'electron'
import { getDb } from '../db'
import { uuid, now } from '../lib/util'
import { getActive, getProviderForTier } from './config.service'
import { buildContext } from './memory.service'
import * as chapterService from './chapter.service'
import { resolveModel } from './model-router.service'
import type {
  AiSession,
  AiMessage,
  ContinueParams,
  PolishParams,
  RewriteParams,
  ChatParams,
  RagContext,
  AiTaskType
} from '@shared/types'

let abortController: AbortController | null = null

type SessionRow = {
  id: string
  project_id: string
  type: string
  title: string
  created_at: number
}

type MessageRow = {
  id: string
  session_id: string
  role: string
  content: string
  context_refs: string
  created_at: number
}

function mapSession(r: SessionRow): AiSession {
  return {
    id: r.id,
    project_id: r.project_id,
    type: r.type as AiTaskType,
    title: r.title,
    created_at: r.created_at
  }
}

function mapMessage(r: MessageRow): AiMessage {
  let refs: string[] = []
  try {
    refs = JSON.parse(r.context_refs) as string[]
  } catch {
    refs = []
  }
  return {
    id: r.id,
    session_id: r.session_id,
    role: r.role as AiMessage['role'],
    content: r.content,
    context_refs: refs,
    created_at: r.created_at
  }
}

export function listSessions(projectId: string): AiSession[] {
  const rows = getDb()
    .prepare('SELECT * FROM ai_sessions WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as SessionRow[]
  return rows.map(mapSession)
}

export function getMessages(sessionId: string): AiMessage[] {
  const rows = getDb()
    .prepare('SELECT * FROM ai_messages WHERE session_id = ? ORDER BY created_at ASC')
    .all(sessionId) as MessageRow[]
  return rows.map(mapMessage)
}

export function deleteSession(id: string): void {
  getDb().prepare('DELETE FROM ai_sessions WHERE id = ?').run(id)
}

function createSession(projectId: string, type: AiTaskType, title: string): AiSession {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      'INSERT INTO ai_sessions (id, project_id, type, title, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, projectId, type, title, ts)
  return mapSession(getDb().prepare('SELECT * FROM ai_sessions WHERE id = ?').get(id) as SessionRow)
}

function addMessage(
  sessionId: string,
  role: AiMessage['role'],
  content: string,
  contextRefs: string[] = []
): AiMessage {
  const id = uuid()
  const ts = now()
  getDb()
    .prepare(
      'INSERT INTO ai_messages (id, session_id, role, content, context_refs, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(id, sessionId, role, content, JSON.stringify(contextRefs), ts)
  return mapMessage(
    getDb().prepare('SELECT * FROM ai_messages WHERE id = ?').get(id) as MessageRow
  )
}

function emit(event: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(`event:${event}`, payload)
  }
}

async function streamChat(
  messages: Array<{ role: string; content: string }>,
  onToken: (token: string) => void
): Promise<string> {
  const provider = getActive()
  if (!provider) throw new Error('未配置 API，请先在设置中添加')
  if (!provider.apiKey) throw new Error('API Key 未设置')

  const url = `${provider.base_url.replace(/\/$/, '')}/chat/completions`
  const model = provider.llm_model || 'gpt-4o-mini'

  abortController = new AbortController()
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: abortController.signal
  })

  if (!resp.ok) {
    const detail = await resp.text()
    throw new Error(`LLM API 错误 ${resp.status}: ${detail}`)
  }

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data) as {
          choices: Array<{ delta: { content?: string } }>
        }
        const token = json.choices[0]?.delta?.content
        if (token) {
          full += token
          onToken(token)
        }
      } catch {
        // ignore parse errors for partial chunks
      }
    }
  }
  abortController = null
  return full
}

export async function chatLLM(
  messages: Array<{ role: string; content: string }>,
  route?: { agentType?: string; taskType?: string; riskLevel?: 'low' | 'normal' | 'high' | 'critical'; forceTier?: 'flash' | 'pro' }
): Promise<string> {
  const routing = route?.agentType && route?.taskType
    ? resolveModel(route.agentType, route.taskType, {
        riskLevel: route.riskLevel,
        forceTier: route.forceTier
      })
    : null
  const provider = routing ? (getProviderForTier(routing.tier) || getActive()) : getActive()
  if (!provider) throw new Error('未配置 API，请先在设置中添加')
  if (!provider.apiKey) throw new Error('API Key 未设置')

  const url = `${provider.base_url.replace(/\/$/, '')}/chat/completions`
  const model = routing?.model || provider.llm_model || 'gpt-4o-mini'

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({ model, messages, stream: false })
  })

  if (!resp.ok) {
    const detail = await resp.text()
    throw new Error(`LLM API 错误 ${resp.status}: ${detail}`)
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>
  }
  return data.choices[0]?.message?.content || ''
}

export function stop(): void {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}

function formatContext(ctx: RagContext): string {
  const parts: string[] = []
  const characters = ctx.chunks.filter((c) => c.source_type === 'character')
  const locations = ctx.chunks.filter((c) => c.source_type === 'location')
  const lores = ctx.chunks.filter((c) => c.source_type === 'lore')
  const foundations = ctx.chunks.filter((c) => c.source_type === 'foundation')
  const chapters = ctx.chunks.filter((c) => c.source_type === 'chapter')

  if (characters.length) {
    parts.push('## 人物设定\n' + characters.map((c) => c.content).join('\n\n'))
  }
  if (foundations.length) {
    parts.push('## 导入文档依据\n' + foundations.map((c) => c.content).join('\n\n---\n\n'))
  }
  if (lores.length) {
    parts.push('## 世界观设定\n' + lores.map((c) => c.content).join('\n\n'))
  }
  if (locations.length) {
    parts.push('## 地点设定\n' + locations.map((c) => c.content).join('\n\n'))
  }
  if (ctx.current_chapter_tail) {
    parts.push('## 当前章节最近内容\n' + ctx.current_chapter_tail)
  }
  if (chapters.length) {
    parts.push('## 相关前文片段\n' + chapters.map((c) => c.content).join('\n\n---\n\n'))
  }
  return parts.join('\n\n')
}

export async function continueWrite(params: ContinueParams): Promise<void> {
  try {
    const ctx = await buildContext(
      params.project_id,
      params.cursor_before,
      params.chapter_id
    )
    const contextStr = formatContext(ctx)
    const session = createSession(params.project_id, 'continue', '续写')
    addMessage(session.id, 'user', params.cursor_before, ctx.chunks.map((c) => c.chunk_id))

    const messages = [
      {
        role: 'system',
        content: `你是一位专业的小说创作助手。请根据以下小说设定与前文，续写故事。
要求：
1. 严格保持人物性格、关系、设定的连贯性
2. 语言风格与前文一致
3. 不要重复前文内容
4. 续写约 500-800 字

${contextStr}`
      },
      { role: 'user', content: `请续写以下内容：\n\n${params.cursor_before}` }
    ]

    let full = ''
    await streamChat(messages, (token) => {
      full += token
      emit('aiToken', { session_id: session.id, token })
    })
    addMessage(session.id, 'assistant', full)
    emit('aiDone', { session_id: session.id, content: full })
  } catch (e) {
    emit('aiError', { message: (e as Error).message })
  }
}

export async function polish(params: PolishParams): Promise<void> {
  try {
    const ctx = await buildContext(params.project_id, params.selected_text)
    const contextStr = formatContext(ctx)
    const session = createSession(params.project_id, 'polish', '润色')
    addMessage(session.id, 'user', params.selected_text, ctx.chunks.map((c) => c.chunk_id))

    const messages = [
      {
        role: 'system',
        content: `你是专业文字编辑。请润色以下选中的文本，风格：${params.style}。
保持原意，不改变情节，仅优化表达。直接输出润色后的文本，不要解释。

${contextStr}`
      },
      { role: 'user', content: params.selected_text }
    ]

    let full = ''
    await streamChat(messages, (token) => {
      full += token
      emit('aiToken', { session_id: session.id, token })
    })
    addMessage(session.id, 'assistant', full)
    emit('aiDone', { session_id: session.id, content: full })
  } catch (e) {
    emit('aiError', { message: (e as Error).message })
  }
}

export async function rewrite(params: RewriteParams): Promise<void> {
  try {
    const ctx = await buildContext(params.project_id, params.selected_text)
    const contextStr = formatContext(ctx)
    const session = createSession(params.project_id, 'rewrite', '改写')
    addMessage(session.id, 'user', params.selected_text, ctx.chunks.map((c) => c.chunk_id))

    const instruction = params.instruction
      ? `\n改写要求：${params.instruction}`
      : ''
    const messages = [
      {
        role: 'system',
        content: `你是专业小说编辑。请改写以下文本，保持情节一致但优化表达。直接输出改写后的文本，不要解释。${instruction}

${contextStr}`
      },
      { role: 'user', content: params.selected_text }
    ]

    let full = ''
    await streamChat(messages, (token) => {
      full += token
      emit('aiToken', { session_id: session.id, token })
    })
    addMessage(session.id, 'assistant', full)
    emit('aiDone', { session_id: session.id, content: full })
  } catch (e) {
    emit('aiError', { message: (e as Error).message })
  }
}

export async function chat(params: ChatParams): Promise<void> {
  try {
    let sessionId = params.session_id
    if (!sessionId) {
      const session = createSession(params.project_id, 'chat', params.message.slice(0, 30))
      sessionId = session.id
    } else {
      addMessage(sessionId, 'user', params.message)
    }

    const ctx = await buildContext(params.project_id, params.message)
    const contextStr = formatContext(ctx)
    const history = getMessages(sessionId).slice(-10)

    const messages = [
      {
        role: 'system',
        content: `你是小说创作助手。基于以下小说设定与前文回答作者问题。
若信息不足，明确说明，不要编造设定。

${contextStr}`
      },
      ...history.map((m) => ({ role: m.role, content: m.content }))
    ]

    emit('aiToken', { session_id: sessionId, token: '', start: true })
    let full = ''
    await streamChat(messages, (token) => {
      full += token
      emit('aiToken', { session_id: sessionId, token })
    })
    addMessage(sessionId, 'assistant', full, ctx.chunks.map((c) => c.chunk_id))
    emit('aiDone', { session_id: sessionId, content: full })
  } catch (e) {
    emit('aiError', { message: (e as Error).message })
  }
}
