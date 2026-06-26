import { getDb } from '../db'
import { getActive, getProviderForTier } from './config.service'
import { resolveModel } from './model-router.service'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

// Compression levels (increasing cost, increasing compression ratio)
type CompactionLevel = 'none' | 'tool_compact' | 'store_compact' | 'llm_summary'

// Track compaction state per project
interface CompactionState {
  lastLevel: CompactionLevel
  lastCompactAt: number
  compactCount: number
  consecutiveFailures: number
  summaryMessage: LlmMessage | null
}

const states = new Map<string, CompactionState>()

function getState(projectId: string): CompactionState {
  if (!states.has(projectId)) {
    states.set(projectId, { lastLevel: 'none', lastCompactAt: 0, compactCount: 0, consecutiveFailures: 0, summaryMessage: null })
  }
  return states.get(projectId)!
}

function resetState(projectId: string): void {
  states.delete(projectId)
}

// ── Token estimation (Chinese-aware) ──

function estimateTokens(text: string): number {
  if (!text) return 0
  const runes = Array.from(text).length
  // CJK characters ~1.5 tokens per character, ASCII ~0.25 per char
  const cjkCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length
  const asciiCount = runes - cjkCount
  return Math.ceil(cjkCount * 1.5 + asciiCount * 0.25)
}

export function estimateMessagesTokens(messages: LlmMessage[]): number {
  let total = 0
  for (const m of messages) {
    if (m.content) total += estimateTokens(m.content)
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += estimateTokens(tc.function.name)
        total += estimateTokens(tc.function.arguments)
      }
    }
  }
  return total
}

// ── Health level ──

function healthLevel(tokens: number, window: number): 'green' | 'yellow' | 'red' {
  if (tokens < window * 0.7) return 'green'
  if (tokens < window * 0.85) return 'yellow'
  return 'red'
}

// ── Level 1: ToolResultCompact ──
// Trim old tool call results: keep only success/error + truncated summary.
// No LLM cost. Applied to messages older than the most recent N.

function compactToolResults(messages: LlmMessage[], keepRecent: number): LlmMessage[] {
  if (messages.length <= keepRecent) return messages
  const keep = messages.slice(-keepRecent)
  const old = messages.slice(0, -keepRecent)
  const compacted: LlmMessage[] = []
  for (const m of old) {
    if (m.role === 'tool' && m.content) {
      try {
        const parsed = JSON.parse(m.content) as Record<string, unknown>
        compacted.push({
          ...m,
          content: JSON.stringify({
            success: parsed.success,
            summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 200) : '',
            agent: parsed.agent,
            task: typeof parsed.task === 'string' ? parsed.task.slice(0, 100) : '',
            _compacted: true
          })
        })
      } catch {
        compacted.push({ ...m, content: m.content.slice(0, 300) + ' [truncated]' })
      }
    } else if (m.role === 'assistant' && m.content) {
      // Truncate long assistant responses, keep first 500 chars
      compacted.push({ ...m, content: m.content.slice(0, 500) + (m.content.length > 500 ? '...[截断]' : '') })
    } else {
      compacted.push(m)
    }
  }
  return [...compacted, ...keep]
}

// ── Level 2: StoreSummaryCompact ──
// Replace old subagent tool call/result pairs with a summary from the DB.
// Zero LLM cost. Reads from agent_decisions table.

function storeSummaryCompact(projectId: string, messages: LlmMessage[], keepRecent: number): LlmMessage[] {
  if (messages.length <= keepRecent) return messages
  const keep = messages.slice(-keepRecent)
  const old = messages.slice(0, -keepRecent)

  // Extract subagent summaries from DB
  const db = getDb()
  const summaries = db.prepare(
    `SELECT agent_type, tool_name, substr(thinking, 1, 500) as think_snippet, created_at
     FROM agent_decisions
     WHERE project_id = ?
     ORDER BY created_at DESC LIMIT 30`
  ).all(projectId) as Array<{ agent_type: string; tool_name: string; think_snippet: string; created_at: number }>

  const summaryText = summaries.length > 0
    ? `[历史摘要] 最近 ${summaries.length} 次工具调用:\n${summaries.map(s => `- ${s.agent_type}: ${s.tool_name} (${s.think_snippet.slice(0, 100)})`).join('\n')}`
    : ''

  // Keep system prompt + 1 summary message + recent messages
  const systemMsgs = messages.filter(m => m.role === 'system')
  return [...systemMsgs, { role: 'user', content: summaryText }, ...keep]
}

// ── Level 3: LLM FullSummary ──
// Use LLM to summarize old conversation. Most expensive but highest compression.

