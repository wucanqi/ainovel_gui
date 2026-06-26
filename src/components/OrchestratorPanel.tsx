import { useEffect, useRef, useState } from 'react'
import { useHostStore } from '../stores/host.store'
import type { OrchestratorState, AgentType } from '@shared/types'

const STATE_LABELS: Record<OrchestratorState, string> = {
  idle: '空闲',
  initializing: '初始化',
  architecting: '架构设计',
  contract_generation: '契约生成',
  plan_gate: '计划门禁',
  draft_gate: '草稿门禁',
  writing: '写作中',
  arc_review_pending: '待评审',
  arc_review: '弧评审',
  arc_passed: '评审通过',
  polishing: '打磨中',
  chapter_review: '章评审',
  chapter_rewrite: '章重写',
  next_arc_plan: '下一弧规划',
  volume_review: '卷评审',
  completed: '已完成'
}

const STATE_COLORS: Record<OrchestratorState, string> = {
  idle: 'bg-bg-softer text-ink-faint',
  initializing: 'bg-blue-500/15 text-blue-300',
  architecting: 'bg-purple-500/15 text-purple-300',
  contract_generation: 'bg-indigo-500/15 text-indigo-300',
  plan_gate: 'bg-amber-500/15 text-amber-300',
  draft_gate: 'bg-red-500/15 text-red-300',
  writing: 'bg-emerald-500/15 text-emerald-300',
  arc_review_pending: 'bg-orange-500/15 text-orange-300',
  arc_review: 'bg-orange-500/15 text-orange-300',
  arc_passed: 'bg-emerald-500/15 text-emerald-300',
  polishing: 'bg-yellow-500/15 text-yellow-300',
  chapter_review: 'bg-orange-500/15 text-orange-300',
  chapter_rewrite: 'bg-rose-500/15 text-rose-300',
  next_arc_plan: 'bg-purple-500/15 text-purple-300',
  volume_review: 'bg-blue-500/15 text-blue-300',
  completed: 'bg-emerald-500/15 text-emerald-300'
}

const AGENT_LABELS: Record<AgentType, string> = {
  architect: 'Architect 架构师',
  writer: 'Writer 写手',
  editor: 'Editor 编辑'
}

