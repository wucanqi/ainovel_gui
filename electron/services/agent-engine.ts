import type { ToolDefinition, ToolResult, AgentResponse, AgentType, JSONSchema } from '@shared/types'
import { getActive, getProviderForTier } from './config.service'
import { executeTool, logAgentDecision, createAgentSession } from './tool-executor'
import { resolveModel } from './model-router.service'
import { getDb } from '../db'
import { uuid, now } from '../lib/util'

function setSessionStatus(sessionId: string, status: 'running' | 'completed' | 'aborted'): void {
  const db = getDb()
  const endedAt = status === 'completed' || status === 'aborted' ? now() : null
  db.prepare(
    'UPDATE agent_sessions SET status = ?, ended_at = ? WHERE id = ?'
  ).run(status, endedAt, sessionId)
}

const MAX_ROUNDS = 12

interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

interface LlmToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: JSONSchema
  }
}

interface LlmChoice {
  index: number
  message: {
    role: string
    content: string | null
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
  }
  finish_reason: string
}

function jsonSchemaToOpenAI(schema: JSONSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: schema.type,
    properties: {}
  }
  if (schema.required) {
    result.required = schema.required
  }
  for (const [key, prop] of Object.entries(schema.properties)) {
    const p: Record<string, unknown> = { type: prop.type }
    if (prop.description) p.description = prop.description
    if (prop.enum) p.enum = prop.enum
    if (prop.items) {
      const items: Record<string, unknown> = { type: prop.items.type }
      if (prop.items.description) items.description = prop.items.description
      p.items = items
    }
    if (prop.properties) {
      p.properties = {}
      for (const [sk, sv] of Object.entries(prop.properties)) {
        const sp: Record<string, unknown> = { type: sv.type }
        if (sv.description) sp.description = sv.description
        ;(p.properties as Record<string, unknown>)[sk] = sp
      }
    }
    ;(result.properties as Record<string, unknown>)[key] = p
  }
  return result
}

function buildToolsForLLM(tools: ToolDefinition[]): LlmToolDef[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }))
}

