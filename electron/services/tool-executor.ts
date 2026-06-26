import type { ToolDefinition, ToolResult } from '@shared/types'
import { getDb } from '../db'
import { uuid, now } from '../lib/util'

const toolRegistry = new Map<string, ToolDefinition>()

export function registerTool(tool: ToolDefinition): void {
  toolRegistry.set(tool.name, tool)
}

export function registerTools(tools: ToolDefinition[]): void {
  for (const tool of tools) {
    toolRegistry.set(tool.name, tool)
  }
  console.log('[Tool] registry updated, total tools:', toolRegistry.size, 'names:', Array.from(toolRegistry.keys()))
}

export function getTool(name: string): ToolDefinition | undefined {
  return toolRegistry.get(name)
}

export function getAllToolNames(): string[] {
  return Array.from(toolRegistry.keys())
}

export async function executeTool(
  projectId: string,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const tool = toolRegistry.get(name)
  if (!tool) {
    const firstArg = typeof args === 'object' ? JSON.stringify(args).slice(0, 200) : String(args).slice(0, 200)
    console.error('[Tool] NOT FOUND:', { name, argsPreview: firstArg, registeredTools: getAllToolNames().length })
    return { success: false, error: `Tool not found: ${name}` }
  }
  try {
    return await tool.handler(projectId, args)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[Tool] ERROR:', { name, error: message, stack: e instanceof Error ? e.stack?.slice(0, 300) : undefined })
    return { success: false, error: message }
  }
}

export function logAgentDecision(
  projectId: string,
  sessionId: string,
  agentType: string,
  roundNumber: number,
  toolName: string,
  toolArgs: Record<string, unknown>,
  toolResult: Record<string, unknown>,
  thinking: string
): void {
  const db = getDb()
  const id = uuid()
  const ts = now()
  db.prepare(
    `INSERT INTO agent_decisions
     (id, project_id, session_id, agent_type, round_number, tool_name, tool_args, tool_result, thinking, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    projectId,
    sessionId,
    agentType,
    roundNumber,
    toolName,
    JSON.stringify(toolArgs),
    JSON.stringify(toolResult),
    thinking,
    ts
  )
}

export function createAgentSession(
  projectId: string,
  agentType: string,
  mode: string,
  contextSnapshot: string
): string {
  const db = getDb()
  const id = uuid()
  const ts = now()
  db.prepare(
    `INSERT INTO agent_sessions
     (id, project_id, agent_type, mode, context_snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, projectId, agentType, mode, contextSnapshot, ts)
  return id
}