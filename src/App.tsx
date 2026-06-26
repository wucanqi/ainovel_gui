import { useEffect, useState } from 'react'
import { api } from './lib/ipc'
import type { Project, SystemStatus } from '@shared/types'
import { ProjectList } from './pages/ProjectList'
import { EditorPage } from './pages/EditorPage'
import { Settings } from './pages/Settings'
import { StoryBiblePage } from './pages/StoryBiblePage'
import { OrchestrationPage } from './pages/OrchestrationPage'
import { ErrorBoundary } from './components/ErrorBoundary'

type View =
  | { name: 'projects' }
  | { name: 'editor'; project: Project }
  | { name: 'bible'; project: Project }
  | { name: 'orchestrator'; project: Project }
  | { name: 'settings' }

export default function App(): JSX.Element {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [view, setView] = useState<View>({ name: 'projects' })
  const [projects, setProjects] = useState<Project[]>([])

  const refreshStatus = (): void => {
    void api.system.status().then((s: SystemStatus) => setStatus(s))
  }

  const refreshProjects = (): void => {
    void api.project.list().then((p: Project[]) => setProjects(p))
  }

  useEffect(() => {
    refreshStatus()
    refreshProjects()
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-ink">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-4">
        <span className="mr-4 text-sm font-semibold tracking-wide text-ink">NovelTool</span>
        {view.name === 'editor' || view.name === 'bible' || view.name === 'orchestrator' ? (
          <>
            <NavButton active onClick={() => setView({ name: 'projects' })}>
              ← 返回项目
            </NavButton>
            <span className="ml-2 truncate text-sm text-ink-soft">{view.project.title}</span>
            <NavButton active={view.name === 'editor'} onClick={() => setView({ name: 'editor', project: view.project })}>
              ✍️ 编辑器
            </NavButton>
            <NavButton active={view.name === 'bible'} onClick={() => setView({ name: 'bible', project: view.project })}>
              📖 创作启动中心
            </NavButton>
            <NavButton active={view.name === 'orchestrator'} onClick={() => setView({ name: 'orchestrator', project: view.project })}>
              ⚙️ 自动编排台
            </NavButton>
          </>
        ) : (
          <>
            <NavButton active={view.name === 'projects'} onClick={() => setView({ name: 'projects' })}>
              项目
            </NavButton>
            <NavButton active={view.name === 'settings'} onClick={() => setView({ name: 'settings' })}>
              设置
            </NavButton>
          </>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-ink-faint">
          <StatusDot ok={!!status?.dbReady} label="DB" />
          <StatusDot ok={!!status?.vecReady} label={`vec ${status?.vecVersion ?? ''}`} />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary>
        {view.name === 'projects' ? (
          <div className="h-full overflow-auto">
            <ProjectList
              projects={projects}
              onChange={refreshProjects}
              onOpen={(p) => setView({ name: 'editor', project: p })}
            />
          </div>
        ) : view.name === 'editor' ? (
          <EditorPage project={view.project} />
        ) : view.name === 'bible' ? (
          <StoryBiblePage
            project={view.project}
            onLaunchReady={() => setView({ name: 'orchestrator', project: view.project })}
          />
        ) : view.name === 'orchestrator' ? (
          <OrchestrationPage project={view.project} />
        ) : (
          <div className="h-full overflow-auto">
            <Settings />
          </div>
        )}
        </ErrorBoundary>
      </main>

      <footer className="flex h-7 shrink-0 items-center border-t border-line px-4 text-[11px] text-ink-faint">
        {status ? (
          <span>
            DB: {status.dbPath} · 表数: {status.tableCount}
          </span>
        ) : (
          <span>加载中…</span>
        )}
      </footer>
    </div>
  )
}

function NavButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-sm transition-colors ${
        active ? 'bg-bg-softer text-ink' : 'text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function StatusDot({ ok, label }: { ok: boolean; label: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span
        className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
      />
      {label}
    </span>
  )
}
