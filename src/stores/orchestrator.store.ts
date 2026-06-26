import { create } from 'zustand'
import { api } from '../lib/ipc'
import type {
  OrchestratorState,
  SystemState,
  BoundaryConditions,
  OrchestrationLogEntry,
  AgentSession,
  AgentType,
  ExecutionMode,
  RecoveryStatus,
  CheckpointType
} from '@shared/types'

interface OrchestratorStore {
  projectId: string | null
  state: SystemState | null
  conditions: BoundaryConditions | null
  logs: OrchestrationLogEntry[]
  sessions: AgentSession[]
  recovery: RecoveryStatus | null
  agentOutput: Array<{ type: 'thinking' | 'tool_call' | 'tool_result' | 'error' | 'checkpoint'; content: string; timestamp: number }>
  running: boolean
  polling: ReturnType<typeof setInterval> | null
  automation: ReturnType<typeof setInterval> | null
  autoRunning: boolean

  load: (projectId: string) => Promise<void>
  refresh: () => Promise<void>
  start: () => Promise<{ state: string; message: string }>
  tick: () => Promise<{ state: OrchestratorState; action: string; details: Record<string, unknown> }>
  pause: () => Promise<void>
  resume: () => Promise<void>
  setExecutionMode: (mode: ExecutionMode) => Promise<void>
  runAgent: (userMessage?: string) => Promise<void>
  reset: () => Promise<void>
  startAutomation: () => Promise<void>
  stopAutomation: () => void
  clearOutput: () => void
  clearRecovery: () => void
  startPolling: () => void
  stopPolling: () => void
  destroy: () => void
}

const AGENT_RUN_STATES: OrchestratorState[] = [
  'architecting',
  'contract_generation',
  'writing',
  'polishing',
  'chapter_review',
  'chapter_rewrite',
  'arc_review',
  'volume_review',
  'next_arc_plan'
]

function checkpointShouldStop(mode: ExecutionMode, checkpoint: CheckpointType): boolean {
  switch (mode) {
    case 'full_auto':
      return checkpoint === 'arc_done' || checkpoint === 'volume_done' || checkpoint === 'gate_failed' || checkpoint === 'agent_error'
    case 'arc_auto':
      return checkpoint === 'chapter_done' || checkpoint === 'arc_done' || checkpoint === 'gate_failed' || checkpoint === 'agent_error'
    case 'node_review':
      return true
    case 'semi_auto':
      return true
    default:
      return true
  }
}