export function OrchestratorPanel({ projectId }: { projectId: string }): JSX.Element {
  const {
    state,
    logs,
    output: agentOutput,
    running: agentRunning,
    load,
    refresh,
    start,
    pause,
    resume,
    clearOutput,
    startPolling,
    stopPolling,
    destroy
  } = useHostStore()

  const [statusMsg, setStatusMsg] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void load(projectId)
    startPolling()
    return () => {
      stopPolling()
      destroy()
    }
  }, [projectId])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [agentOutput])

  const currentState = state?.orchestrator_state ?? (state ? 'idle' : null)
  const isPaused = state?.is_paused === 1
  const activeAgent = state?.active_agent as AgentType | undefined
  const phase = (state?.phase as string) ?? '-'
  const flow = (state?.flow as string) ?? '-'

  const handleStart = async () => {
    try {
      await start()
      setStatusMsg('编排已启动')
    } catch (e) {
      setStatusMsg(`错误: ${(e as Error).message}`)
    }
  }

  const handlePause = async () => {
    await pause()
    setStatusMsg('已暂停')
  }

  const handleResume = async () => {
    await resume()
    setStatusMsg('已恢复')
  }

  const isRunning = currentState && currentState !== 'idle' && currentState !== 'completed'
  const isLoading = state === null

  return (
    <div className="flex h-full flex-col bg-bg-soft">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-sm font-medium text-ink">编排器</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${currentState ? STATE_COLORS[currentState as OrchestratorState] : 'bg-bg-softer text-ink-faint'}`}>
          {currentState ? STATE_LABELS[currentState as OrchestratorState] : '加载中...'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 控制按钮 */}
        <div className="border-b border-line px-3 py-2">
          <div className="flex gap-1.5">
            {!isLoading && !isRunning && currentState !== 'completed' && (
              <button
                onClick={handleStart}
                className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                启动编排
              </button>
            )}
            {isRunning && (
              <>
                <button
                  onClick={handlePause}
                  className="flex-1 rounded-md bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-500"
                >
                  暂停
                </button>
              </>
            )}
            {isPaused && currentState && currentState !== 'completed' && (
              <button
                onClick={handleResume}
                className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                恢复
              </button>
            )}
          </div>
          {statusMsg && (
            <p className="mt-1.5 text-[11px] text-ink-soft">{statusMsg}</p>
          )}
        </div>

        {/* 活跃 Agent */}
        {activeAgent && (
          <div className="border-b border-line px-3 py-2">
            <span className="text-[11px] text-ink-faint">活跃 Agent</span>
            <p className="text-xs font-medium text-ink">{AGENT_LABELS[activeAgent]}</p>
          </div>
        )}

        {/* Phase / Flow */}
        <div className="border-b border-line px-3 py-2">
          <span className="text-[11px] text-ink-faint">阶段 / 流程</span>
          <div className="mt-1 flex gap-2">
            <span className="rounded bg-bg-softer px-2 py-0.5 text-[10px] text-ink-soft">
              Phase: {phase ?? '-'}
            </span>
            <span className="rounded bg-bg-softer px-2 py-0.5 text-[10px] text-ink-soft">
              Flow: {flow ?? '-'}
            </span>
          </div>
        </div>

        {/* Agent 输出 */}
        <div className="border-b border-line">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] text-ink-faint">Agent 输出</span>
            {agentOutput.length > 0 && (
              <button
                onClick={clearOutput}
                className="text-[10px] text-ink-faint hover:text-ink-soft"
              >
                清空
              </button>
            )}
          </div>
          <div ref={outputRef} className="max-h-48 overflow-y-auto px-3 pb-2">
            {agentOutput.length === 0 && !agentRunning && (
              <p className="py-4 text-center text-[11px] text-ink-faint">
                点击「执行」启动 Agent
              </p>
            )}
            {agentOutput.map((entry, i) => (
              <div key={i} className="mb-1 rounded bg-bg px-2 py-1">
                <span className="text-[10px] text-ink-faint">
                  {new Date(entry.timestamp).toLocaleTimeString()}{' '}
                </span>
                <span
                  className={`text-[11px] ${
                    entry.type === 'error'
                      ? 'text-rose-400'
                      : entry.type === 'tool_call'
                        ? 'text-blue-400'
                        : entry.type === 'tool_result'
                          ? 'text-emerald-400'
                          : entry.type === 'phase_change' || entry.type === 'flow_change'
                            ? 'text-amber-400'
                          : entry.type === 'checkpoint'
                            ? 'text-fuchsia-400'
                          : 'text-ink-soft'
                  }`}
                >
                  {entry.type === 'tool_call' && '→ '}
                  {entry.type === 'tool_result' && '← '}
                  {entry.type === 'subagent' && '◆ '}
                  {entry.type === 'error' && '✗ '}
                  {entry.type === 'phase_change' && 'P '}
                  {entry.type === 'flow_change' && 'F '}
                  {entry.type === 'progress' && '▸ '}
                  {entry.type === 'checkpoint' && '⬥ '}
                  {entry.content}
                </span>
              </div>
            ))}
            {agentRunning && (
              <div className="mb-1 rounded bg-bg px-2 py-1">
                <span className="text-[11px] text-ink-faint animate-pulse">⏳ Agent 执行中...</span>
              </div>
            )}
          </div>
        </div>

        {/* 编排日志 */}
        <div className="px-3 py-2">
          <span className="text-[11px] text-ink-faint">编排日志</span>
          <div className="mt-1 max-h-32 overflow-y-auto">
            {logs.length === 0 && (
              <p className="py-2 text-center text-[11px] text-ink-faint">暂无日志</p>
            )}
            {logs.slice(0, 20).map((log) => (
              <div key={log.id} className="mb-0.5 text-[10px] text-ink-faint">
                <span className="text-ink-soft">
                  {log.event_type ?? (log.from_state ? STATE_LABELS[log.from_state as OrchestratorState] ?? log.from_state : '-')}
                </span>
                {log.to_state && <span className="mx-1">→</span>}
                {log.to_state && <span className="text-ink-soft">{STATE_LABELS[log.to_state as OrchestratorState] ?? log.to_state}</span>}
                <span className="ml-1.5 text-ink-faint">{log.reason}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
