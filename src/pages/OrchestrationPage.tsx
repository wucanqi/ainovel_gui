import { useEffect, useRef, useState } from 'react'
import { useHostStore } from '../stores/host.store'
import { useEditorStore } from '../stores/editor.store'
import { api } from '../lib/ipc'
import type { Character, Project } from '@shared/types'

const PHASE_LABELS: Record<string, string> = { init: '初始', premise: '前提设定', outline: '大纲规划', writing: '写作中', complete: '已完成' }
const FLOW_LABELS: Record<string, string> = { writing: '写作', reviewing: '评审', rewriting: '重写', polishing: '打磨', steering: '干预' }
const LIFECYCLE_LABELS: Record<string, string> = { idle: '空闲', running: '运行中', paused: '暂停', completed: '已完成' }

export function OrchestrationPage({ project }: { project: Project }): JSX.Element {
  const { state, progress, recovery, output, running, autoRunning, load, refresh, start, resume, pause, reset, steer, startAutomation, stopAutomation, clearOutput, clearRecovery, startPolling, stopPolling, destroy } = useHostStore()
  const { chapters, volumes, loadProject } = useEditorStore()
  const [characters, setCharacters] = useState<Character[]>([])
  const [statusMsg, setStatusMsg] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => { void load(project.id); void loadProject(project.id); void api.character.list(project.id).then(setCharacters); startPolling(); return () => { stopPolling(); destroy() } }, [project.id])
  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight }, [output])

  const s = state as Record<string,unknown>
  const phase = (s?.phase as string) ?? 'init'
  const lifecycle = (s?.lifecycle as string) ?? 'idle'
  const isRunning = lifecycle === 'running'
  const isPaused = lifecycle === 'paused'
  const currentChapter = (s?.current_chapter as number) ?? 0
  const [showResumeModal, setShowResumeModal] = useState(false)
  const [steerText, setSteerText] = useState('')
  const [pauseAfterSteer, setPauseAfterSteer] = useState(false)

  useEffect(() => {
    if (recovery?.needsRecovery || lifecycle === 'paused') {
      setShowResumeModal(true)
    }
  }, [recovery, lifecycle])

  const toggle = (i: number) => { const next = new Set(collapsed); next.has(i) ? next.delete(i) : next.add(i); setCollapsed(next) }

  return (
    <div className="flex h-full min-h-0 bg-[#10131a] text-ink" style={{ '--sidebar-left': '220px', '--sidebar-right': '260px' } as React.CSSProperties}>
      {/* Left sidebar: status + controls */}
      <aside className="flex w-[var(--sidebar-left,220px)] shrink-0 flex-col border-r border-line bg-[#0d1017]">
        <div className="border-b border-line px-4 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-ink-faint">Coordinator</div>
          <div className="mt-1 text-sm font-semibold text-ink">编排控制台</div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <div className="rounded-lg border border-line bg-[#121722] p-3">
            <div className="text-xs text-ink-faint">Phase</div>
            <div className="text-sm font-medium text-ink">{PHASE_LABELS[phase] ?? phase}</div>
          </div>
          <div className="rounded-lg border border-line bg-[#121722] p-3">
            <div className="text-xs text-ink-faint">Flow</div>
            <div className="text-sm font-medium text-ink">{FLOW_LABELS[s?.flow as string] ?? '-'}</div>
          </div>
          <div className="rounded-lg border border-line bg-[#121722] p-3">
            <div className="text-xs text-ink-faint">状态</div>
            <span className={`rounded px-2 py-1 text-[10px] ${isRunning ? 'bg-[#1d8f6a]/20 text-[#87d7b1]' : isPaused ? 'bg-[#9c7040]/20 text-[#f2c185]' : 'bg-[#0d1017] text-ink-faint'}`}>{LIFECYCLE_LABELS[lifecycle]}</span>
          </div>
          <div className="rounded-lg border border-line bg-[#121722] p-3">
            <div className="text-xs text-ink-faint">进度</div>
            <div className="text-sm font-medium text-ink">第 {s?.current_chapter as number ?? 0} 章</div>
          </div>
          <div className="space-y-2 pt-2">
            {!isRunning && !isPaused && (<button onClick={() => { clearRecovery(); void start() }} className="w-full rounded-md bg-[#d46b2c] px-3 py-2 text-sm font-medium text-white hover:bg-[#e07a39]">启动编排</button>)}
            {isRunning && (<><button onClick={() => autoRunning ? stopAutomation() : startAutomation()} className="w-full rounded-md bg-[#1d8f6a] px-3 py-2 text-xs text-white hover:bg-[#28a37a]">{autoRunning ? '停止自动' : '自动推进'}</button><button onClick={() => void pause()} className="w-full rounded-md bg-[#9c7040] px-3 py-2 text-xs text-white hover:bg-[#b1814d] mt-1">暂停</button></>)}
            {isPaused && (<button onClick={() => void resume().then(() => startAutomation())} className="w-full rounded-md bg-[#1d8f6a] px-3 py-2 text-xs text-white hover:bg-[#28a37a]">恢复</button>)}
            {(isRunning || isPaused) && (<button onClick={() => void reset()} className="w-full rounded-md bg-red-700/50 px-3 py-2 text-xs text-white hover:bg-red-700 mt-1">重置</button>)}
          </div>
        </div>
      </aside>

      {/* Main: output */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-line bg-[#121722] px-5 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-ink-faint">{project.title}</div>
            <div className="mt-1 text-sm text-[#f2c185]">{statusMsg || (recovery?.needsRecovery ? `⚠ ${recovery.message}` : '编排器就绪')}</div>
          </div>
          <div className="flex gap-2">
            {output.length > 0 && <button onClick={clearOutput} className="rounded border border-line px-2 py-1 text-[11px] text-ink-faint hover:text-ink">清空</button>}
            <button onClick={() => setExpanded(new Set(output.map((_, i) => i)))} className="rounded border border-line px-2 py-1 text-[11px] text-ink-faint hover:text-ink">展开全部</button>
            <button onClick={() => setExpanded(new Set())} className="rounded border border-line px-2 py-1 text-[11px] text-ink-faint hover:text-ink">折叠全部</button>
          </div>
        </div>
        <div ref={outputRef} className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
          {/* Resume confirmation modal */}
          {showResumeModal && (
            <div className="mb-4 rounded-lg border border-[#d46b2c]/50 bg-[#1a150e] p-5">
              <div className="text-sm font-medium text-[#f2c185] mb-3">
                {lifecycle === 'paused' ? '⚠ 检测到未完成的编排' : '⚠ 编排处于暂停状态'}
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4 text-xs text-ink-soft">
                <div className="rounded bg-[#0d1017] px-3 py-2">
                  <div className="text-ink-faint mb-1">Phase</div>
                  <div className="font-medium text-ink">{PHASE_LABELS[phase]}</div>
                </div>
                <div className="rounded bg-[#0d1017] px-3 py-2">
                  <div className="text-ink-faint mb-1">Flow</div>
                  <div className="font-medium text-ink">{FLOW_LABELS[s?.flow as string] ?? '-'}</div>
                </div>
                <div className="rounded bg-[#0d1017] px-3 py-2">
                  <div className="text-ink-faint mb-1">当前章节</div>
                  <div className="font-medium text-ink">{currentChapter > 0 ? `第 ${currentChapter} 章` : '尚未开始'}</div>
                </div>
                <div className="rounded bg-[#0d1017] px-3 py-2">
                  <div className="text-ink-faint mb-1">状态</div>
                  <div className="font-medium text-ink">{LIFECYCLE_LABELS[lifecycle]}</div>
                </div>
              </div>
              {recovery?.message && (
                <div className="text-[11px] text-ink-faint mb-3">{recovery.message}</div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowResumeModal(false); clearRecovery(); void start().then(() => startAutomation()) }}
                  className="flex-1 rounded bg-[#1d8f6a] px-4 py-2 text-sm font-medium text-white hover:bg-[#28a37a]"
                >
                  继续编排
                </button>
                <button
                  onClick={() => { setShowResumeModal(false); clearRecovery(); void reset() }}
                  className="flex-1 rounded bg-[#9c7040] px-4 py-2 text-sm font-medium text-white hover:bg-[#b1814d]"
                >
                  重置重新开始
                </button>
                <button
                  onClick={() => setShowResumeModal(false)}
                  className="rounded border border-line px-4 py-2 text-sm text-ink-faint hover:text-ink"
                >
                  稍后决定
                </button>
              </div>
            </div>
          )}
          {output.length === 0 && !running && !showResumeModal && (<div className="py-16 text-center text-xs text-ink-faint">点击「启动编排」开始</div>)}
          {output.map((entry, i) => {
            const isCollapsed = collapsed.has(i)
            const hasFull = !!entry.fullContent && entry.fullContent.length > entry.content.length
            return (
              <div key={`${entry.timestamp}-${i}`} className={`mb-2 rounded-md border ${entry.type === 'error' ? 'border-rose-500/20 bg-rose-500/5' : entry.type === 'phase_change' ? 'border-amber-500/20 bg-amber-500/5' : entry.type === 'coordinator' ? 'border-sky-500/15 bg-sky-500/3' : entry.type === 'subagent' ? 'border-violet-500/15 bg-violet-500/3' : entry.type === 'subagent_think' ? 'border-violet-500/10 bg-transparent' : entry.type === 'checkpoint' ? 'border-fuchsia-500/15 bg-fuchsia-500/3' : entry.type === 'system' ? 'border-line/30 bg-transparent' : 'border-line bg-[#0d1017]'} ${hasFull ? 'cursor-pointer hover:border-[#d46b2c]/30' : ''}`} onClick={() => hasFull && toggle(i)}>
                <div className="flex items-start gap-2 px-3 py-2">
                  <span className={`text-[9px] uppercase tracking-wider font-mono shrink-0 mt-0.5 ${typeTone(entry.type)}`}>{typeLabel(entry.type)}</span>
                  <span className="text-[10px] text-ink-faint shrink-0 mt-0.5">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className={`text-xs leading-5 ${typeTone(entry.type)} ${isCollapsed && hasFull ? 'line-clamp-2' : ''}`}>
                    {isCollapsed ? entry.content : (entry.fullContent ?? entry.content)}
                  </span>
                  {hasFull && <span className="text-[9px] text-ink-faint shrink-0 mt-0.5 ml-auto">{isCollapsed ? '▶ 展开' : '▲ 收起'}</span>}
                </div>
              </div>
            )
          })}
          {running && <div className="text-xs text-[#f2c185] py-1">执行中...</div>}
        </div>
      </section>

      {/* Right: chapters + characters */}
      <aside className="flex w-[var(--sidebar-right,260px)] shrink-0 flex-col border-l border-line bg-[#0d1017]">
        <div className="border-b border-line px-4 py-3 text-xs font-medium text-ink">章节</div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {chapters.map(ch => (
            <div key={ch.id} className="mb-2 rounded border border-line bg-[#121722] px-3 py-2">
              <div className="text-xs font-medium text-ink">{ch.title}</div>
              <div className="text-[10px] text-ink-faint mt-1">{ch.word_count}字 · {ch.status}</div>
            </div>
          ))}
        </div>
        <div className="border-b border-line px-4 py-3 text-xs font-medium text-ink">人物</div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {characters.map(c => (
            <div key={c.id} className="mb-2 rounded border border-line bg-[#121722] px-3 py-2">
              <div className="text-xs font-medium text-ink">{c.name}</div>
              <div className="text-[10px] text-ink-faint mt-1">{c.role || '-'}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* Bottom intervention bar */}
      <div className="fixed bottom-0 border-t border-[#d46b2c]/40 bg-[#0d1017] px-4 py-2 z-10" style={{ left: 'var(--sidebar-left,220px)', right: 'var(--sidebar-right,260px)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ink-faint shrink-0">干预</span>
          <input
            value={steerText}
            onChange={(e) => setSteerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && steerText.trim()) {
                e.preventDefault()
                void steer(steerText.trim())
                setSteerText('')
                if (pauseAfterSteer && isRunning) void pause()
              }
            }}
            placeholder={isRunning ? "输入干预指令后回车（如: 第3章人设错误,张三应该更冷漠）" : isPaused ? "输入干预指令后回车（恢复时生效）" : "编排未启动"}
            disabled={!isRunning && !isPaused}
            className="flex-1 rounded border border-line bg-[#121722] px-3 py-1.5 text-xs text-ink outline-none focus:border-[#d46b2c] disabled:opacity-40"
          />
          <button
            onClick={() => { if (steerText.trim()) { void steer(steerText.trim()); setSteerText(''); if (pauseAfterSteer && isRunning) void pause() } }}
            disabled={!isRunning && !isPaused}
            className="rounded bg-[#d46b2c] px-3 py-1.5 text-xs text-white hover:bg-[#e07a39] disabled:opacity-40"
          >
            提交
          </button>
          <label className="flex items-center gap-1 text-[10px] text-ink-faint cursor-pointer shrink-0">
            <input type="checkbox" checked={pauseAfterSteer} onChange={(e) => setPauseAfterSteer(e.target.checked)} className="accent-[#d46b2c]" />
            提交后暂停
          </label>
        </div>
      </div>
    </div>
  )
}

function typeTone(t: string): string {
  if (t === 'error') return 'text-rose-300'
  if (t === 'phase_change') return 'text-amber-300 font-medium'
  if (t === 'progress') return 'text-emerald-300'
  if (t === 'subagent') return 'text-violet-300'
  if (t === 'subagent_think') return 'text-violet-200/70 text-[10px] italic'
  if (t === 'coordinator') return 'text-sky-300'
  if (t === 'tool_call') return 'text-cyan-300'
  if (t === 'tool_result') return 'text-emerald-300'
  if (t === 'system') return 'text-ink-faint'
  return 'text-ink-soft'
}
function typeLabel(t: string): string {
  if (t === 'coordinator') return 'C'
  if (t === 'subagent') return 'S'
  if (t === 'subagent_think') return 'think'
  if (t === 'tool_call') return '→'
  if (t === 'tool_result') return '←'
  if (t === 'phase_change') return 'PHASE'
  if (t === 'flow_change') return 'FLOW'
  if (t === 'progress') return 'PROG'
  if (t === 'error') return 'ERR'
  if (t === 'system') return '·'
  if (t === 'checkpoint') return '◆'
  return t
}
