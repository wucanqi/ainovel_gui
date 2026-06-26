import { create } from 'zustand'
import { api } from '../lib/ipc'
import type { OrchestrationLogEntry, AgentSession, RecoveryStatus } from '@shared/types'

type OutputEntry = {
  type: 'system' | 'coordinator' | 'subagent' | 'subagent_think' | 'tool_call' | 'tool_result' | 'phase_change' | 'flow_change' | 'progress' | 'error' | 'checkpoint'
  content: string
  fullContent?: string
  timestamp: number
  meta?: Record<string, unknown>
}

interface HostStore {
  projectId: string | null
  state: Record<string, unknown> | null
  progress: Record<string, unknown> | null
  logs: OrchestrationLogEntry[]
  sessions: AgentSession[]
  recovery: RecoveryStatus | null
  output: OutputEntry[]
  running: boolean
  error: string | null
  polling: ReturnType<typeof setInterval> | null
  automation: ReturnType<typeof setInterval> | null
  autoRunning: boolean
  load: (projectId: string) => Promise<void>
  refresh: () => Promise<void>
  start: () => Promise<void>
  resume: () => Promise<void>
  pause: () => Promise<void>
  reset: () => Promise<void>
  steer: (text: string) => Promise<void>
  startAutomation: () => void
  stopAutomation: () => void
  clearOutput: () => void
  clearRecovery: () => void
  clearError: () => void
  startPolling: () => void
  stopPolling: () => void
  destroy: () => void
}

function append(set: (u: Partial<HostStore> | ((s: HostStore) => Partial<HostStore>)) => void, type: OutputEntry['type'], content: string, ts?: number, full?: string, meta?: Record<string, unknown>) {
  const display = (full ?? content).slice(0, 500)
  set((s) => ({ output: [...s.output, { type, content: display, fullContent: full ?? content, timestamp: ts ?? Date.now(), meta }] }))
}

let _listeners: Array<() => void> = []

function setupListeners(set: (u: Partial<HostStore> | ((s: HostStore) => Partial<HostStore>)) => void): void {
  _listeners.forEach(u => u())
  _listeners = []
  const u: Array<() => void> = []
  u.push(api.on('agentThinking' as 'agentThinking', (p: unknown) => { const d = p as { text: string; ts: number }; set({ running: true }); append(set, 'system', d.text.slice(0, 200), d.ts, d.text) }))
  u.push(api.on('coordinatorThinking' as 'coordinatorThinking', (p: unknown) => { const d = p as { text: string; timestamp: number }; set({ running: true }); append(set, 'coordinator', d.text, d.timestamp, d.text) }))
  u.push(api.on('subagentStart' as 'subagentStart', (p: unknown) => { const d = p as { agentType: string; task: string; timestamp: number }; set({ running: true }); append(set, 'subagent', `▶ ${d.agentType}: ${d.task}`, d.timestamp, d.task, { agentType: d.agentType }) }))
  u.push(api.on('subagentDone' as 'subagentDone', (p: unknown) => { const d = p as { agentType: string; done: boolean; summary: string; timestamp: number }; append(set, 'subagent', `✓ ${d.agentType} done`, d.timestamp, d.summary, { agentType: d.agentType }) }))
  u.push(api.on('subagentThinking' as 'subagentThinking', (p: unknown) => { const d = p as { agentType: string; text: string; timestamp: number }; set({ running: true }); append(set, 'subagent_think', `${d.agentType}: ${d.text}`, d.timestamp, d.text) }))
  u.push(api.on('subagentToolCall' as 'subagentToolCall', (p: unknown) => { const d = p as { agentType: string; toolName: string; args: Record<string, unknown>; timestamp: number }; append(set, 'tool_call', `${d.agentType} → ${d.toolName}`, d.timestamp, JSON.stringify(d.args, null, 2), { agentType: d.agentType, tool: d.toolName }) }))
  u.push(api.on('subagentToolResult' as 'subagentToolResult', (p: unknown) => { const d = p as { agentType: string; toolName: string; success: boolean; error?: string; timestamp: number }; d.success ? append(set, 'tool_result', `${d.agentType}: ${d.toolName} ✓`, d.timestamp) : append(set, 'error', `${d.agentType}: ${d.toolName} ✗`, d.timestamp, d.error) }))
  u.push(api.on('phaseChanged' as 'phaseChanged', (p: unknown) => { const d = p as { from: string; to: string; timestamp: number }; append(set, 'phase_change', `Phase ${d.from} → ${d.to}`, d.timestamp) }))
  u.push(api.on('progressUpdated' as 'progressUpdated', (p: unknown) => { const d = p as { chapter: number; total: number; timestamp: number }; append(set, 'progress', `第${d.chapter}/${d.total}章`, d.timestamp) }))
  u.push(api.on('checkpointReached' as 'checkpointReached', (p: unknown) => { const d = p as { message: string; timestamp: number }; append(set, 'checkpoint', d.message, d.timestamp) }))
  u.push(api.on('agentError' as 'agentError', (p: unknown) => { const d = p as { message: string; timestamp: number }; append(set, 'error', d.message.slice(0, 500), d.timestamp, d.message) }))
  _listeners = u
}