async function llmSummaryCompact(
  projectId: string,
  messages: LlmMessage[],
  keepRecent: number,
  signal?: AbortSignal
): Promise<LlmMessage[] | null> {
  if (messages.length <= keepRecent) return null
  const keep = messages.slice(-keepRecent)
  const oldText = messages.slice(0, -keepRecent)
    .filter(m => m.role !== 'system')
    .map(m => `[${m.role}] ${(m.content ?? '').slice(0, 2000)}`)
    .join('\n---\n')

  if (!oldText.trim()) return null

  try {
    const provider = getActive()
    if (!provider) return null

    const routing = resolveModel('architect', 'summarize', { riskLevel: 'low' })
    const routed = getProviderForTier(routing.tier) || provider
    const url = `${routed.base_url.replace(/\/$/, '')}/chat/completions`
    const model = routing.model || routed.llm_model || provider.llm_model || 'gpt-4o-mini'

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${routed.apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '用中文简要总结以下AI写作对话的关键进展。格式：已创建的基础设定列表、已完成章节列表、当前进行中的任务、待处理事项。不超过500字。' },
          { role: 'user', content: oldText }
        ],
        temperature: 0.3,
        max_tokens: 600
      }),
      signal
    })

    if (!resp.ok) throw new Error(`Summarize failed: ${resp.status}`)
    const json = await resp.json() as { choices: Array<{ message: { content: string } }> }
    const summary = json.choices[0]?.message?.content ?? ''

    const systemMsgs = messages.filter(m => m.role === 'system')
    return [...systemMsgs, { role: 'user', content: `[上文压缩摘要]\n${summary}\n[继续当前任务]` }, ...keep]
  } catch (e) {
    console.error('[Compact] llmSummaryCompact failed:', (e as Error).message)
    return null
  }
}

// ── Main compaction function ──

export async function compactMessages(
  projectId: string,
  messages: LlmMessage[],
  contextWindow: number = 128000,
  signal?: AbortSignal
): Promise<{ messages: LlmMessage[]; compacted: boolean; level: CompactionLevel }> {
  const currentTokens = estimateMessagesTokens(messages)
  const hl = healthLevel(currentTokens, contextWindow)

  if (hl !== 'red') {
    return { messages, compacted: false, level: 'none' }
  }

  const st = getState(projectId)
  console.log('[Compact] triggered', { tokens: currentTokens, window: contextWindow, health: hl, previousLevel: st.lastLevel })

  // Level 1: ToolResultCompact (always try first, zero cost)
  if (st.lastLevel === 'none' || st.lastLevel === 'tool_compact') {
    const compacted = compactToolResults(messages, Math.max(4, Math.floor(messages.length * 0.3)))
    const newTokens = estimateMessagesTokens(compacted)
    st.lastLevel = 'tool_compact'
    st.lastCompactAt = Date.now()
    st.compactCount++
    console.log('[Compact] tool_compact:', { before: currentTokens, after: newTokens, savings: currentTokens - newTokens })
    if (newTokens < currentTokens * 0.7) {
      return { messages: compacted, compacted: true, level: 'tool_compact' }
    }
  }

  // Level 2: StoreSummaryCompact (DB-based, zero LLM cost)
  if (st.lastLevel === 'tool_compact' || st.lastLevel === 'store_compact') {
    const compacted = storeSummaryCompact(projectId, messages, Math.max(4, Math.floor(messages.length * 0.2)))
    const newTokens = estimateMessagesTokens(compacted)
    st.lastLevel = 'store_compact'
    st.lastCompactAt = Date.now()
    st.compactCount++
    console.log('[Compact] store_compact:', { before: currentTokens, after: newTokens, savings: currentTokens - newTokens })
    if (newTokens < currentTokens * 0.6) {
      return { messages: compacted, compacted: true, level: 'store_compact' }
    }
  }

  // Level 3: LLM FullSummary (expensive, try last)
  if (st.consecutiveFailures < 3) {
    try {
      const compacted = await llmSummaryCompact(projectId, messages, Math.max(3, Math.floor(messages.length * 0.15)), signal)
      if (compacted) {
        const newTokens = estimateMessagesTokens(compacted)
        st.lastLevel = 'llm_summary'
        st.lastCompactAt = Date.now()
        st.compactCount++
        st.consecutiveFailures = 0
        st.summaryMessage = compacted.find(m => m.content?.includes('[上文压缩摘要]')) ?? null
        console.log('[Compact] llm_summary:', { before: currentTokens, after: newTokens, savings: currentTokens - newTokens })
        return { messages: compacted, compacted: true, level: 'llm_summary' }
      }
    } catch { st.consecutiveFailures++ }
  }

  // Fallback: hard truncate
  console.warn('[Compact] all levels exhausted, hard truncating')
  const systemMsgs = messages.filter(m => m.role === 'system')
  const recent = messages.slice(-6)
  // Deduplicate: remove system messages from recent if they're already in systemMsgs
  const recentNonSystem = recent.filter(m => m.role !== 'system')
  return { messages: [...systemMsgs, ...recentNonSystem], compacted: true, level: 'store_compact' }
}

// ── Health check for UI ──

export function compactHealth(projectId: string, messages: LlmMessage[], window: number): { level: CompactionLevel; tokens: number; percent: number; color: 'green' | 'yellow' | 'red'; compactCount: number } {
  const tokens = estimateMessagesTokens(messages)
  const percent = Math.round((tokens / window) * 100)
  return {
    level: getState(projectId).lastLevel,
    tokens,
    percent,
    color: healthLevel(tokens, window),
    compactCount: getState(projectId).compactCount
  }
}

export { resetState as resetCompactState }
