import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getDb } from '../electron/db'
import { createTestProject, uuid, now } from './setup'
import { runAgent } from '../electron/services/agent-engine'
import { registerTools } from '../electron/services/tool-executor'
import type { ToolDefinition } from '@shared/types'

vi.mock('../electron/services/config.service', () => ({
  getActive: () => ({
    base_url: 'https://api.openai.com/v1',
    llm_model: 'gpt-4o-mini',
    apiKey: 'test-key'
  }),
  getProviderForTier: () => ({
    base_url: 'https://api.openai.com/v1',
    llm_model: 'gpt-4o-mini',
    apiKey: 'test-key'
  })
}))

describe('Agent Engine', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('should run agent with tool calls and produce results', async () => {
    const projectId = createTestProject()

    const tools: ToolDefinition[] = [
      {
        name: 'create_character',
        description: 'Create a character',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Character name' },
            role: { type: 'string', description: 'Character role' },
            appearance: { type: 'string' },
            personality: { type: 'string' },
            background: { type: 'string' },
            notes: { type: 'string' }
          },
          required: ['name', 'role']
        },
        async handler(pid, args) {
          const db = getDb()
          const id = uuid()
          const ts = now()
          db.prepare(
            `INSERT INTO characters (id, project_id, name, role, appearance, personality, background, notes, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(id, pid, args.name, args.role, args.appearance || '', args.personality || '', args.background || '', args.notes || '', ts)
          return { success: true, data: { id } }
        }
      },
      {
        name: 'report_architecture_done',
        description: 'Report architecture is complete',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Architecture summary' }
          }
        },
        async handler(_pid, args) {
          return { success: true, data: { summary: args.summary } }
        }
      }
    ]

    registerTools(tools)

    const mockFetch = vi.fn()

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: '我来创建角色',
              tool_calls: [{
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'create_character',
                  arguments: JSON.stringify({
                    name: '测试角色',
                    role: 'protagonist',
                    appearance: '高大',
                    personality: '勇敢',
                    background: '神秘',
                    notes: '测试'
                  })
                }
              }]
            },
            finish_reason: 'tool_calls'
          }]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: '架构完成',
              tool_calls: [{
                id: 'call_2',
                type: 'function',
                function: {
                  name: 'report_architecture_done',
                  arguments: JSON.stringify({ summary: '架构设计完成' })
                }
              }]
            },
            finish_reason: 'stop'
          }]
        })
      })

    vi.stubGlobal('fetch', mockFetch)

    const response = await runAgent({
      projectId,
      agentType: 'architect',
      tools,
      context: JSON.stringify({ projectId, currentState: 'architecting' }),
      mode: 'architecting',
      userMessage: '请创建角色并完成架构'
    })

    expect(response.done).toBe(true)
    expect(response.thinking).toContain('我来创建角色')
    expect(response.thinking).toContain('架构完成')

    const db = getDb()
    const chars = db.prepare('SELECT * FROM characters WHERE project_id = ?').all(projectId) as Array<Record<string, unknown>>
    expect(chars.length).toBe(1)
    expect(chars[0].name).toBe('测试角色')

    const decisions = db.prepare(
      'SELECT * FROM agent_decisions WHERE project_id = ? ORDER BY created_at ASC'
    ).all(projectId) as Array<Record<string, unknown>>
    expect(decisions.length).toBe(2)
    expect(decisions[0].tool_name).toBe('create_character')
    expect(decisions[1].tool_name).toBe('report_architecture_done')

    vi.unstubAllGlobals()
  })

  it('should handle LLM API error gracefully', async () => {
    const projectId = createTestProject()

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    })

    vi.stubGlobal('fetch', mockFetch)

    await expect(
      runAgent({
        projectId,
        agentType: 'architect',
        tools: [],
        context: '{}',
        mode: 'architecting',
        userMessage: 'test'
      })
    ).rejects.toThrow('LLM API 错误')

    vi.unstubAllGlobals()
  })

  it('should stop after max rounds', async () => {
    const projectId = createTestProject()

    const tools: ToolDefinition[] = [
      {
        name: 'keep_going',
        description: 'Never stop',
        parameters: { type: 'object', properties: {} },
        async handler() {
          return { success: true, data: {} }
        }
      }
    ]

    registerTools(tools)

    const mockFetch = vi.fn()

    for (let i = 0; i < 15; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: `Round ${i}`,
              tool_calls: [{
                id: `call_${i}`,
                type: 'function',
                function: {
                  name: 'keep_going',
                  arguments: '{}'
                }
              }]
            },
            finish_reason: 'tool_calls'
          }]
        })
      })
    }

    vi.stubGlobal('fetch', mockFetch)

    const response = await runAgent({
      projectId,
      agentType: 'architect',
      tools,
      context: '{}',
      mode: 'architecting'
    })

    expect(response.done).toBe(true)

    const db = getDb()
    const decisions = db.prepare(
      'SELECT COUNT(*) AS c FROM agent_decisions WHERE project_id = ?'
    ).get(projectId) as { c: number }
    expect(decisions.c).toBeLessThanOrEqual(15)

    vi.unstubAllGlobals()
  })

  it('should handle tool calls with no arguments', async () => {
    const projectId = createTestProject()

    const tools: ToolDefinition[] = [
      {
        name: 'no_arg_tool',
        description: 'Tool with no required args',
        parameters: { type: 'object', properties: {} },
        async handler() {
          return { success: true, data: { status: 'ok' } }
        }
      }
    ]

    registerTools(tools)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Done',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'no_arg_tool',
                arguments: '{}'
              }
            }]
          },
          finish_reason: 'stop'
        }]
      })
    })

    vi.stubGlobal('fetch', mockFetch)

    const response = await runAgent({
      projectId,
      agentType: 'architect',
      tools,
      context: '{}',
      mode: 'architecting'
    })

    expect(response.done).toBe(true)
    expect(response.thinking).toContain('Done')

    vi.unstubAllGlobals()
  })

  it('should handle assistant response without tool calls', async () => {
    const projectId = createTestProject()

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '我认为不需要执行任何工具调用。这是纯文本回复。'
          },
          finish_reason: 'stop'
        }]
      })
    })

    vi.stubGlobal('fetch', mockFetch)

    const response = await runAgent({
      projectId,
      agentType: 'architect',
      tools: [],
      context: '{}',
      mode: 'architecting'
    })

    expect(response.done).toBe(true)
    expect(response.thinking).toContain('纯文本回复')

    vi.unstubAllGlobals()
  })

  it('should handle malformed tool arguments', async () => {
    const projectId = createTestProject()

    const tools: ToolDefinition[] = [
      {
        name: 'create_character',
        description: 'Create character',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name' },
            role: { type: 'string', description: 'Role' },
            appearance: { type: 'string' },
            personality: { type: 'string' },
            background: { type: 'string' },
            notes: { type: 'string' }
          },
          required: ['name', 'role']
        },
        async handler(pid, args) {
          const db = getDb()
          const id = uuid()
          const ts = now()
          db.prepare(
            `INSERT INTO characters (id, project_id, name, role, appearance, personality, background, notes, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(id, pid, args.name, args.role, args.appearance || '', args.personality || '', args.background || '', args.notes || '', ts)
          return { success: true, data: { id } }
        }
      }
    ]

    registerTools(tools)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Creating character',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'create_character',
                arguments: 'not valid json at all'
              }
            }]
          },
          finish_reason: 'stop'
        }]
      })
    })

    vi.stubGlobal('fetch', mockFetch)

    const response = await runAgent({
      projectId,
      agentType: 'architect',
      tools,
      context: '{}',
      mode: 'architecting'
    })

    expect(response.done).toBe(true)

    vi.unstubAllGlobals()
  })
})