export const useOrchestratorStore = create<OrchestratorStore>((set, get) => ({
  projectId: null,
  state: null,
  conditions: null,
  logs: [],
  sessions: [],
  recovery: null,
  agentOutput: [],
  running: false,
  polling: null,
  automation: null,
  autoRunning: false,

  load: async (projectId: string) => {
    const store = get()
    if (store.polling) clearInterval(store.polling)

    set({ projectId, state: null, conditions: null, logs: [], sessions: [], recovery: null, agentOutput: [], polling: null, automation: null, autoRunning: false })

    try {
      const [state, logs, sessions, recovery] = await Promise.all([
        api.orchestrator.getState(projectId),
        api.orchestrator.getLogs(projectId, 50),
        api.orchestrator.getSessions(projectId),
        api.orchestrator.getRecoveryStatus(projectId)
      ])
      set({ state: state as unknown as SystemState, logs, sessions, recovery })
    } catch {
      // project may not have orchestrator state yet
    }
  },

  refresh: async () => {
    const { projectId } = get()
    if (!projectId) return

    try {
      const [state, logs, sessions] = await Promise.all([
        api.orchestrator.getState(projectId),
        api.orchestrator.getLogs(projectId, 50),
        api.orchestrator.getSessions(projectId)
      ])
      set({ state: state as unknown as SystemState, logs, sessions })
    } catch {
      // project may not have orchestrator state yet
    }
  },

  clearRecovery: () => set({ recovery: null }),

  reset: async () => {
    const { projectId } = get()
    if (!projectId) throw new Error('No project')

    const appendOutput = (type: OrchestratorStore['agentOutput'][0]['type'], content: string) => {
      set((s) => ({
        agentOutput: [...s.agentOutput, { type, content, timestamp: Date.now() }]
      }))
    }

    get().stopAutomation()
    appendOutput('thinking', '[系统] 重置编排器...')
    const result = await api.orchestrator.reset(projectId)
    appendOutput('tool_result', `[编排器] ${result.message}`)
    set({ recovery: null })
    await get().refresh()
  },

  start: async () => {
    const { projectId } = get()
    if (!projectId) throw new Error('No project')

    const appendOutput = (type: OrchestratorStore['agentOutput'][0]['type'], content: string) => {
      set((s) => ({
        agentOutput: [...s.agentOutput, { type, content, timestamp: Date.now() }]
      }))
    }

    set({ recovery: null })
    appendOutput('thinking', '[系统] 启动编排器...')
    const result = await api.orchestrator.start(projectId)
    appendOutput('tool_result', `[编排器] ${result.message}`)
    await get().refresh()
    return { state: result.phase, message: result.message }
  },

  tick: async () => {
    const { projectId } = get()
    if (!projectId) throw new Error('No project')

    const appendOutput = (type: OrchestratorStore['agentOutput'][0]['type'], content: string) => {
      set((s) => ({
        agentOutput: [...s.agentOutput, { type, content, timestamp: Date.now() }]
      }))
    }

    appendOutput('thinking', '[系统] 单步推进（使用 executeTurn）...')
    // tick is now executeTurn
    appendOutput('tool_result', `[编排器] tick 已合并到 executeTurn，请使用执行按钮`)
    await get().refresh()
    return { state: 'idle' as OrchestratorState, action: 'deprecated', details: { message: 'use executeTurn' } }
  },

  pause: async () => {
    const { projectId } = get()
    if (!projectId) return

    await api.orchestrator.pause(projectId)
    get().stopAutomation()
    await get().refresh()
  },

  resume: async () => {
    const { projectId } = get()
    if (!projectId) return

    const appendOutput = (type: OrchestratorStore['agentOutput'][0]['type'], content: string) => {
      set((s) => ({
        agentOutput: [...s.agentOutput, { type, content, timestamp: Date.now() }]
      }))
    }

    const result = await api.orchestrator.resume(projectId)
    appendOutput('tool_result', `[编排器] ${result.message}`)
    await get().refresh()
  },

  setExecutionMode: async (_mode: ExecutionMode) => {
    // deprecated: no more execution modes in new architecture
    await get().refresh()
  },

  runAgent: async (userMessage?: string) => {
    const { projectId } = get()
    if (!projectId) return

    set({ running: true })
    const appendOutput = (type: OrchestratorStore['agentOutput'][0]['type'], content: string, ts?: number) => {
      set((s) => ({
        agentOutput: [...s.agentOutput, { type, content, timestamp: ts ?? Date.now() }]
      }))
    }

    const unsubscribers: Array<() => void> = []
    try {
      appendOutput('thinking', `[开始] 执行 Coordinator turn`)
      if (userMessage) appendOutput('thinking', `[指令] ${userMessage}`)

      const startTs = Date.now()
      const response = await api.orchestrator.resume(projectId)
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(1)
      appendOutput('tool_result', `[耗时] ${elapsed}s`)
      await get().refresh()
    } catch (e) {
      const msg = (e as Error).message
      appendOutput('error', `[异常] ${msg}`)
    } finally {
      for (const u of unsubscribers) u()
      set({ running: false })
    }
  },

  startAutomation: async () => {
    const store = get()
    const { projectId, state, automation } = store
    if (!projectId || !state) return
    if (automation) return

    const appendOutput = (type: OrchestratorStore['agentOutput'][0]['type'], content: string) => {
      set((s) => ({
        agentOutput: [...s.agentOutput, { type, content, timestamp: Date.now() }]
      }))
    }

    appendOutput('tool_result', `[自动推进] 开始，模式: ${state.auto_mode}`)
    await api.orchestrator.resume(projectId)
    set({ autoRunning: true })

    const step = async (): Promise<void> => {
      const current = get()
      const latestState = current.state
      if (!projectId || !latestState) return
      if (current.running) return
      if (latestState.is_paused === 1) return

      // Deprecated automation loop - use host.store instead
      const mode = latestState.auto_mode as unknown as ExecutionMode
      const currentState = (latestState.orchestrator_state ?? 'idle') as OrchestratorState
      if (mode === 'semi_auto') {
        current.stopAutomation()
        return
      }
      if (currentState === 'idle' || currentState === 'completed') {
        current.stopAutomation()
        return
      }
      if (AGENT_RUN_STATES.includes(currentState as OrchestratorState)) {
        await current.runAgent()
      } else {
        await current.tick()
      }
      await current.refresh()
    }

    const id = setInterval(() => {
      void step()
    }, 1200)
    set({ automation: id, autoRunning: true })
    await step()
  },

  stopAutomation: () => {
    const { automation } = get()
    if (automation) clearInterval(automation)
    set({ automation: null, autoRunning: false })
    set((s) => ({
      agentOutput: [...s.agentOutput, { type: 'tool_result' as const, content: '[自动推进] 已停止', timestamp: Date.now() }]
    }))
  },

  clearOutput: () => set({ agentOutput: [] }),

  startPolling: () => {
    const { polling } = get()
    if (polling) return

    const id = setInterval(() => {
      void get().refresh()
    }, 3000)
    set({ polling: id })
  },

  stopPolling: () => {
    const { polling } = get()
    if (polling) {
      clearInterval(polling)
      set({ polling: null })
    }
  },

  destroy: () => {
    const { polling, automation } = get()
    if (polling) clearInterval(polling)
    if (automation) clearInterval(automation)
    set({ projectId: null, state: null, conditions: null, logs: [], sessions: [], recovery: null, agentOutput: [], polling: null, automation: null, autoRunning: false })
  }
}))