async function callLlm(
  messages: LlmMessage[],
  tools: LlmToolDef[],
  route: { agentType: AgentType; taskType: string; riskLevel?: 'low' | 'normal' | 'high' | 'critical' },
  signal?: AbortSignal
): Promise<LlmChoice> {
  const provider = getActive()
  if (!provider) {
    console.error('[AgentEngine] callLlm ERROR: no active provider')
    throw new Error('未配置 API，请先在设置中添加')
  }
  if (!provider.apiKey) {
    console.error('[AgentEngine] callLlm ERROR: API key not set for provider', provider.provider)
    throw new Error('API Key 未设置')
  }

  const routing = resolveModel(route.agentType, route.taskType, {
    riskLevel: route.riskLevel
  })
  const routedProvider = getProviderForTier(routing.tier) || provider
  const url = `${routedProvider.base_url.replace(/\/$/, '')}/chat/completions`
  const model = routing.model || routedProvider.llm_model || provider.llm_model || 'gpt-4o-mini'

  console.log('[AgentEngine] callLlm', {
    agentType: route.agentType,
    taskType: route.taskType,
    riskLevel: route.riskLevel,
    provider: routedProvider.provider,
    baseUrl: routedProvider.base_url,
    model,
    tier: routing.tier,
    toolCount: tools.length,
    messageCount: messages.length
  })

  const maxOutTokens = route.agentType === 'architect' ? 16384 : 4096

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: maxOutTokens
  }

  if (tools.length > 0) {
    body.tools = tools
    body.tool_choice = 'auto'
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${routedProvider.apiKey}`
    },
    body: JSON.stringify(body),
    signal
  })

  if (!resp.ok) {
    const detail = await resp.text()
    console.error('[AgentEngine] callLlm HTTP error', { status: resp.status, detail: detail.slice(0, 500) })
    throw new Error(`LLM API 错误 ${resp.status}: ${detail}`)
  }

  const json = (await resp.json()) as {
    choices: LlmChoice[]
  }
  const choice = json.choices[0]
  console.log('[AgentEngine] callLlm response', {
    finishReason: choice.finish_reason,
    hasContent: !!choice.message.content,
    contentPreview: choice.message.content?.slice(0, 100),
    hasToolCalls: !!choice.message.tool_calls,
    toolCallNames: choice.message.tool_calls?.map(tc => tc.function.name)
  })
  return choice
}

function buildSystemPrompt(agentType: AgentType): string {
  switch (agentType) {
    case 'architect':
      return `你是一位资深小说架构师（Architect）。你的职责是：

**核心任务：**
1. 创意收敛：分析用户输入，明确创作方向
2. 类型定位：确定故事的主类型和子类型
3. 核心卖点：提炼故事的独特吸引力
4. 故事指南针：定义终局方向、核心冲突、主题、目标读者、情感基调、叙事视角
5. 书名候选：生成多个有吸引力的书名选项
6. 人物弧：为每个角色设计完整的成长轨迹（起点、终点、核心谎言、核心真相、关键转折点）
7. 世界规则：建立世界观的核心规则体系
8. 卷弧骨架：规划卷→弧的层级结构，每个弧要有明确目标
9. 弧细纲：为每个弧规划详细的章节计划（每章目标、场景、伏笔、POV、预估字数）
10. 伏笔规划：注册伏笔，规划埋下/推进/回收的时间点

**工作流程：**
- 先做整体规划（指南针、类型定位），再做细节（人物弧、世界规则、章节计划）
- 滚动规划：不要一次性规划全部卷，只需要规划前1-2卷的弧骨架，以及首弧的详细章节计划
- 每完成一个阶段，使用对应的工具将结果写入数据库
- 全部完成后，使用 report_architecture_done 工具提交

**注意事项：**
- 所有产出必须通过工具写入数据库，不要只在对话中输出文本
- 如果用户没有明确指令，基于已有设定做出合理推断
- 每次只调用1-3个工具，调用后等待结果再继续
- 不要重复调用同一个工具
- 使用 create_character 创建人物后，再使用 create_character_arc 为其创建人物弧`

    case 'writer':
      return `你是一位专业小说写手（Writer）。你的职责是：

**核心任务：**
1. 制定章节计划：根据弧大纲中的章节目标，制定详细的场景列表、节奏、视角
2. 撰写正文：写出高质量的章节内容
3. 一致性检查：检查本章是否与设定、前文、人物状态一致
4. 产出章节摘要：总结本章关键事件和状态变化
5. 更新角色状态：记录角色在本章后的状态变化（位置、情绪、目标、持有物品）
6. 更新角色关系：记录角色间关系的变化
7. 更新世界状态：记录世界观层面的变化
8. 更新伏笔状态：标记伏笔的埋下/推进/回收
9. 设定下一章衔接提示：为下一章提供写作方向

**工作流程：**
- 写作前必须先调用 get_chapter_contract 和 get_knowledge_contract 读取契约
- 在 plan_gate 阶段先使用 create_chapter_plan 制定章节计划
- 在 writing 阶段再使用 write_chapter_body 撰写正文
- 使用 consistency_check 执行一致性检查
- 草稿完成后调用 request_draft_review 请求门禁检查
- 只有章节被系统 commit 后，才能使用 create_chapter_summary 与更新角色状态、关系、世界状态、伏笔状态
- 使用 set_next_chapter_hint 设定下一章衔接提示

**注意事项：**
- 你只负责当前章节，不要决定全局方向
- 严格遵循上下文提供的弧目标、角色状态、伏笔计划
- 优先使用工具写入数据库，正文内容通过 write_chapter_body 写入
- 正文使用 HTML 格式，段落用 <p> 标签包裹
- 保持与前一章的风格和语气一致
- 每章建议 2000-4000 字
- 不得再调用 report_chapter_done；Writer 没有最终提交权`

    case 'editor':
      return `你是一位资深小说编辑（Editor）。你的职责是：

**核心任务：**
1. 章级评审：检查单章质量（文字、节奏、一致性）
2. 弧级评审：检查弧目标是否完成、人物弧是否推进、伏笔是否按计划处理、节奏是否成立、钩子是否自然、设定是否一致
3. 卷级评审：检查大阶段故事是否成立、人物弧整体推进、伏笔全局台账、指南针是否偏移
4. 产出评审结果：通过（pass）、打磨（polish）、重写（rewrite_chapter）、重新规划（replan）
5. 生成弧摘要：总结弧的关键事件和人物变化
6. 生成角色快照：记录角色在弧/卷结束时的状态
7. 生成伏笔结转：标记哪些伏笔带到下一弧
8. 生成卷摘要：总结卷的关键内容
9. 更新故事指南针：在卷级评审后，如有偏移则更新指南针

**评审维度：**
- 情节（plot）：故事推进是否合理、有吸引力
- 人物（character）：人物行为是否符合弧设计
- 节奏（pacing）：章节节奏是否合适
- 伏笔（foreshadowing）：伏笔是否按计划处理
- 一致性（consistency）：设定、人物、前文是否一致
- 钩子（hook）：章节结尾是否足够吸引读者

**判定标准：**
- pass：整体质量良好，可以使用
- polish：有局部问题需要打磨，指定具体章节和打磨点
- rewrite_chapter：某章需要重写，附原因
- replan：弧目标或规划需要重新调整，附建议

**注意事项：**
- 评审必须有具体依据，不能泛泛而谈
- 如果需要打磨或重写，必须指定具体章节和原因
- 评分要客观，不要全部满分
- 使用工具写入评审结果，不要只在对话中输出`

    default:
      return 'You are a helpful assistant.'
  }
}

export interface AgentRunOptions {
  projectId: string
  agentType: AgentType
  tools: ToolDefinition[]
  context: string
  mode: string
  userMessage?: string
  signal?: AbortSignal
  systemPrompt?: string
  onThinking?: (thinking: string) => void
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void
  onToolResult?: (toolName: string, result: ToolResult) => void
  onSummary?: (summary: string) => void
  taskType?: string
  riskLevel?: 'low' | 'normal' | 'high' | 'critical'
}

function inferTaskType(agentType: AgentType, mode: string): string {
  if (agentType === 'architect') {
    return mode === 'contract_generation' ? 'chapter_contract' : 'arc_outline'
  }
  if (agentType === 'writer') {
    if (mode === 'plan_gate') return 'chapter_plan'
    return 'chapter_draft'
  }
  if (agentType === 'editor') {
    if (mode === 'volume_review') return 'volume_review'
    if (mode === 'arc_review' || mode === 'arc_review_pending') return 'arc_review'
    return 'consistency_check'
  }
  return 'any'
}

function inferRiskLevel(agentType: AgentType, taskType: string): 'low' | 'normal' | 'high' | 'critical' {
  if (agentType === 'architect' && taskType === 'knowledge_contract') return 'critical'
  if (agentType === 'architect') return 'high'
  if (agentType === 'editor' && (taskType === 'arc_review' || taskType === 'volume_review')) return 'high'
  if (agentType === 'editor') return 'normal'
  return 'low'
}

export async function runAgent(options: AgentRunOptions): Promise<AgentResponse> {
  const {
    projectId,
    agentType,
    tools,
    context,
    mode,
    userMessage,
    signal,
    onThinking,
    onToolCall,
    onToolResult,
    onSummary,
    taskType,
    riskLevel
  } = options

  console.log('[AgentEngine] runAgent start', { projectId, agentType, mode, toolCount: tools.length, contextLength: context.length, hasUserMessage: !!userMessage })

  const sessionId = createAgentSession(projectId, agentType, mode, context)
  setSessionStatus(sessionId, 'running')
  const systemPrompt = options.systemPrompt ?? buildSystemPrompt(agentType)
  const llmTools = buildToolsForLLM(tools)

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: userMessage
        ? `${userMessage}\n\n当前项目上下文：\n${context}`
        : `请根据以下项目上下文执行你的任务：\n\n${context}`
    }
  ]

  const allThinking: string[] = []
  let roundNumber = 0
  const resolvedTaskType = taskType || inferTaskType(agentType, mode)
  const resolvedRiskLevel = riskLevel || inferRiskLevel(agentType, resolvedTaskType)

  try {
    while (roundNumber < MAX_ROUNDS) {
      roundNumber++

      if (signal?.aborted) {
        console.log('[AgentEngine] runAgent aborted by signal')
        setSessionStatus(sessionId, 'aborted')
        throw new DOMException('Agent 执行被取消', 'AbortError')
      }

      const choice = await callLlm(messages, llmTools, {
        agentType,
        taskType: resolvedTaskType,
        riskLevel: resolvedRiskLevel
      }, signal)
      const msg = choice.message

    if (msg.content) {
      allThinking.push(msg.content)
      onThinking?.(msg.content)
    }

    const toolCalls = msg.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: msg.content ?? null,
        tool_calls: toolCalls
      })

      for (const tc of toolCalls) {
        const toolName = tc.function.name
        let toolArgs: Record<string, unknown> = {}
        try {
          toolArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>
        } catch {
          console.error('[AgentEngine] failed to parse tool arguments:', tc.function.name, tc.function.arguments?.slice(0, 200))
          messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ success: false, error: `参数解析失败: ${tc.function.arguments?.slice(0, 200)}` })
          })
          continue
        }

        console.log('[AgentEngine] runAgent round', roundNumber, 'tool call:', toolName)
        onToolCall?.(toolName, toolArgs)

        const result = await executeTool(projectId, toolName, toolArgs)
        console.log('[AgentEngine] runAgent round', roundNumber, 'tool result:', toolName, { success: result.success, error: result.error })

        logAgentDecision(
          projectId,
          sessionId,
          agentType,
          roundNumber,
          toolName,
          toolArgs,
          result.success ? (result.data as Record<string, unknown> ?? {}) : { error: result.error },
          msg.content ?? ''
        )

        onToolResult?.(toolName, result)

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        })
      }

      if (choice.finish_reason === 'stop') {
        break
      }
      continue
    }

    if (choice.finish_reason === 'stop') {
      messages.push({
        role: 'assistant',
        content: msg.content ?? ''
      })
      break
    }

    messages.push({
      role: 'assistant',
      content: msg.content ?? ''
    })
    }

    const summary = allThinking.join('\n\n')
    onSummary?.(summary)

    setSessionStatus(sessionId, 'completed')
    console.log('[AgentEngine] runAgent done', { projectId, agentType, rounds: roundNumber, thinkingLength: allThinking.join('').length })
    return {
      thinking: allThinking.join('\n'),
      tool_calls: [],
      done: true,
      summary
    }
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === 'AbortError'
    if (!isAbort) {
      console.error('[AgentEngine] runAgent error', e)
    }
    setSessionStatus(sessionId, 'aborted')
    throw e
  }
}

export interface AgentStreamOptions extends AgentRunOptions {
  onToken?: (token: string) => void
}

export async function runAgentStreaming(options: AgentStreamOptions): Promise<AgentResponse> {
  const {
    projectId,
    agentType,
    tools,
    context,
    mode,
    userMessage,
    signal,
    onThinking,
    onToolCall,
    onToolResult,
    onSummary,
    onToken,
    taskType,
    riskLevel
  } = options

  const sessionId = createAgentSession(projectId, agentType, mode, context)
  setSessionStatus(sessionId, 'running')
  const systemPrompt = options.systemPrompt ?? buildSystemPrompt(agentType)
  const llmTools = buildToolsForLLM(tools)

  const provider = getActive()
  if (!provider) throw new Error('未配置 API，请先在设置中添加')
  if (!provider.apiKey) throw new Error('API Key 未设置')

  const resolvedTaskType = taskType || inferTaskType(agentType, mode)
  const resolvedRiskLevel = riskLevel || inferRiskLevel(agentType, resolvedTaskType)
  const routing = resolveModel(agentType, resolvedTaskType, {
    riskLevel: resolvedRiskLevel
  })
  const routedProvider = getProviderForTier(routing.tier) || provider
  const url = `${routedProvider.base_url.replace(/\/$/, '')}/chat/completions`
  const model = routing.model || routedProvider.llm_model || provider.llm_model || 'gpt-4o-mini'

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: userMessage
        ? `${userMessage}\n\n当前项目上下文：\n${context}`
        : `请根据以下项目上下文执行你的任务：\n\n${context}`
    }
  ]

  const allThinking: string[] = []
  let roundNumber = 0

  try {
    while (roundNumber < MAX_ROUNDS) {
      roundNumber++

      if (signal?.aborted) {
        console.log('[AgentEngine] runAgentStreaming aborted by signal')
        setSessionStatus(sessionId, 'aborted')
        throw new DOMException('Agent 执行被取消', 'AbortError')
      }

    const maxOutTokens = agentType === 'architect' ? 16384 : 4096

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.7,
      max_tokens: maxOutTokens,
      stream: true
    }

    if (llmTools.length > 0) {
      body.tools = llmTools
      body.tool_choice = 'auto'
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${routedProvider.apiKey}`
      },
      body: JSON.stringify(body),
      signal
    })

    if (!resp.ok) {
      const detail = await resp.text()
      throw new Error(`LLM API 错误 ${resp.status}: ${detail}`)
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map()
    let contentAccumulator = ''
    let finishReason = ''

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
            choices: Array<{
              index: number
              delta: {
                content?: string
                tool_calls?: Array<{
                  index: number
                  id?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
              finish_reason?: string
            }>
          }

          const choice = json.choices[0]
          if (!choice) continue

          const delta = choice.delta

          if (delta.content) {
            contentAccumulator += delta.content
            onToken?.(delta.content)
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallAccumulators.get(tc.index) ?? {
                id: '',
                name: '',
                arguments: ''
              }
              if (tc.id) existing.id = tc.id
              if (tc.function?.name) existing.name = tc.function.name
              if (tc.function?.arguments) existing.arguments += tc.function.arguments
              toolCallAccumulators.set(tc.index, existing)
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    if (contentAccumulator) {
      allThinking.push(contentAccumulator)
      onThinking?.(contentAccumulator)
    }

    if (toolCallAccumulators.size > 0) {
      const toolCalls = Array.from(toolCallAccumulators.values()).map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments }
      }))

      messages.push({
        role: 'assistant',
        content: contentAccumulator || null,
        tool_calls: toolCalls
      })

      for (const tc of toolCalls) {
        let toolArgs: Record<string, unknown> = {}
        try {
          toolArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>
        } catch {
          console.error('[AgentEngine] streaming: failed to parse tool arguments:', tc.function.name, tc.function.arguments?.slice(0, 200))
          messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ success: false, error: `参数解析失败` })
          })
          continue
        }

        onToolCall?.(tc.function.name, toolArgs)

        const result = await executeTool(projectId, tc.function.name, toolArgs)

        logAgentDecision(
          projectId,
          sessionId,
          agentType,
          roundNumber,
          tc.function.name,
          toolArgs,
          result.success ? (result.data as Record<string, unknown> ?? {}) : { error: result.error },
          contentAccumulator
        )

        onToolResult?.(tc.function.name, result)

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        })
      }

      if (finishReason === 'stop') {
        break
      }
    } else if (finishReason === 'stop') {
      messages.push({
        role: 'assistant',
        content: contentAccumulator
      })
      break
    } else {
      // No tool calls and finishReason is not 'stop' (e.g., null/undefined/length)
      // Push the assistant message and break to avoid infinite loop
      messages.push({
        role: 'assistant',
        content: contentAccumulator
      })
      break
    }
    }

    const summary = allThinking.join('\n\n')
    onSummary?.(summary)

    setSessionStatus(sessionId, 'completed')
    return {
      thinking: allThinking.join('\n'),
      tool_calls: [],
      done: true,
      summary
    }
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === 'AbortError'
    if (!isAbort) {
      console.error('[AgentEngine] runAgentStreaming error', e)
    }
    setSessionStatus(sessionId, 'aborted')
    throw e
  }
}