export const useHostStore = create<HostStore>((set, get) => ({
  projectId: null, state: null, progress: null, logs: [], sessions: [], recovery: null, output: [], running: false, error: null, polling: null, automation: null, autoRunning: false,

  load: async (pid) => {
    get().polling && clearInterval(get().polling!)
    set({ projectId: pid, state: null, progress: null, logs: [], sessions: [], recovery: null, output: [], polling: null, automation: null, autoRunning: false, running: false, error: null })
    setupListeners(set)
    try {
      const [s, p, l, ss, r] = await Promise.all([api.orchestrator.getState(pid), api.orchestrator.getProgress(pid), api.orchestrator.getLogs(pid, 100), api.orchestrator.getSessions(pid), api.orchestrator.getRecoveryStatus(pid)])
      const lc = (s as Record<string, unknown>)?.lifecycle as string
      set({ state: s, progress: p, logs: l, sessions: ss, recovery: r, running: lc === 'running', error: null })
    } catch (e) { set({ error: `加载编排状态失败: ${(e as Error).message}` }); console.error('[host.store] load error:', e) }
  },
  refresh: async () => {
    const { projectId: pid } = get(); if (!pid) return
    try {
      const [s, p, l, ss, r] = await Promise.all([
        api.orchestrator.getState(pid),
        api.orchestrator.getProgress(pid),
        api.orchestrator.getLogs(pid, 100),
        api.orchestrator.getSessions(pid),
        api.orchestrator.getRecoveryStatus(pid)
      ])
      const lc = (s as Record<string, unknown>)?.lifecycle as string
      set({ state: s, progress: p, logs: l, sessions: ss, recovery: r, error: null,
        running: lc === 'running',
        autoRunning: lc === 'running' ? get().autoRunning : false
      })
    } catch (e) { console.error('[host.store] refresh error:', e) }
  },
  clearRecovery: () => set({ recovery: null }),
  clearError: () => set({ error: null }),
  reset: async () => { const { projectId: pid } = get(); if (!pid) return; get().stopAutomation(); set({ running: false }); await api.orchestrator.reset(pid); set({ recovery: null }); await get().refresh() },
  start: async () => { const { projectId: pid } = get(); if (!pid) return; set({ running: true }); await api.orchestrator.start(pid); await get().refresh() },
  resume: async () => { const { projectId: pid } = get(); if (!pid) return; set({ running: true }); await api.orchestrator.resume(pid); await get().refresh() },
  pause: async () => { const { projectId: pid } = get(); if (!pid) return; await api.orchestrator.pause(pid); get().stopAutomation(); set({ running: false }); await get().refresh() },
  steer: async (text) => { const { projectId: pid } = get(); if (!pid) return; await api.orchestrator.steer(pid, text) },
  startAutomation: () => {
    const { projectId: pid, state: st, automation: a } = get()
    if (!pid || !st || a) { if (!a) set({ autoRunning: true }); return }
    const lc = (st as Record<string, unknown>)?.lifecycle as string
    if (lc === 'paused') { void api.orchestrator.resume(pid).then(() => get().refresh()) }
    else if (lc !== 'running') { void api.orchestrator.start(pid).then(() => get().refresh()) }
    set({ autoRunning: true, running: true })
  },
  stopAutomation: () => { const { automation: a, projectId: pid } = get(); if (a) clearInterval(a); set({ automation: null, autoRunning: false, running: false }); if (pid) void api.orchestrator.pause(pid).then(() => get().refresh()) },
  clearOutput: () => set({ output: [] }),
  startPolling: () => { if (get().polling) return; set({ polling: setInterval(() => { void get().refresh() }, 3000) }) },
  stopPolling: () => { const { polling: p } = get(); if (p) { clearInterval(p); set({ polling: null }) } },
  destroy: () => { const { polling: p, automation: a } = get(); if (p) clearInterval(p); if (a) clearInterval(a); _listeners.forEach(u => u()); _listeners = []; set({ projectId: null, state: null, progress: null, logs: [], sessions: [], recovery: null, output: [], polling: null, automation: null, autoRunning: false }) }
}))
